// 每次调用模型用了多少 token、命中了多少缓存：上课每一步（会话里的每个 step）、社团每一步都记一条。
// - 写进日志一行，边用边看；
// - 追加到插件目录的 usage.jsonl（一行一个 JSON），以后拿来统计。超过 MAX_BYTES 换新文件，只留一个旧的（usage.jsonl.1）。
// 用量来自 DSH：社团是 ctx.llm.stream 里的 { type: 'usage' } 块，上课是会话事件 assistant/message 的 usage。
// 几个数是分开算的（DSH 的 TokenUsage）：inputTokens 只算没命中缓存的输入，命中的在 cacheReadTokens，
// 写进缓存的在 cacheWriteTokens；计费的输入是三者之和。
import { appendFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from './host.js'

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface UsageEntry {
  /** class：上课会话的一步；club-turn：社团叫分出牌；club-react：社团发表情。 */
  kind: 'class' | 'club-turn' | 'club-react'
  /** 学生的 aiId。 */
  student: string
  /** provider/model；不知道是空串。 */
  model: string
  usage: TokenUsage
}

/** 超过这么大换新文件。 */
const MAX_BYTES = 5 * 1024 * 1024
export const USAGE_FILE = 'usage.jsonl'

const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)

/** 命中率：命中缓存的输入占全部输入的比例；没有输入返回 null。 */
export function hitRate(u: TokenUsage): number | null {
  const total = n(u.inputTokens) + n(u.cacheReadTokens) + n(u.cacheWriteTokens)
  return total > 0 ? n(u.cacheReadTokens) / total : null
}

export function createUsageLog(o: { dir: string; log: Logger; now?: () => number }) {
  const now = o.now ?? Date.now
  const file = join(o.dir, USAGE_FILE)
  /** 一条一条按顺序写，免得两次写入交错、换文件时撞上。 */
  let chain: Promise<void> = Promise.resolve()

  async function write(line: string): Promise<void> {
    try {
      const size = await stat(file).then((s) => s.size, () => 0)
      if (size > MAX_BYTES) await rename(file, `${file}.1`)
      await appendFile(file, line, 'utf8')
    } catch (error) {
      o.log.warn('用量记不下来：', (error as Error)?.message ?? error)
    }
  }

  return {
    file,
    record(e: UsageEntry): void {
      const u = e.usage ?? {}
      const rate = hitRate(u)
      const row = {
        at: new Date(now()).toISOString(),
        kind: e.kind,
        student: e.student,
        model: e.model,
        input: n(u.inputTokens),
        cacheRead: n(u.cacheReadTokens),
        cacheWrite: n(u.cacheWriteTokens),
        output: n(u.outputTokens),
        ...(u.reasoningTokens !== undefined ? { reasoning: n(u.reasoningTokens) } : {}),
        hitRate: rate === null ? null : Math.round(rate * 1000) / 1000,
      }
      o.log.info(
        `用量 ${row.kind} ${row.model || '（模型不明）'}：输入 ${row.input}，缓存命中 ${row.cacheRead}，写入缓存 ${row.cacheWrite}，输出 ${row.output}，命中率 ${rate === null ? '-' : `${Math.round(rate * 100)}%`}`,
      )
      const line = `${JSON.stringify(row)}\n`
      chain = chain.then(() => write(line))
    },
    /** 等写完（测试用）。 */
    flush: () => chain,
  }
}

export type UsageLog = ReturnType<typeof createUsageLog>
