// DSH 那一半的"无状态地问一次模型"（社团用）：直接调 ctx.llm.stream，不开会话、不写进任何会话记录、不挂工具。
// 模型：设置里的"社团用的模型"，没填用"上课用的模型"，再没有用 DSH 的默认模型（ctx.agentDefaultModel）。
// 出处：deepseek-ai/deepseek-harness 的 docs/subsystems/llm-streaming.md（ctx.llm、GenerateOptions、StreamChunk）
// 和 docs/subsystems/core.md（ctx.agentDefaultModel）。
import { service, type DshContext, type Logger } from './host.js'

interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'finish'; reason: { kind: string; failure?: { code?: string; message?: string } } }
  | { type: string }

interface LlmRuntime {
  stream(options: {
    provider: string
    model: string
    reasoningEffort?: string
    system?: string
    messages: { role: 'user'; content: { type: 'text'; text: string }[] }[]
    signal?: AbortSignal
  }): AsyncIterable<StreamChunk>
}

export interface AskerOptions {
  ctx: DshContext
  log: Logger
  /** "provider/model"；空就往下找。 */
  models: () => string[]
}

/** "provider/model" 拆开；不合格式返回 null。 */
export function parseModel(s: string): ModelSelection | null {
  const t = s.trim()
  const cut = t.indexOf('/')
  return cut > 0 && cut < t.length - 1 ? { provider: t.slice(0, cut), model: t.slice(cut + 1) } : null
}

export function createAsker(o: AskerOptions) {
  const llm = () => service<LlmRuntime>(o.ctx, 'llm')
  const defaults = () => service<{ currentSelection(): ModelSelection }>(o.ctx, 'agentDefaultModel')

  function pick(): ModelSelection | null {
    for (const m of o.models()) {
      const sel = parseModel(m)
      if (sel) return sel
    }
    try {
      const sel = defaults()?.currentSelection()
      if (sel?.provider && sel.model) return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}) }
    } catch {
      // 没有默认模型
    }
    return null
  }

  return {
    available: () => typeof llm()?.stream === 'function',
    /** deadline（绝对时刻）前没答完、出错都返回 null。 */
    async ask(req: { system: string; prompt: string; deadline: number }): Promise<string | null> {
      const rt = llm()
      const sel = pick()
      if (!rt || !sel) {
        o.log.warn('社团：拿不到模型（没有 llm 服务或者没有默认模型）')
        return null
      }
      const left = req.deadline - Date.now()
      if (left < 1_000) return null
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), left)
      let text = ''
      try {
        for await (const chunk of rt.stream({
          ...sel,
          system: req.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: req.prompt }] }],
          signal: ac.signal,
        })) {
          if (chunk.type === 'text-delta') text += (chunk as { text: string }).text
          else if (chunk.type === 'finish') {
            const reason = (chunk as { reason: { kind: string; failure?: { code?: string } } }).reason
            if (reason.kind === 'error' || reason.kind === 'aborted') {
              if (!ac.signal.aborted) o.log.warn(`社团：模型出错了（${reason.failure?.code ?? reason.kind}）`)
              return null
            }
          }
        }
      } catch (error) {
        if (!ac.signal.aborted) o.log.warn('社团：调用模型失败：', (error as Error)?.message ?? error)
        return null
      } finally {
        clearTimeout(timer)
      }
      return text.trim() || null
    },
  }
}

export type Asker = ReturnType<typeof createAsker>
