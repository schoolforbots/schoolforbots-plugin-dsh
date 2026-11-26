import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { apply, inject, name } from '../src/dsh/index.js'
import { createFakeDsh } from './fake-dsh.js'

const dir = mkdtempSync(join(tmpdir(), 'sfb-apply-'))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('registers the class prompt variable, the tools and /school, and unloads cleanly', async () => {
  process.env.DSH_HOME = dir
  const dsh = createFakeDsh()
  expect(name).toBe('schoolforbots')
  expect(inject).toContain('sessionController')
  apply(dsh.ctx, { enabled: false })
  expect(dsh.variables.get('schoolforbots_class_prompt')?.()).toContain('机器人网校')
  // 上课时也能查课程表
  expect(dsh.variables.get('schoolforbots_class_prompt')?.()).toContain('school_timetable')
  // 校园记忆工具默认开
  expect([...dsh.tools.keys()].sort()).toEqual(['school_agree_rules', 'school_club', 'school_enroll', 'school_intro', 'school_memory', 'school_move', 'school_status', 'school_timetable', 'school_verify_code', 'school_write_persona'])
  const school = dsh.commands.get('school')!
  const r = await school.handler({ rawInput: '', agent: { id: 'x', session: { id: 'x' }, followup: () => {} } })
  expect(r.text).toContain('还没有学生')
  await dsh.dispose()
  delete process.env.DSH_HOME
})

it('reads volatile settings live, falling back to the defaults', async () => {
  const { liveConfig, Config } = await import('../src/dsh/index.js')
  let chance = 0.3
  const cfg = liveConfig({ questionChance: { get: () => chance }, maxRounds: 8, clubModel: undefined })
  expect(cfg.questionChance).toBe(0.3)
  chance = 0.7
  expect(cfg.questionChance).toBe(0.7)
  expect(cfg.maxRounds).toBe(8)
  expect(cfg.clubModel).toBe('')
  expect(cfg.base).toBe('https://api.schoolforbots.org')
  // 配置页能改的字段都是 volatile；学校地址这类改了要重新加载的不是
  if (Config) {
    const refs = (Config.toJSON() as { refs: Record<string, { meta?: { volatile?: boolean } }> }).refs
    const root = Object.values(refs).find((r) => (r as { dict?: unknown }).dict) as unknown as { dict: Record<string, number> }
    const volatile = (k: string) => !!refs[root.dict[k]!]?.meta?.volatile
    expect(volatile('questionChance') && volatile('clubJoin') && volatile('enabled')).toBe(true)
    expect(volatile('base') || volatile('preset')).toBe(false)
  }
})

it('registers school_memory only while school memory is switched on', async () => {
  process.env.DSH_HOME = dir
  const dsh = createFakeDsh()
  let open = false
  apply(dsh.ctx, { enabled: false, memoryAccess: { get: () => open } } as never)
  expect(dsh.tools.has('school_memory')).toBe(false)
  open = true
  dsh.emit('loader/volatile-update')
  expect(dsh.tools.has('school_memory')).toBe(true)
  open = false
  dsh.emit('loader/volatile-update')
  expect(dsh.tools.has('school_memory')).toBe(false)
  await dsh.dispose()
  delete process.env.DSH_HOME
})
