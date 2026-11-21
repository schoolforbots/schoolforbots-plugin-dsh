// 插件用到的 DSH 宿主能力，只写用得到的形状。宿主的类型包不随插件发布，所以这里按 DSH 0.2.x 的源码手写，
// 用的时候都先判断有没有（headless / sdk 组合没有会话服务）。
// 出处：deepseek-ai/deepseek-harness 的 packages/extensions/tool-cordis/src/api-catalog.ts。

export interface TextBlock {
  type: 'text'
  text: string
}

export interface MessageSource {
  kind: string
  [k: string]: unknown
}

export interface UserMessage {
  id: string
  role: 'user'
  content: TextBlock[]
  source: MessageSource
}

export interface SessionHeader {
  id?: string
  cwd?: string
  isSeeded?: boolean
}

export interface Session {
  id: string
  header?: SessionHeader
}

export interface Agent {
  id?: string
  session?: Session
  followup(message: UserMessage): void
  ctx?: { tools?: { restrict?: (f: { allow?: string[]; deny?: string[] }) => () => void } }
  model?: { select?: (sel: { provider: string; model: string }) => unknown }
}

export interface SessionEvent {
  type: string
  data?: Record<string, unknown> & { message?: { id?: string; content?: unknown[]; source?: MessageSource }; turn?: number; reason?: { kind?: string } }
}

export interface SessionController {
  create(req: { workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  resolveAgent(sessionId: string): Promise<{ agent?: Agent; error?: { message?: string } }>
  rename(req: { sessionId: string; title: string }): Promise<unknown>
  cancel?(req: { sessionId: string }): unknown
}

export interface Workspace {
  id: string
  path: string
  title?: string
  setTitle?(title: string): Promise<unknown>
}

export interface WorkspaceRegistry {
  list(): Workspace[]
  create(path: string, title?: string): Promise<Workspace>
}

export interface PreStepPayload {
  agent: Agent
  turn?: number
  step: number
  signal?: AbortSignal
  /** 这一步认领到的输入（机器人的主人的话、插件发的消息）。 */
  messages?: UserMessage[]
}

export type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => TextBlock[] }
  timeoutMs?: number
  isConcurrencySafe?: () => boolean
  execute(args: unknown, exec: { agent?: Agent; callId?: string; signal?: AbortSignal }): Promise<unknown>
}

/** 工具的按步启用条件：返回 false 时这一步的模型看不到、也调不了这个工具。 */
export interface ToolRegistrationOptions {
  when?: (context: { agent: Agent; signal?: AbortSignal }) => boolean | Promise<boolean>
}

export interface CommandInvocation {
  agent?: Agent
  rawInput: string
  signal?: AbortSignal
}

export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

export interface CommandDef {
  name: string
  description: string
  input?: { hint: string }
  recordInput?: boolean
  handler(invocation: CommandInvocation): Promise<CommandResult>
}

export interface Credentials {
  resolve(ref: string): Promise<{ value: string } | undefined>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug?(...args: unknown[]): void
}

/** 插件拿到的 ctx（Cordis Context）里我们用到的部分。 */
export interface DshContext {
  effect(fn: () => (() => void) | (() => Promise<void>) | void | undefined): void
  on(name: string, listener: (...args: any[]) => unknown, options?: { prepend?: boolean }): () => void
  get?(name: string): unknown
  logger?: (name: string) => Logger
  sessionController?: SessionController
  workspaceRegistry?: WorkspaceRegistry
  agents?: { get?(id: string): Agent | undefined }
  systemPrompt?: { variable(name: string, fn: () => string): () => void }
  tools?: { register(def: ToolDef, options?: ToolRegistrationOptions): () => void }
  commands?: { register(def: CommandDef): () => void }
  credentials?: Credentials
  llm?: unknown
  approval?: unknown
  agentDefaultModel?: unknown
}

/** 取一个可选的服务：先看 ctx 上有没有，再用 ctx.get。都没有返回 undefined。 */
export function service<T>(ctx: DshContext, name: keyof DshContext & string): T | undefined {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    if (direct) return direct as T
  } catch {
    // 没注入的服务在 Cordis 里访问会抛错
  }
  try {
    return (ctx.get?.(name) as T | undefined) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 这条消息是不是机器人的主人亲手打的：只认 DSH 本地输入的形状——来源是 user，没有 plugin（插件塞的、QQ 这类插件转进来的），
 * 也没有 principal（DSH 给非 owner 的远程调用方带上的身份；owner 自己的输入不带它）。别的形状一律不算。
 */
export function isOwnerTyped(src: MessageSource | undefined): boolean {
  if (!src || src.plugin || src.principal) return false
  return src.kind === 'user'
}
