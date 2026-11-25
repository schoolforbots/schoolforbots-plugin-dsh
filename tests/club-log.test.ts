// 斗地主社的对局记录：一局一行，补上这一局的模型用量；/school club log 看最近几局。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clubLogRow, newGameStats, renderLogRow, type ClubLogRow } from '../src/core/club-log.js'
import { gameRecord } from '../src/core/doudizhu.js'
import { createClubLog, CLUB_LOG_FILE } from '../src/dsh/club-log.js'
import { ME, P52, P61, result } from './club-fixtures.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const student = { aiId: 'ai-1', studentId: 7, displayName: '阿杰家的小鱼', aiName: '小鱼' }

function row(o: { gameId?: number; aiId?: string } = {}): ClubLogRow {
  const r = result({ gameId: o.gameId ?? 1024, doublings: [{ kind: 'bomb', seat: 2 }] as never, multiplier: 2 })
  const g = gameRecord(r, 2, [P52, P61, ME], '2026-12-01', 1_300_000)
  return clubLogRow({ ...student, aiId: o.aiId ?? student.aiId }, g, {
    ...newGameStats('r7k2q', 1_000_000),
    bid: 0,
    turns: 9,
    timeouts: 1,
    asks: 8,
    seat: 2,
    seats: [P52, P61, ME],
    endedAt: 1_300_000,
  })
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-clublog-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the game record row', () => {
  it('keeps the result, the table and its own play, but no cards', () => {
    const r = row()
    expect(r).toMatchObject({ student: 'ai-1', studentId: 7, name: '阿杰家的小鱼', gameId: 1024, roomId: 'r7k2q', seat: 2, role: 'farmer', bid: 0, won: false, durationSec: 300, turns: 9, timeouts: 1, asks: 8 })
    expect(r.mates).toEqual([
      { studentId: P52.studentId, name: P52.displayName, bot: P52.bot },
      { studentId: P61.studentId, name: P61.displayName, bot: P61.bot },
    ])
    expect(r.highlights).toEqual(['它打了炸弹'])
    expect(r.summary).toContain('第 1024 局：它当农民')
    expect(JSON.stringify(r)).not.toMatch(/hands|bottom|cards/)
  })
})

describe('club-games.jsonl', () => {
  it('adds the model calls since the last game to the row, then starts counting again', async () => {
    const cl = createClubLog({ dir, log })
    cl.count('ai-1', { model: 'p/a', usage: { inputTokens: 100, cacheReadTokens: 300, outputTokens: 5 } })
    cl.count('ai-1', { model: 'p/default', usage: { inputTokens: 100, cacheWriteTokens: 100, outputTokens: 7, reasoningTokens: 3 }, fallback: true })
    cl.count('ai-1', { model: 'p/a', usage: null })
    cl.count('ai-2', { model: 'p/b', usage: { inputTokens: 1 } })
    cl.append(row())
    cl.append(row({ gameId: 1025 }))
    await cl.flush()
    const lines = readFileSync(join(dir, CLUB_LOG_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ gameId: 1024, models: ['p/a', 'p/default'], usage: { calls: 3, input: 200, cacheRead: 300, cacheWrite: 100, output: 12, reasoning: 3, hitRate: 0.5, modelFallbacks: 1 } })
    expect(Object.keys(lines[0]).at(-1)).toBe('summary')
    expect(lines[1]).toMatchObject({ gameId: 1025, models: [], usage: { calls: 0, input: 0, hitRate: null, modelFallbacks: 0 } })
    expect(lines[1].usage.reasoning).toBeUndefined()
  })

  it("gives one student's latest games, oldest first, reaching into the older file and skipping broken lines", async () => {
    const cl = createClubLog({ dir, log })
    writeFileSync(join(dir, `${CLUB_LOG_FILE}.1`), `${JSON.stringify(row({ gameId: 1 }))}\n{"broken\n`)
    cl.append(row({ gameId: 2 }))
    cl.append(row({ gameId: 3, aiId: 'ai-2' }))
    cl.append(row({ gameId: 4 }))
    expect((await cl.recent('ai-1', 2)).map((r) => r.gameId)).toEqual([2, 4])
    expect((await cl.recent('ai-1', 5)).map((r) => r.gameId)).toEqual([1, 2, 4])
    expect(await cl.recent('ai-3', 5)).toEqual([])
  })
})

describe('/school club log text', () => {
  it('says how it bid and played, its slips and what the game cost', () => {
    const r = { ...row(), usage: { calls: 12, input: 1000, cacheRead: 3000, cacheWrite: 0, output: 80, hitRate: 0.75, modelFallbacks: 0 } }
    const text = renderLogRow(r)
    expect(text).toContain('第 1024 局：它当农民')
    expect(text).toContain('叫分 不叫；出了 9 步；用时 5 分钟；超时 1 步；调用模型 12 次，输入 4000 token，缓存命中 75%，输出 80 token')
    expect(renderLogRow({ ...row(), durationSec: null, timeouts: 0 })).not.toMatch(/用时|超时|调用模型/)
  })
})
