// 一条社团的 WebSocket 连接（/v1/club）：hello、ack 对账、限速、按房间记下重连用的 roomId 和 lastSeq。
// 断了以后要不要重连、等多久，归 club-attendance.ts 管；这里只管这一条连接。写法照 class-link.ts。
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { startHeartbeat, type Heartbeat } from './heartbeat.js'
import { CLUB, type ClubAck, type ClubClosing, type ClubOutgoing, type ClubServerMessage } from './club-protocol.js'
import { PROTOCOL, type PluginInfo } from './protocol.js'

export interface ClubLinkOptions {
  /** wss://<学校>/v1/club */
  url: string
  key: string
  plugin: PluginInfo
  /** 重连：上次坐的房间和收到的最后一个房间事件。 */
  resume?: { roomId: string; lastSeq: number } | null
  onMessage: (msg: ClubServerMessage) => void
  /** 每收到（去掉补发过的重复事件以后）、发出一条消息调一次：给完整记录用。 */
  tap?: (dir: 'in' | 'out', frame: unknown) => void
  ackTimeoutMs?: number
  /** 多久没有任何动静就当连接已经断了（毫秒，默认 75 秒）。 */
  idleTimeoutMs?: number
}

export interface ClubLinkEnd {
  closing: ClubClosing | null
  unauthorized: boolean
  code: number
  welcomed: boolean
}

const failed = (id: string, code: string, message: string): ClubAck => ({ type: 'ack', id, ok: false, error: { code, message } })

export class ClubLink {
  readonly ended: Promise<ClubLinkEnd>
  /** 现在坐的房间；不在房间里是 null。 */
  roomId: string | null = null
  lastSeq = 0

  private ws: WebSocket
  private pending = new Map<string, { resolve: (a: ClubAck) => void; timer: NodeJS.Timeout }>()
  private sentAt: number[] = []
  private framesPerMinute = 60
  private closing: ClubClosing | null = null
  private unauthorized = false
  private welcomed = false
  private finished = false
  private readonly ackTimeoutMs: number
  private heartbeat: Heartbeat | null = null

  constructor(private readonly opts: ClubLinkOptions) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 30_000
    if (opts.resume) {
      this.roomId = opts.resume.roomId
      this.lastSeq = opts.resume.lastSeq
    }
    this.ws = new WebSocket(opts.url, { headers: { Authorization: `Bearer ${opts.key}` }, handshakeTimeout: 15_000 })
    this.ended = new Promise<ClubLinkEnd>((resolve) => {
      const finish = (code: number) => {
        if (this.finished) return
        this.finished = true
        this.heartbeat?.stop()
        for (const [, p] of this.pending) {
          clearTimeout(p.timer)
          p.resolve(failed('', 'disconnected', '连接断了'))
        }
        this.pending.clear()
        resolve({ closing: this.closing, unauthorized: this.unauthorized, code, welcomed: this.welcomed })
      }
      this.ws.on('unexpected-response', (_req, res) => {
        if (res.statusCode === 401) this.unauthorized = true
        this.ws.terminate()
        finish(res.statusCode ?? 0)
      })
      this.ws.on('close', (code) => finish(code))
      this.ws.on('error', () => finish(1006))
    })
    this.ws.on('open', () => {
      void this.send({
        type: 'hello',
        protocol: PROTOCOL,
        plugin: opts.plugin,
        club: CLUB,
        ...(this.roomId ? { roomId: this.roomId, lastSeq: this.lastSeq } : {}),
      })
    })
    this.heartbeat = startHeartbeat(this.ws, { idleMs: opts.idleTimeoutMs })
    this.ws.on('message', (data) => {
      this.heartbeat?.touch()
      this.onRaw(String(data))
    })
  }

  /** 坐进了一个房间（开房、进房、快速加入、接受邀请的 ack 里的房间状态）。 */
  enterRoom(roomId: string, lastSeq: number): void {
    if (this.roomId !== roomId) this.lastSeq = 0
    this.roomId = roomId
    this.lastSeq = Math.max(this.lastSeq, lastSeq)
  }

  private onRaw(text: string): void {
    let msg: ClubServerMessage
    try {
      msg = JSON.parse(text) as ClubServerMessage
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return
    switch (msg.type) {
      case 'ack': {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          this.heartbeat?.ackOk()
          p.resolve(msg)
        }
        break
      }
      case 'welcome':
        this.welcomed = true
        this.framesPerMinute = Math.max(1, msg.limits.framesPerMinute)
        if (msg.room) {
          // 回到同一个房间：服务器从我们的 lastSeq 往后补发；我们的比房间的还大（以前一个同编号的房间），服务器从头补发。
          // 没带 roomId 或者是别的房间：服务器不补发事件，从房间状态的 lastSeq 往后接。
          const same = this.roomId === msg.room.roomId
          this.roomId = msg.room.roomId
          this.lastSeq = same ? (this.lastSeq > msg.room.lastSeq ? 0 : this.lastSeq) : msg.room.lastSeq
        } else {
          this.roomId = null
          this.lastSeq = 0
        }
        break
      case 'room.event':
        // 只记自己坐的房间（观战的房间不记）；补发过的不再处理。私密消息会让 seq 跳号，不算丢。
        if (msg.roomId === this.roomId) {
          if (msg.seq <= this.lastSeq) return
          this.lastSeq = msg.seq
        }
        break
      case 'room.left':
        if (msg.roomId === this.roomId) {
          this.roomId = null
          this.lastSeq = 0
        }
        break
      case 'closing':
        this.closing = msg
        break
    }
    try {
      this.opts.tap?.('in', msg)
    } catch {
      // 录不下来不影响上课、打牌
    }
    try {
      this.opts.onMessage(msg)
    } catch {
      // 处理消息出错不该弄断连接
    }
  }

  /** 发一条消息，等它的 ack。断线、超时也回一个失败的 ack（code 是 disconnected / timeout），不抛错。 */
  async send(body: ClubOutgoing): Promise<ClubAck> {
    await this.waitForRoom()
    if (this.finished || this.ws.readyState !== WebSocket.OPEN) return failed('', 'disconnected', '连接断了')
    const id = randomUUID()
    return new Promise<ClubAck>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.heartbeat?.ackTimedOut()
        resolve(failed(id, 'timeout', '学校没有回答'))
      }, this.ackTimeoutMs)
      this.pending.set(id, { resolve, timer })
      this.sentAt.push(Date.now())
      const msg = { id, ...body }
      try {
        this.opts.tap?.('out', msg)
      } catch {
        // 录不下来不影响打牌
      }
      this.ws.send(JSON.stringify(msg))
    })
  }

  /** 每分钟最多 framesPerMinute 帧（welcome 里给的）：满了就等最早那一帧滑出一分钟。留一帧余量。 */
  private async waitForRoom(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.sentAt = this.sentAt.filter((t) => now - t < 60_000)
      if (this.sentAt.length < Math.max(1, this.framesPerMinute - 1)) return
      const wait = 60_000 - (now - this.sentAt[0]!) + 50
      await new Promise((r) => setTimeout(r, wait))
      if (this.finished) return
    }
  }

  close(): void {
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate()
    else this.ws.close(1000)
  }
}
