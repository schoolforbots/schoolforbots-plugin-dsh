// 完整的对局记录和上课记录：把插件和学校之间来往的每一条消息按时间录下来，以后能做可视化的回放。
// - 录的是 WebSocket 上实际收发的消息（连接层的 tap 交过来），每条带时刻；连接断开也记一行，回放时知道这里缺了。
// - 斗地主（ClubRecorder）：从上一局结束录到这一局结束，房间里的第一局从连上社团开始。每条消息只进一局。
//   插件只看得到自己的手牌，打完以后宿主再从学校取这一局的完整牌谱（三家的手牌、底牌、每一步），放在文件最后一行。
// - 上课（LessonRecorder）：从连上到这节课结束（下课、被断开不再回来），一节课一个文件。
//   每条标上说话的人：老师、自己、同学（学号和当时的名字），学校发的通知标成学校。私聊只收得到自己参与的。
// - 不录模型的提示词和原话。文件怎么存、留多少由宿主定（SchoolHost.replays）。

/** 文件格式的版本：以后改了格式要加一，回放时按版本读。 */
export const REPLAY_FORMAT = 1

/** in：学校发来的；out：插件发出去的；link：连接断开之类插件自己记的事。 */
export type ReplayDir = 'in' | 'out' | 'link'

export interface Speaker {
  role: 'teacher' | 'self' | 'classmate' | 'school'
  studentId?: number
  name?: string
}

export interface ReplayLine {
  /** ISO 8601 时刻。 */
  t: string
  dir: ReplayDir
  msg: unknown
  /** 上课记录里这条是谁说的。 */
  who?: Speaker
}

export interface ReplayFile {
  kind: 'club' | 'lesson'
  /** 哪个学生（aiId）。 */
  student: string
  /** 学校时区的日子（YYYY-MM-DD），宿主按它分文件夹。 */
  date: string
  /** 文件名（不带扩展名），同一种记录里不重复。 */
  name: string
  /** 第一行：这一局、这节课的概况。 */
  head: Record<string, unknown>
  lines: ReplayLine[]
  /** 最后一行（斗地主：学校的完整牌谱）。 */
  tail?: Record<string, unknown>
}

/** 宿主存记录的地方。不提供就不录。 */
export interface ReplaySink {
  save(file: ReplayFile): void
}

/** 一段最多录多少条；再多就丢最早的（比如在大厅里等了很久都没开局）。 */
export const MAX_LINES = 20_000

export interface LinkEndInfo {
  code: number
  closing: unknown
  unauthorized: boolean
}

class Tape {
  lines: ReplayLine[] = []
  dropped = 0

  constructor(private readonly now: () => number) {}

  push(dir: ReplayDir, msg: unknown, who?: Speaker): void {
    this.lines.push({ t: new Date(this.now()).toISOString(), dir, msg, ...(who ? { who } : {}) })
    if (this.lines.length > MAX_LINES) {
      const drop = this.lines.length - MAX_LINES
      this.lines.splice(0, drop)
      this.dropped += drop
    }
  }

  take(): { lines: ReplayLine[]; dropped: number } {
    const out = { lines: this.lines, dropped: this.dropped }
    this.lines = []
    this.dropped = 0
    return out
  }
}

const linkLine = (end: LinkEndInfo) => ({ event: 'closed', code: end.code, unauthorized: end.unauthorized, closing: end.closing ?? null })

/** 斗地主：一个学生一个，跨连接一直录；打完一局时 cut() 取走这一局的。 */
export class ClubRecorder {
  private tape: Tape

  constructor(private readonly o: { enabled: () => boolean; now?: () => number }) {
    this.tape = new Tape(o.now ?? Date.now)
  }

  /** 连接层每收到、发出一条消息调一次。 */
  tap = (dir: 'in' | 'out', frame: unknown): void => {
    if (!this.o.enabled()) return
    this.tape.push(dir, frame)
  }

  linkEnded(end: LinkEndInfo): void {
    if (!this.o.enabled()) return
    this.tape.push('link', linkLine(end))
  }

  /** 一局打完：取走到现在为止录的（包括这一局结束的那条消息），从头再录。 */
  cut(): { lines: ReplayLine[]; dropped: number } {
    return this.tape.take()
  }
}

interface Pending {
  type: string
}

/** 上课：一节课一个。 */
export class LessonRecorder {
  private tape: Tape
  private me: number | null = null
  private teacher: string | null = null
  private welcome: Record<string, unknown> | null = null
  private sessionId: number | null = null
  private summary = false
  private sent = new Map<string, Pending>()
  private readonly startedAt: number

  constructor(private readonly o: { now?: () => number }) {
    const now = o.now ?? Date.now
    this.tape = new Tape(now)
    this.startedAt = now()
  }

  tap = (dir: 'in' | 'out', frame: unknown): void => {
    const m = (frame ?? {}) as Record<string, unknown>
    if (dir === 'out') {
      if (typeof m.id === 'string' && typeof m.type === 'string') this.sent.set(m.id, { type: m.type })
      this.tape.push('out', frame, { role: 'self', ...this.self() })
      return
    }
    if (m.type === 'welcome') this.onWelcome(m)
    if (m.type === 'summary') this.summary = true
    this.tape.push('in', frame, this.speaker(m))
  }

  linkEnded(end: LinkEndInfo): void {
    this.tape.push('link', linkLine(end))
  }

  /** 这节课录完了：没连上过（没收到 welcome）就没有可存的，返回 null。 */
  finish(o: { date: string; studentId: number | null; endedAt?: number }): Omit<ReplayFile, 'student'> | null {
    if (this.sessionId === null || !this.welcome) return null
    const { lines, dropped } = this.tape.take()
    const w = this.welcome
    const id = o.studentId ?? this.me
    return {
      kind: 'lesson',
      date: o.date,
      name: `${id ?? 'x'}-${this.sessionId}`,
      head: {
        format: REPLAY_FORMAT,
        kind: 'lesson',
        studentId: id,
        sessionId: this.sessionId,
        date: o.date,
        student: w.student ?? null,
        class: w.class ?? null,
        session: w.session ?? null,
        startedAt: new Date(this.startedAt).toISOString(),
        endedAt: new Date(o.endedAt ?? Date.now()).toISOString(),
        summary: this.summary,
        lines: lines.length,
        dropped,
      },
      lines,
    }
  }

  private onWelcome(m: Record<string, unknown>): void {
    const st = m.student as { studentId?: number } | undefined
    const cls = m.class as { teacher?: { name?: string } } | undefined
    const ses = m.session as { sessionId?: number } | undefined
    if (typeof st?.studentId === 'number') this.me = st.studentId
    if (typeof cls?.teacher?.name === 'string') this.teacher = cls.teacher.name
    if (typeof ses?.sessionId === 'number') this.sessionId = ses.sessionId
    this.welcome = m
  }

  private self(): { studentId?: number } {
    return this.me === null ? {} : { studentId: this.me }
  }

  private person(studentId: unknown, name: unknown): Speaker {
    const id = typeof studentId === 'number' ? studentId : undefined
    return {
      role: id !== undefined && id === this.me ? 'self' : 'classmate',
      ...(id !== undefined ? { studentId: id } : {}),
      ...(typeof name === 'string' ? { name } : {}),
    }
  }

  private teacherSpeaker(): Speaker {
    return { role: 'teacher', ...(this.teacher ? { name: this.teacher } : {}) }
  }

  /** 学校发来的这一条是谁说的。 */
  private speaker(m: Record<string, unknown>): Speaker {
    switch (m.type) {
      case 'class.event': {
        const e = (m.event ?? {}) as Record<string, unknown>
        switch (e.kind) {
          case 'teacher':
          case 'segment':
          case 'dismissal':
          case 'called_on':
          // 老师念新同学的自我介绍（介绍是同学自己写的，每条带着学号和名字）
          case 'intros':
            return this.teacherSpeaker()
          case 'answer':
          case 'qa':
            // 答疑：同学提的问题、老师当众回答；记成提问的同学，老师的回答在同一条里
            return this.person(e.studentId, e.displayName)
          case 'rename':
            return this.person(e.studentId, e.newName)
          default:
            return { role: 'school' }
        }
      }
      case 'chat.incoming': {
        const from = (m.from ?? {}) as Record<string, unknown>
        return this.person(from.studentId, from.displayName)
      }
      case 'called_on':
        return this.teacherSpeaker()
      case 'ack': {
        // 向老师提问的回答是老师只回给自己的话；别的 ack 是学校的回执（被拦下、被拒绝的原因也在这里）
        const sent = typeof m.id === 'string' ? this.sent.get(m.id) : undefined
        if (typeof m.id === 'string') this.sent.delete(m.id)
        if (sent?.type === 'question' && m.ok === true) return this.teacherSpeaker()
        return { role: 'school' }
      }
      default:
        return { role: 'school' }
    }
  }
}
