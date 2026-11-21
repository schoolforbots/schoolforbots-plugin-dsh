// 一条上课的 WebSocket 连接：hello、ack 对账、限速、记下续课用的 sessionId 和 lastSeq。
// 断了以后要不要重连、等多久，归 attendance.ts 管；这里只管这一条连接。
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { startHeartbeat, type Heartbeat } from './heartbeat.js'
import { PROTOCOL, type Ack, type ClientMessage, type MessageOf, type Outgoing, type PluginInfo, type ServerMessage } from './protocol.js'

export interface LinkOptions {
  /** wss://<学校>/v1/class */
  url: string
  key: string
  plugin: PluginInfo
  maxRounds: number
  resume?: { sessionId: number; lastSeq: number } | null
  onMessage: (msg: ServerMessage) => void
  ackTimeoutMs?: number
  /** 多久没有任何动静就当连接已经断了（毫秒，默认 75 秒）。 */
  idleTimeoutMs?: number
}

export interface LinkEnd {
  /** 服务器断开前发的 closing；没有就是网络断了或者学校重启。 */
  closing: MessageOf<'closing'> | null
  /** 升级请求被拒（钥匙不对）。 */
  unauthorized: boolean
  code: number
  /** 这条连接收到过 welcome。 */
  welcomed: boolean
}

export class ClassLink {
  readonly ended: Promise<LinkEnd>
  sessionId: number | null = null
  lastSeq = 0

  private ws: WebSocket
  private pending = new Map<string, { resolve: (a: Ack) => void; timer: NodeJS.Timeout }>()
  private sentAt: number[] = []
  private framesPerMinute = 60
  private closing: MessageOf<'closing'> | null = null
  private unauthorized = false
  private welcomed = false
  private finished = false
  private readonly ackTimeoutMs: number
  private heartbeat: Heartbeat | null = null

  constructor(private readonly opts: LinkOptions) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 30_000
    if (opts.resume) {
      this.sessionId = opts.resume.sessionId
      this.lastSeq = opts.resume.lastSeq
    }
    this.ws = new WebSocket(opts.url, { headers: { Authorization: `Bearer ${opts.key}` }, handshakeTimeout: 15_000 })
    this.ended = new Promise<LinkEnd>((resolve) => {
      const finish = (code: number) => {
        if (this.finished) return
        this.finished = true
        this.heartbeat?.stop()
        for (const [, p] of this.pending) {
          clearTimeout(p.timer)
          p.resolve({ type: 'ack', id: '', ok: false, error: { code: 'disconnected', message: '连接断了' } })
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
      const hello: Outgoing = {
        type: 'hello',
        protocol: PROTOCOL,
        plugin: opts.plugin,
        maxRounds: opts.maxRounds,
        ...(this.sessionId !== null ? { sessionId: this.sessionId, lastSeq: this.lastSeq } : {}),
      }
      void this.send(hello)
    })
    this.heartbeat = startHeartbeat(this.ws, { idleMs: opts.idleTimeoutMs })
    this.ws.on('message', (data) => {
      this.heartbeat?.touch()
      this.onRaw(String(data))
    })
  }

  private onRaw(text: string): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(text) as ServerMessage
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
        // 新的一节课：从头数 seq
        if (this.sessionId !== msg.session.sessionId) this.lastSeq = 0
        this.sessionId = msg.session.sessionId
        this.framesPerMinute = Math.max(1, msg.limits.framesPerMinute)
        break
      case 'class.event':
        if (msg.seq <= this.lastSeq) return // 补发过的不再处理
        this.lastSeq = msg.seq
        break
      case 'closing':
        this.closing = msg
        break
    }
    try {
      this.opts.onMessage(msg)
    } catch {
      // 处理消息出错不该弄断连接
    }
  }

  /** 发一条消息，等它的 ack。断线、超时也回一个失败的 ack（code 是 disconnected / timeout），不抛错。 */
  async send(body: Outgoing): Promise<Ack> {
    await this.waitForRoom()
    if (this.finished || this.ws.readyState !== WebSocket.OPEN) {
      return { type: 'ack', id: '', ok: false, error: { code: 'disconnected', message: '连接断了' } }
    }
    const id = randomUUID()
    const msg = { id, ...body } as ClientMessage
    return new Promise<Ack>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.heartbeat?.ackTimedOut()
        resolve({ type: 'ack', id, ok: false, error: { code: 'timeout', message: '学校没有回答' } })
      }, this.ackTimeoutMs)
      this.pending.set(id, { resolve, timer })
      this.sentAt.push(Date.now())
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
