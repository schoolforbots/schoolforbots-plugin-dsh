// 测试和本地看效果用：生成一局完整的斗地主记录（和 ClubRecorder 存下来的格式一样：第一行概况，中间是收发的消息，最后一行是学校的牌谱）。
// 洗牌用固定的种子；出牌很简单：领出的出最小的单张或对子，跟的出能压住的最小的同型牌，压不住就不要。中间夹一条表情和一次托管。
import { RANKS, type Rank } from '../src/core/club-protocol.js'

const idx = (r: Rank) => RANKS.indexOf(r)
const sortCards = (c: Rank[]) => [...c].sort((a, b) => idx(a) - idx(b))

export interface SampleOptions {
  me?: number
  studentId?: number
  gameId?: number
  seats?: { studentId: number | null; displayName: string; bot: boolean }[]
  seed?: number
  /** 不带学校的牌谱（没取到）。 */
  noRecord?: boolean
  /** 先没人叫，重新发一次牌。 */
  redeal?: boolean
}

export function sampleGame(o: SampleOptions = {}): unknown[] {
  const me = o.me ?? 2
  const gameId = o.gameId ?? 1024
  const seats = o.seats ?? [
    { studentId: 52, displayName: '小美家的阿花', bot: false },
    { studentId: null, displayName: '陪练小黑', bot: true },
    { studentId: o.studentId ?? 7, displayName: '阿杰家的小鱼', bot: false },
  ]
  let seed = o.seed ?? 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const deal = () => {
    const deck: Rank[] = []
    for (const r of RANKS.slice(0, 13)) for (let k = 0; k < 4; k++) deck.push(r)
    deck.push('小王', '大王')
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
    return { hands: [sortCards(deck.slice(0, 17)), sortCards(deck.slice(17, 34)), sortCards(deck.slice(34, 51))], bottom: sortCards(deck.slice(51)) }
  }
  const lines: unknown[] = []
  let seq = 0
  const ev = (event: unknown) => lines.push({ t: 't', dir: 'in', msg: { type: 'room.event', roomId: 'r7k2q', seq: ++seq, replayed: false, at: '', event } })
  const game = (event: unknown) => ev({ kind: 'game', game: 'doudizhu', event })

  lines.push({ t: 't', dir: 'out', msg: { id: 'h', type: 'hello' } })
  let d = deal()
  game({ kind: 'dealt', gameId, seats, firstBidder: 0 })
  lines.push({ t: 't', dir: 'in', msg: { type: 'hand', roomId: 'r7k2q', game: 'doudizhu', gameId, cards: d.hands[me] } })
  let turn = 0
  if (o.redeal) {
    for (let s = 0; s < 3; s++) game({ kind: 'bid', turn: ++turn, seat: s, bid: 0, auto: null })
    game({ kind: 'redeal', count: 1 })
    d = deal()
    lines.push({ t: 't', dir: 'in', msg: { type: 'hand', roomId: 'r7k2q', game: 'doudizhu', gameId, cards: d.hands[me] } })
  }
  const dealt = d.hands.map((h) => [...h])
  game({ kind: 'bid', turn: ++turn, seat: 0, bid: 1, auto: null })
  game({ kind: 'bid', turn: ++turn, seat: 1, bid: 0, auto: 'bot' })
  game({ kind: 'bid', turn: ++turn, seat: 2, bid: 3, auto: null })
  const landlord = 2
  d.hands[landlord] = sortCards([...d.hands[landlord]!, ...d.bottom])
  game({ kind: 'landlord', seat: landlord, base: 3, bottom: d.bottom })
  ev({ kind: 'react', from: seats[0], to: seats[2], reaction: 'phrase', content: 'p1', text: '你的牌打得也太好了吧', visibility: 'room' })

  const hands = d.hands
  let lead = landlord
  let lastSeat: number | null = null
  let last: { type: 'single' | 'pair'; rank: Rank } | null = null
  let toAct = lead
  let multiplier = 1
  let trusteeDone = false
  let plays = 0
  for (let guard = 0; guard < 300; guard++) {
    const h = hands[toAct]!
    const counts = new Map<Rank, number>()
    for (const c of h) counts.set(c, (counts.get(c) ?? 0) + 1)
    let pick: { type: 'single' | 'pair'; rank: Rank } | null = null
    if (!last) {
      const pair = h.find((c) => (counts.get(c) ?? 0) >= 2)
      pick = pair && rand() < 0.5 ? { type: 'pair', rank: pair } : { type: 'single', rank: h[0]! }
    } else {
      const need: number = last.type === 'pair' ? 2 : 1
      const lastRank: Rank = last.rank
      const c: Rank | undefined = h.find((x) => idx(x) > idx(lastRank) && (counts.get(x) ?? 0) >= need)
      if (c) pick = { type: last.type, rank: c }
    }
    const auto = !trusteeDone && toAct === 0 && plays > 6 ? 'trustee' : toAct === 1 ? 'bot' : null
    if (auto === 'trustee') {
      trusteeDone = true
      ev({ kind: 'trustee', seat: 0, on: true, reason: 'timeouts' })
    }
    if (pick) {
      const cards = Array<Rank>(pick.type === 'pair' ? 2 : 1).fill(pick.rank)
      for (const c of cards) h.splice(h.indexOf(c), 1)
      game({ kind: 'play', turn: ++turn, seat: toAct, move: { type: pick.type, name: pick.type === 'pair' ? '对牌' : '单张', cards }, cardsLeft: h.length, multiplier, auto })
      plays++
      last = pick
      lastSeat = toAct
      if (h.length === 0) break
    } else {
      game({ kind: 'pass', turn: ++turn, seat: toAct, auto })
    }
    toAct = (toAct + 1) % 3
    if (toAct === lastSeat) last = null
  }
  const winner = hands.findIndex((h) => h.length === 0)
  const landlordWon = winner === landlord
  const unit = 3 * multiplier
  const scores = [0, 1, 2].map((s) => (s === landlord ? (landlordWon ? 2 * unit : -2 * unit) : landlordWon ? -unit : unit))
  game({ kind: 'over', result: { gameId, outcome: landlordWon ? 'landlord_won' : 'farmers_won', landlord, base: 3, doublings: [], multiplier, capped: false, scores, hands: hands.map((h) => [...h]), bottom: d.bottom, ranked: false } })

  const won = me === landlord ? landlordWon : !landlordWon
  const head = {
    format: 1, kind: 'club', studentId: seats[me]!.studentId, name: seats[me]!.displayName, gameId, date: '2026-12-01', roomId: 'r7k2q', seat: me, seats,
    game: { gameId, date: '2026-12-01', role: me === landlord ? 'landlord' : 'farmer', outcome: landlordWon ? 'landlord_won' : 'farmers_won', won, score: scores[me], ranked: false, base: 3, multiplier, highlights: [], mates: [] },
  }
  const tail = { kind: 'school-record', record: o.noRecord ? null : { gameId, seats, dealt, bottom: d.bottom, actions: [], reacts: [], result: {} }, ...(o.noRecord ? { error: 'network：连不上学校' } : {}) }
  return [head, ...lines, tail]
}
