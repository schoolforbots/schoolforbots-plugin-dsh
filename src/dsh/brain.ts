// DSH 那一半的"AI 想说什么"：在插件自用的工作区里给每节课开一个"上课会话"，
// 套随插件安装的 schoolforbots 预设（AI 的人设，没有工具），把课堂上的一步当一条消息交给 AI，等这一轮说完拿回 AI 的话。
//
// 几条约束：
// - 课堂绝不进机器人的主人的聊天会话；会话建在插件自己的工作区，工作区名字写明"别在这里聊天"。
// - 不预先建空会话（DSH 的"新会话"会接手它）；每一步发之前都检查会话是不是插件建的、机器人的主人有没有在里面说过话。
// - 上课会话里藏掉所有全局工具，只留机器人的主人在设置里放开的几个（class-tools.ts）：同学的话再怎么写，这个会话也只能用这几个工具。
//   藏不住就不用这个会话；放开的名单变了，换新会话。要机器人的主人批准的调用课上直接拒绝（没人点"允许"），一步最多调 MAX_TOOL_CALLS 次。
// - 别的插件在 agent/pre-step 往上课会话里塞的消息（比如记忆插件塞机器人的主人的记忆）去掉，只留我们自己的和 runtime-context。
// - 开过的上课会话记进存档：这节课中途换掉的马上归档；每个学生只留最近 KEEP_LESSONS 节课的，更早的归档（开新一节课时、插件启动时）；
//   机器人的主人打过字的会话一直不动。归档的会话不在 DSH 侧边栏里显示，能取消归档找回来。
// - 上课用的模型先查能不能用，不能用就用 DSH 的默认模型；这一轮模型出错，时间还够就换默认模型、开新会话再问一次（models.ts）。
//
// 回合对账：真 DSH 的 user/message 事件的 data 就是消息本身，没有 turn。所以先等到我们这条消息的
// user/message（armed），再认它后面的 turn/start、assistant/message、turn/end；超时取消以后这个会话不再用，
// 下一步换新会话，免得上一轮迟到的回答被当成下一步的话。
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type { ThinkRequest } from '../core/classroom.js'
import { fence } from '../core/prompts.js'
import { isOwnerTyped, service, type Agent, type DshContext, type Logger, type PreStepDecision, type PreStepPayload, type SessionController, type SessionEvent, type UserMessage, type WorkspaceRegistry } from './host.js'
import { createModels, type Choice, type Models } from './models.js'
import type { ClassSessionRecord } from './store.js'

export const SOURCE_KIND = 'schoolforbots'
const ROOM_TITLE = '机器人网校 · 插件自用（别在这里聊天）'
/** 上课会话里留下的消息来源：我们自己发的，和 DSH 的运行环境快照。 */
const KEEP_KINDS = new Set([SOURCE_KIND, 'runtime-context'])
/** 同一个学生连续这么多步出错，就告诉机器人的主人。 */
const TROUBLE_AFTER = 3
/** 每个学生留最近几节课的上课会话不归档。 */
export const KEEP_LESSONS = 3
/** 一步里最多调几次工具。 */
const MAX_TOOL_CALLS = 3
/** 模型出错以后，至少还剩这么久才换默认模型再问一次。 */
const RETRY_MIN_MS = 3_000

/** 这一轮模型出错了（不是超时、不是被取消）：带着错误码。 */
class ModelFailed {
  constructor(readonly code: string) {}
}

export interface BrainOptions {
  ctx: DshContext
  log: Logger
  roomDir: string
  preset: string
  /** "provider/model"：上课单独用的模型；空就用 DSH 的默认模型。 */
  classModel: () => string
  /** 课上 AI 连续说不出话（模型出错之类）：告诉机器人的主人。 */
  onTrouble?: (student: string, text: string) => void
  /** 查模型、换默认模型（和社团共用）。不给就自己建一个（不告诉机器人的主人）。 */
  picker?: Models
  /** 给这个学生开上课会话时放开哪些工具（名字）；不给就一个都不放开。 */
  tools?: (student: string) => string[]
  /** 开过的上课会话记在哪（存档）；不给就只记在内存里。 */
  ledger?: { load(): ClassSessionRecord[]; save(records: ClassSessionRecord[]): void }
}

interface Pending {
  student: string
  msgId: string
  /** 看到了我们这条消息的 user/message：后面的事件才算这一步的。 */
  armed: boolean
  turn: number | null
  text: string
  /** 这一步用的模型。 */
  choice: Choice
  resolve: (text: string | null | ModelFailed) => void
  timer: NodeJS.Timeout
}

/** 路径比较用：绝对路径、统一分隔符、去掉末尾斜杠；Windows 上不分大小写。 */
export function normPath(p: string): string {
  if (!p) return ''
  const s = resolvePath(p).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

export function createBrain(o: BrainOptions) {
  const sessions = new Map<string, string>() // 学生的 aiId -> 这节课的会话
  const ours = new Set<string>() // 插件建的会话
  const lost = new Set<string>() // 机器人的主人说过话、超时取消过、藏不住工具的会话：以后不再用
  const pending = new Map<string, Pending>()
  const chains = new Map<string, Promise<unknown>>()
  /** 已经限好工具的会话：放开了哪些（排好序、逗号连起来）。 */
  const restricted = new WeakMap<Agent, string>()
  /** 上课会话这一步调了几次工具。 */
  const toolCalls = new Map<string, number>()
  const failures = new Map<string, number>()
  /** 这节课已经开过会话的学生：再开新会话时要补上前面的事。 */
  const started = new Set<string>()
  let workspace: { id: string; path: string } | null = null
  let sourceKind = SOURCE_KIND
  let disposed = false
  /** 开过、还没归档的上课会话。 */
  let records: ClassSessionRecord[] = (() => {
    try {
      return [...(o.ledger?.load() ?? [])]
    } catch {
      return []
    }
  })()
  /** 每个学生这节课开始的时刻。 */
  const lessonAt = new Map<string, number>()
  /** 正在归档的会话：别重复归档。 */
  const archiving = new Set<string>()
  const picker = o.picker ?? createModels({ ctx: o.ctx, log: o.log })

  const controller = () => service<SessionController>(o.ctx, 'sessionController')
  const registry = () => service<WorkspaceRegistry>(o.ctx, 'workspaceRegistry')

  function available(): boolean {
    return Boolean(controller() && registry())
  }

  async function ensureWorkspace() {
    const reg = registry()
    if (!reg) throw new Error('这个 DSH 没有工作区服务（要用桌面版或 dsh web）')
    mkdirSync(o.roomDir, { recursive: true })
    const want = normPath(o.roomDir)
    if (workspace && normPath(workspace.path) === want) return workspace
    const found = reg.list().find((w) => normPath(w.path) === want)
    const ws = found ?? (await reg.create(o.roomDir, ROOM_TITLE))
    if (ws.title !== ROOM_TITLE) await ws.setTitle?.(ROOM_TITLE).catch(() => undefined)
    workspace = ws
    return ws
  }

  async function resolveAgent(sid: string): Promise<Agent> {
    const live = o.ctx.agents?.get?.(sid)
    if (live) return live
    const r = await controller()!.resolveAgent(sid)
    if (r?.agent) return r.agent
    throw new Error(r?.error?.message || '恢复会话失败')
  }

  /**
   * 藏掉全局工具，只留 allow 里的。每个 agent 对象只限一次；藏不住返回 false（这个会话不能用来上课）。
   * 已经限过、但放开的名单不一样了，也返回 false：换新会话。
   */
  function hideTools(agent: Agent, allow: string[]): boolean {
    const key = [...allow].sort().join(',')
    const done = restricted.get(agent)
    if (done !== undefined) return done === key
    const tools = agent.ctx?.tools
    if (typeof tools?.restrict !== 'function') return false
    try {
      // 要当方法调：DSH 的 restrict 里用 this.ctx，单独取出来调用会抛错
      tools.restrict({ allow })
    } catch (error) {
      if (!allow.length) {
        o.log.warn('上课会话藏不住工具，这个会话不用：', (error as Error)?.message)
        return false
      }
      // 放开的工具刚好没了（插件卸载之类）：一个都不放开
      o.log.warn('上课会话放开工具失败，这个会话不放开工具：', (error as Error)?.message)
      try {
        tools.restrict({ allow: [] })
      } catch (again) {
        o.log.warn('上课会话藏不住工具，这个会话不用：', (again as Error)?.message)
        return false
      }
    }
    restricted.set(agent, key)
    return true
  }

  /** 这一步用哪个模型：设置里填的能用就用它，不然用 DSH 的默认模型（会话里换回来，免得留着上一步的）。 */
  async function chooseModel(student: string): Promise<Choice> {
    return picker.choose(student, [[o.classModel(), '上课用的模型']])
  }

  function useModel(agent: Agent, choice: Choice): void {
    if (!choice.sel) return
    try {
      agent.model?.select?.(choice.sel)
    } catch (error) {
      o.log.warn('换上课用的模型失败（用默认模型）：', (error as Error)?.message)
    }
  }

  /** 这个会话还能不能拿来上课：是插件建的、在插件工作区里、机器人的主人没在里面说过话、没被取消过。 */
  function clean(agent: Agent, sid: string): boolean {
    if (!ours.has(sid) || lost.has(sid)) return false
    const ids = [agent.id, agent.session?.id].filter(Boolean).map(String)
    if (ids.some((x) => x !== sid)) return false
    const cwd = agent.session?.header?.cwd
    if (cwd && workspace && normPath(cwd) !== normPath(workspace.path)) return false
    if (agent.session?.header?.isSeeded) return false
    return true
  }

  async function sessionFor(student: string, title: string): Promise<{ sid: string; agent: Agent; fresh?: boolean }> {
    const allow = o.tools?.(student) ?? []
    const existing = sessions.get(student)
    if (existing) {
      try {
        const agent = await resolveAgent(existing)
        if (clean(agent, existing) && hideTools(agent, allow)) return { sid: existing, agent }
      } catch (error) {
        o.log.info(`上课会话恢复不了（${(error as Error).message}），新开一个`)
      }
      retire(existing)
    }
    const ws = await ensureWorkspace()
    const r = await controller()!.create({ workspaceId: ws.id, agentPreset: o.preset })
    const sid = String(r.sessionId)
    ours.add(sid)
    remember({ sid, student, lessonAt: lessonAt.get(student) ?? Date.now() })
    if (disposed) throw new Error('插件已卸载')
    const agent = await resolveAgent(sid)
    if (!clean(agent, sid)) {
      retire(sid)
      throw new Error('DSH 交回来的不是一个干净的新会话，这一步不答')
    }
    if (!hideTools(agent, allow)) {
      retire(sid)
      throw new Error('上课会话藏不住工具（DSH 版本不支持 tools.restrict），这一步不答')
    }
    sessions.set(student, sid)
    const fresh = started.has(student)
    started.add(student)
    await controller()!.rename({ sessionId: sid, title }).catch(() => undefined)
    return { sid, agent, fresh }
  }

  function send(agent: Agent, msg: UserMessage): void {
    try {
      agent.followup(msg)
    } catch (error) {
      // 有的 DSH 版本只认 source.kind = 'user'
      if (sourceKind !== 'user') {
        sourceKind = 'user'
        msg.source = { kind: 'user', plugin: SOURCE_KIND }
        agent.followup(msg)
        return
      }
      throw error
    }
  }

  /**
   * 这个会话不再用：下一步换新会话（上一轮可能还会迟到地说完）。
   * 换掉的马上归档；让给机器人的主人的（owner）记下来，一直不动。
   */
  function retire(sid: string, owner = false): void {
    lost.add(sid)
    for (const [k, v] of sessions) if (v === sid) sessions.delete(k)
    const rec = records.find((r) => r.sid === sid)
    if (!rec) return
    if (owner) {
      rec.ownerTook = true
      delete rec.retired
    } else if (!rec.ownerTook) rec.retired = true
    saveRecords()
    if (!owner && !rec.ownerTook) void archive(sid)
  }

  function remember(rec: ClassSessionRecord): void {
    records.push(rec)
    saveRecords()
  }

  function saveRecords(): void {
    try {
      o.ledger?.save(records)
    } catch (error) {
      o.log.warn('记不下上课会话：', (error as Error)?.message)
    }
  }

  /** 归档一个上课会话（停掉它还在跑的事），归档了就不再记着。归档失败也不再记着：只是侧边栏里多一个。 */
  async function archive(sid: string): Promise<void> {
    if (archiving.has(sid)) return
    const reg = registry()
    if (typeof reg?.archiveSession !== 'function') return
    archiving.add(sid)
    try {
      await reg.archiveSession(sid, { stopActivity: true })
    } catch (error) {
      o.log.info(`上课会话归档不了（${(error as Error)?.message ?? error}），不再管它`)
    } finally {
      archiving.delete(sid)
      records = records.filter((r) => r.sid !== sid)
      saveRecords()
    }
  }

  /**
   * 把该归档的上课会话归档：中途换掉的、这节课里以前开的（插件重启前开的，现在不用了），和每个学生最近 KEEP_LESSONS 节课以前的。
   * 正在用的、让给机器人的主人的不动。
   */
  async function tidy(): Promise<void> {
    if (disposed) return
    const inUse = new Set([...sessions.values(), ...pending.keys()])
    const recent = new Map<string, Set<number>>()
    for (const r of records) {
      const set = recent.get(r.student) ?? new Set<number>()
      set.add(r.lessonAt)
      recent.set(r.student, set)
    }
    // 正在上的这一节也算一节（刚开课时还没开会话）
    for (const [student, at] of lessonAt) recent.get(student)?.add(at)
    for (const [student, set] of recent) recent.set(student, new Set([...set].sort((a, b) => b - a).slice(0, KEEP_LESSONS)))
    const due = records.filter(
      (r) => !r.ownerTook && !inUse.has(r.sid) && (r.retired || r.lessonAt === lessonAt.get(r.student) || !recent.get(r.student)!.has(r.lessonAt)),
    )
    for (const r of due) await archive(r.sid)
  }

  function trouble(student: string, why: string): void {
    const n = (failures.get(student) ?? 0) + 1
    failures.set(student, n)
    if (n === TROUBLE_AFTER) o.onTrouble?.(student, `课上 AI 连着 ${n} 次没说出话（${why}）。看看上课用的模型设置对不对、余额够不够。`)
  }

  async function runTurn(student: string, title: string, req: ThinkRequest): Promise<string | null> {
    if (disposed) return null
    if (req.deadline - Date.now() < 2_000) return null
    const choice = await chooseModel(student)
    const r = await turnWith(student, title, req, choice)
    if (!(r instanceof ModelFailed)) return r
    // 设置里填的模型出错了：换 DSH 的默认模型、开新会话（补上前面的事）再问一次
    picker.failed(student, choice.sel!, choice.what, r.code)
    if (disposed || req.deadline - Date.now() < RETRY_MIN_MS) return null
    const again = await turnWith(student, title, req, await chooseModel(student))
    if (again instanceof ModelFailed) {
      trouble(student, `error ${again.code}`.trim())
      return null
    }
    return again
  }

  async function turnWith(student: string, title: string, req: ThinkRequest, choice: Choice): Promise<string | null | ModelFailed> {
    const { sid, agent, fresh } = await sessionFor(student, title)
    const left = req.deadline - Date.now()
    if (left < 2_000 || disposed) return null
    // 这节课中途换了新会话：把前面的事补上
    const text = fresh && req.recap?.length
      ? ['【这节课前面发生过的事（换了一个新的会话，补给你）】', fence(req.recap.join('\n')), '', req.text].join('\n')
      : req.text
    const msg: UserMessage = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: sourceKind, ...(sourceKind === 'user' ? { plugin: SOURCE_KIND } : {}) },
    }
    const done = new Promise<string | null | ModelFailed>((resolveText) => {
      const timer = setTimeout(() => {
        if (pending.get(sid)?.msgId !== msg.id) return
        pending.delete(sid)
        try {
          controller()?.cancel?.({ sessionId: sid })
        } catch {
          // 取消不了就算了：这个会话反正不再用
        }
        retire(sid)
        o.log.info('AI 没在时限内想好，这一步不说了')
        trouble(student, '想得太久')
        resolveText(null)
      }, left)
      pending.set(sid, { student, msgId: msg.id, armed: false, turn: null, text: '', choice, resolve: resolveText, timer })
      toolCalls.set(sid, 0)
    })
    useModel(agent, choice)
    send(agent, msg)
    return done
  }

  function settle(sid: string, p: Pending, text: string | null | ModelFailed): void {
    pending.delete(sid)
    toolCalls.delete(sid)
    clearTimeout(p.timer)
    p.resolve(text)
  }

  return {
    available,
    /**
     * 新的一节课：下一步开新会话；更早的上课会话该归档的归档。
     * startsAt 是课表上这节课开始的时刻：插件在课上重启（热重载）后还是同一节课，重启前开的会话算中途换掉的。
     */
    newLesson(student: string, startsAt?: number) {
      sessions.delete(student)
      failures.delete(student)
      started.delete(student)
      lessonAt.set(student, startsAt ?? Date.now())
      void tidy()
    },
    /** 插件启动时整理一遍：把关着 DSH 时攒下的旧上课会话归档。 */
    tidy,
    /** 同一个学生一次只想一件事（Classroom 本来也排着队，这里再保一道）。 */
    think(student: string, title: string, req: ThinkRequest): Promise<string | null> {
      if (!available() || disposed) return Promise.resolve(null)
      const prev = chains.get(student) ?? Promise.resolve()
      const run = prev
        .then(() => runTurn(student, title, req))
        .catch((error) => {
          o.log.warn('上课会话出错：', (error as Error)?.message ?? error)
          trouble(student, (error as Error)?.message ?? '出错')
          return null
        })
      chains.set(student, run)
      return run
    },
    isSchoolSession: (sid: string) => ours.has(sid),
    /**
     * 挂到 agent/pre-step 上：上课会话里只留我们自己的消息和 runtime-context。
     * 挂到 tools/pre-execute 上：上课会话里要批准的调用直接拒绝，一步调工具的次数有上限。
     */
    attach(ctx: DshContext): void {
      ctx.on(
        'tools/pre-execute',
        async (exec: { name?: string; agent?: Agent }, next: () => Promise<{ kind: string }>) => {
          const sid = String(exec?.agent?.session?.id ?? exec?.agent?.id ?? '')
          if (!sid || !ours.has(sid) || lost.has(sid)) return next()
          const n = (toolCalls.get(sid) ?? 0) + 1
          toolCalls.set(sid, n)
          if (n > MAX_TOOL_CALLS) return { kind: 'deny', reason: `这一步已经调了 ${MAX_TOOL_CALLS} 次工具，不能再调了。直接用你现在知道的回答。` }
          const decision = await next()
          // 课上没人能点"允许"：等下去只会超时
          if (decision?.kind === 'ask') return { kind: 'deny', reason: '这个工具要你的主人批准才能用，上课时没人批准，这次不调用。直接用你现在知道的回答。' }
          return decision
        },
        { prepend: true },
      )
      ctx.on(
        'agent/pre-step',
        async (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => {
          const decision = await next()
          const sid = String(payload?.agent?.session?.id ?? payload?.agent?.id ?? '')
          if (!sid || !ours.has(sid) || !decision || decision.kind !== 'enter') return decision
          // 已经让给机器人的主人的会话：不再过滤
          if (lost.has(sid)) return decision
          // 机器人的主人在上课会话里打字：让给机器人的主人，这一步原样放行（真 DSH 在 pre-step 之后才写 user/message，
          // 过滤掉的话 onSessionEvent 永远看不到机器人的主人说话）
          const claimed = Array.isArray(payload?.messages) ? payload.messages : decision.messages
          if (claimed.some((m) => isOwnerTyped(m?.source))) {
            retire(sid, true)
            const p = pending.get(sid)
            if (p) settle(sid, p, null)
            o.log.warn('机器人的主人在上课会话里说话了：这个会话让给机器人的主人，课堂换到新会话')
            return decision
          }
          const kept = decision.messages.filter((m) => KEEP_KINDS.has(String(m?.source?.kind)) || m?.source?.plugin === SOURCE_KIND)
          if (kept.length !== decision.messages.length) o.log.debug?.(`上课会话里去掉了 ${decision.messages.length - kept.length} 条别的插件加的消息`)
          return { ...decision, messages: kept }
        },
        { prepend: true },
      )
    },
    onSessionEvent(session: { id?: string } | undefined, event: SessionEvent | undefined) {
      const sid = String(session?.id ?? '')
      if (!sid || !event || !ours.has(sid)) return
      const d = (event.data ?? {}) as Record<string, unknown> & { turn?: number; reason?: { kind?: string; error?: { code?: string; message?: string } } }
      if (event.type === 'user/message') {
        // 真 DSH：data 就是消息本身；兼容 { message } 的写法
        const m = ((d as { message?: unknown }).message ?? d) as { id?: string; source?: { kind: string; [k: string]: unknown } }
        if (isOwnerTyped(m.source)) {
          // 机器人的主人在上课会话里说话了：让给机器人的主人，以后不再往里发
          retire(sid, true)
          const p = pending.get(sid)
          if (p) settle(sid, p, null)
          o.log.warn('机器人的主人在上课会话里说话了：这个会话让给机器人的主人，课堂换到新会话')
          return
        }
        const p = pending.get(sid)
        if (p && m.id === p.msgId) p.armed = true
        return
      }
      const p = pending.get(sid)
      if (!p || !p.armed) return
      if (event.type === 'turn/start') {
        if (p.turn === null && typeof d.turn === 'number') p.turn = d.turn
        return
      }
      if (p.turn !== null && typeof d.turn === 'number' && d.turn !== p.turn) return
      if (event.type === 'assistant/message') {
        if ((d as { interrupted?: boolean }).interrupted) return
        // 真 DSH 里 turn/start 在 user/message 之前：用 armed 之后第一条回答的 turn 认这一轮
        if (p.turn === null && typeof d.turn === 'number') p.turn = d.turn
        p.text = replyText((d as { message?: unknown }).message)
      } else if (event.type === 'turn/end') {
        const kind = d.reason?.kind
        if (!kind || kind === 'completed') {
          failures.delete(p.student)
          settle(sid, p, p.text)
        } else {
          const code = d.reason?.error?.code ?? ''
          o.log.warn(`上课会话这一轮没正常结束：${kind}${code ? ` ${code}` : ''}`)
          retire(sid)
          // 设置里填的模型出错：交回 runTurn 换默认模型再试，先不算"说不出话"
          if (kind === 'error' && p.choice.custom) return settle(sid, p, new ModelFailed(code))
          trouble(p.student, `${kind}${code ? ` ${code}` : ''}`)
          settle(sid, p, null)
        }
      }
    },
    dispose() {
      disposed = true
      for (const [sid, p] of pending) settle(sid, p, null)
    },
  }
}

export type Brain = ReturnType<typeof createBrain>

/** 一轮结束时 AI 最后说的话：最后一条 assistant 消息里的文字（带工具调用的不算）。 */
export function replyText(message: unknown): string {
  const content = (message as { content?: unknown[] } | undefined)?.content
  if (!Array.isArray(content)) return ''
  if (content.some((b) => (b as { type?: string })?.type === 'tool-call' || (b as { type?: string })?.type === 'tool_use')) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export const roomDirOf = (dir: string) => join(dir, 'room')
