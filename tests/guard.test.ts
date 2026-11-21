// 报名、同意校规这些工具只在机器人的主人亲手发起的轮次里能用；会产生后果的几步还要机器人的主人在 DSH 界面上批准。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, DEFAULT_CONFIG, OWNER_ONLY, type ToolGuard } from '../src/dsh/app.js'
import { createBrain } from '../src/dsh/brain.js'
import { apply } from '../src/dsh/index.js'
import { createOwnerTurns, fromPerson } from '../src/dsh/owner-turn.js'
import { createSecrets, createStore, forgetStores } from '../src/dsh/store.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const owner = { kind: 'user', rpcId: 'r1' }
const bridged = { kind: 'user', plugin: 'qq-bridge' }
const snapshot = { kind: 'plugin:schoolforbots', form: 'snapshot' }
const runtime = { kind: 'runtime-context', form: 'snapshot' }

describe('owner turns', () => {
  it('tells the owner\'s own messages from forwarded ones and ignores plugin snapshots', () => {
    expect(fromPerson(owner)).toBe(true)
    expect(fromPerson(bridged)).toBe(true)
    expect(fromPerson(snapshot)).toBe(false)
    expect(fromPerson(runtime)).toBe(false)
    const t = createOwnerTurns()
    expect(t.ownerTurn('s')).toBe(false)
    t.observe('s', [{ source: owner }, { source: runtime }])
    expect(t.ownerTurn('s')).toBe(true)
    // 同一轮后面的步骤没有新输入：沿用
    t.observe('s', [{ source: snapshot }])
    expect(t.ownerTurn('s')).toBe(true)
    // 群里有人说话（转发进来的）：不是机器人的主人的轮次
    t.observe('s', [{ source: bridged }])
    expect(t.ownerTurn('s')).toBe(false)
    // 机器人的主人的话和转发的话一起进来：也不算
    t.observe('s', [{ source: owner }, { source: bridged }])
    expect(t.ownerTurn('s')).toBe(false)
  })
})

describe('owner turns from session events', () => {
  const spliced = (...sources: object[]) => ({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: sources.map((source) => ({ role: 'user', content: [], source })) } })
  const consumed = { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } }
  const turnStart = { type: 'turn/start', data: { turn: 1 } }

  it('decides a turn when it starts, from what was queued for it, before any step runs', () => {
    const t = createOwnerTurns()
    t.onSessionEvent('s', spliced(owner))
    expect(t.ownerTurn('s')).toBe(false) // 还没开始
    t.onSessionEvent('s', turnStart)
    t.onSessionEvent('s', consumed)
    expect(t.ownerTurn('s')).toBe(true)
  })

  it('does not let a message queued during a turn change that turn, and counts a mixed queue as not the owner\'s', () => {
    const t = createOwnerTurns()
    t.onSessionEvent('s', spliced(bridged))
    t.onSessionEvent('s', turnStart)
    expect(t.ownerTurn('s')).toBe(false)
    // 群聊那一轮还在进行，主人插了一句：这一轮还是群聊的
    t.onSessionEvent('s', spliced(owner))
    expect(t.ownerTurn('s')).toBe(false)
    t.onSessionEvent('s', turnStart)
    expect(t.ownerTurn('s')).toBe(true)
    // 下一轮排进来主人的话和群里的话
    t.onSessionEvent('s', spliced(owner))
    t.onSessionEvent('s', spliced(bridged))
    t.onSessionEvent('s', turnStart)
    expect(t.ownerTurn('s')).toBe(false)
    // 插件附的快照不算人
    t.onSessionEvent('s', spliced(owner, snapshot))
    t.onSessionEvent('s', turnStart)
    expect(t.ownerTurn('s')).toBe(true)
  })
})

describe('guarded tools', () => {
  let dir: string
  let school: MockSchool
  let dsh: FakeDsh
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfb-guard-'))
    school = await startMockSchool()
    dsh = createFakeDsh()
  })
  afterEach(async () => {
    await dsh.dispose()
    await school.close()
    forgetStores()
    rmSync(dir, { recursive: true, force: true })
  })

  function setup(g: { owner: boolean; approve: boolean }) {
    const store = createStore(dir)
    const asked: string[] = []
    const guard: ToolGuard = {
      ownerTurn: () => g.owner,
      approve: async (r) => (asked.push(r.toolName), g.approve),
    }
    const brain = createBrain({ ctx: dsh.ctx, log, roomDir: join(dir, 'room'), preset: 'schoolforbots', classModel: () => '' })
    const app = createApp({ config: { ...DEFAULT_CONFIG, base: school.base, enabled: false }, store, secrets: createSecrets(() => undefined, dir), brain, guard, log, version: 'test' })
    const exec = { agent: { id: 'chat', session: { id: 'chat' }, followup: () => {} }, callId: 'c1' }
    const tool = (n: string) => app.tools.find((t) => t.name === n)!
    return { app, store, asked, exec, tool }
  }

  const enrollArgs = { email: 'a@example.com', owner_name: '阿杰', ai_name: '小鱼', division: '初中部', slot: '晚班' }

  it('refuses enrollment tools in a turn the owner did not start, but still answers status and memory', async () => {
    const t = setup({ owner: false, approve: true })
    expect(String(await t.tool('school_enroll').execute(enrollArgs, t.exec))).toContain('你的主人亲手发消息')
    expect(t.store.state.students).toHaveLength(0)
    expect(String(await t.tool('school_status').execute({}, t.exec))).toContain('还没有学生')
    expect(String(await t.app.memoryTool.execute({}, t.exec))).toContain('还没有学生')
  })

  it('asks the owner to approve agreeing to the rules and does nothing without it', async () => {
    const t = setup({ owner: true, approve: false })
    expect(String(await t.tool('school_enroll').execute(enrollArgs, t.exec))).toContain('校规正文')
    expect(t.asked).toEqual([]) // 开始报名不产生后果，不用批准
    expect(String(await t.tool('school_agree_rules').execute({ version: '2026-11-11' }, t.exec))).toContain('没有在 DSH 里批准')
    expect(t.asked).toEqual(['school_agree_rules'])
    expect(t.store.state.students[0]!.pendingRegistration).toBeNull()
    expect(school.http.some((h) => h.url === '/v1/registrations')).toBe(false)
  })

  it('goes ahead once the owner approves', async () => {
    const t = setup({ owner: true, approve: true })
    await t.tool('school_enroll').execute(enrollArgs, t.exec)
    expect(String(await t.tool('school_agree_rules').execute({ version: '2026-11-11' }, t.exec))).toContain('验证码')
    expect(String(await t.tool('school_verify_code').execute({ code: '123456' }, t.exec))).toContain('报名成功')
    expect(t.asked).toEqual(['school_agree_rules', 'school_verify_code'])
  })

  it('registers the owner-only tools with a condition that hides them outside owner turns', async () => {
    process.env.DSH_HOME = dir
    apply(dsh.ctx, { enabled: false })
    for (const name of OWNER_ONLY) expect(typeof dsh.toolOptions.get(name)?.when).toBe('function')
    expect(dsh.toolOptions.get('school_status')?.when).toBeUndefined()
    const when = dsh.toolOptions.get('school_enroll')!.when!
    const agent = { id: 's1', session: { id: 's1' }, followup: () => {} }
    expect(await when({ agent })).toBe(false)
    await dsh.ownerSays('s1', '帮我报名')
    expect(await when({ agent })).toBe(true)
    await dsh.ownerSays('s1', '群里有人说', { kind: 'user', plugin: 'qq-bridge' })
    expect(await when({ agent })).toBe(false)
    delete process.env.DSH_HOME
  })
})
