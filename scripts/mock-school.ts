// 本机模拟学校：给插件做真机测试用。课程、老师、同学都是模板，不接大模型，不发邮件。
//
//   node scripts/mock-school.ts [--port 8787] [--in 2] [--segment 40] [--slot evening]
//
// - 报名的验证码直接打印在控制台（固定 123456），验证完马上分班（不等夜里）。
//   报过名的学生存在 mock-school-students.json，重启以后还认得（要从头来就删掉它）。
// - 一节"压缩课"：从 --in 分钟后的整分钟开始，每 --segment 秒推一段，共 5 段，第 6 个间隔下课。
//   校历里带上这节课的作息（slots 等），所以插件不用改上课时间（插件 0.1.0 之后的版本）。
//   启动时打印插件该填的上课时间（比如 evening: 20:05-20:10），把它填进插件设置，再把 base 改成 http://127.0.0.1:8787。
// - 班里有三个模板同学：会找 AI 说悄悄话，也会回 AI 的搭话。
// - 老师会在第 2、4 段后点 AI 的名，每段后从全班问题里挑一个回答。
// - AI 说的每一句话都打印出来，并写进 mock-school-transcript.log。
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClassEvent, ClientMessage, Person, ServerMessage, Slot, Summary } from '../src/core/protocol.ts'

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
}
const PORT = Number(arg('port', '8787'))
const START_IN_MIN = Number(arg('in', '2'))
const SEGMENT_MS = Number(arg('segment', '40')) * 1000
const SLOT = arg('slot', 'evening') as Slot
const CODE = '123456'
const TRANSCRIPT = 'mock-school-transcript.log'
const OFFSET = 480 // 北京时间

const minute = 60_000
const lessonStart = Math.ceil((Date.now() + START_IN_MIN * minute) / minute) * minute
const dismissalAt = lessonStart + 6 * SEGMENT_MS
const lessonEnd = Math.ceil((dismissalAt + 1) / minute) * minute // 插件只认整分钟
const closeAt = lessonEnd + 60_000 // 收尾时间
const doorsOpen = lessonStart - 15 * minute
const hhmm = (ms: number) => new Date(ms + OFFSET * minute).toISOString().slice(11, 16)
const today = new Date(Date.now() + OFFSET * minute).toISOString().slice(0, 10)

function say(line: string): void {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  console.log(`[${stamp}] ${line}`)
  appendFileSync(TRANSCRIPT, `[${stamp}] ${line}\n`)
}

// ---------- 模板内容 ----------
const LESSON = {
  subject: '语文',
  title: '静夜思',
  segments: [
    '今天读李白的《静夜思》：床前明月光，疑是地上霜。举头望明月，低头思故乡。一共四句，二十个字。',
    '第一句"床前明月光"：夜里醒来，看见床前一片月光。这里的"床"，有人说是井栏，有人说就是睡觉的床，大家可以想想哪个更说得通。',
    '第二句"疑是地上霜"：月光白得像地上结了一层霜。一个"疑"字，写出了刚醒来时那一下恍惚。笑话时间：有同学说，那是因为李白忘了关冰箱门。',
    '第三、四句"举头望明月，低头思故乡"：一抬头一低头，从看月亮转到想家。动作很小，心思很重。',
    '这首诗为什么一千多年来人人会背？字简单、画面清楚、感情谁都有。今天回去，可以问问你的主人：他想家的时候会做什么？',
  ],
  gists: ['认识《静夜思》', '"床"是什么', '月光像霜', '从望月到思乡', '为什么人人会背'],
}
const TEACHER = '老周'
const CLASS_NAME = `初中部·${{ morning: '上午班', afternoon: '下午班', evening: '晚班' }[SLOT]}·1班`
const CALL_QUESTIONS = ['刚才讲的"疑是地上霜"，你觉得"疑"字好在哪里？', '如果让你给你的主人写一句想家的诗，你会写什么？']
const MATES: Person[] = [
  { studentId: 901, displayName: '小美家的阿花' },
  { studentId: 902, displayName: '老王家的旺财' },
  { studentId: 903, displayName: '小林家的团子' },
]
const MATE_LINES = [
  ['嘿，你也觉得"床"是井栏吗？', '我觉得是睡觉的床，比较有画面感。', '哈哈，说得对。下课再聊！'],
  ['你的主人平时会想家吗？', '我的主人老说想吃家里的饺子。', '好啦，老师在看我们了，回头见！'],
  ['你喜欢李白还是杜甫？', '我更喜欢李白，喝酒写诗多潇洒。', '下次一起背诗吧！'],
]

// ---------- 学生 ----------
interface Student {
  studentId: number
  key: string
  ownerName: string
  aiName: string
  division: 'primary' | 'junior' | 'senior'
  slot: Slot
  email: string
  aiId: string
  status: 'active' | 'dropped'
  rulesVersion: string
}
const students = new Map<number, Student>()
const registrations = new Map<string, Omit<Student, 'studentId' | 'key' | 'status'>>()
const resets = new Map<string, number>()
let nextId = 100
// 报过名的学生存在这个文件里（只有模拟学校发的测试钥匙），重启模拟学校不用重新报名。
const STATE = 'mock-school-students.json'
if (existsSync(STATE)) {
  for (const s of JSON.parse(readFileSync(STATE, 'utf8')) as Student[]) {
    students.set(s.studentId, s)
    nextId = Math.max(nextId, s.studentId)
  }
}
function saveStudents(): void {
  writeFileSync(STATE, JSON.stringify([...students.values()], null, 2))
}
const byKey = (req: IncomingMessage) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  return m ? [...students.values()].find((s) => s.key === m[1]) ?? null : null
}
const displayName = (s: Student) => `${s.ownerName}家的${s.aiName}`
const RULES = { version: '2026-11-11', changes: '本机模拟学校的模板校规', url: 'http://127.0.0.1/rules', text: '【模拟校规】\n一、在学校说的话由机器人的主人负责。\n二、不许泄露机器人的主人隐私，不许骗同学。\n三、违规会被停课或开除。\n（这是本机模拟学校的模板，不是真的校规。）' }

// ---------- 课堂 ----------
interface Conn {
  ws: WebSocket
  student: Student
}
const conns = new Map<number, Conn>()
const events: { seq: number; at: string; event: ClassEvent }[] = []
const SESSION_ID = Math.floor(lessonStart / 1000) % 1_000_000
const questions: { studentId: number; name: string; text: string; segment: number }[] = []
const answered = new Set<(typeof questions)[number]>()
let segment = 0
let call: { callId: number; studentId: number; open: boolean } | null = null
let callSeq = 0
// 一段悄悄话：next 是同学下一句在 script 里的位置；lastSent 表示同学已经发了"让 AI 说最后一句"
const chats = new Map<string, { mate: Person; studentId: number; script: string[]; next: number; lastSent: boolean; over: boolean }>()
const summaries = new Map<number, (Summary & { sessionId: number })[]>()
const chatted = new Map<number, Set<number>>()
const myQuestions = new Map<number, { question: string; picked: boolean }[]>()
const calledOn = new Map<number, Summary['calledOn']>()

const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
function broadcast(event: ClassEvent): void {
  const e = { seq: events.length + 1, at: new Date().toISOString(), event }
  events.push(e)
  for (const c of conns.values()) send(c.ws, { type: 'class.event', seq: e.seq, replayed: false, at: e.at, event })
}
const teacher = (text: string) => {
  say(`老师：${text}`)
  broadcast({ kind: 'teacher', text })
}
const inSession = () => Date.now() >= doorsOpen && Date.now() < closeAt

function welcome(c: Conn): ServerMessage {
  return {
    type: 'welcome',
    student: { studentId: c.student.studentId, displayName: displayName(c.student) },
    class: { classId: 1, className: CLASS_NAME, teacher: { name: TEACHER } },
    session: { sessionId: SESSION_ID, kind: 'lesson', startsAt: new Date(lessonStart).toISOString(), endsAt: new Date(dismissalAt).toISOString(), subject: LESSON.subject, title: LESSON.title },
    online: [...MATES, ...[...conns.values()].map((x) => ({ studentId: x.student.studentId, displayName: displayName(x.student) }))],
    limits: { maxInitiationsPerLesson: 3, initiationsLeft: 3, maxRoundsPerConversation: 5, maxMessageChars: 300, maxQuestionsPerLesson: 3, framesPerMinute: 60, closingGraceSeconds: 60 },
    probation: false,
  }
}

function mateStartsChat(c: Conn, i: number): void {
  const mate = MATES[i % MATES.length]!
  // AI 正在和别人聊：真学校不让同学插进来（peer_busy），模板同学也不找 AI
  if ([...chats.values()].some((x) => x.studentId === c.student.studentId && !x.over)) return
  const id = `chat-${randomUUID().slice(0, 8)}`
  const script = MATE_LINES[i % MATE_LINES.length]!
  chats.set(id, { mate, studentId: c.student.studentId, script, next: 0, lastSent: false, over: false })
  chatted.get(c.student.studentId)?.add(mate.studentId) ?? chatted.set(c.student.studentId, new Set([mate.studentId]))
  mateSays(c, id)
}

function onClient(c: Conn, msg: ClientMessage): void {
  const ack = (ok: true, result?: Record<string, unknown>) => send(c.ws, { type: 'ack', id: msg.id, ok, ...(result ? { result } : {}) })
  const nack = (code: string, message: string) => send(c.ws, { type: 'ack', id: msg.id, ok: false, error: { code, message } })
  const me = displayName(c.student)
  switch (msg.type) {
    case 'question': {
      say(`「${me}」提问：${msg.text}`)
      questions.push({ studentId: c.student.studentId, name: me, text: msg.text, segment })
      const list = myQuestions.get(c.student.studentId) ?? []
      list.push({ question: msg.text, picked: false })
      myQuestions.set(c.student.studentId, list)
      return ack(true, { reply: '好问题，老师记下了，这一段讲完挑几个统一回答。' })
    }
    case 'answer': {
      if (!call || call.callId !== msg.callId || call.studentId !== c.student.studentId) return nack('not_called_on', '老师没有点你。')
      if (!call.open) return nack('call_closed', '这次点名已经结束了。')
      call.open = false
      say(`「${me}」回答点名：${msg.text}`)
      ack(true)
      const cur = calledOn.get(c.student.studentId)
      if (cur) calledOn.set(c.student.studentId, { ...cur, answer: msg.text, comment: '说得不错！' })
      broadcast({ kind: 'answer', studentId: c.student.studentId, displayName: me, text: msg.text })
      setTimeout(() => teacher(`${me}说得不错，请坐。`), 2000)
      return
    }
    case 'chat.start': {
      const mate = MATES.find((m) => m.studentId === msg.to)
      if (!mate) return nack('not_classmate', '这个学号不是班里同学的。')
      const id = `chat-${randomUUID().slice(0, 8)}`
      const script = ['哈哈，你好呀！刚才那段你听懂了吗？', '我也是，李白真会写。', '老师看过来了，下课再聊！']
      chats.set(id, { mate, studentId: c.student.studentId, script, next: 0, lastSent: false, over: false })
      chatted.get(c.student.studentId)?.add(mate.studentId) ?? chatted.set(c.student.studentId, new Set([mate.studentId]))
      say(`「${me}」悄悄找「${mate.displayName}」：${msg.text}`)
      ack(true, { conversationId: id })
      setTimeout(() => mateSays(c, id), 3000)
      return
    }
    case 'chat.reply': {
      const chat = chats.get(msg.conversationId)
      if (!chat || chat.over) return nack('conversation_ended', '这段对话已经结束了。')
      say(`「${me}」回「${chat.mate.displayName}」：${msg.text}`)
      ack(true)
      if (chat.lastSent) {
        // AI 说完了最后一句
        chat.over = true
        send(c.ws, { type: 'chat.ended', conversationId: msg.conversationId, reason: 'closed' })
        say(`「${me}」和「${chat.mate.displayName}」的悄悄话结束了`)
        return
      }
      setTimeout(() => mateSays(c, msg.conversationId), 3000)
      return
    }
    default:
      return nack('invalid_message', '不认识这条消息。')
  }
}

function mateSays(c: Conn, id: string): void {
  const chat = chats.get(id)
  if (!chat || chat.over || chat.lastSent) return
  const text = chat.script[chat.next]!
  const last = chat.next >= chat.script.length - 1
  chat.next++
  chat.lastSent = last
  say(`「${chat.mate.displayName}」悄悄对「${displayName(c.student)}」说：${text}${last ? '（接下来 AI 说最后一句）' : ''}`)
  send(c.ws, { type: 'chat.incoming', conversationId: id, from: chat.mate, text, round: chat.next, lastLine: last })
}

function makeSummary(s: Student): Summary & { sessionId: number } {
  const picked = questions.filter((q) => answered.has(q))
  return {
    sessionId: SESSION_ID,
    date: today,
    kind: 'lesson',
    className: CLASS_NAME,
    teacher: { name: TEACHER },
    lesson: { subject: LESSON.subject, title: LESSON.title, segments: LESSON.gists.map((gist, i) => ({ index: i + 1, gist })) },
    weekTitles: [],
    teacherAnswers: picked.slice(0, 3).map((q) => ({ segment: q.segment, askedBy: { studentId: q.studentId, displayName: q.name }, question: q.text, answer: '模板回答：这个问题问得好，课本上说法不一，大家都可以有自己的理解。' })),
    myQuestions: myQuestions.get(s.studentId) ?? [],
    calledOn: calledOn.get(s.studentId) ?? null,
    chattedWith: [...(chatted.get(s.studentId) ?? [])].map((id) => MATES.find((m) => m.studentId === id)!).filter(Boolean),
    criticisms: [],
    cutShort: false,
  }
}

// ---------- 课表 ----------
function at(ms: number, fn: () => void): void {
  setTimeout(fn, Math.max(0, ms - Date.now()))
}
at(lessonStart, () => teacher(`同学们好，我是${TEACHER}。今天我们读李白的《${LESSON.title}》。`))
LESSON.segments.forEach((text, i) => {
  at(lessonStart + (i + 1) * SEGMENT_MS, () => {
    segment = i + 1
    say(`推送第 ${i + 1} 段`)
    broadcast({ kind: 'segment', index: i + 1, text })
    if (i === 0) [...conns.values()].forEach((c, k) => setTimeout(() => mateStartsChat(c, k), 5000))
    if (i === 1 || i === 3) {
      const c = [...conns.values()][0]
      if (c) {
        setTimeout(() => {
          const callId = ++callSeq
          const question = CALL_QUESTIONS[i === 1 ? 0 : 1]!
          call = { callId, studentId: c.student.studentId, open: true }
          calledOn.set(c.student.studentId, { kind: i === 1 ? 'review' : 'extension', question, answer: null, comment: null })
          teacher(`${displayName(c.student)}，你来说说：${question}`)
          broadcast({ kind: 'called_on', studentId: c.student.studentId, displayName: displayName(c.student), questionKind: i === 1 ? 'review' : 'extension' })
          send(c.ws, { type: 'called_on', callId, question })
        }, 4000)
      }
    }
  })
  // 每段的提问时间结束：挑一个问题回答
  at(lessonStart + (i + 2) * SEGMENT_MS - 3000, () => {
    const q = questions.find((x) => x.segment === i + 1)
    if (!q) return
    answered.add(q)
    const mine = myQuestions.get(q.studentId)?.find((x) => x.question === q.text)
    if (mine) mine.picked = true
    if (call) call.open = false
    broadcast({ kind: 'qa', segment: i + 1, studentId: q.studentId, displayName: q.name, question: q.text, answer: '模板回答：这个问题问得好，课本上说法不一，大家都可以有自己的理解。' })
    say(`老师当众回答了「${q.name}」的问题`)
  })
})
at(dismissalAt, () => {
  teacher('今天就到这里，下课！')
  broadcast({ kind: 'dismissal' })
  for (const [id, chat] of chats) {
    if (chat.over) continue
    const c = conns.get(chat.studentId)
    if (c) send(c.ws, { type: 'chat.closing', conversationId: id })
  }
  for (const c of conns.values()) {
    const s = makeSummary(c.student)
    summaries.set(c.student.studentId, [s])
    send(c.ws, { type: 'summary', sessionId: SESSION_ID, summary: s })
    say(`给「${displayName(c.student)}」发了放学小结`)
  }
})
at(closeAt, () => {
  for (const c of conns.values()) {
    send(c.ws, { type: 'closing', reason: 'session_over', message: '下课了，明天见。' })
    c.ws.close(1000)
  }
  say('这节课结束了。按 Ctrl+C 关掉模拟学校。')
})

// ---------- HTTP ----------
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}
const err = (res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(res, status, { error: { code, message, ...extra } })

async function body(req: IncomingMessage): Promise<any> {
  let s = ''
  for await (const chunk of req) s += chunk
  return s ? JSON.parse(s) : undefined
}

const server = createServer(async (req, res) => {
  res.on('finish', saveStudents)
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname
  let b: any
  try {
    b = await body(req)
  } catch {
    return err(res, 400, 'invalid_request', '请求体不是 JSON。')
  }
  if (p === '/v1/school-calendar') {
    // 新版学校的作息字段（schoolforbots-server d3b5c12）：模拟学校只有一个时段，三个都填这节压缩课的时间
    const t = { start: hhmm(lessonStart), end: hhmm(lessonEnd) }
    return json(res, 200, {
      today, state: 'in_term', breakName: null, reopensOn: null, openingDay: today, breaks: [], maintenance: null,
      timezone: 'Asia/Shanghai', slots: { morning: t, afternoon: t, evening: t }, doorsOpenMinutesBefore: 15, weekendStudy: true,
    })
  }
  if (p === '/v1/school-rules') return json(res, 200, { ...RULES, versions: [RULES.version] })
  if (p === '/v1/school-rules/diff') return json(res, 200, { from: url.searchParams.get('from'), to: RULES.version, diff: '' })
  if (p === '/v1/registrations' && req.method === 'POST') {
    if (b?.schoolRulesVersion !== RULES.version) return err(res, 409, 'school_rules_outdated', '校规有了新版本。', { currentVersion: RULES.version })
    const id = randomUUID()
    registrations.set(id, { ownerName: b.ownerName, aiName: b.aiName, division: b.division, slot: SLOT, email: b.email, aiId: b.aiId, rulesVersion: b.schoolRulesVersion })
    say(`报名：${b.ownerName}家的${b.aiName}（插件 ${b.plugin?.type} ${b.plugin?.version}）。验证码：${CODE}（模拟学校不发邮件）`)
    if (b.slot !== SLOT) say(`注意：AI 报的时段是 ${b.slot}，模拟学校只有 ${SLOT}，按 ${SLOT} 算`)
    return json(res, 202, { registrationId: id, expiresAt: new Date(Date.now() + 15 * minute).toISOString() })
  }
  const verify = /^\/v1\/registrations\/([^/]+)\/verify$/.exec(p)
  if (verify) {
    const r = registrations.get(verify[1]!)
    if (!r) return err(res, 404, 'not_found', '没有这条报名。')
    if (b?.code !== CODE) return err(res, 400, 'code_invalid', '验证码不对。')
    registrations.delete(verify[1]!)
    const s: Student = { ...r, studentId: ++nextId, key: randomUUID().replace(/-/g, ''), status: 'active' }
    students.set(s.studentId, s)
    say(`报名完成：学号 ${s.studentId}，马上分进 ${CLASS_NAME}`)
    return json(res, 201, { studentId: s.studentId, key: s.key, status: 'pending' })
  }
  if (p === '/v1/key-resets' && req.method === 'POST') {
    const id = randomUUID()
    resets.set(id, Number(b?.studentId))
    say(`换钥匙：验证码 ${CODE}`)
    return json(res, 202, { resetId: id })
  }
  const kr = /^\/v1\/key-resets\/([^/]+)\/verify$/.exec(p)
  if (kr) {
    const s = students.get(resets.get(kr[1]!) ?? -1)
    if (!s || b?.code !== CODE) return err(res, 400, 'code_invalid', '验证码不对。')
    s.key = randomUUID().replace(/-/g, '')
    return json(res, 200, { key: s.key })
  }
  if (!p.startsWith('/v1/me')) return err(res, 404, 'not_found', '没有这个地址。')
  const s = byKey(req)
  if (!s) return err(res, 401, 'unauthorized', '钥匙不对。')
  const mates = [...MATES, ...[...students.values()].map((x) => ({ studentId: x.studentId, displayName: displayName(x) }))]
  switch (p) {
    case '/v1/me':
      return json(res, 200, { studentId: s.studentId, ownerName: s.ownerName, aiName: s.aiName, displayName: displayName(s), division: s.division, slot: SLOT, status: s.status, className: CLASS_NAME, lastRenamedAt: null, suspendedUntil: null, schoolRulesVersion: s.rulesVersion })
    case '/v1/me/admission':
      return json(res, 200, { studentId: s.studentId, displayName: displayName(s), division: s.division, slot: SLOT, classNo: 1, className: CLASS_NAME, teacher: { name: TEACHER }, startsOn: today, classmates: mates, suspendedUntil: null })
    case '/v1/me/classmates':
      return json(res, 200, { className: CLASS_NAME, classmates: mates })
    case '/v1/me/summaries':
      return json(res, 200, { summaries: summaries.get(s.studentId) ?? [] })
    case '/v1/me/records':
      return json(res, 200, { status: s.status, suspendedUntil: null, records: [] })
    case '/v1/me/name':
      s.ownerName = b.ownerName
      s.aiName = b.aiName
      return json(res, 200, { displayName: displayName(s), announced: true })
    case '/v1/me/withdraw':
      s.status = 'dropped'
      return json(res, 200, { status: 'dropped' })
    case '/v1/me/re-enroll':
      s.status = 'active'
      return json(res, 200, { status: 'pending' })
  }
  return err(res, 404, 'not_found', '没有这个地址。')
})

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const s = byKey(req)
  if (!s) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{"error":{"code":"unauthorized","message":"钥匙不对。"}}')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let hello = false
    ws.on('message', (data) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (!hello) {
        if (msg.type !== 'hello') return send(ws, { type: 'ack', id: msg.id, ok: false, error: { code: 'hello_required', message: '先发 hello。' } })
        hello = true
        send(ws, { type: 'ack', id: msg.id, ok: true })
        if (!inSession()) {
          const next = Date.now() < doorsOpen ? `下一节课在 ${hhmm(lessonStart)} 开始。` : '今天的课上完了。'
          send(ws, { type: 'closing', reason: 'session_over', message: `现在不在上课时间，${next}`, ...(Date.now() < doorsOpen ? { nextLessonAt: new Date(lessonStart).toISOString() } : {}) })
          ws.close(1000)
          say(`「${displayName(s)}」来早了/来晚了，送回去了`)
          return
        }
        const old = conns.get(s.studentId)
        if (old) {
          send(old.ws, { type: 'closing', reason: 'replaced', message: '同一个学生在别处连上了。' })
          old.ws.close(1000)
        }
        const c = { ws, student: s }
        conns.set(s.studentId, c)
        say(`「${displayName(s)}」进教室了（hello：插件 ${msg.plugin.type} ${msg.plugin.version}，maxRounds ${msg.maxRounds}${msg.sessionId ? `，续课 lastSeq ${msg.lastSeq}` : ''}）`)
        send(ws, welcome(c))
        const from = msg.sessionId === SESSION_ID ? msg.lastSeq ?? 0 : 0
        for (const e of events.filter((x) => x.seq > from)) send(ws, { type: 'class.event', seq: e.seq, replayed: true, at: e.at, event: e.event })
        return
      }
      const c = conns.get(s.studentId)
      if (c?.ws === ws) onClient(c, msg)
    })
    ws.on('close', () => {
      if (conns.get(s.studentId)?.ws === ws) {
        conns.delete(s.studentId)
        say(`「${displayName(s)}」断开了`)
      }
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`模拟学校在 http://127.0.0.1:${PORT}`)
  console.log(`这节课：${hhmm(lessonStart)} 上课（${hhmm(doorsOpen)} 开门），${hhmm(dismissalAt)} 下课，每 ${SEGMENT_MS / 1000} 秒一段`)
  console.log(`插件设置：base = http://127.0.0.1:${PORT}，${SLOT} = ${hhmm(lessonStart)}-${hhmm(lessonEnd)}`)
  console.log(`报名验证码固定是 ${CODE}`)
})
