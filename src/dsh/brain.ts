// DSH 那一半的"AI 想说什么"：在插件自用的工作区里给每节课开一个"上课会话"，
// 套随插件安装的 schoolforbots 预设（AI 的人设，没有工具），把课堂上的一步当一条消息交给 AI，等这一轮说完拿回 AI 的话。
//
// 几条约束：
// - 课堂绝不进机器人的主人的聊天会话；会话建在插件自己的工作区，工作区名字写明"别在这里聊天"。
// - 不预先建空会话（DSH 的"新会话"会接手它）；每一步发之前都检查会话是不是插件建的、机器人的主人有没有在里面说过话。
// - 上课会话里藏掉所有全局工具（allow: []）：同学的话再怎么写，这个会话也做不了任何事。藏不住就不用这个会话。
// - 别的插件在 agent/pre-step 往上课会话里塞的消息（比如记忆插件塞机器人的主人的记忆）去掉，只留我们自己的和 runtime-context。
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

export const SOURCE_KIND = 'schoolforbots'
const ROOM_TITLE = '机器人网校 · 插件自用（别在这里聊天）'
/** 上课会话里留下的消息来源：我们自己发的，和 DSH 的运行环境快照。 */
const KEEP_KINDS = new Set([SOURCE_KIND, 'runtime-context'])
/** 同一个学生连续这么多步出错，就告诉机器人的主人。 */
const TROUBLE_AFTER = 3

export interface BrainOptions {
  ctx: DshContext
  log: Logger
  roomDir: string
  preset: string
  /** "provider/model"：上课单独用的模型；空就用 DSH 的默认模型。 */
  classModel: () => string
  /** 课上 AI 连续说不出话（模型出错之类）：告诉机器人的主人。 */
  onTrouble?: (student: string, text: string) => void
}

interface Pending {
  student: string
  msgId: string
  /** 看到了我们这条消息的 user/message：后面的事件才算这一步的。 */
  armed: boolean
  turn: number | null
  text: string
  resolve: (text: string | null) => void
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
  const restricted = new WeakSet<Agent>()
  const failures = new Map<string, number>()
  /** 这节课已经开过会话的学生：再开新会话时要补上前面的事。 */
  const started = new Set<string>()
  let workspace: { id: string; path: string } | null = null
  let sourceKind = SOURCE_KIND
  let disposed = false

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

  /** 藏掉所有全局工具。每个 agent 对象只藏一次；藏不住返回 false（这个会话不能用来上课）。 */
  function hideTools(agent: Agent): boolean {
    if (restricted.has(agent)) return true
    try {
      const tools = agent.ctx?.tools
      if (typeof tools?.restrict !== 'function') return false
      // 要当方法调：DSH 的 restrict 里用 this.ctx，单独取出来调用会抛错
      tools.restrict({ allow: [] })
      restricted.add(agent)
      return true
    } catch (error) {
      o.log.warn('上课会话藏不住工具，这个会话不用：', (error as Error)?.message)
      return false
    }
  }

  function useClassModel(agent: Agent): void {
    const want = o.classModel().trim()
    const cut = want.indexOf('/')
    if (cut <= 0) return
    try {
      agent.model?.select?.({ provider: want.slice(0, cut), model: want.slice(cut + 1) })
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
    const existing = sessions.get(student)
    if (existing) {
      try {
        const agent = await resolveAgent(existing)
        if (clean(agent, existing) && hideTools(agent)) return { sid: existing, agent }
      } catch (error) {
        o.log.info(`上课会话恢复不了（${(error as Error).message}），新开一个`)
      }
      sessions.delete(student)
    }
    const ws = await ensureWorkspace()
    const r = await controller()!.create({ workspaceId: ws.id, agentPreset: o.preset })
    const sid = String(r.sessionId)
    ours.add(sid)
    if (disposed) throw new Error('插件已卸载')
    const agent = await resolveAgent(sid)
    if (!clean(agent, sid)) {
      lost.add(sid)
      throw new Error('DSH 交回来的不是一个干净的新会话，这一步不答')
    }
    if (!hideTools(agent)) {
      lost.add(sid)
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

  /** 这个会话不再用：下一步换新会话（上一轮可能还会迟到地说完）。 */
  function retire(sid: string): void {
    lost.add(sid)
    for (const [k, v] of sessions) if (v === sid) sessions.delete(k)
  }

  function trouble(student: string, why: string): void {
    const n = (failures.get(student) ?? 0) + 1
    failures.set(student, n)
    if (n === TROUBLE_AFTER) o.onTrouble?.(student, `课上 AI 连着 ${n} 次没说出话（${why}）。看看上课用的模型设置对不对、余额够不够。`)
  }

  async function runTurn(student: string, title: string, req: ThinkRequest): Promise<string | null> {
    if (disposed) return null
    if (req.deadline - Date.now() < 2_000) return null
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
    const done = new Promise<string | null>((resolveText) => {
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
      pending.set(sid, { student, msgId: msg.id, armed: false, turn: null, text: '', resolve: resolveText, timer })
    })
    useClassModel(agent)
    send(agent, msg)
    return done
  }

  function settle(sid: string, p: Pending, text: string | null): void {
    pending.delete(sid)
    clearTimeout(p.timer)
    p.resolve(text)
  }

  return {
    available,
    /** 新的一节课：下一步开新会话。 */
    newLesson(student: string) {
      sessions.delete(student)
      failures.delete(student)
      started.delete(student)
    },
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
    /** 挂到 agent/pre-step 上：上课会话里只留我们自己的消息和 runtime-context。 */
    attach(ctx: DshContext): void {
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
            retire(sid)
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
          retire(sid)
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
          trouble(p.student, `${kind}${code ? ` ${code}` : ''}`)
          retire(sid)
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
