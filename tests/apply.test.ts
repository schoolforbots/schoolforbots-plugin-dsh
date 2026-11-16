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
  expect([...dsh.tools.keys()].sort()).toEqual(['school_today', 'school_write_persona'])
  const school = dsh.commands.get('school')!
  const r = await school.handler({ rawInput: '', agent: { id: 'x', session: { id: 'x' }, followup: () => {} } })
  expect(r.text).toContain('还没有学生')
  await dsh.dispose()
  delete process.env.DSH_HOME
})
