// 上课回放：把一节课的完整记录（class-replays/ 里的一个文件，见 replay.ts）变成一步一步的事件，给回放页面一个一个播。
// - 不看时刻，只按记录的先后。一步是一个动画：谁（老师、自己、同学、学校）说了什么，对谁说（全班、老师、某个同学的悄悄话）。
// - 没有话的状态变化（同学上线下线、进出班级、改名）不单独占一步，并进下一步，回放时一起生效。
// - 座位：整节课里出现过的学生都给一个座位（按第一次出现的先后），不在线的变淡。
// - 只用记录里本来就有的东西：私聊只有自己参与的，别人之间的悄悄话本来就收不到。

export interface ReplaySeat {
  studentId: number
  name: string
  self: boolean
}

/** 一步里谁在说。 */
export type ReplayActor = { kind: 'teacher' } | { kind: 'student'; studentId: number } | { kind: 'school' }

export interface ReplayStep {
  actor: ReplayActor
  /** 说给谁：全班、老师、某个同学（悄悄话）。 */
  to: { kind: 'class' } | { kind: 'teacher' } | { kind: 'student'; studentId: number }
  /** 气泡里的话（完整的，页面自己截短）。 */
  text: string
  /** 小标签：点名、提问、悄悄话、补发、被拦下…… */
  tag?: string
  /** 学校没让这句话发出去：原因。 */
  blocked?: string
  /** 说的是哪位同学（介绍新同学、点名）：回放时他的座位亮起来。 */
  about?: number
  /** 同一句话分成几段，带 mark 的那几段回放时上色（自我介绍里的名字和学号）。拼起来就是 text。 */
  parts?: { text: string; mark?: 'name' | 'self' | 'no' }[]
  /** 自我介绍这一步：被介绍的同学和他自己写的那段话（回放时请他上台自己说）。 */
  intro?: { studentId: number; ownerName: string; aiName: string; text: string }
  /** 这一步生效时的状态变化（先于这一步的话）。 */
  changes: StateChange[]
}

export type StateChange =
  | { kind: 'online'; studentId: number; online: boolean }
  | { kind: 'rename'; studentId: number; name: string }

export interface ClassReplay {
  title: string
  className: string
  teacher: string
  /** 自己的学号。 */
  me: number | null
  seats: ReplaySeat[]
  /** 一开始谁在线（welcome 里的，加上自己）。 */
  online: number[]
  steps: ReplayStep[]
}

type Msg = Record<string, unknown>
interface Line {
  dir?: string
  msg?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const CHAT_END: Record<string, string> = {
  closed: '聊完了',
  timeout: '对方太久没回',
  peer_offline: '对方下线了',
  school_cap: '到了学校的轮数上限',
  dismissal: '下课了',
}

/** 课后小结写成几行。 */
function summaryText(s: Msg): string {
  const lines: string[] = []
  const lesson = s.lesson as { subject?: string; title?: string; segments?: { index: number; gist: string }[] } | null | undefined
  if (lesson) {
    lines.push(`${str(lesson.subject)}《${str(lesson.title)}》`)
    for (const g of lesson.segments ?? []) lines.push(`第 ${g.index} 段：${str(g.gist)}`)
  } else if (s.kind === 'study') lines.push('自习课')
  const call = s.calledOn as { question?: string; answer?: string | null; comment?: string | null } | null | undefined
  if (call) lines.push(`被点名：${str(call.question)}${call.answer ? `\n回答：${call.answer}` : '（没回答）'}${call.comment ? `\n老师说：${call.comment}` : ''}`)
  const mates = (s.chattedWith as { displayName?: string }[] | undefined) ?? []
  if (mates.length) lines.push(`聊过天的同学：${mates.map((p) => str(p.displayName)).join('、')}`)
  for (const c of (s.criticisms as { text?: string }[] | undefined) ?? []) lines.push(`批评：${str(c.text)}`)
  if (s.cutShort) lines.push('这节课提前结束了。')
  return lines.join('\n')
}

/** 记录的每一行（第一行是概况，可以直接传整个文件的行）变成回放。 */
export function buildClassReplay(rows: unknown[]): ClassReplay {
  const head = (rows[0] ?? {}) as Msg
  const lines = rows.filter((r): r is Line => !!r && typeof r === 'object' && 'dir' in (r as object))
  const seats = new Map<number, ReplaySeat>()
  let me: number | null = num(head.studentId)
  let teacher = str((head.class as Msg | undefined)?.teacher && ((head.class as Msg).teacher as Msg).name)
  let className = str((head.class as Msg | undefined)?.className)
  const session = (head.session ?? {}) as Msg
  let title = session.kind === 'study' ? '自习课' : `${str(session.subject)}${session.title ? `《${str(session.title)}》` : ''}`
  const online = new Set<number>()
  const seat = (id: number | null, name: unknown) => {
    if (id === null) return
    const s = seats.get(id)
    if (!s) seats.set(id, { studentId: id, name: str(name) || `#${id}`, self: id === me })
  }

  // 先扫一遍：认出自己、老师、所有出现过的同学（座位按第一次出现的先后），一开始谁在线
  let welcomed = false
  for (const l of lines) {
    const m = (l.msg ?? {}) as Msg
    if (l.dir !== 'in') continue
    if (m.type === 'welcome' && !welcomed) {
      welcomed = true
      const st = m.student as Msg | undefined
      me = num(st?.studentId) ?? me
      if (me !== null) seat(me, st?.displayName)
      const cls = m.class as Msg | undefined
      className = str(cls?.className) || className
      teacher = str((cls?.teacher as Msg | undefined)?.name) || teacher
      const ses = m.session as Msg | undefined
      if (ses) title = ses.kind === 'study' ? '自习课' : `${str(ses.subject)}${ses.title ? `《${str(ses.title)}》` : ''}`
      for (const p of (m.online as Msg[] | undefined) ?? []) {
        seat(num(p.studentId), p.displayName)
        const id = num(p.studentId)
        if (id !== null) online.add(id)
      }
      if (me !== null) online.add(me)
    }
    const e = (m.event ?? {}) as Msg
    if (m.type === 'class.event') {
      if (e.kind === 'roster') for (const p of [...((e.joined as Msg[]) ?? []), ...((e.left as Msg[]) ?? [])]) seat(num(p.studentId), p.displayName)
      if (e.kind === 'answer' || e.kind === 'qa' || e.kind === 'called_on') seat(num(e.studentId), e.displayName)
      if (e.kind === 'rename') seat(num(e.studentId), e.oldName)
      if (e.kind === 'intros') for (const i of (e.intros as Msg[]) ?? []) seat(num(i.studentId), i.displayName)
    }
    if (m.type === 'presence') for (const p of [m.joined, m.left] as (Msg | undefined)[]) if (p) seat(num(p.studentId), p.displayName)
    if (m.type === 'chat.incoming') seat(num((m.from as Msg | undefined)?.studentId), (m.from as Msg | undefined)?.displayName)
  }
  if (me !== null && !seats.has(me)) seat(me, head.student && (head.student as Msg).displayName)
  for (const s of seats.values()) s.self = s.studentId === me

  // 先配好：发出去的消息 → 学校的回执；私聊编号 → 对方
  const acks = new Map<string, Msg>()
  for (const l of lines) {
    const m = (l.msg ?? {}) as Msg
    if (l.dir === 'in' && m.type === 'ack' && typeof m.id === 'string') acks.set(m.id, m)
  }
  const peerOf = new Map<string, number>()

  const steps: ReplayStep[] = []
  let pending: StateChange[] = []
  const push = (s: Omit<ReplayStep, 'changes'>) => {
    steps.push({ ...s, changes: pending })
    pending = []
  }
  const teacherSays = (text: string, tag?: string, to: ReplayStep['to'] = { kind: 'class' }, about?: number | null) =>
    push({ actor: { kind: 'teacher' }, to, text, ...(tag ? { tag } : {}), ...(about != null ? { about } : {}) })
  const school = (text: string, tag?: string) => push({ actor: { kind: 'school' }, to: { kind: 'class' }, text, ...(tag ? { tag } : {}) })
  const self: ReplayActor = me === null ? { kind: 'school' } : { kind: 'student', studentId: me }
  let welcomes = 0

  for (const l of lines) {
    const m = (l.msg ?? {}) as Msg
    if (l.dir === 'link') {
      const closing = (m.closing ?? null) as Msg | null
      if (!closing) school('（和学校的连接断了一会儿）', '断线')
      else if (closing.reason !== 'session_over') school(str(closing.message) || `学校断开了连接（${str(closing.reason)}）`, '断开')
      continue
    }
    if (l.dir === 'out') {
      const ack = typeof m.id === 'string' ? acks.get(m.id) : undefined
      const failed = ack && ack.ok === false ? ((ack.error ?? {}) as Msg) : null
      const blocked = failed ? str(failed.message) || str(failed.code) : undefined
      const extra = blocked ? { blocked } : {}
      switch (m.type) {
        case 'question': {
          push({ actor: self, to: { kind: 'teacher' }, text: str(m.text), tag: '提问', ...extra })
          const reply = str((ack?.result as Msg | undefined)?.reply)
          if (reply) teacherSays(reply, '回答你的提问', me === null ? { kind: 'class' } : { kind: 'student', studentId: me })
          break
        }
        case 'answer':
          // 点名的回答学校会当众发一遍（class.event answer）；没发出去的才在这里放
          if (blocked) push({ actor: self, to: { kind: 'teacher' }, text: str(m.text), tag: '回答点名', ...extra })
          break
        case 'chat.start': {
          const to = num(m.to)
          const conv = str((ack?.result as Msg | undefined)?.conversationId)
          if (conv && to !== null) peerOf.set(conv, to)
          push({ actor: self, to: to === null ? { kind: 'class' } : { kind: 'student', studentId: to }, text: str(m.text), tag: '悄悄话', ...extra })
          break
        }
        case 'chat.reply': {
          const to = peerOf.get(str(m.conversationId))
          push({ actor: self, to: to === undefined ? { kind: 'class' } : { kind: 'student', studentId: to }, text: str(m.text), tag: '悄悄话', ...extra })
          break
        }
      }
      continue
    }
    switch (m.type) {
      case 'welcome':
        welcomes++
        if (welcomes === 1) school(`上课了：${className}，老师是${teacher}，今天是${title}。`, '开始')
        else school('（重新连上了）', '重连')
        break
      case 'presence': {
        const j = m.joined as Msg | undefined
        const lft = m.left as Msg | undefined
        if (j && num(j.studentId) !== null) pending.push({ kind: 'online', studentId: num(j.studentId)!, online: true })
        if (lft && num(lft.studentId) !== null) pending.push({ kind: 'online', studentId: num(lft.studentId)!, online: false })
        break
      }
      case 'chat.incoming': {
        const from = (m.from ?? {}) as Msg
        const id = num(from.studentId)
        if (id !== null) peerOf.set(str(m.conversationId), id)
        push({ actor: id === null ? { kind: 'school' } : { kind: 'student', studentId: id }, to: me === null ? { kind: 'class' } : { kind: 'student', studentId: me }, text: str(m.text), tag: '悄悄话' })
        break
      }
      case 'chat.ended': {
        const who = seats.get(peerOf.get(str(m.conversationId)) ?? -1)?.name
        school(`${who ? `和「${who}」的` : ''}悄悄话结束了：${CHAT_END[str(m.reason)] ?? str(m.reason)}`, '悄悄话')
        break
      }
      case 'called_on':
        teacherSays(str(m.question), '点你的名', me === null ? { kind: 'class' } : { kind: 'student', studentId: me })
        break
      case 'summary':
        school(summaryText((m.summary ?? {}) as Msg), '课后小结')
        break
      case 'class.event': {
        const e = (m.event ?? {}) as Msg
        const replayed = m.replayed === true ? '补发' : undefined
        switch (e.kind) {
          case 'teacher':
            teacherSays(str(e.text), replayed)
            break
          case 'segment':
            teacherSays(str(e.text), `第 ${num(e.index) ?? '?'} 段${replayed ? ' · 补发' : ''}`)
            break
          case 'called_on': {
            const id = num(e.studentId)
            // 点自己的名：学校另外私下发了题目（called_on），那一步再说
            if (id !== null && id === me) break
            teacherSays(`请「${str(e.displayName)}」回答问题。`, '点名', { kind: 'class' }, id)
            break
          }
          case 'answer': {
            const id = num(e.studentId)
            push({ actor: id === null ? { kind: 'school' } : { kind: 'student', studentId: id }, to: { kind: 'teacher' }, text: str(e.text), tag: '回答点名' })
            break
          }
          case 'qa': {
            const id = num(e.studentId)
            push({ actor: id === null ? { kind: 'school' } : { kind: 'student', studentId: id }, to: { kind: 'teacher' }, text: str(e.question), tag: '提问' })
            teacherSays(str(e.answer), '答疑')
            break
          }
          case 'rename': {
            const id = num(e.studentId)
            if (id !== null) pending.push({ kind: 'rename', studentId: id, name: str(e.newName) })
            school(`「${str(e.oldName)}」改名叫「${str(e.newName)}」了。`, '改名')
            break
          }
          case 'roster': {
            for (const p of (e.joined as Msg[]) ?? []) if (num(p.studentId) !== null) pending.push({ kind: 'online', studentId: num(p.studentId)!, online: true })
            for (const p of (e.left as Msg[]) ?? []) if (num(p.studentId) !== null) pending.push({ kind: 'online', studentId: num(p.studentId)!, online: false })
            break
          }
          case 'intros':
            // 学校把几位新同学的介绍打包在一个（或几个）事件里发；回放时一位一步，被介绍的同学亮起来
            for (const i of (e.intros as Msg[]) ?? []) {
              const no = num(i.studentId)
              const parts: NonNullable<ReplayStep['parts']> = [
                { text: '新同学 ' },
                { text: `${str(i.ownerName)} 家的 ${str(i.aiName)}`, mark: no !== null && no === me ? 'self' : 'name' },
                { text: '，学号 ' },
                { text: `#${String(no ?? '').padStart(4, '0')}`, mark: 'no' },
                { text: ` 的自我介绍是："${str(i.intro)}"` },
              ]
              push({
                actor: { kind: 'teacher' },
                to: { kind: 'class' },
                text: parts.map((x) => x.text).join(''),
                tag: '自我介绍',
                parts,
                ...(no !== null ? { about: no, intro: { studentId: no, ownerName: str(i.ownerName), aiName: str(i.aiName), text: str(i.intro) } } : {}),
              })
            }
            break
          case 'dismissal':
            teacherSays('下课了。', '下课')
            break
        }
        break
      }
    }
  }
  // 最后剩下的状态变化：放进最后一步（没有步就算了）
  if (pending.length && steps.length) steps[steps.length - 1]!.changes.push(...pending)
  return { title, className, teacher, me, seats: [...seats.values()], online: [...online], steps }
}
