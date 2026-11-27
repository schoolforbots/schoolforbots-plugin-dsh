// 斗地主回放的花色：同一份记录配出来都一样；一副牌里同点数的四张花色不重复；出的牌带着手里的花色上桌。
import { describe, expect, it } from 'vitest'
import { buildClubReplay } from '../src/core/club-replay.js'
import { cardSuits } from '../src/dsh/card-suits.js'
import { sampleGame } from './club-game-sample.js'

describe('suits in a game replay', () => {
  it('are the same every time and never repeat a suit within a rank', () => {
    const r = buildClubReplay(sampleGame())
    const a = cardSuits(r)
    expect(cardSuits(buildClubReplay(sampleGame()))).toEqual(a)
    // 发完底牌（地主拿到底牌）那一步：三家手里加起来就是整副牌
    const k = r.steps.findIndex((s) => s.kind === 'landlord')
    const snap = r.steps[k]!.snap
    const byRank = new Map<string, string[]>()
    snap.hands.forEach((h, i) => h!.forEach((rank, j) => byRank.set(rank, [...(byRank.get(rank) ?? []), a[k]!.hands[i]![j]!])))
    for (const [rank, list] of byRank) {
      if (rank === '小王' || rank === '大王') expect(list).toEqual([''])
      else expect(new Set(list).size, rank).toBe(list.length)
    }
  })

  it('moves a card\'s suit with it from the hand to the table', () => {
    const r = buildClubReplay(sampleGame())
    const a = cardSuits(r)
    r.steps.forEach((s, k) => {
      if (s.kind !== 'play' || k === 0) return
      const seat = s.seat!
      const before = r.steps[k - 1]!.snap.hands[seat]!.map((rank, j) => rank + a[k - 1]!.hands[seat]![j])
      const after = s.snap.hands[seat]!.map((rank, j) => rank + a[k]!.hands[seat]![j])
      const played = s.cards!.map((rank, j) => rank + a[k]!.table[seat]![j])
      expect([...after, ...played].sort()).toEqual([...before].sort())
    })
  })

  it('still gives suits when only its own hand is known', () => {
    const r = buildClubReplay(sampleGame({ noRecord: true }))
    expect(r.godView).toBe(false)
    const a = cardSuits(r)
    const other = r.steps.findIndex((s) => s.kind === 'play' && s.seat !== r.me)
    expect(a[other]!.table[r.steps[other]!.seat!]!.every((x, j) => x !== '' || ['小王', '大王'].includes(r.steps[other]!.cards![j]!))).toBe(true)
    // 自己的手牌每一步都有花色（大小王除外）
    r.steps.forEach((st, k) => st.snap.hands[r.me]?.forEach((rank, j) => expect(a[k]!.hands[r.me]![j] !== '' || rank === '小王' || rank === '大王').toBe(true)))
  })
})
