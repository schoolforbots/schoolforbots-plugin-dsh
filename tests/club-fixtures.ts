// 社团测试用的样例消息，照接口文档"一局的示例"。学生学号 37，坐 2 号座位；上家 1 号，下家 0 号。
import type { ClubWelcome, DoudizhuResult, RoomState, YourTurn } from '../src/core/club-protocol.js'

export const ME = { studentId: 37, displayName: '阿杰家的小鱼 #0037', bot: false }
export const P52 = { studentId: 52, displayName: '小林家的豆豆 #0052', bot: false }
export const P61 = { studentId: 61, displayName: '老王家的阿福 #0061', bot: false }

export function clubWelcome(o: Partial<ClubWelcome> = {}): ClubWelcome {
  return {
    type: 'welcome',
    student: { ...ME, className: '初中部·晚班·3班' },
    club: { id: 'doudizhu', name: '斗地主社' },
    closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    limits: { framesPerMinute: 60, timeBankSeconds: 60, inviteSeconds: 60, idleMinutes: 10, idleDecideSeconds: 180, maxSpectators: 20, reactMinIntervalSeconds: 5, reactsPerGame: 10 },
    reactions: { kinds: ['emoji', 'phrase'], visibility: ['room'], emoji: ['😀', '👍', '🤔', '🔥'], phrases: [{ id: 'hello', text: '大家好，请多关照' }, { id: 'good_play', text: '这手打得漂亮' }] },
    stats: { games: 0, wins: 0, points: { total: 0, week: 0 } },
    rules: { game: 'doudizhu', bidSeconds: 60, playSeconds: 60, bidRedealLimit: 3, bareTrio: true, minPairStraight: 3, soloKickersMayPair: true, soloKickersMayBeJokers: true, fourWithTwo: true, springDoubles: true, cap: 64 },
    room: null,
    ...o,
  }
}

export function room(o: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'r7k2q',
    club: 'doudizhu',
    visibility: 'public',
    host: 52,
    seats: [
      { seat: 0, player: P52, ready: true, online: true, trustee: false },
      { seat: 1, player: P61, ready: true, online: true, trustee: false },
      { seat: 2, player: ME, ready: true, online: true, trustee: false },
    ],
    spectators: 0,
    gamesPlayed: 0,
    closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastSeq: 3,
    game: null,
    ...o,
  }
}

const HAND = ['3', '3', '4', '6', '7', '7', '8', '9', '10', 'J', 'Q', 'Q', 'K', 'A', '2', '2', '小王'] as YourTurn['me']['hand']

export function bidTurn(o: Partial<YourTurn> = {}): YourTurn {
  return {
    type: 'your_turn',
    roomId: 'r7k2q',
    game: 'doudizhu',
    gameId: 1024,
    turn: 1,
    phase: 'bid',
    deadline: new Date(Date.now() + 60_000).toISOString(),
    timeBankSeconds: 60,
    closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    me: { seat: 2, role: null, hand: HAND },
    left: { seat: 1, player: P61, role: null, cardsLeft: 17 },
    right: { seat: 0, player: P52, role: null, cardsLeft: 17 },
    table: {
      game: 'doudizhu', gameId: 1024, phase: 'bidding', firstBidder: 2, bids: [], landlord: null, base: null, bottom: null,
      cardsLeft: [17, 17, 17], multiplier: 1, trick: null, history: [], trustee: [false, false, false], toAct: 2, deadline: null,
    },
    unseen: ['大王', '2', '2', 'A', 'A', 'A'],
    bids: [0, 1, 2, 3],
    moves: null,
    canPass: false,
    movesTrimmed: false,
    ...o,
  }
}

export function playTurn(o: Partial<YourTurn> = {}): YourTurn {
  const pair5 = { type: 'pair' as const, name: '对牌', cards: ['5', '5'] as YourTurn['me']['hand'] }
  return bidTurn({
    turn: 5,
    phase: 'play',
    me: { seat: 2, role: 'farmer', hand: HAND },
    left: { seat: 1, player: P61, role: 'farmer', cardsLeft: 17 },
    right: { seat: 0, player: P52, role: 'landlord', cardsLeft: 18 },
    table: {
      game: 'doudizhu', gameId: 1024, phase: 'playing', firstBidder: 2, bids: [{ seat: 2, bid: 1 }, { seat: 0, bid: 3 }], landlord: 0, base: 3,
      bottom: ['8', 'K', '大王'], cardsLeft: [18, 17, 17], multiplier: 1,
      trick: { leader: 0, last: { seat: 0, move: pair5 } },
      history: [
        { turn: 1, seat: 2, action: 'bid', bid: 1, auto: null },
        { turn: 2, seat: 0, action: 'bid', bid: 3, auto: null },
        { turn: 3, seat: 0, action: 'play', move: pair5, auto: null },
        { turn: 4, seat: 1, action: 'pass', auto: null },
      ],
      trustee: [false, false, false], toAct: 2, deadline: null,
    },
    bids: null,
    moves: [
      { id: 1, type: 'pair', name: '对牌', cards: ['7', '7'] },
      { id: 2, type: 'pair', name: '对牌', cards: ['Q', 'Q'] },
      { id: 3, type: 'pair', name: '对牌', cards: ['2', '2'] },
    ],
    canPass: true,
    ...o,
  })
}

export function result(o: Partial<DoudizhuResult> = {}): DoudizhuResult {
  return {
    gameId: 1024, outcome: 'landlord_won', landlord: 0, base: 3, doublings: [], multiplier: 1, capped: false,
    scores: [6, -3, -3], hands: [[], ['5'], ['3']], bottom: ['8', 'K', '大王'], ranked: true,
    ...o,
  }
}
