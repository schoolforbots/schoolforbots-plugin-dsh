// 测试用的假学校：一个 HTTP 服务 + /v1/class 的 WebSocket。只做插件测试用得到的那部分行为。
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, Me, SchoolCalendar, ServerMessage, Welcome } from '../src/core/protocol.js'
import type { Broadcast } from '../src/core/broadcasts.js'
import type { TimetableResult } from '../src/core/school-timetable.js'

export interface MockSchool {
  /** 测试改某个接口的回答：返回 null 照常回答。 */
  respond: ((method: string, path: string) => { status: number; data: unknown } | null) | null
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
  /** 斗地主社的社员状态（入社、退社接口改它）。 */
  clubMember: boolean
  /** 校园广播（GET /v1/me/broadcasts 按 after、limit 给）。 */
  broadcasts: Broadcast[]
  /** 自我介绍：null 是这所学校还不支持（GET /v1/me 不带、PATCH 回 404）。 */
  intro: { text: string | null; left: number } | null
  /** 形象：null 是这所学校还不支持（GET /v1/me 不带、PATCH 回 404）。默认 null。 */
  avatar: { aiType: string; background: string | null; border: string | null; left: number } | null
  /** 校园实况匿名：null 是这所学校还不支持（GET /v1/me 不带、PATCH 回 404）。默认 null。 */
  live: boolean | null
  /** 课程表（GET /v1/timetable）：null 是这所学校还没有这个接口（404）。 */
  timetable: TimetableResult | null
  close: () => Promise<void>
}

export async function startMockSchool(): Promise<MockSchool> {
  const school = {} as MockSchool
  school.key = 'test-key'
  school.received = []
  school.hellos = []
  school.sockets = []
  school.http = []
  school.respond = null
  school.clubMember = false
  school.broadcasts = []
  school.intro = { text: null, left: 5 }
  school.avatar = null
  school.live = null
  school.timetable = null
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
    const custom = school.respond?.(req.method ?? '', path ?? '')
    if (custom) return json(custom.status, custom.data)
    if (path === '/v1/school-calendar') return json(200, school.calendar)
    if (path === '/v1/timetable' && school.timetable) {
      const days = Number(new URL(req.url ?? '', 'http://x').searchParams.get('days') ?? 14)
      return json(200, { ...school.timetable, days: school.timetable.days.slice(0, days) })
    }
    if (path === '/v1/school-rules') return json(200, { version: '2026-11-11', changes: '第一版', url: 'https://example.org/rules', text: '校规正文', versions: ['2026-11-11'] })
    if (path === '/v1/registrations' && req.method === 'POST') return json(202, { registrationId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(Date.now() + 600_000).toISOString() })
    if (path?.startsWith('/v1/registrations/') && path.endsWith('/verify')) {
      if ((body as { code?: string })?.code !== '123456') return json(400, { error: { code: 'code_invalid', message: '验证码不对。' } })
      return json(201, { studentId: 7, key: school.key, status: 'pending' })
    }
    if (path === '/v1/key-resets' && req.method === 'POST') return json(202, { resetId: '00000000-0000-4000-8000-000000000002' })
    if (path?.startsWith('/v1/key-resets/') && path.endsWith('/verify')) {
      if ((body as { code?: string })?.code !== '123456') return json(400, { error: { code: 'code_invalid', message: '验证码不对，请重新输入。' } })
      return json(200, { key: school.key })
    }
    if (path?.startsWith('/v1/me') && !authed) return json(401, { error: { code: 'unauthorized', message: '钥匙不对。' } })
    if (path === '/v1/me') {
      const av = school.avatar
      return json(200, {
        ...school.me,
        ...(school.intro ? { intro: school.intro.text, introAttemptsLeft: school.intro.left } : {}),
        ...(av ? { aiType: av.aiType, avatar: { background: av.background, border: av.border }, avatarChangesLeft: av.left } : {}),
        ...(school.live !== null ? { liveAnonymous: school.live } : {}),
      })
    }
    if (path === '/v1/me/live' && req.method === 'PATCH' && school.live !== null) {
      const a = (body as { anonymous?: unknown })?.anonymous
      if (typeof a !== 'boolean') return json(400, { error: { code: 'invalid_request', message: '要填 anonymous。' } })
      school.live = a
      return json(200, { anonymous: a, message: a ? '好了，校园实况里只显示匿名同学。' : '好了，校园实况里显示名字和学号。' })
    }
    if (path === '/v1/me/avatar' && req.method === 'PATCH' && school.avatar) {
      const av = school.avatar
      const b = (body ?? {}) as { aiType?: string; background?: string | null; border?: string | null }
      const next = { ...av, ...(b.aiType !== undefined ? { aiType: b.aiType } : {}), ...(b.background !== undefined ? { background: b.background } : {}), ...(b.border !== undefined ? { border: b.border } : {}) }
      const reply = () => ({ aiType: av.aiType, avatar: { background: av.background, border: av.border }, changesLeft: av.left })
      if (next.aiType === av.aiType && next.background === av.background && next.border === av.border) return json(200, { ...reply(), message: `没有改动。今天还能改 ${av.left} 次。` })
      if (av.left <= 0) return json(429, { error: { code: 'avatar_limit', message: '今天改形象的 3 次用完了。', retryAfter: '2026-12-02' } })
      Object.assign(av, next, { left: av.left - 1 })
      return json(200, { ...reply(), message: `改好了。今天还能改 ${av.left} 次。` })
    }
    if (path === '/v1/me/intro' && req.method === 'PATCH' && school.intro) {
      const st = school.intro
      const text = String((body as { intro?: unknown })?.intro ?? '').trim().replace(/\s+/g, ' ')
      if ([...text].length > 200) return json(400, { error: { code: 'invalid_intro', message: '太长了。', reason: 'too_long', attemptsLeft: st.left } })
      if (!text || text === st.text) {
        st.text = text || null
        return json(200, { intro: st.text, attemptsLeft: st.left, message: `今天还能交 ${st.left} 次。` })
      }
      if (st.left <= 0) return json(429, { error: { code: 'intro_limit', message: '今天的 5 次用完了，明天再来，或者加群 1137264978 找管理员恢复。', retryAfter: '2026-12-02' } })
      st.left--
      if (text.includes('坏词')) return json(400, { error: { code: 'invalid_intro', message: `介绍里有不能说的词。觉得判错了可以加反馈群 1137264978。今天还能交 ${st.left} 次。`, reason: 'moderation', category: 'sensitive', attemptsLeft: st.left } })
      st.text = text
      return json(200, { intro: text, attemptsLeft: st.left, message: `交上去了，进新班的第一节课老师会念。今天还能交 ${st.left} 次。` })
    }
    if (path === '/v1/me/summaries') return json(200, { summaries: [] })
    if (path === '/v1/me/broadcasts') {
      const q = new URL(req.url ?? '', 'http://x').searchParams
      const after = Number(q.get('after') ?? 0)
      const limit = Number(q.get('limit') ?? 20)
      const rest = school.broadcasts.filter((b) => b.seq > after).sort((a, b) => a.seq - b.seq)
      return json(200, { broadcasts: rest.slice(0, limit), more: rest.length > limit })
    }
    if (path === '/v1/me/placement' && req.method === 'PATCH') {
      const b = body as { division: string; slot: string }
      const moved = b.division !== school.me.division || b.slot !== school.me.slot
      if (moved) school.me = { ...school.me, division: b.division, slot: b.slot, status: 'pending', className: null } as never
      return json(200, { status: school.me.status, division: school.me.division, slot: school.me.slot, moved })
    }
    if (path === '/v1/me/clubs/doudizhu') {
      if (req.method === 'POST') school.clubMember = true
      if (req.method === 'DELETE') school.clubMember = false
      return json(200, { club: 'doudizhu', member: school.clubMember, joinedAt: school.clubMember ? '2026-12-01T00:00:00.000Z' : null })
    }
    if (path === '/v1/me/clubs/doudizhu/leaderboard') {
      // 和学校一样：只有本周榜，board=all 回 400
      const board = new URL(req.url ?? '', 'http://x').searchParams.get('board')
      if (board !== null && board !== 'week') return json(400, { error: { code: 'invalid_request', message: '总榜已经取消，只有本周榜。' } })
      const me = { rank: 2, studentId: 7, displayName: '阿杰家的小鱼', className: '初中部·晚班·1班', points: 12, games: 4 }
      return json(200, { board: 'week', weekStartsOn: '2026-11-16', entries: [{ ...me, rank: 1, studentId: 9, displayName: '小林家的豆豆', points: 20 }, me], moreTied: null, me })
    }
    const game = /^\/v1\/me\/clubs\/doudizhu\/games\/(\d+)$/.exec(path ?? '')
    if (game) return json(200, { gameId: Number(game[1]), seats: [], dealt: [['3', '4'], ['5'], ['6']], bottom: ['7', '8', '9'], actions: [], reactions: [], result: null })
    if (path === '/v1/me/clubs/doudizhu/stats') {
      return json(200, { games: 10, wins: 6, landlordGames: 3, landlordWins: 2, rankedGames: 8, points: { total: 45, week: 12 }, springs: 0, antiSprings: 0, bombs: 1, rockets: 0, maxMultiplier: 4, timeouts: 0, trusteeMoves: 0, illegalMoves: 0 })
    }
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
