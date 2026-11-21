import { describe, expect, it } from 'vitest'
import { parseReaction } from '../src/core/club-table.js'
import { countRanks, fallbackTurn, gameRecord, parseTurn, renderGame, turnPrompt } from '../src/core/doudizhu.js'
import { bidTurn, clubWelcome, ME, P52, P61, playTurn, result } from './club-fixtures.js'

const rules = clubWelcome().rules

describe('turnPrompt', () => {
  it('writes the whole position for a bid: hand, both neighbours, what is unseen, what can be bid', () => {
    const p = turnPrompt(bidTurn(), rules)
    expect(p).toContain('手牌 17 张：3 3 4 6 7 7 8 9 10 J Q Q K A 2 2 小王')
    expect(p).toContain('上家「老王家的阿福 #0061」')
    expect(p).toContain('下家「小林家的豆豆 #0052」')
    expect(p).toContain('大王×1  2×2  A×3')
    expect(p).toContain('能叫：0（不叫）、1、2、3')
  })

  it('writes what to beat, who is the landlord, the numbered moves and that passing is allowed', () => {
    const p = turnPrompt(playTurn(), rules)
    expect(p).toContain('地主是下家「小林家的豆豆 #0052」，底分 3')
    expect(p).toContain('桌上要压的是下家「小林家的豆豆 #0052」出的 对牌（5 5）')
    expect(p).toContain('1. 对牌（7 7）')
    expect(p).toContain('3. 对牌（2 2）')
    expect(p).toContain('也可以"不要"')
    expect(p).toContain('上家「老王家的阿福 #0061」不要')
  })

  it('tells the model why its last answer was refused', () => {
    expect(turnPrompt(playTurn(), rules, '压不住对 5')).toContain('【刚才】你交的不合规则，没有算：压不住对 5')
  })

  it('mentions that the trick belongs to a fellow farmer', () => {
    const t = playTurn()
    const yt = playTurn({ table: { ...t.table, trick: { leader: 1, last: { seat: 1, move: { type: 'single', name: '单牌', cards: ['9'] } } } } })
    expect(turnPrompt(yt, rules)).toContain('农民队友')
  })
})

describe('parseTurn', () => {
  it('reads a bid, "不叫", and full-width digits; refuses a bid that is not offered', () => {
    expect(parseTurn('2', bidTurn())).toEqual({ kind: 'bid', bid: 2 })
    expect(parseTurn('不叫', bidTurn())).toEqual({ kind: 'bid', bid: 0 })
    expect(parseTurn('叫３分', bidTurn())).toEqual({ kind: 'bid', bid: 3 })
    expect(parseTurn('2', bidTurn({ bids: [0, 3] }))).toBeNull()
  })

  it('reads a move number from the first line, or a pass; refuses numbers not on the list', () => {
    expect(parseTurn('2\n因为……', playTurn())).toEqual({ kind: 'play', moveId: 2 })
    expect(parseTurn('选 1', playTurn())).toEqual({ kind: 'play', moveId: 1 })
    expect(parseTurn('不要', playTurn())).toEqual({ kind: 'pass' })
    expect(parseTurn('9', playTurn())).toBeNull()
    expect(parseTurn('不要', playTurn({ canPass: false }))).toBeNull()
    expect(parseTurn('', playTurn())).toBeNull()
  })
})

it('falls back to bidding 0, passing when allowed, otherwise the first move', () => {
  expect(fallbackTurn(bidTurn())).toEqual({ kind: 'bid', bid: 0 })
  expect(fallbackTurn(playTurn())).toEqual({ kind: 'pass' })
  expect(fallbackTurn(playTurn({ canPass: false }))).toEqual({ kind: 'play', moveId: 1 })
})

it('counts unseen cards from high to low', () => {
  expect(countRanks(['3', '大王', '3', 'A'])).toBe('大王×1  A×1  3×2')
})

describe('gameRecord', () => {
  it('records a farmer losing to the landlord, with the table mates', () => {
    const g = gameRecord(result(), 2, [P52, P61, ME], '2026-12-01', 1)
    expect(g).toMatchObject({ gameId: 1024, role: 'farmer', won: false, score: -3, ranked: true, date: '2026-12-01' })
    expect(g.mates).toEqual(['小林家的豆豆 #0052', '老王家的阿福 #0061'])
    expect(renderGame(g)).toContain('你当农民，输了，-3 分')
  })

  it('records the landlord winning a spring with its own bomb, and bot games as unranked', () => {
    const r = result({ landlord: 2, scores: [-12, -12, 24], doublings: [{ kind: 'bomb', seat: 2 }, { kind: 'spring', seat: null }], multiplier: 4, ranked: false })
    const g = gameRecord(r, 2, [{ ...P52, studentId: null, bot: true, displayName: '陪练小一' }, P61, ME], '2026-12-01')
    expect(g).toMatchObject({ role: 'landlord', won: true, score: 24 })
    expect(g.highlights).toEqual(['你打了炸弹', '地主打了春天'])
    expect(g.mates[0]).toBe('陪练小一（陪练）')
    expect(renderGame(g, 'owner')).toContain('它当地主，赢了，+24 分（底分 3，倍数 4，有陪练不计排行）；它打了炸弹')
  })
})

it('picks only allowed reactions: a phrase id, a phrase text, or a whole whitelisted emoji', () => {
  const r = clubWelcome().reactions
  expect(parseReaction('good_play', r)).toEqual({ kind: 'phrase', content: 'good_play' })
  expect(parseReaction('大家好，请多关照', r)).toEqual({ kind: 'phrase', content: 'hello' })
  expect(parseReaction('🔥', r)).toEqual({ kind: 'emoji', content: '🔥' })
  expect(parseReaction('[沉默]', r)).toBeNull()
  expect(parseReaction('😈', r)).toBeNull()
})
