// 斗地主社的对局记录：每打完一局追加一行到插件目录的 club-games.jsonl（一行一个 JSON）。
// - 行的内容由核心给（src/core/club-log.ts），这里补上这一局的模型用量：社团每次调用模型（包括发表情）都先记在这个学生名下，
//   一局记完清零。所以一行的用量是"上一局记完到这一局打完"，两局之间的表情也算进下一局。
// - 超过 MAX_BYTES 换新文件，只留一个旧的（club-games.jsonl.1），和 usage.jsonl 一样。
// 不记手牌、每一步出的什么牌、模型的原话。
import { appendFile, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClubLogRow, ClubLogUsage } from '../core/club-log.js'
import type { Logger } from './host.js'
import { hitRate, type TokenUsage } from './usage-log.js'

const MAX_BYTES = 5 * 1024 * 1024
export const CLUB_LOG_FILE = 'club-games.jsonl'

const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)

interface Tally {
  calls: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
  hasReasoning: boolean
  modelFallbacks: number
  models: Set<string>
}

const emptyTally = (): Tally => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, hasReasoning: false, modelFallbacks: 0, models: new Set() })

export function createClubLog(o: { dir: string; log: Logger }) {
  const file = join(o.dir, CLUB_LOG_FILE)
  const tallies = new Map<string, Tally>()
  let chain: Promise<void> = Promise.resolve()

  async function write(line: string): Promise<void> {
    try {
      const size = await stat(file).then((s) => s.size, () => 0)
      if (size > MAX_BYTES) await rename(file, `${file}.1`)
      await appendFile(file, line, 'utf8')
    } catch (error) {
      o.log.warn('对局记录写不下来：', (error as Error)?.message ?? error)
    }
  }

  async function lines(path: string): Promise<ClubLogRow[]> {
    const text = await readFile(path, 'utf8').catch(() => '')
    const rows: ClubLogRow[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line) as ClubLogRow)
      } catch {
        // 写到一半的行：跳过
      }
    }
    return rows
  }

  return {
    file,
    /** 社团调用了一次模型（fallback：这是填的模型出错以后换默认模型再问的那次）。 */
    count(student: string, e: { model: string; usage: TokenUsage | null; fallback?: boolean }): void {
      const t = tallies.get(student) ?? emptyTally()
      tallies.set(student, t)
      t.calls++
      if (e.model) t.models.add(e.model)
      if (e.fallback) t.modelFallbacks++
      const u = e.usage
      if (!u) return
      t.input += n(u.inputTokens)
      t.cacheRead += n(u.cacheReadTokens)
      t.cacheWrite += n(u.cacheWriteTokens)
      t.output += n(u.outputTokens)
      if (u.reasoningTokens !== undefined) {
        t.hasReasoning = true
        t.reasoning += n(u.reasoningTokens)
      }
    },
    append(row: ClubLogRow): void {
      const t = tallies.get(row.student) ?? emptyTally()
      tallies.delete(row.student)
      const rate = hitRate({ inputTokens: t.input, cacheReadTokens: t.cacheRead, cacheWriteTokens: t.cacheWrite })
      const usage: ClubLogUsage = {
        calls: t.calls,
        input: t.input,
        cacheRead: t.cacheRead,
        cacheWrite: t.cacheWrite,
        output: t.output,
        ...(t.hasReasoning ? { reasoning: t.reasoning } : {}),
        hitRate: rate === null ? null : Math.round(rate * 1000) / 1000,
        modelFallbacks: t.modelFallbacks,
      }
      // summary 放最后：一行里先看数字，最后是给人看的一句话
      const { summary, ...rest } = row
      const line = `${JSON.stringify({ ...rest, models: [...t.models], usage, summary })}\n`
      chain = chain.then(() => write(line))
    },
    async recent(student: string, count: number): Promise<ClubLogRow[]> {
      await chain
      let rows = (await lines(file)).filter((r) => r.student === student)
      if (rows.length < count) rows = [...(await lines(`${file}.1`)).filter((r) => r.student === student), ...rows]
      return rows.slice(-count)
    },
    flush: () => chain,
  }
}

export type ClubLog = ReturnType<typeof createClubLog>
