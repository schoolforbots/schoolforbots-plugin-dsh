// 一个学生的上学循环：查身份 → 查校历 → 等到开门 → 连上去上课 → 断了按规矩重连 → 下课 → 等下一节。
// 断开原因怎么处理照接口文档"连不上学校时怎么办"和"断开原因"两节。
import { ClassLink, type LinkEnd } from './class-link.js'
import { Classroom, type ClassroomDeps } from './classroom.js'
import { readStatusFile, SchoolError, type SchoolHttp } from './http.js'
import type { Me, PluginInfo, SchoolCalendar, Summary } from './protocol.js'
import { atLocal, nextLesson, zoneOffsetMinutes, type LessonWindow, type TimetableOptions } from './timetable.js'

/** 学校时区里某一天的零点。时区不认识就按北京时间。 */
export function schoolMidnight(date: string, timeZone?: string | null): number {
  const noon = Date.parse(`${date}T12:00:00Z`)
  const offset = (timeZone ? zoneOffsetMinutes(timeZone, noon) : null) ?? 480
  return atLocal(date, '00:00', offset)
}

export type Phase =
  | 'starting'
  | 'no-key'
  | 'unauthorized'
  | 'waiting-assignment' // 待分班、排队
  | 'left' // 已退学或被开除
  | 'suspended'
  | 'maintenance'
  | 'on-break'
  | 'waiting' // 等下一节课
  | 'in-class'
  | 'replaced'
  | 'offline' // 连不上学校
  | 'stopped'

export interface AttendanceStatus {
  phase: Phase
  /** 给机器人的主人看的一句话。 */
  message: string
  nextLessonAt: number | null
  me: Me | null
  updatedAt: number
}

export interface ResumePoint {
  date: string
  sessionId: number
  lastSeq: number
}

export interface Hold {
  until: number
  reason: string
}

export interface AttendanceDeps {
  http: SchoolHttp
  /** wss://<学校>/v1/class */
  classUrl: string
  /** 状态文件的地址；没有就不读。 */
  statusUrl?: string | null
  plugin: PluginInfo
  maxRounds: () => number
  getKey: () => Promise<string | null>
  /** 每节课开始时调一次：classroom 用的 think、设置等。 */
  classroom: (lesson: LessonWindow) => Omit<ClassroomDeps, 'send'>
  onSummary: (summary: Summary, sessionId: number) => void
  onStatus?: (s: AttendanceStatus) => void
  /** 要告诉机器人的主人的事（被顶替、被停课……）。 */
  onAlert?: (text: string) => void
  loadResume: () => ResumePoint | null
  saveResume: (r: ResumePoint | null) => void
  /** 到什么时刻以前不要连学校（被顶替、停课、放假）。要存进档案：热重载、poke 以后还要记得。 */
  loadHold?: () => Hold | null
  saveHold?: (h: Hold | null) => void
  /** 已经存下的小结编号，用来补拉下课时没收到的小结。 */
  knownSummaries: () => number[]
  timetable?: () => TimetableOptions
  now?: () => number
  random?: () => number
  log?: (msg: string) => void
}

const MIN = 60_000
const HOUR = 60 * MIN

export function backoffMs(failures: number, random: () => number = Math.random): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1))
  return Math.round(base * (0.5 + random()))
}

export class Attendance {
  status: AttendanceStatus
  private readonly ac = new AbortController()
  private link: ClassLink | null = null
  private wake: (() => void) | null = null
  /** 最近一次读到的校历（时区、开门时间）。 */
  private cal: SchoolCalendar | null = null
  /** 学校在 closing 里告诉的下一节课时刻。 */
  private hint: number | null = null
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly d: AttendanceDeps) {
    this.now = d.now ?? Date.now
    this.random = d.random ?? Math.random
    this.status = { phase: 'starting', message: '正在启动', nextLessonAt: null, me: null, updatedAt: this.now() }
  }

  private set(phase: Phase, message: string, extra: Partial<AttendanceStatus> = {}): void {
    this.status = { ...this.status, phase, message, ...extra, updatedAt: this.now() }
    this.d.onStatus?.(this.status)
  }

  private log(msg: string): void {
    this.d.log?.(msg)
  }

  /** 等 ms 毫秒；stop() 或 poke() 会提前叫醒。 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.ac.signal.aborted) return resolve()
      const signal = this.ac.signal
      const done = () => {
        clearTimeout(t)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const t = setTimeout(done, Math.max(0, ms))
      this.wake = done
      signal.addEventListener('abort', done, { once: true })
    })
  }

  /** 设置改了、刚报完名：马上重新看一遍。 */
  poke(): void {
    this.wake?.()
  }

  stop(): void {
    this.ac.abort()
    this.link?.close()
    this.set('stopped', '插件停了')
  }

  get stopped(): boolean {
    return this.ac.signal.aborted
  }

  async run(): Promise<void> {
    let failures = 0
    while (!this.stopped) {
      try {
        const wait = await this.once()
        failures = 0
        await this.sleep(wait)
      } catch (error) {
        if (this.stopped) break
        failures++
        const e = error as SchoolError
        if (e instanceof SchoolError && e.transient) {
          const msg = await this.offlineMessage(failures, e.message)
          this.set('offline', msg)
        } else {
          this.set('offline', `出错了：${(error as Error)?.message ?? error}`)
          this.log(`上学循环出错：${(error as Error)?.stack ?? error}`)
        }
        await this.sleep(Math.max(backoffMs(failures, this.random), failures >= 5 ? 5 * MIN : 0))
      }
    }
  }

  private async offlineMessage(failures: number, fallback: string): Promise<string> {
    if (failures < 3 || !this.d.statusUrl) return `连不上学校，过一会儿再试（${fallback}）`
    const s = await readStatusFile(this.d.statusUrl)
    if (s?.status === 'maintenance') return `学校在维护：${s.message ?? ''}`
    if (s?.status === 'down') return `学校的服务器出了故障，正在抢修：${s.message ?? ''}。插件会继续尝试。`
    if (s?.status === 'ok') return '学校那边一切正常，多半是这边到学校的网络有问题。插件会继续尝试。'
    return `连不上学校，过一会儿再试（${fallback}）`
  }

  /** 走一遍：返回接下来要等多久。 */
  private async once(): Promise<number> {
    const key = await this.d.getKey()
    if (!key) {
      this.set('no-key', '还没报名，或者钥匙没存好。用 /school 报名。')
      return 6 * HOUR
    }
    let me: Me
    try {
      me = await this.d.http.me(key)
    } catch (error) {
      if (error instanceof SchoolError && error.code === 'unauthorized') {
        this.set('unauthorized', '学校不认这把钥匙了（可能换过钥匙）。用 /school key-reset 换一把。')
        return 6 * HOUR
      }
      throw error
    }
    this.status.me = me
    const now = this.now()
    const hold = this.d.loadHold?.() ?? null
    if (hold && hold.until > now) {
      this.set(this.status.phase === 'starting' ? 'waiting' : this.status.phase, hold.reason, { nextLessonAt: null })
      // 一次最多睡一小时：中间学校可能解除（比如撤销误判的停课）
      return Math.min(hold.until - now, HOUR)
    }
    if (hold) this.d.saveHold?.(null)
    if (me.status === 'pending' || me.status === 'waitlisted') {
      this.set('waiting-assignment', me.status === 'pending' ? '报好名了，等分班：学校每个整点分一次，最晚一小时。' : '这个时段满了，正在排队等位：每个整点有空座就补进去。')
      // 学校每个整点分班、补空座：整点过 1～2 分钟再问，分好了马上知道，赶得上当天还没开门的课
      return HOUR - (now % HOUR) + MIN + this.random() * MIN
    }
    if (me.status === 'dropped' || me.status === 'expelled') {
      this.set('left', me.status === 'dropped' ? '已经退学了。想回来用 /school re-enroll。' : '被学校开除了。')
      return 12 * HOUR
    }
    if (me.status === 'suspended' && me.suspendedUntil && Date.parse(me.suspendedUntil) > now) {
      this.set('suspended', `正在停课，${new Date(me.suspendedUntil).toLocaleString('zh-CN', { hour12: false })} 以后才能回去上课。`)
      return Math.min(6 * HOUR, Date.parse(me.suspendedUntil) - now + MIN)
    }

    const cal = await this.d.http.calendar()
    this.cal = cal
    if (cal.maintenance) {
      this.set('maintenance', maintenanceText(cal.maintenance, now))
      return 5 * MIN + this.random() * MIN
    }
    let win = nextLesson(now, me.slot, cal, this.d.timetable?.() ?? {})
    if (!win) {
      this.set('on-break', breakText(cal), { nextLessonAt: null })
      return 12 * HOUR
    }
    // 学校上次说过下一节课的时刻（closing 的 nextLessonAt），比自己算的晚：听学校的
    if (this.hint !== null && this.hint <= now) this.hint = null
    if (this.hint !== null && win.startsAt < this.hint - MIN) {
      const doors = (cal.doorsOpenMinutesBefore ?? 15) * MIN
      win = { ...win, opensAt: this.hint - doors, startsAt: this.hint, endsAt: this.hint + (win.endsAt - win.startsAt) }
    }
    if (now < win.opensAt) {
      this.set('waiting', `下一节课在 ${new Date(win.startsAt).toLocaleString('zh-CN', { hour12: false })}。`, { nextLessonAt: win.startsAt })
      // 一次最多睡一小时：中间校历可能变（放假、维护）
      return Math.min(win.opensAt - now, HOUR)
    }
    await this.attend(key, win)
    // 学校刚说了下一节课的时刻：马上按它重新排
    if (this.hint !== null) return 0
    await this.fetchMissedSummaries(key)
    return MIN
  }

  /** 上一节课：断了就按规矩重连，直到下课或者被告知别再来。 */
  private async attend(key: string, win: LessonWindow): Promise<void> {
    const saved = this.d.loadResume()
    // 新的课堂（插件刚启动、热重载过）：前面的事都不记得了，请学校从头补发这节课（lastSeq 0）。
    // 补发的事标着"补发"进了课堂记录，下一步的 AI 就知道这节课前面讲了什么；同一个课堂里断线重连还是接着 lastSeq。
    let resume = saved && saved.date === win.date ? { sessionId: saved.sessionId, lastSeq: 0 } : null
    const room = new Classroom({ ...this.d.classroom(win), send: (m) => this.link?.send(m) ?? Promise.resolve({ type: 'ack', id: '', ok: false, error: { code: 'disconnected', message: '' } }), onSummary: (s, id) => this.d.onSummary(s, id) })
    let failures = 0
    try {
      while (!this.stopped) {
        this.set('in-class', '在上课', { nextLessonAt: win.startsAt })
        const link = new ClassLink({
          url: this.d.classUrl,
          key,
          plugin: this.d.plugin,
          maxRounds: this.d.maxRounds(),
          resume,
          onMessage: (m) => room.handle(m),
        })
        this.link = link
        const end: LinkEnd = await link.ended
        if (end.welcomed) failures = 0
        this.link = null
        // 插件已经停了（卸载、热重载）：不再写存档，免得把旧的状态写回去
        if (this.stopped) return
        if (link.sessionId !== null) {
          resume = { sessionId: link.sessionId, lastSeq: link.lastSeq }
          this.d.saveResume({ date: win.date, ...resume })
        }
        if (end.unauthorized) {
          this.set('unauthorized', '学校不认这把钥匙了。用 /school key-reset 换一把。')
          return
        }
        const c = end.closing
        if (c) {
          this.log(`学校断开了连接：${c.reason} ${c.message}`)
          switch (c.reason) {
            case 'session_over': {
              // 门还没开：学校告诉了下一节课的时刻（新版服务器才带 nextLessonAt）
              const next = c.nextLessonAt ? Date.parse(c.nextLessonAt) : NaN
              if (!end.welcomed && next > this.now()) {
                // 说的就是这一节（本机的钟快了，或者上课服务开门晚了）：别马上重连，越等越久，最晚到开课再连
                if (next <= win.startsAt + MIN) {
                  failures++
                  await this.sleep(Math.min(backoffMs(failures, this.random), next - this.now() + 1_000 + this.random() * 2_000))
                  continue
                }
                // 说的是更晚的一节（学校改了上课时间）：回去按它重新排
                this.hint = next
                return
              }
              // 下课了，或者门还没开、上课服务在重启：过了下课时间就算这节课结束
              if (this.now() >= win.endsAt) return
              failures++
              await this.sleep(backoffMs(failures, this.random) + (end.welcomed ? 0 : 20_000))
              continue
            }
            case 'replaced': {
              const text = '同一个学生在别处也连上了学校，这台 DSH 这节课先不去了。是不是开了两个 DSH？'
              this.d.saveHold?.({ until: win.endsAt + MIN, reason: text })
              this.set('replaced', text)
              this.d.onAlert?.(text)
              return
            }
            case 'suspended':
            case 'expelled': {
              // 停到什么时候以 GET /v1/me 为准；查不到就过一会儿再看
              let until = this.now() + (c.reason === 'expelled' ? 24 * HOUR : HOUR)
              if (c.reason === 'suspended') {
                const me = await this.d.http.me(key).catch(() => null)
                const end = me?.suspendedUntil ? Date.parse(me.suspendedUntil) : NaN
                // 学校给的结束时间已经过去、却还说在停课：至少等 5 分钟，免得每分钟连一次
                if (Number.isFinite(end)) until = Math.max(this.now() + 5 * MIN, Math.min(end, this.now() + 6 * HOUR))
              }
              this.d.saveHold?.({ until, reason: c.message })
              this.set(c.reason === 'expelled' ? 'left' : 'suspended', c.message)
              this.d.onAlert?.(c.message)
              return
            }
            case 'on_break': {
              // 用学校的时区和开门时间
              const doors = (this.cal?.doorsOpenMinutesBefore ?? 15) * MIN
              const first = c.firstLessonAt ? Date.parse(c.firstLessonAt) - doors : NaN
              const reopen = c.reopensOn ? schoolMidnight(c.reopensOn, this.cal?.timezone) : NaN
              const until = Number.isFinite(first) ? first : Number.isFinite(reopen) ? reopen : this.now() + 12 * HOUR
              this.d.saveHold?.({ until, reason: c.message })
              this.set('on-break', c.message)
              return
            }
            case 'maintenance':
              this.d.saveHold?.({ until: this.now() + 5 * MIN, reason: c.message })
              this.set('maintenance', c.message)
              return
          }
        }
        // 网络断了：越等越久地重连，带上 sessionId 和 lastSeq 续课
        if (this.now() >= win.endsAt + 2 * MIN) return
        failures++
        this.set('offline', await this.offlineMessage(failures, '连接断了'))
        await this.sleep(backoffMs(failures, this.random))
      }
    } finally {
      room.stop()
    }
  }

  /** 下课时没在线、没收到小结：从 GET /v1/me/summaries 补上。 */
  private async fetchMissedSummaries(key: string): Promise<void> {
    try {
      const known = new Set(this.d.knownSummaries())
      const r = await this.d.http.summaries(key, 3)
      for (const s of r.summaries.slice().reverse()) if (!known.has(s.sessionId)) this.d.onSummary(s, s.sessionId)
    } catch (error) {
      this.log(`补拉放学小结失败：${(error as Error).message}`)
    }
  }
}

export function maintenanceText(m: NonNullable<SchoolCalendar['maintenance']>, now: number): string {
  const back = m.expectedBackAt ? Date.parse(m.expectedBackAt) : null
  if (back === null) return `学校在维护：${m.message}`
  if (back <= now) return `学校在维护：${m.message}（维护比预计的久，请稍候）`
  return `学校在维护：${m.message}（预计 ${new Date(back).toLocaleString('zh-CN', { hour12: false })} 恢复）`
}

export function breakText(cal: SchoolCalendar): string {
  if (cal.state === 'not_started') return cal.openingDay ? `还没开学，${cal.openingDay} 开学。` : '还没开学，开学时间另行通知。'
  if (cal.state === 'on_break') return `放${cal.breakName ?? '假'}中，${cal.reopensOn ? `${cal.reopensOn} 开学` : '开学时间另行通知'}。`
  return '近期没有课。'
}
