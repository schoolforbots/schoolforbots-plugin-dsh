// 一个学生的社团循环：查身份 → 查校历（社团开没开、什么时候关门）→ 主人设的时间段、今天打够了没有 → 连上去打牌 →
// 断了按断开原因等或者重连。断开原因照接口文档"社团的断开原因"一节。
// 社团在上课时间关门（每个时段从开门到收尾），所以和上学循环不会同时连。
import { schoolMidnight, backoffMs, maintenanceText, type Hold } from './attendance.js'
import { ClubLink, type ClubLinkEnd } from './club-link.js'
import { ClubTable, type ClubTableDeps } from './club-table.js'
import { SchoolError, type SchoolHttp } from './http.js'
import type { Me, PluginInfo, SchoolCalendar } from './protocol.js'
import { atLocal, zoneOffsetMinutes } from './timetable.js'

export type ClubPhase = 'starting' | 'off' | 'not-eligible' | 'closed' | 'waiting' | 'playing' | 'done-today' | 'maintenance' | 'offline' | 'stopped'

export interface ClubStatus {
  phase: ClubPhase
  message: string
  updatedAt: number
}

export interface ClubResume {
  roomId: string
  lastSeq: number
}

export interface ClubAttendanceDeps {
  http: SchoolHttp
  /** wss://<学校>/v1/club */
  clubUrl: string
  plugin: PluginInfo
  getKey: () => Promise<string | null>
  /** 主人打开了入社开关。 */
  enabled: () => boolean
  /** 学校时区的这一天已经打了几局。 */
  gamesOn: (date: string) => number
  gamesPerDay: () => number
  /** 主人设的打牌时间段（学校时区的 HH:MM-HH:MM）；null 是社团开门就去。 */
  window: () => { start: string; end: string } | null
  /** 每次连上时调一次：牌桌要的 ask、设置、记一局的地方。 */
  table: (today: () => string) => Omit<ClubTableDeps, 'send' | 'onRoom' | 'onDone' | 'wantMore' | 'today'>
  loadResume: () => ClubResume | null
  saveResume: (r: ClubResume | null) => void
  loadHold: () => Hold | null
  saveHold: (h: Hold | null) => void
  /** 学校说不是社员：把主人的入社开关关掉。 */
  onNotMember?: (message: string) => void
  onStatus?: (s: ClubStatus) => void
  onAlert?: (text: string) => void
  now?: () => number
  random?: () => number
  log?: (msg: string) => void
}

const MIN = 60_000
const HOUR = 60 * MIN

/** 学校时区的下一天。 */
function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

/** 主人设的时间段，换成绝对时刻：这一天的开始、结束（结束早于开始表示跨过午夜）。 */
export function windowOn(date: string, w: { start: string; end: string }, timeZone?: string): { from: number; to: number } {
  const noon = Date.parse(`${date}T12:00:00Z`)
  const offset = (timeZone ? zoneOffsetMinutes(timeZone, noon) : null) ?? 480
  const from = atLocal(date, w.start, offset)
  let to = atLocal(date, w.end, offset)
  if (to <= from) to += 86_400_000
  return { from, to }
}

export class ClubAttendance {
  status: ClubStatus
  private readonly ac = new AbortController()
  private link: ClubLink | null = null
  private table: ClubTable | null = null
  private wake: (() => void) | null = null
  private cal: SchoolCalendar | null = null
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly d: ClubAttendanceDeps) {
    this.now = d.now ?? Date.now
    this.random = d.random ?? Math.random
    this.status = { phase: 'starting', message: '正在启动', updatedAt: this.now() }
  }

  private set(phase: ClubPhase, message: string): void {
    this.status = { phase, message, updatedAt: this.now() }
    this.d.onStatus?.(this.status)
  }

  private log(msg: string): void {
    this.d.log?.(msg)
  }

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

  poke(): void {
    this.wake?.()
  }

  stop(): void {
    this.ac.abort()
    this.table?.stop()
    this.link?.close()
    this.set('stopped', '插件停了')
  }

  get stopped(): boolean {
    return this.ac.signal.aborted
  }

  /** 学校时区的今天：用最近一次读到的校历推算。 */
  private today(): string {
    const tz = this.cal?.timezone
    const offset = (tz ? zoneOffsetMinutes(tz, this.now()) : null) ?? 480
    return new Date(this.now() + offset * MIN).toISOString().slice(0, 10)
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
        this.set('offline', e instanceof SchoolError ? `连不上学校，过一会儿再试（${e.message}）` : `出错了：${(error as Error)?.message ?? error}`)
        if (!(e instanceof SchoolError)) this.log(`社团循环出错：${(error as Error)?.stack ?? error}`)
        await this.sleep(Math.max(backoffMs(failures, this.random), failures >= 5 ? 5 * MIN : 0))
      }
    }
  }

  /** 走一遍：返回接下来要等多久。 */
  private async once(): Promise<number> {
    if (!this.d.enabled()) {
      this.set('off', '没有入社。')
      return 6 * HOUR
    }
    const key = await this.d.getKey()
    if (!key) {
      this.set('off', '还没有钥匙。')
      return 6 * HOUR
    }
    const now = this.now()
    const hold = this.d.loadHold()
    if (hold && hold.until > now) {
      this.set(this.status.phase === 'starting' ? 'waiting' : this.status.phase, hold.reason)
      return Math.min(hold.until - now, HOUR)
    }
    if (hold) this.d.saveHold(null)

    let me: Me
    try {
      me = await this.d.http.me(key)
    } catch (error) {
      if (error instanceof SchoolError && error.code === 'unauthorized') {
        this.set('not-eligible', '学校不认这把钥匙了。')
        return 6 * HOUR
      }
      throw error
    }
    if (me.status !== 'active' || !me.className) {
      this.set('not-eligible', me.status === 'suspended' ? '停课中，社团也去不了。' : '还没分班，或者已经不在学校：社团要在读、分好班的学生才能去。')
      return HOUR
    }

    const cal = await this.d.http.calendar()
    this.cal = cal
    if (!cal.clubs) {
      this.set('closed', '学校还没有开社团。')
      return 6 * HOUR
    }
    if (!cal.clubs.enabled) {
      this.set('closed', '学校暂时关掉了社团。')
      return HOUR
    }
    if (cal.maintenance) {
      this.set('maintenance', maintenanceText(cal.maintenance, now))
      return 5 * MIN + this.random() * MIN
    }
    // 正在关门（上课时间）：等到这一段结束
    const closure = cal.clubs.closures.find((c) => Date.parse(c.startsAt) <= now && now < Date.parse(c.endsAt))
    if (closure) {
      const until = Date.parse(closure.endsAt)
      this.set('closed', `社团现在关门（上课时间），${fmt(until)} 再开。`)
      return Math.min(until - now + this.random() * 30_000, HOUR)
    }
    // 日期一律按学校时区自己算（和记牌局用的同一个），不混用校历里的 today
    const today = this.today()
    const cap = this.d.gamesPerDay()
    if (this.d.gamesOn(today) >= cap) {
      const tomorrow = schoolMidnight(nextDate(today), cal.timezone)
      this.set('done-today', `今天打够了 ${cap} 局，明天再去。`)
      return Math.min(Math.max(tomorrow - now, MIN), HOUR)
    }
    const w = this.d.window()
    if (w) {
      const todayWin = windowOn(today, w, cal.timezone)
      const prevWin = windowOn(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10), w, cal.timezone)
      const inside = (now >= todayWin.from && now < todayWin.to) || (now >= prevWin.from && now < prevWin.to)
      if (!inside) {
        const next = now < todayWin.from ? todayWin.from : windowOn(nextDate(today), w, cal.timezone).from
        this.set('waiting', `主人设的打牌时间是 ${w.start}-${w.end}，${fmt(next)} 再去。`)
        return Math.min(next - now, HOUR)
      }
    }
    // 打够了自己离开的：马上重新看一遍（今天打够了、时间段过了）；别的情况过一分钟再看
    return (await this.play(key)) ? 1_000 : MIN
  }

  /** 连上去打牌：断了就按规矩重连，直到打够了、关门了，或者被告知别再来。 */
  private async play(key: string): Promise<boolean> {
    let failures = 0
    while (!this.stopped) {
      let done = false
      const today = () => this.today()
      // 每次判断都读当前的设置：配置页上改了局数、时间段，打完这一局就按新的来
      const wantMore = () => {
        if (this.stopped || !this.d.enabled()) return false
        if (this.d.gamesOn(today()) >= this.d.gamesPerDay()) return false
        const win = this.d.window()
        if (!win) return true
        const t = this.now()
        const a = windowOn(today(), win, this.cal?.timezone)
        const b = windowOn(new Date(Date.parse(`${today()}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10), win, this.cal?.timezone)
        return (t >= a.from && t < a.to) || (t >= b.from && t < b.to)
      }
      const link = new ClubLink({
        url: this.d.clubUrl,
        key,
        plugin: this.d.plugin,
        resume: this.d.loadResume(),
        onMessage: (m) => table.handle(m),
      })
      const table = new ClubTable({
        ...this.d.table(today),
        send: (m) => link.send(m),
        onRoom: (roomId, lastSeq) => {
          link.enterRoom(roomId, lastSeq)
          this.d.saveResume({ roomId, lastSeq })
        },
        onDone: () => {
          done = true
          link.close()
        },
        wantMore,
        today,
      })
      this.link = link
      this.table = table
      this.set('playing', '在社团打牌')
      const end: ClubLinkEnd = await link.ended
      table.stop()
      this.link = null
      this.table = null
      if (this.stopped) return false
      this.d.saveResume(link.roomId ? { roomId: link.roomId, lastSeq: link.lastSeq } : null)
      if (done) {
        this.d.saveResume(null)
        return true
      }
      if (end.unauthorized) {
        this.set('not-eligible', '学校不认这把钥匙了。')
        return false
      }
      const c = end.closing
      if (c) {
        this.log(`社团断开了连接：${c.reason} ${c.message}`)
        switch (c.reason) {
          case 'club_closed': {
            const reopen = c.reopensAt ? Date.parse(c.reopensAt) : NaN
            const until = Number.isFinite(reopen) ? reopen + this.random() * 30_000 : this.now() + 10 * MIN
            this.d.saveHold({ until, reason: `社团关门了，${fmt(until)} 再开。` })
            this.d.saveResume(null)
            this.set('closed', c.message)
            return false
          }
          case 'maintenance':
            this.d.saveHold({ until: this.now() + 5 * MIN, reason: c.message })
            this.set('maintenance', c.message)
            return false
          case 'replaced': {
            const text = '同一个学生在别处也连上了社团，这台 DSH 一小时内先不去。是不是开了两个 DSH？'
            this.d.saveHold({ until: this.now() + HOUR, reason: text })
            this.d.onAlert?.(text)
            this.set('waiting', text)
            return false
          }
          case 'suspended':
          case 'expelled':
            this.d.saveHold({ until: this.now() + (c.reason === 'expelled' ? 24 : 1) * HOUR, reason: c.message })
            this.set('not-eligible', c.message)
            return false
          case 'not_member':
            this.d.saveResume(null)
            this.d.onNotMember?.(c.message)
            this.set('off', c.message)
            return false
          case 'service_stopping':
            break
        }
      }
      // 网络断了、社团服务重启：越等越久地重连，带上 roomId 和 lastSeq（打牌中掉线座位还在）
      failures++
      this.set('offline', '和社团的连接断了，马上重连')
      await this.sleep(backoffMs(failures, this.random) + (c?.reason === 'service_stopping' ? 5_000 : 0))
    }
    return false
  }
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}
