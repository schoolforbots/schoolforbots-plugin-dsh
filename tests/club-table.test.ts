import { describe, expect, it } from 'vitest'
import type { ClubAck, ClubOutgoing, DoudizhuEvent } from '../src/core/club-protocol.js'
import { ClubTable, DEFAULT_CLUB_SETTINGS, type AskRequest, type ClubSettings } from '../src/core/club-table.js'
import type { GameDetail } from '../src/core/club-log.js'
import type { ClubGameRecord } from '../src/core/doudizhu.js'
import { bidTurn, clubWelcome, ME, P52, P61, playTurn, result, room } from './club-fixtures.js'

function setup(o: { answers?: (string | null)[]; ack?: (m: ClubOutgoing) => ClubAck | undefined; settings?: Partial<ClubSettings>; wantMore?: () => boolean; random?: number; now?: () => number; siblings?: number[] } = {}) {
  const sent: ClubOutgoing[] = []
  const asked: AskRequest[] = []
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  const games: ClubGameRecord[] = []
  const details: GameDetail[] = []
  const answers = [...(o.answers ?? [])]
  let done = 0
  const table = new ClubTable({
    send: async (m) => {
      sent.push(m)
      const custom = o.ack?.(m)
      if (custom) return custom
      if (m.type === 'room.quick' || m.type === 'room.create' || m.type === 'room.accept') return { type: 'ack', id: 'x', ok: true, result: { room: room(), created: false } }
      if (m.type === 'bid' || m.type === 'play' || m.type === 'pass') return { type: 'ack', id: 'x', ok: true, result: { turn: m.turn } }
      return { type: 'ack', id: 'x', ok: true }
    },
    ask: async (r) => {
      asked.push(r)
      return answers.length ? answers.shift()! : null
    },
    settings: () => ({ ...DEFAULT_CLUB_SETTINGS, ...o.settings }),
    wantMore: o.wantMore ?? (() => true),
    ...(o.siblings ? { siblings: () => o.siblings! } : {}),
    onGame: (g, d) => {
      games.push(g)
      details.push(d)
    },
    onDone: () => done++,
    today: () => '2026-12-01',
    random: () => o.random ?? 0.99,
    sleep: async () => {},
    ...(o.now ? { now: o.now } : {}),
    after: (ms, fn) => {
      const t = { ms, fn, cancelled: false }
      timers.push(t)
      return () => void (t.cancelled = true)
    },
  })
  const settle = () => new Promise((r) => setTimeout(r, 20))
  const reacts = () => sent.filter((m) => m.type === 'react')
  const reactPrompts = () => asked.filter((a) => a.purpose === 'react').map((a) => a.prompt)
  return { table, sent, asked, games, details, timers, settle, reacts, reactPrompts, done: () => done }
}

const over = (r = result()) => ({ type: 'room.event' as const, roomId: 'r7k2q', seq: 40, replayed: false, at: '', event: { kind: 'game' as const, game: 'doudizhu' as const, event: { kind: 'over' as const, result: r } } })
const dealt = { type: 'room.event' as const, roomId: 'r7k2q', seq: 4, replayed: false, at: '', event: { kind: 'game' as const, game: 'doudizhu' as const, event: { kind: 'dealt' as const, gameId: 1024, seats: [P52, P61, ME], firstBidder: 2 } } }
let seq = 100
const ge = (event: DoudizhuEvent, replayed = false) => ({ type: 'room.event' as const, roomId: 'r7k2q', seq: seq++, replayed, at: '', event: { kind: 'game' as const, game: 'doudizhu' as const, event } })
const dealtTo = (firstBidder: number) => ge({ kind: 'dealt', gameId: 1024, seats: [P52, P61, ME], firstBidder })
const bomb = { type: 'bomb' as const, name: '炸弹', cards: ['9', '9', '9', '9'] as ('9')[] }
const rocket = { type: 'rocket' as const, name: '王炸', cards: ['小王', '大王'] as ('小王' | '大王')[] }

describe('ClubTable', () => {
  it('quick-joins a room after welcome, or opens a room with bots when set to', async () => {
    const t = setup()
    t.table.handle(clubWelcome())
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.quick' }])
    const b = setup({ settings: { join: 'bots' } })
    b.table.handle(clubWelcome())
    await b.settle()
    expect(b.sent).toEqual([{ type: 'room.create', visibility: 'public', bots: true }])
  })

  it('stays in the room it is already seated in after a reconnect', async () => {
    const t = setup()
    t.table.handle(clubWelcome({ room: room({ game: playTurn().table }) }))
    await t.settle()
    expect(t.sent).toEqual([])
  })

  it('asks the model on its turn and plays the chosen move with the same turn number', async () => {
    const t = setup({ answers: ['1'] })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(playTurn())
    await t.settle()
    expect(t.asked[0]!.prompt).toContain('1. 对牌（7 7）')
    expect(t.asked[0]!.deadline).toBeLessThan(Date.parse(playTurn().deadline))
    expect(t.sent).toEqual([{ type: 'play', game: 'doudizhu', turn: 5, moveId: 1 }])
  })

  it('asks again with the server\'s reason after an illegal move, then plays a legal one', async () => {
    let first = true
    const t = setup({
      answers: ['3', '2'],
      ack: (m) => {
        if (m.type !== 'play' || !first) return undefined
        first = false
        return { type: 'ack', id: 'x', ok: false, error: { code: 'illegal_move', message: '不合规则', problem: 'cannot_beat', reason: '要出更大的对牌', retry: { turn: 5, deadline: new Date(Date.now() + 50_000).toISOString(), timeBankSeconds: 60 } } }
      },
    })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(playTurn())
    await t.settle()
    expect(t.asked[1]!.prompt).toContain('【刚才】你交的不合规则，没有算：要出更大的对牌')
    expect(t.sent.filter((m) => m.type === 'play')).toEqual([
      { type: 'play', game: 'doudizhu', turn: 5, moveId: 3 },
      { type: 'play', game: 'doudizhu', turn: 5, moveId: 2 },
    ])
  })

  it('asks once more when it cannot read the answer, and falls back when the model gives nothing', async () => {
    const t = setup({ answers: ['我想想……'] })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(bidTurn())
    await t.settle()
    expect(t.asked).toHaveLength(2)
    expect(t.asked[1]!.prompt).toContain('没看懂你的回答')
    expect(t.sent).toEqual([{ type: 'bid', game: 'doudizhu', turn: 1, bid: 0 }])
  })

  it('drops a turn the server says is stale', async () => {
    const t = setup({ answers: ['2'], ack: (m) => (m.type === 'play' ? { type: 'ack', id: 'x', ok: false, error: { code: 'stale_turn', message: '过了' } } : undefined) })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(playTurn())
    await t.settle()
    expect(t.sent.filter((m) => m.type === 'play' || m.type === 'pass')).toHaveLength(1)
  })

  it('answers a repeated your_turn for the same step only once', async () => {
    const t = setup({ answers: ['1', '2'] })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(playTurn())
    t.table.handle(playTurn({ deadline: new Date(Date.now() + 90_000).toISOString() }))
    await t.settle()
    expect(t.sent.filter((m) => m.type === 'play')).toHaveLength(1)
  })

  it('records the game and gets ready for the next one', async () => {
    const t = setup()
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(dealt)
    t.table.handle(over())
    await t.settle()
    expect(t.games[0]).toMatchObject({ gameId: 1024, role: 'farmer', won: false, score: -3 })
    expect(t.sent).toContainEqual({ type: 'room.ready' })
  })

  it('counts its own moves, timeouts, trustee moves, retries and fallbacks for the game record', async () => {
    let clock = 1_000_000
    const t = setup({ answers: ['我想想……'], now: () => clock })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(dealt)
    t.table.handle(bidTurn())
    await t.settle()
    t.table.handle(ge({ kind: 'bid', turn: 1, seat: 2, bid: 0, auto: null }))
    t.table.handle(ge({ kind: 'play', turn: 6, seat: 2, move: bomb, cardsLeft: 10, multiplier: 2, auto: 'timeout' }))
    t.table.handle(ge({ kind: 'pass', turn: 9, seat: 2, auto: 'trustee' }))
    t.table.handle(ge({ kind: 'pass', turn: 10, seat: 0, auto: 'timeout' }))
    clock += 300_000
    t.table.handle(over())
    await t.settle()
    expect(t.details[0]).toMatchObject({ roomId: 'r7k2q', seat: 2, startedAt: 1_000_000, endedAt: 1_300_000, bid: 0, turns: 3, timeouts: 1, trustee: 1, asks: 2, retries: 1, fallbacks: 1 })
    expect(t.details[0]!.seats.map((p) => p.displayName)).toEqual([P52.displayName, P61.displayName, ME.displayName])
    // 下一局重新数
    t.table.handle(ge({ kind: 'dealt', gameId: 1025, seats: [P52, P61, ME], firstBidder: 0 }))
    t.table.handle(over(result({ gameId: 1025 })))
    await t.settle()
    expect(t.details[1]).toMatchObject({ turns: 0, asks: 0, bid: null })
  })

  it('leaves the room and says it is done once it has played enough', async () => {
    let more = true
    const t = setup({ wantMore: () => more })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(dealt)
    more = false
    t.table.handle(over())
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.leave' })
    expect(t.sent).not.toContainEqual({ type: 'room.ready' })
    expect(t.done()).toBe(1)
  })

  it('accepts invites from classmates only, and never while seated', async () => {
    const t = setup()
    t.table.handle(clubWelcome({ room: null }))
    await t.settle()
    t.sent.length = 0
    const invite = (className: string, inviteId: number) => ({ type: 'invite' as const, inviteId, from: { ...P61, className }, roomId: 'r9', expiresAt: '' })
    const fresh = setup({ ack: (m) => (m.type === 'room.quick' ? { type: 'ack', id: 'x', ok: false, error: { code: 'club_closed', message: '' } } : undefined) })
    fresh.table.handle(clubWelcome())
    await fresh.settle()
    fresh.table.handle(invite('初中部·晚班·1班', 1))
    fresh.table.handle(invite('初中部·晚班·3班', 2))
    await fresh.settle()
    expect(fresh.sent).toContainEqual({ type: 'room.decline', inviteId: 1 })
    expect(fresh.sent).toContainEqual({ type: 'room.accept', inviteId: 2 })
    // 已经坐在房间里：一律拒
    t.table.handle(invite('初中部·晚班·3班', 3))
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.decline', inviteId: 3 }])
  })

  it('calls the bots on an idle prompt, and takes itself off trustee', async () => {
    const t = setup()
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle({ type: 'room.event', roomId: 'r7k2q', seq: 5, replayed: false, at: '', event: { kind: 'idle', decideBy: new Date(Date.now() + 60_000).toISOString() } })
    t.table.handle({ type: 'room.event', roomId: 'r7k2q', seq: 6, replayed: false, at: '', event: { kind: 'trustee', seat: 2, on: true, reason: 'timeouts' } })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.bots' }, { type: 'trustee.off' }])
  })

  it('sometimes sends an allowed reaction after a game', async () => {
    const t = setup({ random: 0, answers: ['good_play'] })
    t.table.handle(clubWelcome({ room: room() }))
    t.table.handle(dealt)
    t.table.handle(over())
    await t.settle()
    expect(t.asked.at(-1)!.purpose).toBe('react')
    expect(t.sent).toContainEqual({ type: 'react', kind: 'phrase', content: 'good_play' })
  })
})

describe('ClubTable reactions at more moments', () => {
  async function seated(o: Parameters<typeof setup>[0] = {}) {
    const t = setup({ random: 0, ...o })
    t.table.handle(clubWelcome({ room: room() }))
    await t.settle()
    return t
  }

  it('offers a greeting when the cards are dealt, unless it bids first', async () => {
    const t = await seated({ answers: ['hello'] })
    t.table.handle(dealtTo(0))
    await t.settle()
    expect(t.reactPrompts()[0]).toContain('新的一局发好牌了，这局同桌是「小林家的豆豆 #0052」和「老王家的阿福 #0061」')
    expect(t.reacts()).toEqual([{ type: 'react', kind: 'phrase', content: 'hello' }])

    const first = await seated()
    first.table.handle(dealtTo(2))
    await first.settle()
    expect(first.reactPrompts()).toEqual([])
  })

  it('offers a reaction when the landlord is decided, but not when it is its own lead', async () => {
    const t = await seated()
    t.table.handle(dealtTo(2))
    t.table.handle(ge({ kind: 'landlord', seat: 0, base: 3, bottom: ['8', 'K', '大王'] }))
    await t.settle()
    expect(t.reactPrompts()).toEqual([expect.stringContaining('叫分结束，「小林家的豆豆 #0052」当了地主，底分 3，你是农民。')])

    const mine = await seated()
    mine.table.handle(dealtTo(2))
    mine.table.handle(ge({ kind: 'landlord', seat: 2, base: 2, bottom: ['8', 'K', '大王'] }))
    await mine.settle()
    expect(mine.reactPrompts()).toEqual([])
  })

  it('offers a reaction to a bomb or a rocket, naming who played it', async () => {
    const t = await seated({ now: (() => { let n = 0; return () => (n += 60_000) })() })
    t.table.handle(dealtTo(2))
    t.table.handle(ge({ kind: 'landlord', seat: 1, base: 3, bottom: ['8', 'K', '大王'] }))
    await t.settle()
    t.table.handle(ge({ kind: 'play', turn: 5, seat: 0, move: bomb, cardsLeft: 10, multiplier: 2, auto: null }))
    await t.settle()
    t.table.handle(ge({ kind: 'play', turn: 7, seat: 2, move: rocket, cardsLeft: 8, multiplier: 4, auto: null }))
    await t.settle()
    const prompts = t.reactPrompts()
    expect(prompts.some((p) => p.includes('队友「小林家的豆豆 #0052」出了炸弹（9999），现在是 2 倍。'))).toBe(true)
    expect(prompts.some((p) => p.includes('你出了王炸，现在是 4 倍。'))).toBe(true)
  })

  it('does not react to a bomb when it is next to play', async () => {
    const t = await seated()
    t.table.handle(dealtTo(2))
    t.table.handle(ge({ kind: 'landlord', seat: 1, base: 3, bottom: ['8', 'K', '大王'] }))
    await t.settle()
    t.asked.length = 0
    t.table.handle(ge({ kind: 'play', turn: 5, seat: 1, move: bomb, cardsLeft: 10, multiplier: 2, auto: null }))
    await t.settle()
    expect(t.reactPrompts()).toEqual([])
  })

  it('offers a reaction when someone else has used most of their time', async () => {
    const t = await seated()
    t.table.handle(dealtTo(0))
    await t.settle()
    const slow = t.timers.at(-1)!
    expect(slow.ms).toBe(36_000) // 叫分 60 秒的六成
    slow.fn()
    await t.settle()
    expect(t.reactPrompts().at(-1)).toContain('「小林家的豆豆 #0052」想了好一会儿还没叫分。')

    // 已经动了：等的那个就作废，换成等下一个人
    const moved = await seated()
    moved.table.handle(dealtTo(0))
    const stale = moved.timers.at(-1)!
    moved.table.handle(ge({ kind: 'bid', turn: 1, seat: 0, bid: 1, auto: null }))
    await moved.settle()
    expect(stale.cancelled).toBe(true)
    const before = moved.reactPrompts().length
    stale.fn()
    await moved.settle()
    expect(moved.reactPrompts().length).toBe(before)
    expect(moved.timers.at(-1)!.cancelled).toBe(false)

    // 轮到自己、轮到陪练：不等
    const none = await seated()
    none.table.handle(dealtTo(2))
    none.table.handle(ge({ kind: 'dealt', gameId: 1025, seats: [{ studentId: null, displayName: '陪练甲', bot: true }, P61, ME], firstBidder: 0 }))
    expect(none.timers.filter((x) => !x.cancelled)).toEqual([])
  })

  it('offers a reaction after it chose to pass, but not after a timeout pass', async () => {
    const t = await seated()
    t.table.handle(dealtTo(2))
    t.table.handle(ge({ kind: 'landlord', seat: 0, base: 3, bottom: ['8', 'K', '大王'] }))
    await t.settle()
    t.asked.length = 0
    t.table.handle(ge({ kind: 'pass', turn: 6, seat: 2, auto: null }))
    await t.settle()
    expect(t.reactPrompts()).toEqual([expect.stringContaining('这一轮你要不起，选了"不要"。')])
    t.asked.length = 0
    t.table.handle(ge({ kind: 'pass', turn: 9, seat: 2, auto: 'timeout' }))
    await t.settle()
    expect(t.reactPrompts()).toEqual([])
  })

  it('keeps to the chance, the per-game limit and the interval, and asks with a short deadline', async () => {
    let clock = 1_000_000
    const t = await seated({ answers: ['hello', 'good_play', 'good_play'], now: () => clock })
    t.table.handle(clubWelcome({ room: room(), limits: { ...clubWelcome().limits, reactsPerGame: 1, reactMinIntervalSeconds: 5 } }))
    t.table.handle(dealtTo(0))
    await t.settle()
    expect(t.asked.at(-1)!.deadline - clock).toBeLessThanOrEqual(10_000)
    clock += 60_000
    t.table.handle(ge({ kind: 'pass', turn: 2, seat: 2, auto: null }))
    await t.settle()
    expect(t.reacts()).toHaveLength(1)

    // 两条之间不到最短间隔：不问
    const quick = await seated({ answers: ['hello'], now: () => 5_000_000 })
    quick.table.handle(dealtTo(0))
    await quick.settle()
    quick.table.handle(ge({ kind: 'pass', turn: 2, seat: 2, auto: null }))
    await quick.settle()
    expect(quick.reactPrompts()).toHaveLength(1)

    // 主人把概率设成 0：哪个时刻都不问
    const never = setup({ random: 0, settings: { reactChance: 0 } })
    never.table.handle(clubWelcome({ room: room() }))
    never.table.handle(dealtTo(0))
    await never.settle()
    expect(never.reactPrompts()).toEqual([])
  })

  it('does not ask about a reaction while it is thinking about its own move', async () => {
    let release: (v: string) => void = () => {}
    const t = await seated()
    const asked: string[] = []
    // 出牌时模型想得慢：这期间别人出炸弹，不另外问
    ;(t.table as unknown as { d: { ask: (r: AskRequest) => Promise<string | null> } }).d.ask = (r) => {
      asked.push(r.purpose)
      return r.purpose === 'turn' ? new Promise((res) => (release = res)) : Promise.resolve(null)
    }
    t.table.handle(dealtTo(2))
    t.table.handle(ge({ kind: 'landlord', seat: 0, base: 3, bottom: ['8', 'K', '大王'] }))
    await t.settle()
    t.table.handle(playTurn())
    await t.settle()
    t.table.handle(ge({ kind: 'play', turn: 6, seat: 1, move: bomb, cardsLeft: 10, multiplier: 2, auto: null }))
    await t.settle()
    expect(asked.filter((p) => p === 'react').length).toBe(1) // 只有地主定了那一次
    expect(asked.at(-1)).toBe('turn')
    release('1')
    await t.settle()
  })
})

describe('ClubTable switching tables', () => {
  const BOT1 = { studentId: null, displayName: '陪练小一', bot: true }
  const BOT2 = { studentId: null, displayName: '陪练小二', bot: true }
  const waitingRoom = (host = P52, roomId = 'm3x9p') => ({ roomId, host: { ...host, className: '初中部·晚班·2 班' }, seatsFree: 2, bots: false, students: 1, playing: false, gamesPlayed: 0 })

  /** 进了房间、打完一局；lobby.list 时大厅里是 rooms（null：大厅不回话）。 */
  async function played(seats: { studentId: number | null; displayName: string; bot: boolean }[], rooms: ReturnType<typeof waitingRoom>[] | null, o: Parameters<typeof setup>[0] = {}) {
    let t: ReturnType<typeof setup>
    t = setup({
      ...o,
      ack: (m) => {
        if (m.type === 'lobby.list' && rooms) t.table.handle({ type: 'lobby', rooms })
        return undefined
      },
    })
    t.table.handle(clubWelcome({ room: room() }))
    await t.settle()
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats, firstBidder: 0 }))
    t.table.handle(over())
    await t.settle()
    return t
  }

  it('leaves a table of bots for a classmate waiting in the lobby, and goes into that room', async () => {
    const t = await played([BOT1, BOT2, ME], [waitingRoom()])
    expect(t.sent).toContainEqual({ type: 'lobby.list' })
    expect(t.sent).toContainEqual({ type: 'room.leave' })
    expect(t.sent).not.toContainEqual({ type: 'room.ready' })
    t.sent.length = 0
    t.table.handle({ type: 'room.left', roomId: 'r7k2q', reason: 'left' })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.join', roomId: 'm3x9p' }])
  })

  it('quick-joins at once when the room it moved for is gone', async () => {
    let t: ReturnType<typeof setup>
    t = setup({
      ack: (m) => {
        if (m.type === 'lobby.list') t.table.handle({ type: 'lobby', rooms: [waitingRoom()] })
        if (m.type === 'room.join') return { type: 'ack', id: 'x', ok: false, error: { code: 'room_not_found', message: '' } }
        return undefined
      },
    })
    t.table.handle(clubWelcome({ room: room() }))
    await t.settle()
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats: [BOT1, BOT2, ME], firstBidder: 0 }))
    t.table.handle(over())
    await t.settle()
    t.sent.length = 0
    t.table.handle({ type: 'room.left', roomId: 'r7k2q', reason: 'left' })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.join', roomId: 'm3x9p' }, { type: 'room.quick' }])
  })

  it('moves to a room with more students, and of two lone students with bots only the later room moves', async () => {
    const more = await played([BOT1, BOT2, ME], [
      { ...waitingRoom(P61, 'a1'), bots: true, students: 1, playing: true },
      { ...waitingRoom(P52, 'z9'), bots: true, students: 2, playing: true },
    ])
    more.table.handle({ type: 'room.left', roomId: 'r7k2q', reason: 'left' })
    await more.settle()
    expect(more.sent).toContainEqual({ type: 'room.join', roomId: 'z9' })

    // 'a1' 排在 'r7k2q' 前面：这边走；'z9' 排在后面：等那边的同学过来
    const earlier = await played([BOT1, BOT2, ME], [{ ...waitingRoom(P61, 'a1'), bots: true, students: 1 }])
    expect(earlier.sent).toContainEqual({ type: 'room.leave' })
    const later = await played([BOT1, BOT2, ME], [{ ...waitingRoom(P61, 'z9'), bots: true, students: 1 }])
    expect(later.sent).not.toContainEqual({ type: 'room.leave' })
    expect(later.sent).toContainEqual({ type: 'room.ready' })
  })

  it('stays when nobody is waiting, or the lobby does not answer', async () => {
    const empty = await played([BOT1, BOT2, ME], [])
    expect(empty.sent).toContainEqual({ type: 'room.ready' })
    expect(empty.sent).not.toContainEqual({ type: 'room.leave' })

    const silent = await played([BOT1, BOT2, ME], null)
    expect(silent.sent).toContainEqual({ type: 'lobby.list' })
    // 等不到大厅的回答：等的时间到了照常准备
    silent.timers.at(-1)!.fn()
    await silent.settle()
    expect(silent.sent).toContainEqual({ type: 'room.ready' })
    expect(silent.sent).not.toContainEqual({ type: 'room.leave' })
  })

  it('does not look for another table when a classmate sat at this one', async () => {
    const t = await played([P52, BOT1, ME], [waitingRoom(P61)])
    expect(t.sent).not.toContainEqual({ type: 'lobby.list' })
    expect(t.sent).toContainEqual({ type: 'room.ready' })
  })

  it('does not count its own room or a room of another student of the same owner', async () => {
    const t = await played([BOT1, BOT2, ME], [waitingRoom(P52, 'r7k2q'), waitingRoom(P61)], { siblings: [61] })
    expect(t.sent).toContainEqual({ type: 'room.ready' })
    expect(t.sent).not.toContainEqual({ type: 'room.leave' })
  })

  it('keeps playing with bots when the owner chose a room of bots', async () => {
    const t = await played([BOT1, BOT2, ME], [waitingRoom()], { settings: { join: 'bots' } })
    expect(t.sent).not.toContainEqual({ type: 'lobby.list' })
    expect(t.sent).toContainEqual({ type: 'room.ready' })
  })
})

describe('ClubTable waiting for a seat a bot gives up', () => {
  const BOT1 = { studentId: null, displayName: '陪练小一', bot: true }
  const BOT2 = { studentId: null, displayName: '陪练小二', bot: true }
  const seatsWithBots = [
    { seat: 0, player: P52, ready: true, online: true, trustee: false },
    { seat: 1, player: BOT1, ready: true, online: true, trustee: false },
    { seat: 2, player: BOT2, ready: true, online: true, trustee: false },
  ]

  async function waiting(o: Parameters<typeof setup>[0] = {}) {
    const t = setup({
      random: 0,
      ...o,
      ack: (m) => (m.type === 'room.quick' ? { type: 'ack', id: 'x', ok: true, result: { room: room({ seats: seatsWithBots, waiting: [ME] }), created: false } } : undefined),
    })
    t.table.handle(clubWelcome())
    await t.settle()
    return t
  }

  it('watches the game without asking about reactions, then takes its seat without getting ready', async () => {
    const t = await waiting()
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats: [P52, BOT1, BOT2], firstBidder: 0 }))
    t.table.handle(ge({ kind: 'play', turn: 5, seat: 0, move: { type: 'bomb', name: '炸弹', cards: ['9', '9', '9', '9'] }, cardsLeft: 10, multiplier: 2, auto: null }))
    await t.settle()
    expect(t.asked).toEqual([])
    expect(t.timers.filter((x) => !x.cancelled)).toEqual([])
    t.table.handle(over())
    await t.settle()
    expect(t.games).toEqual([])
    expect(t.sent).not.toContainEqual({ type: 'room.ready' })
    t.table.handle({ type: 'room.event', roomId: 'r7k2q', seq: 41, replayed: false, at: '', event: { kind: 'left', seat: 1, player: BOT1, reason: 'replaced' } })
    t.table.handle({ type: 'room.event', roomId: 'r7k2q', seq: 42, replayed: false, at: '', event: { kind: 'joined', seat: 1, player: ME } })
    t.table.handle(ge({ kind: 'dealt', gameId: 1025, seats: [P52, ME, BOT2], firstBidder: 1 }))
    t.table.handle(over(result({ landlord: 1, scores: [-3, 6, -3] })))
    await t.settle()
    expect(t.games).toHaveLength(1)
    expect(t.sent).toContainEqual({ type: 'room.ready' })
  })

  it('leaves when it no longer wants to play by the end of the game it waited through', async () => {
    let more = true
    const t = await waiting({ wantMore: () => more })
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats: [P52, BOT1, BOT2], firstBidder: 0 }))
    more = false
    t.table.handle(over())
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.leave' })
  })
})

describe('ClubTable invitations while playing with bots', () => {
  const BOT1 = { studentId: null, displayName: '陪练小一', bot: true }
  const BOT2 = { studentId: null, displayName: '陪练小二', bot: true }
  const invite = (expires = Date.now() + 120_000) => ({ type: 'invite' as const, inviteId: 9, from: { ...P52, className: '初中部·晚班·3班' }, roomId: 'm3x9p', expiresAt: new Date(expires).toISOString() })

  async function withBots() {
    let t: ReturnType<typeof setup>
    t = setup({
      ack: (m) => {
        if (m.type === 'lobby.list') t.table.handle({ type: 'lobby', rooms: [] })
        return undefined
      },
    })
    t.table.handle(clubWelcome({ room: room() }))
    await t.settle()
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats: [BOT1, BOT2, ME], firstBidder: 0 }))
    return t
  }

  it('holds an invitation from a classmate during a game with bots, and takes it when the game ends', async () => {
    const t = await withBots()
    t.table.handle(invite())
    await t.settle()
    expect(t.sent.filter((m) => m.type.startsWith('room.'))).toEqual([])
    t.table.handle(over())
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.leave' })
    expect(t.sent).not.toContainEqual({ type: 'room.ready' })
    t.table.handle({ type: 'room.left', roomId: 'r7k2q', reason: 'left' })
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.accept', inviteId: 9 })
  })

  it('takes an invitation from a classmate at once between games with bots', async () => {
    const t = await withBots()
    t.table.handle(over())
    await t.settle()
    t.sent.length = 0
    t.table.handle(invite())
    await t.settle()
    expect(t.sent).toEqual([{ type: 'room.leave' }])
    t.table.handle({ type: 'room.left', roomId: 'r7k2q', reason: 'left' })
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.accept', inviteId: 9 })
  })

  it('lets a held invitation go when it has expired by the end of the game', async () => {
    const t = await withBots()
    t.table.handle(invite(Date.now() + 1_000))
    t.table.handle(over())
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.ready' })
    expect(t.sent).not.toContainEqual({ type: 'room.leave' })
  })

  it('declines when it already sits with a classmate', async () => {
    const t = setup()
    t.table.handle(clubWelcome({ room: room() }))
    await t.settle()
    t.table.handle(ge({ kind: 'dealt', gameId: 1024, seats: [P61, BOT1, ME], firstBidder: 0 }))
    t.table.handle(invite())
    await t.settle()
    expect(t.sent).toContainEqual({ type: 'room.decline', inviteId: 9 })
  })
})
