// DSH 那一半的"无状态地问一次模型"（社团用）：直接调 ctx.llm.stream，不开会话、不写进任何会话记录、不挂工具。
// 模型：设置里的"社团用的模型"，没填用"上课用的模型"，再没有用 DSH 的默认模型（ctx.agentDefaultModel）。
// 填的模型用不了（models.ts 事先查）就用 DSH 的默认模型；调用出错、时间还够，就换默认模型再问一次。
// 出处：deepseek-ai/deepseek-harness 的 docs/subsystems/llm-streaming.md（ctx.llm、GenerateOptions、StreamChunk）
// 和 docs/subsystems/core.md（ctx.agentDefaultModel）。
import { service, type DshContext, type Logger } from './host.js'
import { createModels, type ModelSelection, type Models } from './models.js'

export { parseModel } from './models.js'

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
  /** 设置项的值（"provider/model"）和名字，按顺序；空的往下找。 */
  models: () => [spec: string, what: string][]
  /** 查模型、换默认模型（和上课共用）。不给就自己建一个（不告诉机器人的主人）。 */
  picker?: Models
}

/** 模型调用出错（不是超时）：带着错误码。 */
class ModelFailed {
  constructor(readonly code: string) {}
}

/** 至少还剩这么久，才换默认模型再问一次。 */
const RETRY_MIN_MS = 1_500

export function createAsker(o: AskerOptions) {
  const llm = () => service<LlmRuntime>(o.ctx, 'llm')
  const picker = o.picker ?? createModels({ ctx: o.ctx, log: o.log })

  /** 用 sel 问一次：到时限没答完返回 null，模型出错返回 ModelFailed。 */
  async function once(rt: LlmRuntime, sel: ModelSelection, req: { system: string; prompt: string; deadline: number }): Promise<string | null | ModelFailed> {
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
            if (ac.signal.aborted) return null
            o.log.warn(`社团：模型出错了（${reason.failure?.code ?? reason.kind}）`)
            return new ModelFailed(reason.failure?.code ?? reason.kind)
          }
        }
      }
    } catch (error) {
      if (ac.signal.aborted) return null
      o.log.warn('社团：调用模型失败：', (error as Error)?.message ?? error)
      return new ModelFailed((error as { code?: string })?.code ?? '')
    } finally {
      clearTimeout(timer)
    }
    return text.trim() || null
  }

  return {
    available: () => typeof llm()?.stream === 'function',
    /** deadline（绝对时刻）前没答完、出错都返回 null。 */
    async ask(req: { system: string; prompt: string; deadline: number }, student = ''): Promise<string | null> {
      const rt = llm()
      const { sel, custom, what } = await picker.choose(student, o.models())
      if (!rt || !sel) {
        o.log.warn('社团：拿不到模型（没有 llm 服务或者没有默认模型）')
        return null
      }
      const r = await once(rt, sel, req)
      if (!(r instanceof ModelFailed)) return r
      // 设置里填的模型出错了：换 DSH 的默认模型再问一次
      const fallback = picker.defaultModel()
      if (!custom || !fallback) return null
      picker.failed(student, sel, what, r.code)
      if (req.deadline - Date.now() < RETRY_MIN_MS) return null
      const again = await once(rt, fallback, req)
      return again instanceof ModelFailed ? null : again
    },
  }
}

export type Asker = ReturnType<typeof createAsker>
