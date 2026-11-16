// 测试用的假学校：一个 HTTP 服务 + /v1/class 的 WebSocket。只做插件测试用得到的那部分行为。
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, Me, SchoolCalendar, ServerMessage, Welcome } from '../src/core/protocol.js'

export interface MockSchool {
  base: string
  classUrl: string
  /** 收到的每一条客户端消息（按连接）。 */
  received: ClientMessage[]
  hellos: Extract<ClientMessage, { type: 'hello' }>[]
  sockets: WebSocket[]
  me: Me
  calendar: SchoolCalendar
  key: string
  /** 连上并通过 hello 后调用；默认发 welcome。 */
  onHello: (ws: WebSocket, hello: Extract<ClientMessage, { type: 'hello' }>) => void
  /** 默认对每条非 hello 消息回 ok 的 ack。 */
  onClient: (ws: WebSocket, msg: ClientMessage) => void
  push: (ws: WebSocket, msg: ServerMessage) => void
  /** 给最近一个连接推一条消息。 */
  pushLast: (msg: ServerMessage) => void
  waitFor: (pred: (m: ClientMessage) => boolean, timeoutMs?: number) => Promise<ClientMessage>
  welcome: (overrides?: Partial<Welcome>) => Welcome
  http: { method: string; url: string; auth: string | undefined; body: unknown }[]
  close: () => Promise<void>
}

export async function startMockSchool(): Promise<MockSchool> {
  const school = {} as MockSchool
  school.key = 'test-key'
  school.received = []
  school.hellos = []
  school.sockets = []
  school.http = []
  school.me = {
    studentId: 7,
    ownerName: '阿杰',
    aiName: '小鱼',
    displayName: '阿杰家的小鱼',
    division: 'junior',
    slot: 'evening',
    status: 'active',
    className: '初中部·晚班·1班',
    lastRenamedAt: null,
    suspendedUntil: null,
    schoolRulesVersion: '2026-11-11',
  }
  school.calendar = { today: '2026-12-01', state: 'in_term', breakName: null, reopensOn: null, openingDay: '2026-12-01', breaks: [], maintenance: null }
  school.welcome = (o = {}) => ({
    type: 'welcome',
    student: { studentId: 7, displayName: '阿杰家的小鱼' },
    class: { classId: 1, className: '初中部·晚班·1班', teacher: { name: '老周' } },
    session: { sessionId: 101, kind: 'lesson', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 30 * 60_000).toISOString(), subject: '语文', title: '静夜思' },
    online: [
      { studentId: 7, displayName: '阿杰家的小鱼' },
      { studentId: 8, displayName: '小美家的阿花' },
    ],
    limits: { maxInitiationsPerLesson: 3, initiationsLeft: 3, maxRoundsPerConversation: 5, maxMessageChars: 300, maxQuestionsPerLesson: 3, framesPerMinute: 60, closingGraceSeconds: 60 },
    probation: false,
    ...o,
  })
  school.push = (ws, msg) => ws.send(JSON.stringify(msg))
  school.pushLast = (msg) => {
    const ws = school.sockets.at(-1)
    if (ws) school.push(ws, msg)
  }
  school.onHello = (ws) => school.push(ws, school.welcome())
  school.onClient = (ws, msg) => school.push(ws, { type: 'ack', id: msg.id, ok: true, result: msg.type === 'chat.start' ? { conversationId: 'c1' } : {} })

  const waiters: { pred: (m: ClientMessage) => boolean; resolve: (m: ClientMessage) => void }[] = []
  school.waitFor = (pred, timeoutMs = 5000) => {
    const hit = school.received.find(pred)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等不到这条消息')), timeoutMs)
      waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) })
    })
  }

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let s = ''
      req.on('data', (c) => (s += c))
      req.on('end', () => resolve(s ? JSON.parse(s) : undefined))
    })

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req)
    const auth = req.headers.authorization
    school.http.push({ method: req.method ?? '', url: req.url ?? '', auth, body })
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    const path = (req.url ?? '').split('?')[0]
    const authed = auth === `Bearer ${school.key}`
    if (path === '/v1/school-calendar') return json(200, school.calendar)
    if (path === '/v1/school-rules') return json(200, { version: '2026-11-11', changes: '第一版', url: 'https://example.org/rules', text: '校规正文', versions: ['2026-11-11'] })
    if (path === '/v1/registrations' && req.method === 'POST') return json(202, { registrationId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(Date.now() + 600_000).toISOString() })
    if (path?.startsWith('/v1/registrations/') && path.endsWith('/verify')) {
      if ((body as { code?: string })?.code !== '123456') return json(400, { error: { code: 'code_invalid', message: '验证码不对。' } })
      return json(201, { studentId: 7, key: school.key, status: 'pending' })
    }
    if (path?.startsWith('/v1/me') && !authed) return json(401, { error: { code: 'unauthorized', message: '钥匙不对。' } })
    if (path === '/v1/me') return json(200, school.me)
    if (path === '/v1/me/summaries') return json(200, { summaries: [] })
    return json(404, { error: { code: 'not_found', message: '没有这个地址。' } })
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.authorization !== `Bearer ${school.key}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{"error":{"code":"unauthorized","message":"钥匙不对。"}}')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      school.sockets.push(ws)
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as ClientMessage
        school.received.push(msg)
        for (const w of waiters.splice(0)) {
          if (w.pred(msg)) w.resolve(msg)
          else waiters.push(w)
        }
        if (msg.type === 'hello') {
          school.hellos.push(msg)
          school.push(ws, { type: 'ack', id: msg.id, ok: true })
          school.onHello(ws, msg)
        } else school.onClient(ws, msg)
      })
    })
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  school.base = `http://127.0.0.1:${port}`
  school.classUrl = `ws://127.0.0.1:${port}/v1/class`
  school.close = async () => {
    for (const ws of school.sockets) ws.terminate()
    wss.close()
    await new Promise<void>((r) => server.close(() => r()))
  }
  return school
}
