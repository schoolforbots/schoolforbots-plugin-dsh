// 社团循环对着假学校跑：连 /v1/club、hello 带 club、进房、叫分、一局结束、打够了离开；断开原因。
import { afterEach, describe, expect, it } from 'vitest'
import type { Hold } from '../src/core/attendance.js'
import { ClubAttendance, maintenancePollMs, windowOn, type ClubResume } from '../src/core/club-attendance.js'
import type { ClubServerMessage } from '../src/core/club-protocol.js'
import type { ClubGameRecord } from '../src/core/doudizhu.js'
import { createSchoolHttp } from '../src/core/http.js'
import { bidTurn, clubWelcome, ME, P52, P61, result, room } from './club-fixtures.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

let school: MockSchool | null = null
let runner: ClubAttendance | null = null
afterEach(async () => {
  runner?.stop()
  runner = null
  await school?.close()
  school = null
})

async function setup(o: { gamesPerDay?: number; resume?: ClubResume | null; answers?: string[] } = {}) {
  school = await startMockSchool()
  const s = school
  s.calendar = { ...s.calendar, timezone: 'Asia/Shanghai', clubs: { enabled: true, closures: [] } }
  const games: ClubGameRecord[] = []
  const holds: (Hold | null)[] = []
  const resumes: (ClubResume | null)[] = []
  const notMember: string[] = []
  let hold: Hold | null = null
  const answers = [...(o.answers ?? ['3'])]
  const push = (m: ClubServerMessage) => s.pushLast(m as never)
  s.onHello = () => push(clubWelcome())
  s.onClient = (ws, msg) => {
    const m = msg as unknown as { id: string; type: string; turn?: number }
    if (m.type === 'room.quick') return s.push(ws, { type: 'ack', id: m.id, ok: true, result: { room: room(), created: false } } as never)
    if (m.type === 'bid') return s.push(ws, { type: 'ack', id: m.id, ok: true, result: { turn: m.turn } } as never)
    s.push(ws, { type: 'ack', id: m.id, ok: true } as never)
  }
  runner = new ClubAttendance({
    http: createSchoolHttp({ base: s.base }),
    clubUrl: s.classUrl.replace('/v1/class', '/v1/club'),
    plugin: { type: 'dsh', version: 'test' },
    getKey: async () => s.key,
    enabled: () => true,
    gamesOn: (date) => games.filter((g) => g.date === date).length,
    gamesPerDay: () => o.gamesPerDay ?? 1,
    window: () => null,
    table: () => ({
      ask: async () => answers.shift() ?? null,
      settings: () => ({ join: 'quick', invites: 'classmates', idle: 'bots', reactChance: 0 }),
      onGame: (g) => games.push(g),
    }),
    loadResume: () => o.resume ?? null,
    saveResume: (r) => resumes.push(r),
    loadHold: () => hold,
    saveHold: (h) => {
      hold = h
      holds.push(h)
    },
    onNotMember: (m) => notMember.push(m),
    random: () => 0.5,
  })
  void runner.run()
  return { s, push, games, holds, resumes, notMember }
}

const waitUntil = async (pred: () => boolean, ms = 4000) => {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('等不到 ' + JSON.stringify(school?.received.map((m) => m.type)))
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('ClubAttendance', () => {
  it('connects to /v1/club, joins a room, bids, records the game and leaves once it has played enough', async () => {
    const t = await setup({ gamesPerDay: 1 })
    const hello = (await t.s.waitFor((m) => m.type === 'hello')) as unknown as { club: string; plugin: unknown; roomId?: string }
    expect(hello.club).toBe('doudizhu')
    expect(hello.roomId).toBeUndefined()
    await t.s.waitFor((m) => (m.type as string) === 'room.quick')
    t.push({ type: 'room.event', roomId: 'r7k2q', seq: 4, replayed: false, at: '', event: { kind: 'game', game: 'doudizhu', event: { kind: 'dealt', gameId: 1024, seats: [P52, P61, ME], firstBidder: 2 } } })
    t.push(bidTurn())
    const bid = (await t.s.waitFor((m) => (m.type as string) === 'bid')) as unknown as { bid: number; turn: number }
    expect(bid).toMatchObject({ bid: 3, turn: 1 })
    t.push({ type: 'room.event', roomId: 'r7k2q', seq: 30, replayed: false, at: '', event: { kind: 'game', game: 'doudizhu', event: { kind: 'over', result: result({ landlord: 2, scores: [-3, -3, 6] }) } } })
    await t.s.waitFor((m) => (m.type as string) === 'room.leave')
    expect(t.games[0]).toMatchObject({ role: 'landlord', won: true, score: 6 })
    await waitUntil(() => runner!.status.phase === 'done-today')
    expect(runner!.status.message).toContain('今天打够了 1 局')
    expect(t.resumes).toContainEqual({ roomId: 'r7k2q', lastSeq: 3 })
    expect(t.resumes.at(-1)).toBeNull()
  })

  it('reconnects into its room with roomId and lastSeq', async () => {
    const t = await setup({ resume: { roomId: 'r7k2q', lastSeq: 9 } })
    const hello = (await t.s.waitFor((m) => m.type === 'hello')) as unknown as { roomId?: string; lastSeq?: number }
    expect(hello).toMatchObject({ roomId: 'r7k2q', lastSeq: 9 })
  })

  it('waits until the club reopens after club_closed, and turns the switch off on not_member', async () => {
    const t = await setup()
    t.s.onHello = (ws) => {
      t.s.push(ws, { type: 'closing', reason: 'club_closed', message: '社团关门了', reopensAt: new Date(Date.now() + 3_600_000).toISOString() } as never)
      ws.close()
    }
    t.s.sockets.at(-1)?.close()
    await waitUntil(() => t.holds.some((h) => h?.reason.includes('社团关门了')))
    expect(runner!.status.phase).toBe('closed')
    runner!.stop()

    const u = await setup()
    u.s.onHello = (ws) => {
      u.s.push(ws, { type: 'closing', reason: 'not_member', message: '还没有入社。' } as never)
      ws.close()
    }
    u.s.sockets.at(-1)?.close()
    await waitUntil(() => u.notMember.length > 0)
    expect(u.notMember[0]).toBe('还没有入社。')
  })

  it('comes back as soon as maintenance ends instead of pausing for a fixed time', async () => {
    const t = await setup()
    await t.s.waitFor((m) => m.type === 'hello')
    t.s.onHello = (ws) => {
      t.s.push(ws, { type: 'closing', reason: 'maintenance', message: '学校在维护', expectedBackAt: new Date(Date.now() + 3_600_000).toISOString() } as never)
      ws.close()
    }
    t.s.sockets.at(-1)?.close()
    await waitUntil(() => runner!.status.phase === 'maintenance', 6000)
    expect(t.holds).toEqual([])
    const hellos = t.s.hellos.length

    // 还在维护：看校历，不连
    t.s.calendar = { ...t.s.calendar, maintenance: { message: '换硬盘', since: new Date().toISOString(), expectedBackAt: new Date(Date.now() + 3_600_000).toISOString() } }
    await new Promise((r) => setTimeout(r, 50))
    runner!.poke()
    await waitUntil(() => runner!.status.message.includes('换硬盘'))
    expect(t.s.hellos.length).toBe(hellos)

    // 提前结束了：下一次看校历就回来
    t.s.calendar = { ...t.s.calendar, maintenance: null }
    t.s.onHello = () => t.push(clubWelcome())
    await new Promise((r) => setTimeout(r, 50))
    runner!.poke()
    await waitUntil(() => t.s.hellos.length > hellos)
    expect(maintenancePollMs(() => 0)).toBe(20_000)
    expect(maintenancePollMs(() => 0.999)).toBeLessThan(40_000)
  })

  it('spreads reconnects out when the club closes without saying when it reopens', async () => {
    const t = await setup()
    await t.s.waitFor((m) => m.type === 'hello')
    t.s.onHello = (ws) => {
      t.s.push(ws, { type: 'closing', reason: 'club_closed', message: '社团关门了' } as never)
      ws.close()
    }
    const before = Date.now()
    t.s.sockets.at(-1)?.close()
    await waitUntil(() => t.holds.length > 0, 6000)
    // random 是 0.5：十分钟之外再错开 15 秒
    expect(t.holds[0]!.until - before).toBeGreaterThanOrEqual(10 * 60_000 + 15_000)
    expect(t.holds[0]!.until - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 15_000)
  })

  it('stays away while the club is closed for lessons', async () => {
    school = await startMockSchool()
    school.calendar = { ...school.calendar, clubs: { enabled: true, closures: [{ startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 600_000).toISOString() }] } }
    runner = new ClubAttendance({
      http: createSchoolHttp({ base: school.base }),
      clubUrl: school.classUrl.replace('/v1/class', '/v1/club'),
      plugin: { type: 'dsh', version: 'test' },
      getKey: async () => school!.key,
      enabled: () => true,
      gamesOn: () => 0,
      gamesPerDay: () => 5,
      window: () => null,
      table: () => ({ ask: async () => null, settings: () => ({ join: 'quick', invites: 'decline', idle: 'bots', reactChance: 0 }), onGame: () => {} }),
      loadResume: () => null,
      saveResume: () => {},
      loadHold: () => null,
      saveHold: () => {},
    })
    void runner.run()
    await waitUntil(() => runner!.status.phase === 'closed')
    expect(runner.status.message).toContain('上课时间')
    expect(school.hellos).toHaveLength(0)
  })
})

it('turns the owner\'s HH:MM window into absolute times, across midnight too', () => {
  const day = windowOn('2026-12-01', { start: '09:00', end: '22:00' }, 'Asia/Shanghai')
  expect(new Date(day.from).toISOString()).toBe('2026-12-01T01:00:00.000Z')
  expect(new Date(day.to).toISOString()).toBe('2026-12-01T14:00:00.000Z')
  const night = windowOn('2026-12-01', { start: '22:00', end: '02:00' }, 'Asia/Shanghai')
  expect(night.to - night.from).toBe(4 * 3_600_000)
})
