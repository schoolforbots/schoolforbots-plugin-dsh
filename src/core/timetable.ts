// 什么时候该去上学。
//
// 学校的作息以校历接口（GET /v1/school-calendar）为准：timezone、slots、doorsOpenMinutesBefore、weekendStudy。
// 旧版服务器的校历里没有这几项，这时用插件自带的默认值（10:00、15:00、20:00，北京时间，开课前 15 分钟开门，周末有自习），
// 机器人的主人也可以在设置里改。算错了也不要紧：门没开时连上去，学校会告诉插件下一节课的时刻（closing 的 nextLessonAt）。

import type { SchoolCalendar, Slot } from './protocol.js'

export interface SlotTime {
  start: string // HH:MM，学校所在时区
  end: string
}

export const DEFAULT_SLOT_TIMES: Record<Slot, SlotTime> = {
  morning: { start: '10:00', end: '10:30' },
  afternoon: { start: '15:00', end: '15:30' },
  evening: { start: '20:00', end: '20:30' },
}

/** 校历里没有作息时的退路。 */
export interface TimetableOptions {
  slotTimes?: Partial<Record<Slot, SlotTime>>
  /** 学校时区相对 UTC 的分钟数。北京时间是 480，没有夏令时。 */
  utcOffsetMinutes?: number
  /** 开课前多少分钟开门。 */
  doorsOpenMinutes?: number
  /** 周末有没有自习。学校默认有。 */
  weekendStudy?: boolean
}

export interface LessonWindow {
  date: string
  /** 开门（可以连上去）的时刻。 */
  opensAt: number
  startsAt: number
  endsAt: number
}

const DAY = 86_400_000

/** 某个 IANA 时区在 at 这一刻相对 UTC 的分钟数。时区名不认识返回 null。 */
export function zoneOffsetMinutes(timeZone: string, at: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60_000)
  } catch {
    return null
  }
}

export function localDate(ms: number, offsetMinutes = 480): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

export function atLocal(date: string, hhmm: string, offsetMinutes = 480): number {
  const [h, m] = hhmm.split(':').map(Number)
  return Date.parse(`${date}T00:00:00Z`) + ((h ?? 0) * 60 + (m ?? 0) - offsetMinutes) * 60_000
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/** 这一天上不上学：开学以后、不在假期里，周末看有没有自习。日期都是 YYYY-MM-DD，可以直接比大小。 */
export function isSchoolDay(date: string, cal: SchoolCalendar, weekendStudy = true): boolean {
  if (cal.state === 'not_started' && (cal.openingDay === null || date < cal.openingDay)) return false
  if (cal.openingDay !== null && date < cal.openingDay) return false
  for (const b of cal.breaks) {
    if (date >= b.from && (b.reopensOn === null || date < b.reopensOn)) return false
  }
  const wd = weekday(date)
  if (!weekendStudy && (wd === 0 || wd === 6)) return false
  return true
}

/** 一个时段的作息：校历给了就用校历的，没给用退路。 */
export function slotTimeOf(slot: Slot, cal: SchoolCalendar, opts: TimetableOptions = {}): SlotTime {
  return cal.slots?.[slot] ?? { ...DEFAULT_SLOT_TIMES[slot], ...(opts.slotTimes?.[slot] ?? {}) }
}

/**
 * 从 now 起（含正在上的这一节）的下一节课。校历里看不到下一节课（还没开学且没定开学日、放假且没定结束日）时返回 null。
 * 最多往后找 120 天。
 */
export function nextLesson(now: number, slot: Slot, cal: SchoolCalendar, opts: TimetableOptions = {}): LessonWindow | null {
  const offsetAt = (at: number) => (cal.timezone ? zoneOffsetMinutes(cal.timezone, at) : null) ?? opts.utcOffsetMinutes ?? 480
  const t = slotTimeOf(slot, cal, opts)
  const doors = (cal.doorsOpenMinutesBefore ?? opts.doorsOpenMinutes ?? 15) * 60_000
  const weekendStudy = cal.weekendStudy ?? opts.weekendStudy ?? true
  let date = localDate(now, offsetAt(now))
  for (let i = 0; i < 120; i++, date = addDays(date, 1)) {
    if (!isSchoolDay(date, cal, weekendStudy)) continue
    // 那一天中午的时区偏移（有夏令时的时区也对）
    const offset = offsetAt(Date.parse(`${date}T12:00:00Z`))
    const startsAt = atLocal(date, t.start, offset)
    let endsAt = atLocal(date, t.end, offset)
    if (endsAt <= startsAt) endsAt += 24 * 60 * 60_000
    if (endsAt <= now) continue
    return { date, opensAt: startsAt - doors, startsAt, endsAt }
  }
  return null
}
