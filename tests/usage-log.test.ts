// 用量和缓存命中的记录：上课每一步、社团每一步各记一条，写进 usage.jsonl。
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAsker } from '../src/dsh/asker.js'
import { createBrain } from '../src/dsh/brain.js'
import type { DshContext } from '../src/dsh/host.js'
import { createUsageLog, hitRate, USAGE_FILE } from '../src/dsh/usage-log.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const rows = (dir: string) => readFileSync(join(dir, USAGE_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-usage-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the usage log', () => {
  it('works out the cache hit rate over all the input', () => {
    expect(hitRate({ inputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 200 })).toBe(0.6)
    expect(hitRate({ outputTokens: 5 })).toBeNull()
  })

  it('writes one JSON line a call, and starts a new file when it gets big', async () => {
    const lines: string[] = []
    const u = createUsageLog({ dir, log: { ...log, info: (m: unknown) => void lines.push(String(m)) }, now: () => Date.parse('2026-12-01T12:00:00Z') })
    u.record({ kind: 'club-turn', student: 'ai1', model: 'deepseek/flash', usage: { inputTokens: 100, cacheReadTokens: 300, outputTokens: 2 } })
    await u.flush()
    expect(rows(dir)).toEqual([{ at: '2026-12-01T12:00:00.000Z', kind: 'club-turn', student: 'ai1', model: 'deepseek/flash', input: 100, cacheRead: 300, cacheWrite: 0, output: 2, hitRate: 0.75 }])
    expect(lines[0]).toBe('用量 club-turn deepseek/flash：输入 100，缓存命中 300，写入缓存 0，输出 2，命中率 75%')

    writeFileSync(join(dir, USAGE_FILE), 'x'.repeat(5 * 1024 * 1024 + 1))
    u.record({ kind: 'class', student: 'ai1', model: '', usage: { inputTokens: 1 } })
    await u.flush()
    expect(statSync(join(dir, `${USAGE_FILE}.1`)).size).toBeGreaterThan(5 * 1024 * 1024)
    expect(rows(dir)).toHaveLength(1)
  })
})

describe('recording usage', () => {
  it('records each club call with the usage the stream reports', async () => {
    const ctx = {
      llm: {
        stream: () =>
          (async function* () {
            yield { type: 'text-delta', index: 0, text: '1' }
            yield { type: 'usage', usage: { inputTokens: 50, cacheReadTokens: 450, outputTokens: 1 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })(),
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'flash' }) },
    } as unknown as DshContext
    const usage = createUsageLog({ dir, log })
    const asker = createAsker({ ctx, log, usage, models: () => [] })
    await asker.ask({ system: '', prompt: '', deadline: Date.now() + 5_000, purpose: 'react' }, 'ai1')
    await usage.flush()
    expect(rows(dir)[0]).toMatchObject({ kind: 'club-react', student: 'ai1', model: 'deepseek/flash', input: 50, cacheRead: 450, hitRate: 0.9 })
  })

  it('records each class step with the usage on the assistant message', async () => {
    const dsh: FakeDsh = createFakeDsh()
    dsh.usage = { inputTokens: 10, cacheReadTokens: 90, outputTokens: 3 }
    const usage = createUsageLog({ dir, log })
    const brain = createBrain({ ctx: dsh.ctx, log, roomDir: join(dir, 'room'), preset: 'schoolforbots', classModel: () => '', usage })
    dsh.ctx.on('session/event', (s: never, e: never) => brain.onSessionEvent(s, e))
    brain.attach(dsh.ctx)
    await brain.think('ai1', 't', { purpose: 'answer', text: '点名', deadline: Date.now() + 5_000 })
    await usage.flush()
    expect(rows(dir)[0]).toMatchObject({ kind: 'class', student: 'ai1', input: 10, cacheRead: 90, output: 3, hitRate: 0.9 })
    await dsh.dispose()
  })
})
