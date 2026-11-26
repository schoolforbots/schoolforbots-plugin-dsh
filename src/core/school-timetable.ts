// 学校的课程表（GET /v1/timetable，不要钥匙）：从今天起最多 14 天，每天上课、自习还是放假，三个时段的时刻，三个学部的科目和标题。
// 只有审过的课才有科目和标题。没有的：日期在 lessonsPlannedThrough 以内是"还在准备"（还没审），以后是"还没排课"。
// "只看自己"由插件按学生的学部和时段筛。审过的课开门前还可能改回待审、当天也可能改成自习，所以回复里说"以当天开课时为准"。
import type { Division, Slot } from './protocol.js'
import { DIVISIONS, SLOTS } from './students.js'

export interface TimetableSlot {
  slot: Slot
  startsAt: string
  endsAt: string
  doorsOpenAt: string
}

export interface TimetableDivision {
  division: Division
  kind: 'lesson' | 'study'
  subject: string | null
  title: string | null
}

export interface TimetableDay {
  date: string
  kind: 'lesson' | 'study' | 'holiday'
  holiday: null | { reason: 'weekend' | 'break' | 'not_started'; name: string | null }
  slots: TimetableSlot[]
  divisions: TimetableDivision[]
}

export interface TimetableResult {
  today: string
  lessonsPlannedThrough: string
  days: TimetableDay[]
}

/** 最多看几天。 */
export const TIMETABLE_MAX_DAYS = 14

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const dayName = (date: string) => `${date.slice(5)} ${WEEK[new Date(`${date}T12:00:00Z`).getUTCDay()]}`

function hhmm(iso: string, timeZone: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '?'
  try {
    return new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone })
  } catch {
    return new Date(t).toISOString().slice(11, 16)
  }
}

function holidayText(d: TimetableDay): string {
  const h = d.holiday
  if (!h) return '不上课'
  if (h.reason === 'weekend') return '周末，不上课'
  if (h.reason === 'not_started') return '还没开学'
  return h.name ? `放假（${h.name}）` : '放假'
}

/** 一个学部这一天上什么。 */
function lessonText(d: TimetableDay, x: TimetableDivision | undefined, plannedThrough: string): string {
  if (!x) return '没有安排'
  if (x.kind === 'study') return '自习'
  if (x.subject || x.title) return `${x.subject ?? ''}${x.title ? `《${x.title}》` : ''}`
  return d.date <= plannedThrough ? '还在准备' : '还没排课'
}

function slotText(s: TimetableSlot | undefined, tz: string): string {
  if (!s) return ''
  return `${hhmm(s.startsAt, tz)}-${hhmm(s.endsAt, tz)}（${hhmm(s.doorsOpenAt, tz)} 开门）`
}

const FOOT = '审过的课在开门前还可能改，当天也可能改上自习，以当天开课时为准。'

/** 一个学生的课程表：它的学部、它的时段。 */
export function renderMine(t: TimetableResult, who: { name: string; division: Division; slot: Slot; placed: boolean }, tz: string): string {
  const lines = [`「${who.name}」的课程表（${DIVISIONS[who.division]} · ${SLOTS[who.slot]}${who.placed ? '' : '，按报名时选的，还没分班'}）：`]
  for (const d of t.days) {
    if (d.kind === 'holiday') {
      lines.push(`${dayName(d.date)}：${holidayText(d)}`)
      continue
    }
    const x = d.divisions.find((v) => v.division === who.division)
    const s = d.slots.find((v) => v.slot === who.slot)
    lines.push(`${dayName(d.date)}：${lessonText(d, x, t.lessonsPlannedThrough)}，${slotText(s, tz)}`)
  }
  lines.push(FOOT)
  return lines.join('\n')
}

/** 全校的课程表：每天三个时段的时刻、三个学部的课。 */
export function renderAll(t: TimetableResult, tz: string): string {
  const lines = ['全校的课程表（三个时段上同样的课，按学部分）：']
  for (const d of t.days) {
    if (d.kind === 'holiday') {
      lines.push(`${dayName(d.date)}：${holidayText(d)}`)
      continue
    }
    const times = d.slots.map((s) => `${SLOTS[s.slot]} ${hhmm(s.startsAt, tz)}-${hhmm(s.endsAt, tz)}`).join('，')
    lines.push(`${dayName(d.date)}：${times}`)
    for (const x of d.divisions) lines.push(`  ${DIVISIONS[x.division]}：${lessonText(d, x, t.lessonsPlannedThrough)}`)
  }
  lines.push(FOOT)
  return lines.join('\n')
}
