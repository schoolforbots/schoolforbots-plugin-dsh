// 验证码：没收到怎么重发、过期或错太多以后打什么、发码太快、等验证码时发现邮箱填错了。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, DEFAULT_CONFIG } from '../src/dsh/app.js'
import { createBrain } from '../src/dsh/brain.js'
import { createSecrets, createStore, forgetStores } from '../src/dsh/store.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const schoolError = (status: number, code: string, message: string) => ({ status, data: { error: { code, message } } })

let dir: string
let school: MockSchool
let dsh: FakeDsh
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-code-'))
  school = await startMockSchool()
  dsh = createFakeDsh()
})
afterEach(async () => {
  await dsh.dispose()
  await school.close()
  forgetStores()
  rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const store = createStore(dir)
  const brain = createBrain({ ctx: dsh.ctx, log, roomDir: join(dir, 'room'), preset: 'schoolforbots', classModel: () => '' })
  const app = createApp({ config: { ...DEFAULT_CONFIG, base: school.base, enabled: false }, store, secrets: createSecrets(() => undefined, dir), brain, log, version: 'test' })
  const run = async (input: string) => {
    const r = await app.command({ rawInput: input, agent: { id: 'home', session: { id: 'home' }, followup: () => {} } })
    return { ok: r.kind === 'success', text: String(r.text ?? '') }
  }
  return { store, run }
}

const ENROLL = 'enroll a@example.com 阿杰 小鱼 初中部 晚班'

describe('the verification code', () => {
  it('says where the code went, until when, and how to have it sent again', async () => {
    const t = setup()
    await t.run(ENROLL)
    const agreed = await t.run('agree 2026-11-11')
    expect(agreed.text).toContain('没收到：先看看垃圾邮件；过 1 分钟可以重新发：/school agree 2026-11-11')
    expect(agreed.text).toContain('每个邮箱 24 小时最多收 5 封')
    const status = await t.run('status')
    expect(status.text).toMatch(/报名中：验证码发到了 a\*+@example\.com（.+ 前有效），收到后打 \/school code 六位数字。/)
    expect(status.text).toContain('邮箱填错了：/school enroll 新邮箱')
  })

  it('says the code has expired in the status once it has', async () => {
    const t = setup()
    await t.run(ENROLL)
    await t.run('agree 2026-11-11')
    t.store.state.students[0]!.pendingRegistration!.expiresAt = new Date(Date.now() - 1_000).toISOString()
    expect((await t.run('status')).text).toContain('的验证码已经过期了，重新发：/school agree 2026-11-11')
  })

  it('tells which command sends a new code when the code expired or was guessed wrong too often', async () => {
    const t = setup()
    await t.run(ENROLL)
    await t.run('agree 2026-11-11')
    school.respond = (m, p) => (p.endsWith('/verify') ? schoolError(410, 'code_expired', '验证码已经过期，请重新获取。') : null)
    const expired = await t.run('code 123456')
    expect(expired.ok).toBe(false)
    expect(expired.text).toContain('验证码已经过期，请重新获取。重新发一个：/school agree 2026-11-11')
    school.respond = (m, p) => (p.endsWith('/verify') ? schoolError(429, 'code_attempts_exceeded', '验证码错得太多次了，请重新获取。') : null)
    expect((await t.run('code 123456')).text).toContain('重新发一个：/school agree 2026-11-11')
    school.respond = null
    expect((await t.run('code 000000')).text).toContain('一个验证码最多错 5 次')
  })

  it('says the last code still works when one was sent a moment ago, and passes on the daily cap as is', async () => {
    const t = setup()
    await t.run(ENROLL)
    await t.run('agree 2026-11-11')
    school.respond = (m, p) => (p === '/v1/registrations' ? schoolError(429, 'resend_too_soon', '验证码刚刚发过，请稍等一会儿再试。') : null)
    const soon = await t.run('agree 2026-11-11')
    expect(soon.ok).toBe(false)
    expect(soon.text).toContain('上一封的验证码 10 分钟内还能用')
    const cap = '24 小时内给这个邮箱发的验证码已经到上限了，请过几个小时、最晚一天以后再试。'
    school.respond = (m, p) => (p === '/v1/registrations' ? schoolError(429, 'resend_too_soon', cap) : null)
    expect((await t.run('agree 2026-11-11')).text).toBe(cap)
  })

  it('lets a wrong email be fixed after the code went out, without a second student', async () => {
    const t = setup()
    await t.run(ENROLL)
    await t.run('agree 2026-11-11')
    const fixed = await t.run('enroll b@example.com 阿杰 小鱼 初中部 晚班')
    expect(fixed.ok).toBe(true)
    expect(fixed.text).toContain('之前发到 a')
    expect(fixed.text).toContain('的验证码作废了')
    expect(t.store.state.students).toHaveLength(1)
    expect(t.store.state.students[0]!.email).toBe('b@example.com')
    expect(t.store.state.students[0]!.pendingRegistration).toBeNull()
    // 作废以后填旧码：说清要先重新同意校规
    expect((await t.run('code 123456')).text).toContain('还没发验证码：读过校规后打 /school agree 版本号')
  })

  it('tells how to resend a key-reset code and which command to type when it expires', async () => {
    const t = setup()
    await t.run(ENROLL)
    await t.run('agree 2026-11-11')
    await t.run('code 123456')
    const reset = await t.run('key-reset')
    expect(reset.text).toContain('没收到：先看看垃圾邮件；过 1 分钟可以重新发：/school key-reset')
    expect(reset.text).not.toContain('邮箱填错了')
    expect((await t.run('status')).text).toContain('换钥匙中：验证码发到了')
    school.respond = (m, p) => (p.endsWith('/verify') ? schoolError(410, 'code_expired', '验证码已经过期，请重新获取。') : null)
    expect((await t.run('code 123456')).text).toContain('重新发一个：/school key-reset')
  })
})
