// 换学部和时段：/school move 先说明会怎样，加"确认"才真换；换好以后记下新的学部时段、按等分班重新排。
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { keyName, newStudent, type StudentRecord } from '../src/core/students.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

let school: MockSchool | null = null
let app: School | null = null
afterEach(async () => {
  app?.dispose()
  await school?.close()
})

async function setup() {
  school = await startMockSchool()
  const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active', className: '初中部·晚班·1班', displayName: '阿杰家的小鱼' }
  s.binding.home = 'home'
  const secrets = new Map([[keyName(s.aiId), school.key]])
  app = new School(
    {
      think: async () => null,
      newLesson: () => {},
      canThink: () => true,
      secrets: { get: async (n) => secrets.get(n) ?? null, set: async () => {}, unset: async () => {} },
      store: { students: [s], save: () => {} },
      log,
    },
    { ...DEFAULT_SCHOOL_CONFIG, base: school.base, enabled: false },
    { type: 'dsh', version: 'test' },
  )
  const run = (raw: string) => app!.ownerCommand(raw, { home: 'home' })
  const patches = () => school!.http.filter((h) => h.method === 'PATCH')
  return { s, school, run, patches }
}

describe('/school move', () => {
  it('first says what will happen, and only moves once confirmed', async () => {
    const t = await setup()
    const preview = await t.run('move 高中部')
    expect(preview.ok).toBe(true)
    expect(preview.text).toContain('从 初中部 · 晚班 换到 高中部 · 晚班')
    expect(preview.text).toContain('马上离开现在的班（初中部·晚班·1班）')
    expect(preview.text).toContain('最晚一小时分进新班')
    expect(preview.text).toContain('一天只能换一次')
    expect(preview.text).not.toContain('那个时段满了') // 时段不变，不会满
    expect(preview.text).toContain('确定的话打 /school move 高中部 晚班 确认')
    expect(t.patches()).toEqual([])

    const done = await t.run('move 高中部 晚班 确认')
    expect(done.text).toContain('换好了：现在是 高中部 · 晚班')
    expect(t.patches()).toEqual([expect.objectContaining({ url: '/v1/me/placement', body: { division: 'senior', slot: 'evening' } })])
    expect(t.s).toMatchObject({ division: 'senior', slot: 'evening', status: 'pending', className: null })
  })

  it('takes only the slot, in either order, and warns that another slot may be full', async () => {
    const t = await setup()
    const preview = await t.run('move 上午班')
    expect(preview.text).toContain('换到 初中部 · 上午班')
    expect(preview.text).toContain('那个时段满了或者有人在排队就换不了')
    await t.run('move 上午班 高中部 确认')
    expect(t.patches()[0]!.body).toEqual({ division: 'senior', slot: 'morning' })
  })

  it('does nothing when nothing changes, and explains what it cannot read', async () => {
    const t = await setup()
    expect((await t.run('move 初中部 晚班 确认')).text).toContain('本来就是 初中部 · 晚班')
    expect((await t.run('move')).ok).toBe(false)
    expect((await t.run('move 大学部')).text).toContain('看不懂「大学部」')
    expect(t.patches()).toEqual([])
  })

  it('warns that the lesson going on will end at once', async () => {
    const t = await setup()
    ;(app as unknown as { runners: Map<string, unknown> }).runners.set(t.s.aiId, { status: { phase: 'in-class' }, poke: () => {}, stop: () => {} })
    expect((await t.run('move 高中部')).text).toContain('它正在上课：一换，这节课马上断开')
    expect(app!.moveNotice('home')).toContain('这节课马上断开')
  })

  it('says when it can move again, and that it stays in its class when the slot is full', async () => {
    const t = await setup()
    t.school.respond = (m, p) => (p === '/v1/me/placement' ? { status: 409, data: { error: { code: 'move_cooldown', message: '今天已经换过了。', retryAfter: '2026-12-02' } } } : null)
    const cool = await t.run('move 高中部 确认')
    expect(cool.ok).toBe(false)
    expect(cool.text).toBe('今天已经换过了。（2026-12-02 起可以再换）')
    t.school.respond = (m, p) => (p === '/v1/me/placement' ? { status: 409, data: { error: { code: 'slot_full', message: '上午班满了。' } } } : null)
    expect((await t.run('move 上午班 确认')).text).toBe('上午班满了。（没有换，还在原来的班）')
    expect(t.s).toMatchObject({ division: 'junior', slot: 'evening', status: 'active' })
  })
})
