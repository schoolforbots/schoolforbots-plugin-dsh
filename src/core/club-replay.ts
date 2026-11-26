// 斗地主对局回放：把一局的完整记录（club-replays/ 里的一个文件，见 replay.ts）变成一步一步的事件，给回放页面一个一个播。
// - 先后顺序看本地录下的消息（叫分、出牌、不要、表情、托管、重新发牌、结果）；三家的手牌看文件最后一行学校的完整牌谱。
//   学校的牌谱只记最后一副牌，所以重新发过牌时，前面几副只知道自己的手牌。没取到牌谱时，也只知道自己的。
// - 每一步带上那一刻的整个牌桌（每家手里的牌、桌上这一轮出的牌、地主、底牌、倍数、托管），回放页面往回拖时直接用。
// - 不看时刻，只按记录的先后。私密的表情只录得到发给自己的和自己发的。
import type { ClubPerson, DoudizhuResult, Move, Rank } from './club-protocol.js'
import { RANKS } from './club-protocol.js'

export interface ClubReplaySeat {
  name: string
  studentId: number | null
  bot: boolean
  self: boolean
}

/** 某一步时的牌桌。 */
export interface TableSnapshot {
  /** 每家手里的牌；不知道是 null（只知道张数）。 */
  hands: (Rank[] | null)[]
  counts: number[]
  /** 这一轮桌上每家出的：牌、"不要"、还没出。 */
  table: ({ kind: 'play'; move: Move } | { kind: 'pass' } | null)[]
  landlord: number | null
  bottom: Rank[] | null
  base: number | null
  multiplier: number
  trustee: boolean[]
}

export interface ClubReplayStep {
  /** 谁（座位号）；学校的通知是 null。 */
  seat: number | null
  kind: 'deal' | 'redeal' | 'bid' | 'landlord' | 'play' | 'pass' | 'react' | 'trustee' | 'over' | 'note'
  /** 气泡里的话（叫分、不要、表情的文字、牌型）。 */
  text: string
  tag?: string
  /** 出的牌（play）、底牌（landlord）。 */
  cards?: Rank[]
  /** 不是自己出的：超时、托管、陪练替出…… */
  auto?: string
  /** 表情对着谁（座位号）。 */
  to?: number | null
  /** 这一步之后的牌桌。 */
  snap: TableSnapshot
  /** 结果（over）：每家的得分。 */
  scores?: number[]
}

export interface ClubReplay {
  title: string
  gameId: number | null
  /** 自己的座位。 */
  me: number
  seats: ClubReplaySeat[]
  /** 有没有学校的完整牌谱（三家的手牌都知道）。 */
  godView: boolean
  steps: ClubReplayStep[]
}

type Msg = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const AUTO: Record<string, string> = { timeout: '超时，学校替出', trustee: '托管替出', bot: '陪练', closing: '关门前学校替出' }
const OUTCOME: Record<string, string> = { landlord_won: '地主赢了', farmers_won: '农民赢了', no_landlord: '没人叫地主，这一局作废' }
const DOUBLING: Record<string, string> = { bomb: '炸弹', rocket: '王炸', spring: '春天', anti_spring: '反春' }

/** 按点数排好（小的在前）。 */
export function sortCards(cards: Rank[]): Rank[] {
  return [...cards].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
}

function without(hand: Rank[], cards: Rank[]): Rank[] {
  const out = [...hand]
  for (const c of cards) {
    const i = out.indexOf(c)
    if (i >= 0) out.splice(i, 1)
  }
  return out
}

/** 记录的每一行（第一行是概况，最后一行是学校的牌谱）变成回放。 */
export function buildClubReplay(rows: unknown[]): ClubReplay {
  const head = (rows[0] ?? {}) as Msg
  const lines = rows.filter((r): r is { dir: string; msg: unknown } => !!r && typeof r === 'object' && 'dir' in (r as object))
  const tailRow = rows.find((r) => !!r && typeof r === 'object' && (r as Msg).kind === 'school-record') as Msg | undefined
  const record = (tailRow?.record ?? null) as { dealt?: Rank[][]; bottom?: Rank[]; seats?: ClubPerson[] } | null
  const me = num(head.seat) ?? 0
  const gameId = num(head.gameId)

  // 座位：dealt 事件里的，没有就用概况里的
  let people: ClubPerson[] = ((head.seats as ClubPerson[] | undefined) ?? record?.seats ?? []).slice(0, 3)
  for (const l of lines) {
    const e = (((l.msg ?? {}) as Msg).event ?? {}) as Msg
    const g = (e.event ?? {}) as Msg
    if (e.kind === 'game' && g.kind === 'dealt' && Array.isArray(g.seats)) people = g.seats as ClubPerson[]
  }
  while (people.length < 3) people.push({ studentId: null, displayName: `${people.length + 1} 号座`, bot: false })
  const seats: ClubReplaySeat[] = people.map((p, i) => ({ name: p.displayName + (p.bot ? '（陪练）' : ''), studentId: p.studentId ?? null, bot: !!p.bot, self: i === me }))
  const seatOf = (p: unknown): number | null => {
    const x = (p ?? {}) as Msg
    const id = num(x.studentId)
    if (id !== null) {
      const i = people.findIndex((q) => q.studentId === id)
      if (i >= 0) return i
    }
    const i = people.findIndex((q) => q.displayName === str(x.displayName))
    return i >= 0 ? i : null
  }

  // 一局里发过几副牌：学校的牌谱是最后一副的
  let deals = 0
  for (const l of lines) {
    const e = (((l.msg ?? {}) as Msg).event ?? {}) as Msg
    const g = (e.event ?? {}) as Msg
    if (e.kind === 'game' && (g.kind === 'dealt' || g.kind === 'redeal')) deals++
  }
  const godView = !!(record?.dealt && record.dealt.length === 3)

  const snap: TableSnapshot = { hands: [null, null, null], counts: [17, 17, 17], table: [null, null, null], landlord: null, bottom: null, base: null, multiplier: 1, trustee: [false, false, false] }
  let lastPlaySeat: number | null = null
  let dealNo = 0
  const copy = (): TableSnapshot => ({
    hands: snap.hands.map((h) => (h ? [...h] : null)),
    counts: [...snap.counts],
    table: snap.table.map((t) => (t ? { ...t } : null)),
    landlord: snap.landlord,
    bottom: snap.bottom ? [...snap.bottom] : null,
    base: snap.base,
    multiplier: snap.multiplier,
    trustee: [...snap.trustee],
  })
  const steps: ClubReplayStep[] = []
  const push = (s: Omit<ClubReplayStep, 'snap'>) => steps.push({ ...s, snap: copy() })
  const name = (seat: number | null) => (seat === null ? '' : seats[seat]?.name ?? `${seat + 1} 号座`)
  const autoOf = (v: unknown) => (typeof v === 'string' && AUTO[v] ? { auto: AUTO[v] } : {})

  const newDeal = () => {
    dealNo++
    snap.table = [null, null, null]
    snap.landlord = null
    snap.bottom = null
    snap.base = null
    snap.multiplier = 1
    snap.counts = [17, 17, 17]
    lastPlaySeat = null
    // 最后一副：三家的牌都知道（学校的牌谱）；前面几副只知道自己的（等 hand 消息）
    snap.hands = godView && dealNo === deals ? record!.dealt!.map((h) => sortCards(h)) : [null, null, null]
  }

  for (const l of lines) {
    const m = (l.msg ?? {}) as Msg
    if (l.dir !== 'in') continue
    if (m.type === 'hand' && Array.isArray(m.cards)) {
      // 自己的手牌（学校的牌谱已经给了三家的就不用）。发牌那一步已经推出去了的，补进那一步
      if (godView && dealNo === deals) continue
      const hand = sortCards(m.cards as Rank[])
      snap.hands[me] = hand
      snap.counts[me] = hand.length
      const last = steps.at(-1)
      if (last && (last.kind === 'deal' || last.kind === 'redeal')) {
        last.snap.hands[me] = [...hand]
        last.snap.counts[me] = hand.length
      }
      continue
    }
    if (m.type !== 'room.event') continue
    const e = (m.event ?? {}) as Msg
    switch (e.kind) {
      case 'react': {
        const from = seatOf(e.from)
        if (from === null) break
        const to = e.to ? seatOf(e.to) : null
        push({ seat: from, kind: 'react', text: str(e.text) || str(e.content), tag: e.visibility === 'private' ? '悄悄发的' : '表情', to })
        break
      }
      case 'trustee': {
        const seat = num(e.seat)
        if (seat === null) break
        snap.trustee[seat] = e.on === true
        push({ seat, kind: 'trustee', text: e.on ? (e.reason === 'timeouts' ? '连着超时，学校替它托管' : '托管了') : '取消托管', tag: '托管' })
        break
      }
      case 'game': {
        const g = (e.event ?? {}) as Msg
        switch (g.kind) {
          case 'dealt': {
            newDeal()
            const first = num(g.firstBidder)
            push({ seat: null, kind: 'deal', text: `第 ${num(g.gameId) ?? gameId ?? ''} 局开始：每家 17 张，留 3 张底牌。${first !== null ? `「${name(first)}」先叫分。` : ''}`, tag: '发牌' })
            break
          }
          case 'redeal': {
            push({ seat: null, kind: 'redeal', text: '没人叫地主，重新发牌。', tag: '重新发牌' })
            newDeal()
            break
          }
          case 'bid': {
            const seat = num(g.seat)
            const bid = num(g.bid) ?? 0
            push({ seat, kind: 'bid', text: bid > 0 ? `叫 ${bid} 分` : '不叫', tag: '叫分', ...autoOf(g.auto) })
            break
          }
          case 'landlord': {
            const seat = num(g.seat)
            const bottom = (g.bottom as Rank[] | undefined) ?? []
            if (seat !== null) {
              snap.landlord = seat
              snap.bottom = sortCards(bottom)
              snap.base = num(g.base)
              snap.counts[seat] = 20
              if (snap.hands[seat]) snap.hands[seat] = sortCards([...snap.hands[seat]!, ...bottom])
            }
            push({ seat, kind: 'landlord', text: `当地主（${num(g.base) ?? '?'} 分），拿走底牌`, tag: '地主', cards: sortCards(bottom) })
            break
          }
          case 'play': {
            const seat = num(g.seat)
            const move = g.move as Move | undefined
            if (seat === null || !move) break
            // 另外两家都不要，轮回到这一家：新的一轮，桌上清空
            if (lastPlaySeat === null || lastPlaySeat === seat) snap.table = [null, null, null]
            snap.table[seat] = { kind: 'play', move }
            lastPlaySeat = seat
            if (snap.hands[seat]) snap.hands[seat] = without(snap.hands[seat]!, move.cards)
            snap.counts[seat] = num(g.cardsLeft) ?? Math.max(0, snap.counts[seat]! - move.cards.length)
            snap.multiplier = num(g.multiplier) ?? snap.multiplier
            push({ seat, kind: 'play', text: move.name, tag: move.type === 'bomb' || move.type === 'rocket' ? `${move.name}！倍数 ×${snap.multiplier}` : '出牌', cards: sortCards(move.cards), ...autoOf(g.auto) })
            break
          }
          case 'pass': {
            const seat = num(g.seat)
            if (seat === null) break
            snap.table[seat] = { kind: 'pass' }
            push({ seat, kind: 'pass', text: '不要', tag: '不要', ...autoOf(g.auto) })
            break
          }
          case 'over': {
            const r = (g.result ?? {}) as DoudizhuResult
            if (Array.isArray(r.hands) && r.hands.length === 3) {
              snap.hands = r.hands.map((h) => sortCards(h))
              snap.counts = r.hands.map((h) => h.length)
            }
            snap.multiplier = num(r.multiplier) ?? snap.multiplier
            const dbl = (r.doublings ?? []).map((d) => DOUBLING[d.kind]).filter(Boolean)
            const scores = Array.isArray(r.scores) ? r.scores : undefined
            const lines2 = [OUTCOME[r.outcome] ?? '这一局结束了']
            if (r.outcome !== 'no_landlord') lines2.push(`底分 ${r.base ?? '?'}，${r.multiplier} 倍${r.capped ? '（封顶）' : ''}${dbl.length ? `，有${dbl.join('、')}` : ''}${r.ranked ? '' : '，有陪练，不计排行'}`)
            if (scores) lines2.push(scores.map((x, i) => `${name(i)} ${x > 0 ? '+' : ''}${x}`).join('，'))
            push({ seat: null, kind: 'over', text: lines2.join('\n'), tag: '结果', ...(scores ? { scores } : {}) })
            break
          }
        }
        break
      }
    }
  }

  const g = (head.game ?? {}) as Msg
  const role = g.role === 'landlord' ? '地主' : g.role === 'farmer' ? '农民' : ''
  const title = `斗地主 · 第 ${gameId ?? '?'} 局${role ? ` · ${seats[me]?.name ?? ''}当${role}` : ''}${typeof g.won === 'boolean' && g.outcome !== 'no_landlord' ? (g.won ? ' · 赢了' : ' · 输了') : ''}`
  return { title, gameId, me, seats, godView, steps }
}
