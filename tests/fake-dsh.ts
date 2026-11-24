// 测试用的假 DSH 宿主，事件的形状照真 DSH（agent-loop/src/agent.ts、session/src/types.ts，提交 39163dd3）：
// - 一轮的顺序：turn/start {turn} → user/message（data 就是消息本身，没有 turn）→ assistant/message {turn, message} → turn/end {turn, reason}
// - agent/pre-step 的 payload 是 { agent, messages（这一步认领到的输入）, turn, step, signal }，
//   默认的 next() 会在最后追加一条 runtime-context 快照（appendRuntimeContext 打开时）
// - followup 是异步的：慢模式下回答要等 delayMs；cancel 以后，被取消的那一轮晚一点才写 turn/end（reason aborted），
//   它原来要说的话也可能晚到（lateReply）。
import type { Agent, CommandDef, ToolRegistrationOptions, DshContext, PreStepDecision, PreStepPayload, ToolDef, UserMessage } from '../src/dsh/host.js'

export interface FakeSession {
  preset?: string
  workspaceId?: string
  title?: string
  messages: UserMessage[]
  restricted: unknown[]
  /** 每一步 pre-step 之后真正进入模型的消息。 */
  entered: UserMessage[][]
  /** agent.model.select 选过的模型（provider/model），按顺序。 */
  models: string[]
}

export interface FakeDsh {
  ctx: DshContext
  variables: Map<string, () => string>
  tools: Map<string, ToolDef>
  /** 注册工具时带的条件（when）。 */
  toolOptions: Map<string, ToolRegistrationOptions>
  commands: Map<string, CommandDef>
  sessions: Map<string, FakeSession>
  reply: (text: string, sid: string) => string
  /** 回答前等多久（毫秒）。 */
  delayMs: number
  /** 被取消的一轮：还会不会晚到地说完（模拟 DSH 取消是异步的）。 */
  lateReply: boolean
  /** 默认的 next() 追加 runtime-context。 */
  appendRuntimeContext: boolean
  /** 不支持 tools.restrict。 */
  noRestrict: boolean
  /** 用这个模型（provider/model）的一轮以 error 结束。 */
  failModel: string | null
  /** 归档过的会话，按顺序。 */
  archived: string[]
  /** 归档时报错。 */
  archiveFails: boolean
  /** 别的插件注册的全局工具名（ctx.tools.definitions() 里有，restrict 认得）。 */
  globalTools: string[]
  /** 在会话 sid 里调一次工具：跑一遍 tools/pre-execute，最里面的默认决定是 base。 */
  preExecute: (sid: string, name: string, base?: { kind: string }) => Promise<{ kind: string; reason?: string }>
  /** 机器人的主人在会话 sid 里说话：跑一遍 pre-step，返回进入这一步的消息。 */
  ownerSays: (sid: string, text: string, source?: UserMessage['source']) => Promise<UserMessage[]>
  emit: (name: string, ...args: unknown[]) => void
  dispose: () => Promise<void>
}

/** 照真 DSH：restrict 是类方法，要用 this（单独取出来调用会抛错）；名单里有不认识的工具名会报错。 */
class FakeTools {
  constructor(
    private readonly log: unknown[],
    private readonly known: () => string[],
  ) {}
  restrict(f: { allow?: string[]; deny?: string[] }): () => void {
    const unknown = (f.allow ?? []).filter((n) => !this.known().includes(n))
    if (unknown.length) throw new Error(`unknown tool: ${unknown.join(', ')}`)
    this.log.push(f)
    return () => {}
  }
}

export function createFakeDsh(): FakeDsh {
  const listeners = new Map<string, { fn: (...a: any[]) => unknown; prepend: boolean }[]>()
  const disposers: (() => unknown)[] = []
  const variables = new Map<string, () => string>()
  const tools = new Map<string, ToolDef>()
  const toolOptions = new Map<string, ToolRegistrationOptions>()
  const commands = new Map<string, CommandDef>()
  const sessions: FakeDsh['sessions'] = new Map()
  const workspaces: { id: string; path: string; title?: string }[] = []
  let n = 0
  let turn = 0
  const running = new Map<string, { turn: number; cancel: () => void }>()

  const emit = (name: string, ...args: unknown[]) => {
    for (const l of listeners.get(name) ?? []) l.fn(...args)
  }

  /** 照 DSH：prepend 的排最前，其余按注册顺序；waterfall，每个监听拿到 next。 */
  async function preStep(agent: Agent, claimed: UserMessage[]): Promise<PreStepDecision> {
    const list = [...(listeners.get('agent/pre-step') ?? [])]
    const chain = [...list.filter((l) => l.prepend).reverse(), ...list.filter((l) => !l.prepend)]
    const payload: PreStepPayload = { agent, messages: claimed, turn: ++turn, step: 1 }
    const base = (): Promise<PreStepDecision> =>
      Promise.resolve({
        kind: 'enter',
        messages: fake.appendRuntimeContext ? [...claimed, { id: `rc${++n}`, role: 'user', content: [{ type: 'text', text: '<runtime-context/>' }], source: { kind: 'runtime-context' } }] : claimed,
      })
    const run = (i: number): Promise<PreStepDecision> => (i >= chain.length ? base() : (chain[i]!.fn(payload, () => run(i + 1)) as Promise<PreStepDecision>))
    return run(0)
  }

  const agents = new Map<string, Agent>()
  function agentFor(sid: string): Agent {
    let a = agents.get(sid)
    if (a) return a
    const s = sessions.get(sid)!
    a = {
      id: sid,
      session: { id: sid, header: { cwd: workspaces.find((w) => w.id === s.workspaceId)?.path } },
      ctx: {
        tools: fake.noRestrict
          ? {}
          : new FakeTools(s.restricted, () => [...tools.keys(), ...fake.globalTools]),
      },
      model: {
        select: (sel) => {
          const label = `${sel.provider}/${sel.model}`
          if (s.models.at(-1) !== label) s.models.push(label)
        },
      },
      followup(msg) {
        s.messages.push(msg)
        const session = { id: sid }
        void (async () => {
          const decision = await preStep(agentFor(sid), [msg])
          if (decision.kind !== 'enter') return
          s.entered.push(decision.messages)
          const t = turn
          emit('session/event', session, { type: 'turn/start', data: { turn: t } })
          emit('session/event', session, { type: 'user/message', data: msg })
          let cancelled = false
          running.set(sid, { turn: t, cancel: () => (cancelled = true) })
          await new Promise((r) => setTimeout(r, fake.delayMs || 5))
          if (cancelled) {
            // 取消是异步的：过一会儿才写 turn/end；lateReply 时它原来要说的话也会晚到
            setTimeout(() => {
              if (fake.lateReply) emit('session/event', session, { type: 'assistant/message', data: { turn: t, message: { content: [{ type: 'text', text: fake.reply(msg.content[0]!.text, sid) }] } } })
              emit('session/event', session, { type: 'turn/end', data: { turn: t, reason: { kind: 'aborted' } } })
            }, 10)
            return
          }
          if (fake.failModel && s.models.at(-1) === fake.failModel) {
            emit('session/event', session, { type: 'turn/end', data: { turn: t, reason: { kind: 'error', error: { code: 'AUTH_FAILED', message: 'no key' } } } })
            return
          }
          const text = fake.reply(msg.content[0]!.text, sid)
          emit('session/event', session, { type: 'assistant/message', data: { turn: t, message: { content: [{ type: 'text', text }] } } })
          emit('session/event', session, { type: 'turn/end', data: { turn: t, reason: { kind: 'completed' } } })
        })()
      },
    }
    agents.set(sid, a)
    return a
  }

  const ctx: DshContext = {
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
    },
    on(name, fn, options) {
      const list = listeners.get(name) ?? []
      list.push({ fn, prepend: Boolean(options?.prepend) })
      listeners.set(name, list)
      return () => {}
    },
    logger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
    agents: { get: (id) => agents.get(id) },
    systemPrompt: { variable: (name, fn) => (variables.set(name, fn), () => variables.delete(name)) },
    tools: {
      register: (def, options) => (tools.set(def.name, def), toolOptions.set(def.name, options ?? {}), () => (tools.delete(def.name), toolOptions.delete(def.name))),
      definitions: () => [...tools.keys(), ...fake.globalTools].map((name) => ({ name })),
    } as DshContext['tools'],
    commands: { register: (def) => (commands.set(def.name, def), () => commands.delete(def.name)) },
    workspaceRegistry: {
      archiveSession: async (sid) => {
        if (fake.archiveFails) throw new Error('archive failed')
        if (!fake.archived.includes(sid)) fake.archived.push(sid)
      },
      list: () => workspaces as never,
      create: async (path, title) => {
        const w = { id: `ws${workspaces.length + 1}`, path, title }
        workspaces.push(w)
        return w as never
      },
    },
    sessionController: {
      create: async (req) => {
        const sid = `s${++n}`
        sessions.set(sid, { preset: req.agentPreset, workspaceId: req.workspaceId, messages: [], restricted: [], entered: [], models: [] })
        return { sessionId: sid }
      },
      resolveAgent: async (sid) => ({ agent: agentFor(sid) }),
      rename: async ({ sessionId, title }) => {
        sessions.get(sessionId)!.title = title
      },
      cancel: ({ sessionId }) => running.get(sessionId)?.cancel(),
    },
  }

  const fake: FakeDsh = {
    ctx,
    variables,
    tools,
    toolOptions,
    commands,
    sessions,
    reply: () => '好的',
    delayMs: 0,
    lateReply: false,
    appendRuntimeContext: true,
    noRestrict: false,
    failModel: null,
    globalTools: [],
    archived: [],
    archiveFails: false,
    async preExecute(sid, name, base = { kind: 'allow' }) {
      const list = [...(listeners.get('tools/pre-execute') ?? [])]
      const chain = [...list.filter((l) => l.prepend).reverse(), ...list.filter((l) => !l.prepend)]
      const exec = { name, agent: agentFor(sid), arguments: {} }
      const run = (i: number): Promise<{ kind: string; reason?: string }> => (i >= chain.length ? Promise.resolve(base) : (chain[i]!.fn(exec, () => run(i + 1)) as Promise<{ kind: string; reason?: string }>))
      return run(0)
    },
    emit,
    async ownerSays(sid, text, source = { kind: 'user', rpcId: 'r1' }) {
      const owner: UserMessage = { id: `u${++n}`, role: 'user', content: [{ type: 'text', text }], source }
      const d = await preStep({ id: sid, session: { id: sid }, followup: () => {} }, [owner])
      return d.kind === 'enter' ? d.messages.filter((m) => m.source.kind !== 'runtime-context') : []
    },
    async dispose() {
      for (const d of disposers.reverse()) await d()
    },
  }
  return fake
}
