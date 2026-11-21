import { describe, expect, it } from 'vitest'
import type { ClubAck, ClubOutgoing } from '../src/core/club-protocol.js'
import { ClubTable, DEFAULT_CLUB_SETTINGS, type AskRequest, type ClubSettings } from '../src/core/club-table.js'
import type { ClubGameRecord } from '../src/core/doudizhu.js'
import { bidTurn, clubWelcome, ME, P52, P61, playTurn, result, room } from './club-fixtures.js'

function setup(o: { answers?: (string | null)[]; ack?: (m: ClubOutgoing) => ClubAck | undefined; settings?: Partial<ClubSettings>; wantMore?: () => boolean; random?: number } = {}) {
  const sent: ClubOutgoing[] = []
  const asked: AskRequest[] = []
  const games: ClubGameRecord[] = []
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
    onGame: (g) => games.push(g),
    onDone: () => done++,
    today: () => '2026-12-01',
    random: () => o.random ?? 0.99,
    sleep: async () => {},
  })
  const settle = () => new Promise((r) => setTimeout(r, 20))
  return { table, sent, asked, games, settle, done: () => done }
}

const over = (r = result()) => ({ type: 'room.event' as const, roomId: 'r7k2q', seq: 40, replayed: false, at: '', event: { kind: 'game' as const, game: 'doudizhu' as const, event: { kind: 'over' as const, result: r } } })
const dealt = { type: 'room.event' as const, roomId: 'r7k2q', seq: 4, replayed: false, at: '', event: { kind: 'game' as const, game: 'doudizhu' as const, event: { kind: 'dealt' as const, gameId: 1024, seats: [P52, P61, ME], firstBidder: 2 } } }

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
