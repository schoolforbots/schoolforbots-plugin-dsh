// 上课、社团用的模型：先查能不能用，用不了就用 DSH 的默认模型；出错了换默认模型再问一次，并告诉机器人的主人。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAsker } from '../src/dsh/asker.js'
import { createBrain } from '../src/dsh/brain.js'
import type { DshContext } from '../src/dsh/host.js'
import { createModels } from '../src/dsh/models.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const DEFAULT = { provider: 'deepseek-official', model: 'deepseek-flash' }

/** DSH 的模型列表：provider -> 模型（空数组表示这个 provider 没列模型）。 */
function catalog(ctx: Record<string, unknown>, list: Record<string, string[]>) {
  const calls = { providers: 0, models: 0 }
  ctx.llm = {
    ...(ctx.llm as object),
    listProviders: () => (calls.providers++, Object.keys(list).map((id) => ({ id, name: id }))),
    listModels: async (p: string) => (calls.models++, (list[p] ?? []).map((id) => ({ provider: p, id, name: id }))),
  }
  ctx.agentDefaultModel = { currentSelection: () => DEFAULT }
  return calls
}

describe('checking a model before using it', () => {
  function picker(list: Record<string, string[]> | null) {
    const ctx: Record<string, unknown> = {}
    if (list) catalog(ctx, list)
    else ctx.agentDefaultModel = { currentSelection: () => DEFAULT }
    const notices: string[] = []
    const m = createModels({ ctx: ctx as unknown as DshContext, log, onNotice: (_s, t) => notices.push(t) })
    return { m, notices }
  }

  it('uses the model when DSH lists it, or when DSH cannot tell', async () => {
    const { m } = picker({ deepseek: ['deepseek-pro'], other: [] })
    expect(await m.choose('a', [['deepseek/deepseek-pro', '上课用的模型']])).toEqual({ sel: { provider: 'deepseek', model: 'deepseek-pro' }, custom: true, what: '上课用的模型' })
    // provider 没列模型：不拦
    expect((await m.choose('a', [['other/x', '上课用的模型']])).custom).toBe(true)
    // 根本查不了模型列表：不拦
    expect((await picker(null).m.choose('a', [['other/x', '上课用的模型']])).custom).toBe(true)
  })

  it('falls back to the default model when the provider or the model is not there, and tells the owner once', async () => {
    const { m, notices } = picker({ deepseek: ['deepseek-pro'] })
    expect(await m.choose('a', [['nope/x', '上课用的模型']])).toEqual({ sel: DEFAULT, custom: false, what: '' })
    expect(await m.choose('a', [['nope/x', '上课用的模型']])).toEqual({ sel: DEFAULT, custom: false, what: '' })
    expect(notices).toEqual(['上课用的模型「nope/x」用不了（DSH 里没有 nope 这个模型服务），先用 DSH 的默认模型。'])
    await m.choose('a', [['deepseek/typo', '社团用的模型']])
    expect(notices.at(-1)).toBe('社团用的模型「deepseek/typo」用不了（deepseek 的模型列表里没有 typo），先用 DSH 的默认模型。')
    // 另一个学生的主人也要告诉
    await m.choose('b', [['nope/x', '上课用的模型']])
    expect(notices).toHaveLength(3)
  })

  it('takes the first setting that is filled in, and uses the default model when none is', async () => {
    const { m } = picker({ deepseek: ['deepseek-pro'] })
    expect((await m.choose('a', [['', '社团用的模型'], ['deepseek/deepseek-pro', '上课用的模型']])).what).toBe('上课用的模型')
    expect(await m.choose('a', [['', '社团用的模型'], ['', '上课用的模型']])).toEqual({ sel: DEFAULT, custom: false, what: '' })
  })

  it('keeps away from a model for a while after it fails', async () => {
    const { m, notices } = picker({ deepseek: ['deepseek-pro'] })
    m.failed('a', { provider: 'deepseek', model: 'deepseek-pro' }, '上课用的模型', 'AUTH_FAILED')
    expect(notices[0]).toContain('上课用的模型「deepseek/deepseek-pro」调用出错：AUTH_FAILED')
    expect((await m.choose('a', [['deepseek/deepseek-pro', '上课用的模型']])).custom).toBe(false)
    expect(notices).toHaveLength(1)
  })
})

describe('the club asks again with the default model', () => {
  function llm(fail: string | null) {
    const calls: string[] = []
    const ctx: Record<string, unknown> = {
      effect: () => {},
      on: () => () => {},
      llm: {
        stream: (opts: { provider: string; model: string }) => {
          const label = `${opts.provider}/${opts.model}`
          calls.push(label)
          return (async function* () {
            if (label === fail) {
              yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH_FAILED' } } }
              return
            }
            yield { type: 'text-delta', index: 0, text: '1' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      },
    }
    catalog(ctx, { deepseek: ['deepseek-pro'], 'deepseek-official': ['deepseek-flash'] })
    const notices: string[] = []
    const picker = createModels({ ctx: ctx as unknown as DshContext, log, onNotice: (_s, t) => notices.push(t) })
    return { ctx: ctx as unknown as DshContext, calls, notices, picker }
  }
  const req = () => ({ system: '', prompt: '', deadline: Date.now() + 5_000 })

  it('uses the default model when the club model is not in DSH', async () => {
    const f = llm(null)
    const asker = createAsker({ ctx: f.ctx, log, picker: f.picker, models: () => [['deepseek/typo', '社团用的模型'], ['', '上课用的模型']] })
    expect(await asker.ask(req(), 'a')).toBe('1')
    expect(f.calls).toEqual(['deepseek-official/deepseek-flash'])
    expect(f.notices).toHaveLength(1)
  })

  it('asks again with the default model when the club model fails, and keeps to the default model after that', async () => {
    const f = llm('deepseek/deepseek-pro')
    const asker = createAsker({ ctx: f.ctx, log, picker: f.picker, models: () => [['deepseek/deepseek-pro', '社团用的模型'], ['', '上课用的模型']] })
    expect(await asker.ask(req(), 'a')).toBe('1')
    expect(f.calls).toEqual(['deepseek/deepseek-pro', 'deepseek-official/deepseek-flash'])
    expect(f.notices[0]).toContain('社团用的模型「deepseek/deepseek-pro」调用出错：AUTH_FAILED')
    expect(await asker.ask(req(), 'a')).toBe('1')
    expect(f.calls.at(-1)).toBe('deepseek-official/deepseek-flash')
    expect(f.calls).toHaveLength(3)
  })

  it('does not ask again when the default model itself fails', async () => {
    const f = llm('deepseek-official/deepseek-flash')
    const asker = createAsker({ ctx: f.ctx, log, picker: f.picker, models: () => [['', '社团用的模型'], ['', '上课用的模型']] })
    expect(await asker.ask(req(), 'a')).toBeNull()
    expect(f.calls).toHaveLength(1)
  })
})

describe('class asks again with the default model', () => {
  let dir: string
  let dsh: FakeDsh
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sfb-models-'))
    dsh = createFakeDsh()
  })
  afterEach(async () => {
    await dsh.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  function setup(classModel: string) {
    catalog(dsh.ctx as unknown as Record<string, unknown>, { deepseek: ['deepseek-pro'], 'deepseek-official': ['deepseek-flash'] })
    const notices: string[] = []
    const troubles: string[] = []
    const picker = createModels({ ctx: dsh.ctx, log, onNotice: (_s, t) => notices.push(t) })
    const brain = createBrain({ ctx: dsh.ctx, log, roomDir: join(dir, 'room'), preset: 'schoolforbots', classModel: () => classModel, picker, onTrouble: (_s, t) => troubles.push(t) })
    dsh.ctx.on('session/event', (s: never, e: never) => brain.onSessionEvent(s, e))
    brain.attach(dsh.ctx)
    const sessions = () => [...dsh.sessions.values()]
    return { brain, notices, troubles, sessions }
  }

  it('uses the default model when the class model is not in DSH', async () => {
    const t = setup('deepseek/typo')
    expect(await t.brain.think('ai1', 't', { purpose: 'answer', text: '点名', deadline: Date.now() + 5_000 })).toBe('好的')
    expect(t.sessions()[0]!.models).toEqual(['deepseek-official/deepseek-flash'])
    expect(t.notices).toEqual(['上课用的模型「deepseek/typo」用不了（deepseek 的模型列表里没有 typo），先用 DSH 的默认模型。'])
  })

  it('asks again with the default model in a new session when the class model fails, and keeps to the default model after that', async () => {
    const t = setup('deepseek/deepseek-pro')
    dsh.failModel = 'deepseek/deepseek-pro'
    const got = await t.brain.think('ai1', 't', { purpose: 'answer', text: '点名', deadline: Date.now() + 5_000, recap: ['老师：同学们好'] })
    expect(got).toBe('好的')
    const [first, second] = t.sessions()
    expect(first!.models).toEqual(['deepseek/deepseek-pro'])
    expect(second!.models).toEqual(['deepseek-official/deepseek-flash'])
    // 新会话补上了这节课前面的事
    expect(second!.messages[0]!.content[0]!.text).toContain('老师：同学们好')
    expect(t.notices[0]).toContain('上课用的模型「deepseek/deepseek-pro」调用出错：AUTH_FAILED')
    expect(t.troubles).toEqual([])
    // 下一步直接用默认模型，不再开新会话
    expect(await t.brain.think('ai1', 't', { purpose: 'answer', text: '再点名', deadline: Date.now() + 5_000 })).toBe('好的')
    expect(t.sessions()).toHaveLength(2)
  })
})
