// 上课会话里放开哪些工具：机器人的主人在设置里填的（一行一个，见 core/class-tools.ts），去掉这几种再放开：
// - 看不懂的行；
// - 我们插件自己的工具（报名、退学、换钥匙、校园记忆……）：课上不能动这些；
// - DSH 里现在没有的工具：tools.restrict 遇到不认识的名字会报错，整个会话就不能用来上课了。
// 去掉的告诉机器人的主人（同一件事同一个学生 6 小时内说一次）。
// 出处：deepseek-ai/deepseek-harness 的 docs/subsystems/tools.md（ToolRestriction、definitions）。
import { parseClassTools, type ClassTool } from '../core/class-tools.js'
import { service, type DshContext, type Logger } from './host.js'

/** 同一件事多久以后才再告诉机器人的主人一次。 */
const RETELL_MS = 6 * 60 * 60_000

export interface ClassToolsOptions {
  ctx: DshContext
  log: Logger
  /** 设置里填的内容。 */
  text: () => string
  /** 我们插件自己注册的工具名。 */
  own: () => Iterable<string>
  onNotice?: (student: string, text: string) => void
  now?: () => number
}

export function createClassTools(o: ClassToolsOptions) {
  const now = o.now ?? Date.now
  const told = new Map<string, number>()

  /** DSH 里现在有的全局工具；查不了返回 null。 */
  function registered(): Set<string> | null {
    try {
      const defs = service<{ definitions?(): readonly { name: string }[] }>(o.ctx, 'tools')?.definitions?.()
      return Array.isArray(defs) ? new Set(defs.map((d) => d.name)) : null
    } catch {
      return null
    }
  }

  function sort(): { allowed: ClassTool[]; dropped: string[] } {
    const text = o.text()
    if (!text.trim()) return { allowed: [], dropped: [] }
    const { tools, bad } = parseClassTools(text)
    const dropped = bad.map((line) => `「${line}」看不懂（一行一个工具名，冒号后面可以写一句说明）`)
    const own = new Set(o.own())
    const have = registered()
    const allowed: ClassTool[] = []
    for (const t of tools) {
      if (own.has(t.name)) dropped.push(`${t.name} 是机器人网校插件自己的工具，课上不能用`)
      else if (!have) dropped.push(`${t.name}：这个 DSH 查不了有哪些工具，先不放开`)
      else if (!have.has(t.name)) dropped.push(`DSH 里现在没有 ${t.name} 这个工具（名字写对了吗？提供它的插件装了吗？）`)
      else allowed.push(t)
    }
    return { allowed, dropped }
  }

  return {
    /** 现在能放开的工具（给课堂提示词用，不告诉机器人的主人）。 */
    allowed: (): ClassTool[] => sort().allowed,
    /** 给某个学生开上课会话时：能放开的工具，去掉的告诉机器人的主人。 */
    forSession(student: string): ClassTool[] {
      const { allowed, dropped } = sort()
      for (const why of dropped) {
        const k = `${student}\n${why}`
        const at = told.get(k)
        if (at !== undefined && now() - at < RETELL_MS) continue
        told.set(k, now())
        const text = `上课可用的工具：${why}。`
        o.log.warn(text)
        o.onNotice?.(student, text)
      }
      return allowed
    },
  }
}

export type ClassTools = ReturnType<typeof createClassTools>
