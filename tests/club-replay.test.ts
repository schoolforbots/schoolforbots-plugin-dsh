// 斗地主对局回放：记录 → 一步一步的牌桌；本地网页；/school club replay。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildClubReplay } from '../src/core/club-replay.js'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { newStudent, type StudentRecord } from '../src/core/students.js'
import { createReplayViewer } from '../src/dsh/replay-viewer.js'
import { sampleGame } from './club-game-sample.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

describe('building a game replay', () => {
  it('shows all three hands from the school\'s record, and keeps the table right step by step', () => {
    const rows = sampleGame()
    const r = buildClubReplay(rows)
    expect(r).toMatchObject({ gameId: 1024, me: 2, godView: true })
    expect(r.seats.map((s) => [s.name, s.self])).toEqual([['小美家的阿花', false], ['陪练小黑（陪练）', false], ['阿杰家的小鱼', true]])
    expect(r.title).toMatch(/^斗地主 · 第 1024 局 · 阿杰家的小鱼当地主 · (赢|输)了$/)
    const deal = r.steps[0]!
    expect(deal.kind).toBe('deal')
    expect(deal.snap.hands.map((h) => h!.length)).toEqual([17, 17, 17])
    const kinds = r.steps.map((s) => s.kind)
    expect(kinds.slice(0, 6)).toEqual(['deal', 'bid', 'bid', 'bid', 'landlord', 'react'])
    const landlord = r.steps[4]!
    expect(landlord.snap.landlord).toBe(2)
    expect(landlord.snap.hands[2]).toHaveLength(20)
    expect(landlord.cards).toHaveLength(3)
    // 每一步出牌之后，那一家手里的牌少了出的那几张，张数和学校说的一样
    for (const s of r.steps.filter((x) => x.kind === 'play')) {
      expect(s.snap.hands[s.seat!]).toHaveLength(s.snap.counts[s.seat!]!)
      expect(s.snap.table[s.seat!]).toMatchObject({ kind: 'play' })
    }
    expect(kinds).toContain('trustee')
    expect(kinds).toContain('pass')
    const over = r.steps.at(-1)!
    expect(over.kind).toBe('over')
    expect(over.scores).toHaveLength(3)
    expect(over.snap.hands.some((h) => h!.length === 0)).toBe(true)
  })

  it('marks who acted for whom and whom a reaction was for', () => {
    const r = buildClubReplay(sampleGame())
    expect(r.steps.find((s) => s.kind === 'bid' && s.seat === 1)!.auto).toBe('陪练')
    const react = r.steps.find((s) => s.kind === 'react')!
    expect(react).toMatchObject({ seat: 0, to: 2, text: '你的牌打得也太好了吧' })
  })

  it('clears the table when a new trick starts', () => {
    const r = buildClubReplay(sampleGame())
    // 找一步：出牌的人是上一轮最后出牌的人（另外两家都不要）
    const i = r.steps.findIndex((s, k) => k > 0 && s.kind === 'play' && r.steps[k - 1]!.kind === 'pass' && r.steps[k - 2]?.kind === 'pass')
    expect(i).toBeGreaterThan(0)
    const t = r.steps[i]!.snap.table
    expect(t.filter(Boolean)).toHaveLength(1)
  })

  it('knows only its own hand without the school\'s record, or for a deal before a redeal', () => {
    const blind = buildClubReplay(sampleGame({ noRecord: true }))
    expect(blind.godView).toBe(false)
    expect(blind.steps[0]!.snap.hands).toEqual([null, null, expect.any(Array)])
    const again = buildClubReplay(sampleGame({ redeal: true }))
    const redeal = again.steps.findIndex((s) => s.kind === 'redeal')
    expect(again.steps[redeal - 1]!.snap.hands[0]).toBeNull()
    expect(again.steps[redeal + 1]!.snap.hands[0]).toHaveLength(17)
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-club-replay-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function save(day: string, name: string, rows: unknown[]) {
  mkdirSync(join(dir, 'club-replays', day), { recursive: true })
  writeFileSync(join(dir, 'club-replays', day, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

describe('/school club replay', () => {
  it('lists a student\'s games newest first, opens one on 127.0.0.1, and checks the number', async () => {
    save('2026-12-01', '7-1024', sampleGame())
    await new Promise((r) => setTimeout(r, 20))
    save('2026-12-01', '7-1025', sampleGame({ gameId: 1025, seed: 7 }))
    save('2026-12-01', '8-1025', sampleGame({ gameId: 1025, studentId: 8 }))
    const opened: string[] = []
    const v = createReplayViewer({ dir, log, open: async (u) => (opened.push(u), true) })
    const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active' }
    s.binding.home = 'home'
    const app = new School(
      {
        think: async () => null,
        newLesson: () => {},
        canThink: () => true,
        secrets: { get: async () => null, set: async () => {}, unset: async () => {} },
        store: { students: [s], save: () => {} },
        log,
        clubReplay: { games: (id) => v.games(id), open: async (id, i) => { const g = (await v.games(id))[i]; return g ? v.openGame(g) : null } },
      },
      { ...DEFAULT_SCHOOL_CONFIG, enabled: false },
      { type: 'dsh', version: 'test' },
    )
    try {
      const run = (raw: string) => app.ownerCommand(raw, { home: 'home' })
      const list = await run('club replay list')
      expect(list.text).toMatch(/1\. 2026-12-01 第 1025 局 · (地主|农民) · (赢|输) · [+-]\d+/)
      expect(list.text).toContain('2. 2026-12-01 第 1024 局')
      const r = await run('club replay 2')
      expect(r.ok).toBe(true)
      expect(r.text).toContain('第 1024 局')
      expect(opened).toHaveLength(1)
      const html = await (await fetch(opened[0]!)).text()
      expect(html).toContain('斗地主回放')
      expect(html).toContain('id="replay-data"')
      expect((await run('club replay 3')).ok).toBe(false)
      // AI 的工具走同一条路
      expect(await app.agentCommand('home', { verb: 'replay', what: 'game', list: true })).toContain('第 1025 局')
    } finally {
      app.dispose()
      v.close()
    }
  })
})
