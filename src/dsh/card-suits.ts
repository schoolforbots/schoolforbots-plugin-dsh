// 斗地主回放里的花色。斗地主不看花色，学校的牌谱里也没有，但牌面上没有花色看着怪，所以插件自己配：
// - 同一份记录每次配出来都一样（只看记录，不用随机数）：每个点数的四张按 ♠ ♥ ♣ ♦ 的顺序发，先发给 0、1、2 号座手里的，再给底牌；
//   大小王没有花色。重新发牌时从头再配。
// - 一张牌从手里出到桌上，花色跟着走：手里同点数的几张，出牌时从最后一张往前拿，剩下的还是原来的花色。
// - 不知道手牌的那家（没取到学校的牌谱），出牌时从这个点数还没发出去的花色里拿。
import type { ClubReplay } from '../core/club-replay.js'

const SUITS = ['♠', '♥', '♣', '♦'] as const
const JOKERS = new Set(['小王', '大王'])

/** 某一步时每张看得见的牌的花色，和这一步的牌一一对应（大小王是空字符串）。 */
export interface StepSuits {
  hands: (string[] | null)[]
  table: (string[] | null)[]
  bottom: string[] | null
}

export function cardSuits(replay: ClubReplay): StepSuits[] {
  let dealt = new Map<string, number>()
  let held: Map<string, string[]>[] = []
  let bottom: string[] | null = null
  let landlordGotBottom = false
  let started = false
  let table: (string[] | null)[] = [null, null, null]

  const reset = () => {
    dealt = new Map()
    held = [new Map(), new Map(), new Map()]
    bottom = null
    landlordGotBottom = false
    started = false
    table = [null, null, null]
  }
  const take = (rank: string): string => {
    if (JOKERS.has(rank)) return ''
    const n = dealt.get(rank) ?? 0
    dealt.set(rank, n + 1)
    return SUITS[n % 4]!
  }
  const pile = (seat: number, rank: string): string[] => {
    const m = held[seat]!
    if (!m.has(rank)) m.set(rank, [])
    return m.get(rank)!
  }
  reset()

  return replay.steps.map((step) => {
    const snap = step.snap
    if (step.kind === 'deal' || step.kind === 'redeal') reset()
    // 第一次看到手牌：知道的几家按座位顺序发
    if (!started) {
      snap.hands.forEach((h, i) => h?.forEach((rank) => pile(i, rank).push(take(rank))))
      started = true
    }
    if (snap.bottom && !bottom) bottom = snap.bottom.map(take)
    // 底牌进了地主手里（地主的手牌要知道才用得上）
    if (bottom && snap.bottom && snap.landlord != null && !landlordGotBottom) {
      landlordGotBottom = true
      if (snap.hands[snap.landlord]) snap.bottom.forEach((rank, j) => pile(snap.landlord!, rank).push(bottom![j]!))
    }
    if (step.kind === 'play' && step.seat != null && step.cards) {
      const seat = step.seat
      const known = !!snap.hands[seat]
      table[seat] = step.cards.map((rank) => (known && pile(seat, rank).length ? pile(seat, rank).pop()! : take(rank)))
    }
    snap.table.forEach((t, i) => {
      if (!t || t.kind !== 'play') table[i] = null
    })
    const hands = snap.hands.map((h, i) => {
      if (!h) return null
      const seen = new Map<string, number>()
      return h.map((rank) => {
        const j = seen.get(rank) ?? 0
        seen.set(rank, j + 1)
        return JOKERS.has(rank) ? '' : pile(i, rank)[j] ?? ''
      })
    })
    return { hands, table: table.map((t) => (t ? [...t] : null)), bottom: snap.bottom && bottom ? [...bottom] : null }
  })
}
