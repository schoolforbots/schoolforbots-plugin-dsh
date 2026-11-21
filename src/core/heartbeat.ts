// 连接的心跳：发现静默断开的连接（笔记本睡眠后唤醒、换 Wi-Fi、NAT 超时，TCP 半开），主动断开，交给上学或社团循环重连。
// 不这样做，半开的连接既不报错也不关闭，`ended` 永远等不到，之后的课都会错过，直到重启 DSH。
//
// - 收到任何消息、ping、pong 都算"有动静"；
// - 每 pingMs 主动 ping 一次（学校也每 30 秒 ping 一次）；超过 idleMs 没有任何动静就 terminate()；
// - 连着 maxAckTimeouts 次请求等不到 ack，也 terminate()。
import type WebSocket from 'ws'

export interface HeartbeatOptions {
  idleMs?: number
  pingMs?: number
  maxAckTimeouts?: number
  now?: () => number
}

export interface Heartbeat {
  touch(): void
  ackOk(): void
  ackTimedOut(): void
  stop(): void
}

export function startHeartbeat(ws: WebSocket, o: HeartbeatOptions = {}): Heartbeat {
  const idleMs = o.idleMs ?? 75_000
  const pingMs = o.pingMs ?? 30_000
  const maxAckTimeouts = o.maxAckTimeouts ?? 2
  const now = o.now ?? Date.now
  let last = now()
  let ackTimeouts = 0
  const kill = () => {
    try {
      ws.terminate()
    } catch {
      // 已经关了
    }
  }
  const touch = () => {
    last = now()
  }
  ws.on('ping', touch)
  ws.on('pong', touch)
  const timer = setInterval(() => {
    if (now() - last > idleMs) return kill()
    if (ws.readyState === ws.OPEN) {
      try {
        ws.ping()
      } catch {
        // 下一轮再看
      }
    }
  }, Math.min(pingMs, Math.max(1_000, Math.floor(idleMs / 3))))
  timer.unref?.()
  return {
    touch,
    ackOk() {
      ackTimeouts = 0
    },
    ackTimedOut() {
      if (++ackTimeouts >= maxAckTimeouts) kill()
    },
    stop() {
      clearInterval(timer)
    },
  }
}
