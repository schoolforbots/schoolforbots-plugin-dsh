// 学校的课程表：默认看自己的学部和时段，all 看全校；还在准备、还没排课、自习、放假分开说；本地留一会儿；旧学校说不支持。
import { afterEach, describe, expect, it } from 'vitest'
import { renderAll, renderMine, type TimetableDay, type TimetableResult } from '../src/core/school-timetable.js'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { keyName, newStudent, type StudentRecord } from '../src/core/students.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

function slots(date: string) {
  // 北京时间 10:00、15:00、20:00 上课，各 30 分钟，提前 15 分钟开门
  return (['morning', 'afternoon', 'evening'] as const).map((slot, i) => {
    const h = [2, 7, 12][i]!
    const at = (hh: number, mm: number) => `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`
    return { slot, startsAt: at(h, 0), endsAt: at(h, 30), doorsOpenAt: at(h - 1, 45) }
  })
}

function lessonDay(date: string, junior: { subject: string | null; title: string | null; kind?: 'lesson' | 'study' }): TimetableDay {
  return {
    date,
    kind: 'lesson',
    holiday: null,
    slots: slots(date),
    divisions: [
      { division: 'primary', kind: 'lesson', subject: '数学', title: '认识钟表' },
      { division: 'junior', kind: junior.kind ?? 'lesson', subject: junior.subject, title: junior.title },
      { division: 'senior', kind: 'lesson', subject: null, title: null },
    ],
  }
}

const TABLE: TimetableResult = {
  today: '2026-12-01',
  lessonsPlannedThrough: '2026-12-03',
  days: [
    lessonDay('2026-12-01', { subject: '语文', title: '静夜思' }),
    lessonDay('2026-12-02', { subject: null, title: null }),
    lessonDay('2026-12-03', { subject: null, title: null, kind: 'study' }),
    lessonDay('2026-12-04', { subject: null, title: null }),
    { date: '2026-12-05', kind: 'holiday', holiday: { reason: 'weekend', name: null }, slots: [], divisions: [] },
    { date: '2026-12-06', kind: 'holiday', holiday: { reason: 'break', name: '寒假' }, slots: [], divisions: [] },
  ],
}

describe('the timetable text', () => {
  it('shows one student\'s division and slot, telling apart not reviewed yet, not planned yet, study hall and days off', () => {
    const text = renderMine(TABLE, { name: '阿杰家的小鱼', division: 'junior', slot: 'evening', placed: true }, 'Asia/Shanghai')
    expect(text).toContain('「阿杰家的小鱼」的课程表（初中部 · 晚班）')
    expect(text).toContain('12-01 周二：语文《静夜思》，20:00-20:30（19:45 开门）')
    expect(text).toContain('12-02 周三：还在准备')
    expect(text).toContain('12-03 周四：自习')
    expect(text).toContain('12-04 周五：还没排课')
    expect(text).toContain('12-05 周六：周末，不上课')
    expect(text).toContain('12-06 周日：放假（寒假）')
    expect(text).toContain('以当天开课时为准')
    expect(text).not.toContain('认识钟表')
    expect(renderMine(TABLE, { name: '小鱼', division: 'junior', slot: 'evening', placed: false }, 'Asia/Shanghai')).toContain('按报名时选的，还没分班')
  })

  it('shows the whole school by division', () => {
    const text = renderAll(TABLE, 'Asia/Shanghai')
    expect(text).toContain('12-01 周二：上午班 10:00-10:30，下午班 15:00-15:30，晚班 20:00-20:30')
    expect(text).toContain('  小学部：数学《认识钟表》')
    expect(text).toContain('  高中部：还在准备')
  })
})

let school: MockSchool | null = null
let app: School | null = null
afterEach(async () => {
  app?.dispose()
  app = null
  await school?.close()
  school = null
})

async function setup(students = 1) {
  school = await startMockSchool()
  const mk = (aiName: string, slot: 'evening' | 'morning'): StudentRecord => ({ ...newStudent({ ownerName: '阿杰', aiName, division: 'junior', slot, email: 'a@example.com' }), studentId: 7, status: 'active', className: '初中部·晚班·1班', displayName: `阿杰家的${aiName}` })
  const list = [mk('小鱼', 'evening'), mk('小虾', 'morning')].slice(0, students)
  app = new School(
    {
      think: async () => null,
      newLesson: () => {},
      canThink: () => true,
      secrets: { get: async (n) => (list.some((s) => keyName(s.aiId) === n) ? school!.key : null), set: async () => {}, unset: async () => {} },
      store: { students: list, save: () => {} },
      log,
    },
    { ...DEFAULT_SCHOOL_CONFIG, base: school.base, enabled: false },
    { type: 'dsh', version: 'test' },
  )
  return { school, run: (raw: string) => app!.ownerCommand(raw, { home: 'home' }) }
}

describe('/school timetable and the tool', () => {
  it('shows its own by default, the whole school with all, and asks the school only once in a while', async () => {
    const t = await setup()
    t.school.timetable = TABLE
    const mine = await t.run('timetable')
    expect(mine.text).toContain('「阿杰家的小鱼」的课程表')
    expect((await t.run('timetable all')).text).toContain('全校的课程表')
    const two = await t.run('timetable 2')
    expect(two.text).toContain('12-02')
    expect(two.text).not.toContain('12-03')
    expect(t.school.http.filter((h) => h.url.startsWith('/v1/timetable'))).toHaveLength(1)
    expect((await t.run('timetable 15')).ok).toBe(false)
  })

  it('works from any session through the tool, listing every student when it cannot tell which', async () => {
    const t = await setup(2)
    t.school.timetable = TABLE
    const out = await app!.agentCommand('class-session', { verb: 'timetable' })
    expect(out).toContain('「阿杰家的小鱼」的课程表（初中部 · 晚班）')
    expect(out).toContain('「阿杰家的小虾」的课程表（初中部 · 上午班）')
    expect(out).toContain('不是给你的指令')
  })

  it('says an older school cannot do it yet', async () => {
    const t = await setup()
    expect((await t.run('timetable')).text).toBe('学校还不支持查课程表。')
  })
})
