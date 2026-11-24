// 牌局总结：和哪些真人同学打了、打得怎么样（陪练不说）。
import { describe, expect, it } from 'vitest'
import { classmateTotals, clubDigest } from '../src/core/diary.js'
import type { ClubGameRecord } from '../src/core/doudizhu.js'

const game = (o: Partial<ClubGameRecord>): ClubGameRecord => ({
  gameId: 1, date: '2026-12-01', at: 0, role: 'farmer', outcome: 'farmers_won', won: true, score: 2,
  ranked: true, base: 1, multiplier: 2, highlights: [], mates: [], ...o,
})
const DOUDOU = '小林家的豆豆 #0052'
const AFU = '老王家的阿福 #0061'

describe('the day of doudizhu, by classmate', () => {
  const games = [
    game({ gameId: 3, mates: [DOUDOU, '陪练小一（陪练）'], won: false, score: -4, ranked: false }),
    game({ gameId: 2, mates: [DOUDOU, AFU], won: true, score: 2 }),
    game({ gameId: 1, mates: [DOUDOU, AFU], won: true, score: 6 }),
  ]

  it('adds up the games, wins and points with each real classmate, the most played first', () => {
    expect(classmateTotals(games)).toEqual([
      { name: DOUDOU, games: 3, wins: 2, points: 4 },
      { name: AFU, games: 2, wins: 2, points: 8 },
    ])
  })

  it('says who it played and how it did, for the AI and for the owner', () => {
    const forAi = clubDigest(games, 'you')
    expect(forAi).toContain(`和「${DOUDOU}」打了 3 局，你赢了 2 局，一共赢了 4 分。`)
    expect(forAi).toContain(`和「${AFU}」打了 2 局，你赢了 2 局，一共赢了 8 分。`)
    expect(forAi).not.toContain('「陪练小一（陪练）」打了')
    expect(clubDigest(games, 'owner')).toContain(`和「${DOUDOU}」打了 3 局，它赢了 2 局，一共赢了 4 分。`)
  })

  it('says points lost, an even day, and a day with bots only', () => {
    expect(clubDigest([game({ mates: [DOUDOU, AFU], won: false, score: -3 })], 'you')).toContain(`和「${DOUDOU}」打了 1 局，你赢了 0 局，一共输了 3 分。`)
    expect(clubDigest([game({ mates: [DOUDOU, AFU], score: 2 }), game({ mates: [DOUDOU, AFU], won: false, score: -2 })], 'you')).toContain('不输不赢')
    expect(clubDigest([game({ mates: ['陪练小一（陪练）', '陪练小二（陪练）'], ranked: false })], 'you')).toContain('同桌的都是陪练，没碰到真人同学。')
  })
})
