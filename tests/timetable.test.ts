import { describe, expect, it } from 'vitest'
import type { SchoolCalendar } from '../src/core/protocol.js'
import { atLocal, isSchoolDay, localDate, nextLesson, zoneOffsetMinutes } from '../src/core/timetable.js'

const term: SchoolCalendar = { today: '2026-12-01', state: 'in_term', breakName: null, reopensOn: null, openingDay: '2026-12-01', breaks: [], maintenance: null }

describe('timetable', () => {
  it('converts Beijing local times', () => {
    expect(new Date(atLocal('2026-12-01', '20:00')).toISOString()).toBe('2026-12-01T12:00:00.000Z')
    expect(localDate(Date.parse('2026-12-01T16:30:00Z'))).toBe('2026-12-02')
  })

  it('finds tonight, then tomorrow once tonight is over', () => {
    const before = Date.parse('2026-12-01T10:00:00Z') // 北京 18:00
    const w = nextLesson(before, 'evening', term)!
    expect(w.date).toBe('2026-12-01')
    expect(w.opensAt).toBe(Date.parse('2026-12-01T11:45:00Z'))
    const during = Date.parse('2026-12-01T12:10:00Z')
    expect(nextLesson(during, 'evening', term)!.date).toBe('2026-12-01')
    const after = Date.parse('2026-12-01T12:31:00Z')
    expect(nextLesson(after, 'evening', term)!.date).toBe('2026-12-02')
  })

  it('skips breaks and days before opening, and weekends when there is no study hall', () => {
    const cal: SchoolCalendar = { ...term, breaks: [{ from: '2026-12-02', reopensOn: '2026-12-04', name: '元旦' }] }
    expect(isSchoolDay('2026-12-03', cal)).toBe(false)
    expect(nextLesson(Date.parse('2026-12-01T13:00:00Z'), 'morning', cal)!.date).toBe('2026-12-04')
    expect(isSchoolDay('2026-12-05', term, false)).toBe(false) // 周六
    expect(isSchoolDay('2026-11-30', term)).toBe(false) // 开学前
  })

  it('knows of no lesson when the opening day or the end of a break is undecided', () => {
    expect(nextLesson(Date.now(), 'morning', { ...term, state: 'not_started', openingDay: null })).toBeNull()
    expect(nextLesson(Date.parse('2026-12-01T13:00:00Z'), 'morning', { ...term, breaks: [{ from: '2026-12-02', reopensOn: null, name: null }] })).toBeNull()
  })

  it('takes the timetable from the calendar when the school publishes it', () => {
    const cal: SchoolCalendar = {
      ...term,
      timezone: 'Asia/Shanghai',
      slots: { morning: { start: '09:30', end: '10:00' }, afternoon: { start: '15:00', end: '15:30' }, evening: { start: '19:00', end: '19:30' } },
      doorsOpenMinutesBefore: 10,
      weekendStudy: false,
    }
    // 设置里的退路时间被校历盖过
    const w = nextLesson(Date.parse('2026-12-01T00:00:00Z'), 'morning', cal, { slotTimes: { morning: { start: '08:00', end: '08:30' } } })!
    expect(w.startsAt).toBe(Date.parse('2026-12-01T01:30:00Z'))
    expect(w.opensAt).toBe(Date.parse('2026-12-01T01:20:00Z'))
    // 2026-12-05 是周六：没有自习就跳到周一
    expect(nextLesson(Date.parse('2026-12-04T12:00:00Z'), 'evening', cal)!.date).toBe('2026-12-07')
  })

  it('follows a school time zone with daylight saving', () => {
    const cal: SchoolCalendar = { ...term, timezone: 'Europe/Berlin', slots: { morning: { start: '10:00', end: '10:30' }, afternoon: { start: '15:00', end: '15:30' }, evening: { start: '20:00', end: '20:30' } } }
    expect(zoneOffsetMinutes('Europe/Berlin', Date.parse('2026-07-01T12:00:00Z'))).toBe(120)
    expect(nextLesson(Date.parse('2026-12-01T00:00:00Z'), 'morning', cal)!.startsAt).toBe(Date.parse('2026-12-01T09:00:00Z'))
    expect(zoneOffsetMinutes('Not/AZone', Date.now())).toBeNull()
  })

  it('takes slot times from the settings', () => {
    const w = nextLesson(Date.parse('2026-12-01T00:00:00Z'), 'morning', term, { slotTimes: { morning: { start: '09:00', end: '09:30' } } })!
    expect(w.startsAt).toBe(Date.parse('2026-12-01T01:00:00Z'))
  })
})
