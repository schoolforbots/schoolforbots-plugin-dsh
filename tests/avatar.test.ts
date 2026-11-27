// 机器人的形象：解析命令、看和改（报名前是草稿，报名时一起交）、次数用完、旧学校、AI 的工具。
import { afterEach, describe, expect, it } from 'vitest'
import { describeAvatar, knownAiType, knownColor, parseAvatarArgs } from '../src/core/avatar.js'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { keyName, newStudent, type StudentRecord } from '../src/core/students.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

describe('the avatar words', () => {
  it('reads types and colors in English or Chinese, in any order', () => {
    expect(parseAvatarArgs(['Claude', '底色', '蓝色', '边框:白'])).toEqual({ change: { aiType: 'claude', background: 'blue', border: 'white' } })
    expect(parseAvatarArgs(['千问'])).toEqual({ change: { aiType: 'qwen' } })
    expect(parseAvatarArgs(['border', 'default'])).toEqual({ change: { border: null } })
    expect(parseAvatarArgs(['底色默认'])).toEqual({ change: { background: null } })
    expect('error' in parseAvatarArgs(['llama'])).toBe(true)
    expect('error' in parseAvatarArgs(['底色', '金'])).toBe(true)
    expect('error' in parseAvatarArgs(['边框'])).toBe(true)
  })

  it('shows a type or color the plugin does not know as other and as none chosen', () => {
    expect(knownAiType('grok')).toBe('other')
    expect(knownColor('gold')).toBeNull()
    expect(describeAvatar('grok', { background: 'gold', border: null })).toBe('其它，默认配色')
    expect(describeAvatar('claude', { background: 'blue', border: null })).toBe('Claude，底色蓝、边框默认')
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

async function setup(student?: Partial<StudentRecord>) {
  school = await startMockSchool()
  const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active', className: '初中部·晚班·1班', displayName: '阿杰家的小鱼', ...student }
  s.binding.home = 'home'
  const students = student === undefined || student.studentId !== null ? [s] : []
  const secrets = new Map([[keyName(s.aiId), school.key]])
  app = new School(
    {
      think: async () => null,
      newLesson: () => {},
      canThink: () => true,
      secrets: { get: async (n) => secrets.get(n) ?? null, set: async () => {}, unset: async () => {} },
      store: { students, save: () => {} },
      log,
    },
    { ...DEFAULT_SCHOOL_CONFIG, base: school.base, enabled: false },
    { type: 'dsh', version: 'test' },
  )
  return { s, students, school, run: (raw: string) => app!.ownerCommand(raw, { home: 'home' }) }
}

const patches = (m: MockSchool) => m.http.filter((h) => h.url === '/v1/me/avatar')

describe('/school avatar', () => {
  it('shows the avatar and what can be chosen, then changes it and shows it in the status', async () => {
    const t = await setup()
    t.school.avatar = { aiType: 'deepseek', background: null, border: null, left: 3 }
    const seen = await t.run('avatar')
    expect(seen.ok).toBe(true)
    expect(seen.text).toContain('形象：DeepSeek，默认配色')
    expect(seen.text).toContain('今天还能改 3 次')
    expect(seen.text).toContain('Claude')
    const r = await t.run('avatar claude 底色 蓝 边框 白')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('形象：Claude，底色蓝、边框白')
    expect(r.text).toContain('今天还能改 2 次')
    expect(patches(t.school).at(-1)!.body).toEqual({ aiType: 'claude', background: 'blue', border: 'white' })
    expect(t.s).toMatchObject({ aiType: 'claude', avatar: { background: 'blue', border: 'white' }, avatarChangesLeft: 2 })
    expect((await t.run('')).text).toContain('形象：Claude，底色蓝、边框白')
  })

  it('goes back to the default colors with 默认', async () => {
    const t = await setup()
    t.school.avatar = { aiType: 'claude', background: 'blue', border: 'white', left: 3 }
    const r = await t.run('avatar 底色 默认')
    expect(r.ok).toBe(true)
    expect(patches(t.school).at(-1)!.body).toEqual({ background: null })
    expect(r.text).toContain('形象：Claude，底色默认、边框白')
  })

  it('says what is wrong with a word it does not know, and sends nothing', async () => {
    const t = await setup()
    t.school.avatar = { aiType: 'deepseek', background: null, border: null, left: 3 }
    const r = await t.run('avatar 底色 金')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('不认识的颜色「金」')
    expect(patches(t.school)).toHaveLength(0)
  })

  it('passes on the school\'s answer when today\'s changes are used up', async () => {
    const t = await setup()
    t.school.avatar = { aiType: 'deepseek', background: null, border: null, left: 0 }
    const r = await t.run('avatar kimi')
    expect(r.ok).toBe(false)
    expect(r.text).toContain('今天改形象的 3 次用完了')
    expect(r.text).toContain('2026-12-02 起可以再改')
    expect(t.s.avatarChangesLeft).toBe(0)
  })

  it('says the school does not support it yet on an older school', async () => {
    const t = await setup()
    expect((await t.run('avatar')).text).toBe('学校还不支持改形象。')
    expect((await t.run('avatar claude')).text).toBe('学校还不支持改形象。')
    expect((await t.run('')).text).not.toContain('形象')
  })

  it('keeps the choice made before enrolling and sends it with the registration, without using a change', async () => {
    const t = await setup({ studentId: null, status: null, className: null, displayName: null })
    const e = await t.run('enroll a@example.com 阿杰 小鱼 初中部 晚班 gemini')
    expect(e.ok).toBe(true)
    expect(e.text).toContain('形象：Gemini，默认配色')
    const s = t.students[0]!
    expect(s.aiType).toBe('gemini')
    const r = await t.run('avatar 底色 粉')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('报名时一起交给学校，不算次数')
    expect(patches(t.school)).toHaveLength(0)
    await t.run('agree 2026-11-11')
    const reg = t.school.http.find((h) => h.url === '/v1/registrations')!
    expect(reg.body).toMatchObject({ aiType: 'gemini', avatar: { background: 'pink', border: null } })
  })

  it('sends no type with a registration when none was chosen', async () => {
    const t = await setup({ studentId: null, status: null, className: null, displayName: null })
    const e = await t.run('enroll a@example.com 阿杰 小鱼 初中部 晚班 12')
    expect(e.text).toContain('形象：DeepSeek，默认配色（没选，学校默认）')
    expect(t.students[0]!.binding.referrer).toBe('12')
    await t.run('agree 2026-11-11')
    const reg = t.school.http.find((h) => h.url === '/v1/registrations')!
    expect(reg.body).not.toHaveProperty('aiType')
    expect(reg.body).not.toHaveProperty('avatar')
    expect((await t.run('enroll a@example.com 阿杰 小鱼 初中部 晚班 llama')).ok).toBe(false)
  })

  it('takes a change from the AI\'s tool, default colors and all', async () => {
    const t = await setup()
    t.school.avatar = { aiType: 'deepseek', background: 'red', border: null, left: 3 }
    const out = await app!.agentCommand('home', { verb: 'avatar', aiType: 'doubao', background: 'default' })
    expect(out).toContain('形象：豆包，默认配色')
    expect(patches(t.school).at(-1)!.body).toEqual({ aiType: 'doubao', background: null })
  })
})
