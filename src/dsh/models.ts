// 上课、社团用哪个模型：设置里填的模型先在 DSH 的模型列表里查一下，查不到就用 DSH 的默认模型；
// 调用时出错（key 没配、余额不够、模型下线……）也换 DSH 的默认模型再试一次，之后一段时间不再用它。
// 换成默认模型时告诉机器人的主人（同一个模型同一个学生 6 小时内只说一次）。
//
// DSH 的模型列表只是"参考"（适配器也可能接受列表里没有的模型），所以：
// - 没有这个 provider：一定用不了；
// - provider 列出了模型、里面没有这个：当作用不了；
// - provider 没列模型、或者查不了：不拦，真出错了再换。
// 出处：deepseek-ai/deepseek-harness 的 docs/subsystems/llm-streaming.md（listProviders、listModels）
// 和 docs/subsystems/core.md（ctx.agentDefaultModel）。
import { service, type DshContext, type Logger } from './host.js'

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

interface LlmCatalog {
  listProviders?(): { id: string }[]
  listModels?(provider: string): Promise<{ id: string }[]>
}

/** DSH 的模型列表多久重新查一次。 */
const CATALOG_MS = 5 * 60_000
/** 查模型列表最多等多久。 */
const CATALOG_WAIT_MS = 3_000
/** 调用出错的模型多久不再用。 */
const BENCH_MS = 30 * 60_000
/** 同一件事多久以后才再告诉机器人的主人一次。 */
const RETELL_MS = 6 * 60 * 60_000

/** "provider/model" 拆开；不合格式返回 null。 */
export function parseModel(s: string): ModelSelection | null {
  const t = s.trim()
  const cut = t.indexOf('/')
  return cut > 0 && cut < t.length - 1 ? { provider: t.slice(0, cut), model: t.slice(cut + 1) } : null
}

export const modelLabel = (s: ModelSelection) => `${s.provider}/${s.model}`

export interface Choice {
  sel: ModelSelection | null
  /** 用的是设置里填的模型（不是 DSH 的默认模型）：出错时可以换默认模型再试。 */
  custom: boolean
  /** 用的是哪个设置项（custom 时才有），比如"上课用的模型"。 */
  what: string
}

export interface ModelsOptions {
  ctx: DshContext
  log: Logger
  /** 告诉某个学生的主人一件事。 */
  onNotice?: (student: string, text: string) => void
  now?: () => number
}

export function createModels(o: ModelsOptions) {
  const now = o.now ?? Date.now
  const catalog = new Map<string, { at: number; ids: Set<string> | null }>()
  const benched = new Map<string, { until: number; why: string }>()
  const told = new Map<string, number>()

  function tell(student: string, key: string, text: string): void {
    o.log.warn(text)
    const k = `${student}\n${key}`
    const at = told.get(k)
    if (at !== undefined && now() - at < RETELL_MS) return
    told.set(k, now())
    o.onNotice?.(student, text)
  }

  function defaultModel(): ModelSelection | null {
    try {
      const sel = service<{ currentSelection(): ModelSelection }>(o.ctx, 'agentDefaultModel')?.currentSelection()
      if (sel?.provider && sel.model) return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}) }
    } catch {
      // 没有默认模型
    }
    return null
  }

  /** provider 列出来的模型；没列、查不了返回 null。 */
  async function listed(llm: LlmCatalog, provider: string): Promise<Set<string> | null> {
    const hit = catalog.get(provider)
    if (hit && now() - hit.at < CATALOG_MS) return hit.ids
    let ids: Set<string> | null = null
    try {
      if (typeof llm.listModels === 'function') {
        let timer: NodeJS.Timeout | undefined
        const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), CATALOG_WAIT_MS)))
        const list = await Promise.race([llm.listModels(provider), timeout]).finally(() => clearTimeout(timer))
        if (Array.isArray(list) && list.length) ids = new Set(list.map((m) => String(m?.id)))
      }
    } catch {
      ids = null
    }
    catalog.set(provider, { at: now(), ids })
    return ids
  }

  /** 这个模型为什么用不了；看不出问题返回 null。 */
  async function whyNot(sel: ModelSelection): Promise<string | null> {
    const b = benched.get(modelLabel(sel))
    if (b && b.until > now()) return b.why
    const llm = service<LlmCatalog>(o.ctx, 'llm')
    let providers: { id: string }[] | undefined
    try {
      providers = llm?.listProviders?.()
    } catch {
      return null
    }
    // 查不了 provider：不拦
    if (!llm || !Array.isArray(providers)) return null
    if (!providers.some((p) => p?.id === sel.provider)) return `DSH 里没有 ${sel.provider} 这个模型服务`
    const ids = await listed(llm, sel.provider)
    if (ids && !ids.has(sel.model)) return `${sel.provider} 的模型列表里没有 ${sel.model}`
    return null
  }

  return {
    defaultModel,
    /**
     * 按顺序取第一个填了的模型；它用不了就用 DSH 的默认模型（并告诉机器人的主人）。都没填也用默认模型。
     * @param settings 设置项的值和名字，比如 ['deepseek/x', '上课用的模型']
     */
    async choose(student: string, settings: [spec: string, what: string][]): Promise<Choice> {
      for (const [spec, what] of settings) {
        const sel = parseModel(spec)
        if (!sel) continue
        const why = await whyNot(sel)
        if (!why) return { sel, custom: true, what }
        tell(student, modelLabel(sel), `${what}「${modelLabel(sel)}」用不了（${why}），先用 DSH 的默认模型。`)
        break
      }
      return { sel: defaultModel(), custom: false, what: '' }
    },
    /** 设置里填的模型调用出错：一段时间内不再用它，告诉机器人的主人。 */
    failed(student: string, sel: ModelSelection, what: string, code: string): void {
      const why = `调用出错${code ? `：${code}` : ''}`
      benched.set(modelLabel(sel), { until: now() + BENCH_MS, why })
      tell(student, modelLabel(sel), `${what}「${modelLabel(sel)}」${why}，这一步换 DSH 的默认模型再试，之后半小时都用默认模型。看看这个模型的 key 和余额。`)
    },
  }
}

export type Models = ReturnType<typeof createModels>
