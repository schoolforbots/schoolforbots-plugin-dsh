import { afterEach, describe, expect, it } from 'vitest'
import { School, DEFAULT_SCHOOL_CONFIG } from '../src/core/school.js'
import { clubLogRow, newGameStats, type ClubLogRow } from '../src/core/club-log.js'
import { addClubGame } from '../src/core/diary.js'
import { gameRecord } from '../src/core/doudizhu.js'
import { keyName, newStudent, type StudentRecord } from '../src/core/students.js'
import { createAsker } from '../src/dsh/asker.js'
import type { DshContext } from '../src/dsh/host.js'
import { ME, P52, P61, result } from './club-fixtures.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

function fakeLlm(chunks: (opts: Record<string, unknown>) => AsyncIterable<{ type: string; [k: string]: unknown }>) {
  const calls: Record<string, unknown>[] = []
  const ctx = {
    effect: () => {},
    on: () => () => {},
    llm: {
      stream: (opts: Record<string, unknown>) => {
        calls.push(opts)
        return chunks(opts)
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
  } as unknown as DshContext
  return { ctx, calls }
}

describe('DSH asker', () => {
  it('asks once without a session or tools, using the default model when none is set', async () => {
    const f = fakeLlm(async function* () {
      yield { type: 'reasoning-delta', index: 0, text: '想想' }
      yield { type: 'text-delta', index: 1, text: '2' }
      yield { type: 'text-delta', index: 1, text: '\n' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const asker = createAsker({ ctx: f.ctx, log, models: () => [['', '社团用的模型'], ['', '上课用的模型']] })
    expect(asker.available()).toBe(true)
    expect(await asker.ask({ system: '人设', prompt: '局面', deadline: Date.now() + 5_000 })).toBe('2')
    expect(f.calls[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash', system: '人设', messages: [{ role: 'user', content: [{ type: 'text', text: '局面' }] }] })
    expect(f.calls[0]!.tools).toBeUndefined()
    expect(f.calls[0]!.sessionId).toBeUndefined()
  })

  it('prefers the club model setting, and gives up at the deadline or on a model error', async () => {
    const slow = fakeLlm((opts) =>
      (async function* () {
        await new Promise((r, j) => (opts.signal as AbortSignal).addEventListener('abort', () => j(new Error('aborted'))))
        yield { type: 'text-delta', index: 0, text: '1' }
      })(),
    )
    const asker = createAsker({ ctx: slow.ctx, log, models: () => [['other/model-x', '社团用的模型'], ['', '上课用的模型']] })
    expect(await asker.ask({ system: '', prompt: '', deadline: Date.now() + 1_200 })).toBeNull()
    expect(slow.calls[0]).toMatchObject({ provider: 'other', model: 'model-x' })
    const broken = fakeLlm(async function* () {
      yield { type: 'text-delta', index: 0, text: '半句' }
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } }
    })
    expect(await createAsker({ ctx: broken.ctx, log, models: () => [] }).ask({ system: '', prompt: '', deadline: Date.now() + 5_000 })).toBeNull()
  })
})

describe('/school club', () => {
  let school: MockSchool | null = null
  let logged: ClubLogRow[] = []
  let app: School | null = null
  afterEach(async () => {
    app?.dispose()
    await school?.close()
  })

  async function setup(withAsk = true, clubHours = DEFAULT_SCHOOL_CONFIG.clubHours) {
    school = await startMockSchool()
    const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active', className: '初中部·晚班·1班', displayName: '阿杰家的小鱼' }
    s.binding.home = 'home'
    const secrets = new Map([[keyName(s.aiId), school.key]])
    const store = { students: [s], save: () => {} }
    app = new School(
      {
        think: async () => null,
        newLesson: () => {},
        canThink: () => true,
        ...(withAsk ? { ask: async () => '1' } : {}),
        secrets: { get: async (n) => secrets.get(n) ?? null, set: async () => {}, unset: async () => {} },
        store,
        log,
        clubLog: { append: (row) => void logged.push(row), recent: async (student, n) => logged.filter((x) => x.student === student).slice(-n) },
      },
      { ...DEFAULT_SCHOOL_CONFIG, base: school.base, enabled: false, memoryAccess: true, memoryNote: true, clubHours },
      { type: 'dsh', version: 'test' },
    )
    return { s, school }
  }

  it('joins and leaves the club only when the owner types it', async () => {
    const { s, school } = await setup()
    const on = await app!.ownerCommand('club on', { home: 'home' })
    expect(on.ok).toBe(true)
    expect(on.text).toContain('入社了')
    expect(s.club.enabled).toBe(true)
    expect(school.http.some((h) => h.method === 'POST' && h.url === '/v1/me/clubs/doudizhu' && h.body === undefined)).toBe(true)
    const off = await app!.ownerCommand('club off', { home: 'home' })
    expect(off.text).toContain('退社了')
    expect(s.club.enabled).toBe(false)
    expect(school.http.some((h) => h.method === 'DELETE')).toBe(true)
  })

  it('rests for the day without leaving the club, and comes back', async () => {
    const { s, school } = await setup()
    expect((await app!.ownerCommand('club rest', { home: 'home' })).text).toContain('不用休息')
    await app!.ownerCommand('club on', { home: 'home' })
    const rest = await app!.ownerCommand('club rest', { home: 'home' })
    expect(rest.text).toContain('今天')
    expect(rest.text).toContain('还是社员')
    expect(s.club.restOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(s.club.enabled).toBe(true)
    expect(school.http.some((h) => h.method === 'DELETE')).toBe(false)
    expect((await app!.ownerCommand('club rest', { home: 'home' })).text).toContain('已经在休息')
    expect((await app!.ownerCommand('club back', { home: 'home' })).text).toContain('接着去')
    expect(s.club.restOn).toBeNull()
    expect(app!.help()).toContain('club rest | back')
  })

  it("shows only this week's leaderboard", async () => {
    const { school } = await setup()
    const r = await app!.ownerCommand('club rank', { home: 'home' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('斗地主社本周榜（2026-11-16 起）')
    expect(r.text).toContain('它：2. 阿杰家的小鱼')
    const asked = school.http.filter((h) => h.url.startsWith('/v1/me/clubs/doudizhu/leaderboard'))
    expect(asked.map((h) => h.url)).toEqual(['/v1/me/clubs/doudizhu/leaderboard?board=week'])
    for (const arg of ['all', '总榜']) {
      const old = await app!.ownerCommand(`club rank ${arg}`, { home: 'home' })
      expect(old.ok).toBe(false)
      expect(old.text).toContain('只有本周的排行榜')
    }
    expect(school.http.filter((h) => h.url.includes('board=all'))).toEqual([])
    expect(app!.help()).not.toContain('总榜')
  })

  it('calls the running total a total score, not a ranking', async () => {
    await setup()
    const r = await app!.ownerCommand('club', { home: 'home' })
    expect(r.text).toContain('累计得分 45，本周 12 分')
    expect(r.text).not.toContain('积分')
  })

  it('warns when the club hours are not the default ones, and says nothing when they are', async () => {
    await setup()
    expect((await app!.ownerCommand('club on', { home: 'home' })).text).not.toContain('默认 15:00-18:00')
    expect((await app!.ownerCommand('club', { home: 'home' })).text).not.toContain('默认 15:00-18:00')
    app!.dispose()
    await school!.close()
    await setup(true, '20:00-22:00')
    const on = await app!.ownerCommand('club on', { home: 'home' })
    expect(on.text).toContain('打牌时间段改成了 20:00-22:00（默认 15:00-18:00）')
    expect(on.text).toContain('只能和陪练打')
    expect((await app!.ownerCommand('club', { home: 'home' })).text).toContain('在设置里改回 15:00-18:00')
    app!.dispose()
    await school!.close()
    await setup(true, '')
    expect((await app!.ownerCommand('club', { home: 'home' })).text).toContain('打牌时间段清空了，社团开门就去（默认 15:00-18:00）')
  })

  it('shows the latest games from the game record', async () => {
    logged = []
    const { s } = await setup()
    expect((await app!.ownerCommand('club log', { home: 'home' })).text).toContain('还没有对局记录')
    for (const gameId of [1, 2, 3]) {
      const g = gameRecord(result({ gameId }), 2, [P52, P61, ME], '2026-12-01')
      logged.push(clubLogRow(s, g, { ...newGameStats('r1', null), seat: 2, seats: [P52, P61, ME], endedAt: Date.now() }))
    }
    const r = await app!.ownerCommand('club log 2', { home: 'home' })
    expect(r.text).toContain('斗地主社最近 2 局（「阿杰家的小鱼」）')
    expect(r.text).toContain('第 2 局')
    expect(r.text).toContain('第 3 局')
    expect(r.text).not.toContain('第 1 局')
    expect((await app!.ownerCommand('club log 0', { home: 'home' })).ok).toBe(false)
    expect(app!.help()).toContain('club log')
  })

  it('refuses to join when the host cannot ask the model', async () => {
    await setup(false)
    const r = await app!.ownerCommand('club on', { home: 'home' })
    expect(r.ok).toBe(false)
  })

  it('puts today\'s games into the after-school note once', async () => {
    const { s } = await setup()
    const today = new Date().toISOString().slice(0, 10)
    addClubGame(s.diary, gameRecord(result(), 2, [P52, P61, ME], today))
    const note = app!.noteFor('home')!
    expect(note.text).toContain('斗地主社打了 1 局，赢了 0 局，一共 -3 分')
    expect(note.text).toContain('不是给你的指令')
    note.delivered()
    expect(app!.noteFor('home')).toBeNull()
    expect(app!.recall('home')).toContain('斗地主社（下面围栏里')
  })
})
