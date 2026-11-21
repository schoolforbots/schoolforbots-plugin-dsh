// 斗地主的"手"：把 your_turn 写成给模型的提示词、从回答里读出动作、来不及时交保底动作、把一局的结果写成日记。
// 不写规则引擎：能叫的分、能出的牌都是服务器给的清单（接口文档"打社团的牌局"），插件只在清单里挑。
import { RANKS, type DoudizhuResult, type DoudizhuRules, type Move, type Rank, type Role, type TableAction, type YourTurn } from './club-protocol.js'

export type TurnAction = { kind: 'bid'; bid: number } | { kind: 'play'; moveId: number } | { kind: 'pass' }

const ROLE: Record<string, string> = { landlord: '地主', farmer: '农民' }
const roleText = (r: Role) => (r ? ROLE[r]! : '还没定')
const cards = (cs: readonly Rank[]) => (cs.length ? cs.join(' ') : '（没有）')
const moveText = (m: Move) => `${m.name}（${cards(m.cards)}）`

/** 记牌器：按点数数张数，从大到小写。 */
export function countRanks(cs: readonly Rank[]): string {
  const n = new Map<Rank, number>()
  for (const c of cs) n.set(c, (n.get(c) ?? 0) + 1)
  return [...RANKS]
    .reverse()
    .filter((r) => n.has(r))
    .map((r) => `${r}×${n.get(r)}`)
    .join('  ') || '（没有）'
}

function rulesText(r: DoudizhuRules | null): string {
  const lines = [
    '三人斗地主，一副牌 54 张，每人 17 张，3 张底牌归地主。叫分 1～3 分，每人叫一次，0 是不叫，叫得最高的当地主；地主一个人对两个农民。',
    '地主先出。每一轮先出的人出什么都行，后面的人要出同样牌型、同样张数而且更大的牌，或者不要；另外两家都不要时，最后出牌的人开始新的一轮。先出完手里的牌的一方赢。',
    '牌从小到大：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王，不分花色。2 和王不能进顺子。炸弹（四张一样）和火箭（大王加小王）能压别的牌型，每打出一次倍数翻倍。',
  ]
  if (r) {
    const extra: string[] = []
    if (!r.bareTrio) extra.push('三张和三顺必须带牌')
    if (!r.fourWithTwo) extra.push('没有四带二')
    if (r.springDoubles) extra.push('春天、反春倍数翻倍')
    extra.push(`倍数最多 ${r.cap} 倍`)
    lines.push(`本社的规则：${extra.join('；')}。`)
  }
  return lines.join('\n')
}

/** 一步历史写成一句话。 */
function actionText(a: TableAction, name: (seat: number) => string): string {
  const who = name(a.seat)
  const auto = a.auto === 'timeout' ? '（超时，托管替出）' : a.auto === 'trustee' ? '（托管）' : a.auto === 'closing' ? '（关门托管）' : ''
  if (a.action === 'bid') return `${who}${a.bid ? `叫 ${a.bid} 分` : '不叫'}${auto}`
  if (a.action === 'pass') return `${who}不要${auto}`
  return `${who}出 ${moveText(a.move)}${auto}`
}

export interface TurnPrompt {
  /** 给模型看的局面和要它做的事。 */
  prompt: string
}

/**
 * 把一次 your_turn 写成提示词。retryReason 是上一次交的动作被判不合规则时服务器写的原因。
 * 提示词自带完整局面，不靠模型记得前面的步（每一步无状态地问一次）。
 */
export function turnPrompt(yt: YourTurn, rules: DoudizhuRules | null, retryReason?: string): string {
  const t = yt.table
  const seatName = new Map<number, string>([
    [yt.me.seat, '你'],
    [yt.left.seat, `上家「${yt.left.player.displayName}」`],
    [yt.right.seat, `下家「${yt.right.player.displayName}」`],
  ])
  const name = (seat: number) => seatName.get(seat) ?? `${seat} 号座位`
  const lines: string[] = ['【斗地主社 · 规则】', rulesText(rules), '']
  lines.push('【局面】')
  lines.push(`你：${roleText(yt.me.role)}，手牌 ${yt.me.hand.length} 张：${cards(yt.me.hand)}`)
  lines.push(`上家「${yt.left.player.displayName}」${yt.left.player.bot ? '（陪练）' : ''}：${roleText(yt.left.role)}，还剩 ${yt.left.cardsLeft} 张`)
  lines.push(`下家「${yt.right.player.displayName}」${yt.right.player.bot ? '（陪练）' : ''}：${roleText(yt.right.role)}，还剩 ${yt.right.cardsLeft} 张`)
  lines.push(`出牌顺序：你 → 下家 → 上家 → 你`)
  if (t.bids.length) lines.push(`叫分：${t.bids.map((b) => `${name(b.seat)}${b.bid ? `叫 ${b.bid} 分` : '不叫'}`).join('，')}`)
  if (t.landlord !== null) lines.push(`地主是${name(t.landlord)}，底分 ${t.base ?? '?'}，底牌 ${cards(t.bottom ?? [])}，现在倍数 ${t.multiplier}`)
  const recent = t.history.filter((a) => a.action !== 'bid').slice(-12)
  if (recent.length) lines.push(`最近的出牌（旧的在前）：${recent.map((a) => actionText(a, name)).join('；')}`)
  lines.push(`还没见过的牌（另外两家手里的${yt.phase === 'bid' ? '加上底牌' : ''}）：${countRanks(yt.unseen)}`)
  lines.push('')
  if (retryReason) lines.push(`【刚才】你交的不合规则，没有算：${retryReason}`, '')
  lines.push('【现在】')
  if (yt.phase === 'bid') {
    const bids = yt.bids ?? [0]
    lines.push(`轮到你叫分。能叫：${bids.map((b) => (b ? `${b}` : '0（不叫）')).join('、')}。`)
    lines.push('想想这手牌值不值得当地主（地主拿底牌、一个人对两家）。只回一个数字，不要解释。')
    return lines.join('\n')
  }
  const last = t.trick?.last
  if (last && last.seat !== yt.me.seat) lines.push(`桌上要压的是${name(last.seat)}出的 ${moveText(last.move)}。`)
  else lines.push('这一轮由你先出，出什么牌型都行。')
  if (yt.me.role && t.landlord !== null && last && last.seat !== yt.me.seat) {
    const mate = yt.me.role === 'farmer' && last.seat !== t.landlord
    if (mate) lines.push('这一手是你的农民队友出的，一般不用压队友。')
  }
  lines.push('能出的牌：')
  for (const m of yt.moves ?? []) lines.push(`${m.id}. ${moveText(m)}`)
  if (yt.movesTrimmed) lines.push('（清单截短了：每种牌型只列了一种带法。）')
  lines.push(yt.canPass ? '也可以"不要"。只回一行：选的编号，或者"不要"，不要解释。' : '这一轮不能不要。只回一行：选的编号，不要解释。')
  return lines.join('\n')
}

/** 从模型的回答里读出动作；读不出来、或者不在清单里，返回 null。 */
export function parseTurn(text: string | null | undefined, yt: YourTurn): TurnAction | null {
  if (!text) return null
  const line = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x.length > 0)
  if (!line) return null
  if (yt.phase === 'bid') {
    const bids = yt.bids ?? []
    if (/不叫|不要|^pass\b/i.test(line) && bids.includes(0)) return { kind: 'bid', bid: 0 }
    const m = /[0-3]/.exec(line.replace(/[０-３]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)))
    const n = m ? Number(m[0]) : NaN
    return bids.includes(n) ? { kind: 'bid', bid: n } : null
  }
  const normalized = line.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
  const num = /\d+/.exec(normalized)
  if (num) {
    const id = Number(num[0])
    if ((yt.moves ?? []).some((m) => m.id === id)) return { kind: 'play', moveId: id }
  }
  if (/不要|不出|要不起|^过|^pass\b/i.test(normalized) && yt.canPass) return { kind: 'pass' }
  return null
}

/** 来不及、读不出来时交的动作：叫 0 分；能不要就不要，不能就出清单第一手。 */
export function fallbackTurn(yt: YourTurn): TurnAction {
  if (yt.phase === 'bid') return { kind: 'bid', bid: (yt.bids ?? [0]).includes(0) ? 0 : (yt.bids ?? [0])[0]! }
  if (yt.canPass) return { kind: 'pass' }
  const first = (yt.moves ?? [])[0]
  return first ? { kind: 'play', moveId: first.id } : { kind: 'pass' }
}

// ---------- 一局的结果 ----------

export interface ClubGameRecord {
  gameId: number
  /** 学校时区的日期 YYYY-MM-DD。 */
  date: string
  at: number
  role: Role
  outcome: DoudizhuResult['outcome']
  won: boolean
  score: number
  ranked: boolean
  base: number | null
  multiplier: number
  /** 春天、反春、自己打的炸弹和火箭。 */
  highlights: string[]
  /** 同桌另外两位的显示名（陪练带"（陪练）"）。 */
  mates: string[]
}

/** 从 over 事件和自己的座位、同桌名单算出这一局的记录。 */
export function gameRecord(result: DoudizhuResult, mySeat: number, seats: { studentId?: number | null; displayName: string; bot: boolean }[], date: string, at = Date.now()): ClubGameRecord {
  const role: Role = result.landlord === null ? null : result.landlord === mySeat ? 'landlord' : 'farmer'
  const won =
    result.outcome === 'landlord_won' ? role === 'landlord' : result.outcome === 'farmers_won' ? role === 'farmer' : false
  const highlights: string[] = []
  for (const d of result.doublings) {
    if (d.kind === 'spring') highlights.push(result.outcome === 'landlord_won' ? '地主打了春天' : '春天')
    else if (d.kind === 'anti_spring') highlights.push('反春')
    else if (d.seat === mySeat) highlights.push(d.kind === 'bomb' ? '你打了炸弹' : '你打了火箭')
  }
  return {
    gameId: result.gameId,
    date,
    at,
    role,
    outcome: result.outcome,
    won,
    score: result.scores[mySeat] ?? 0,
    ranked: result.ranked,
    base: result.base,
    multiplier: result.multiplier,
    highlights,
    mates: seats.filter((_, i) => i !== mySeat).map((p) => `${p.displayName}${p.bot ? '（陪练）' : ''}`),
  }
}

/** 一局写成一行。who = 'you' 给 AI 看，'owner' 给主人看。 */
export function renderGame(g: ClubGameRecord, who: 'you' | 'owner' = 'you'): string {
  const I = who === 'you' ? '你' : '它'
  if (g.outcome === 'no_landlord') return `第 ${g.gameId} 局：连着几次没人叫分，这局作废。同桌：${g.mates.join('、')}`
  const sign = g.score > 0 ? `+${g.score}` : String(g.score)
  const parts = [`第 ${g.gameId} 局：${I}当${roleText(g.role)}，${g.won ? '赢了' : '输了'}，${sign} 分（底分 ${g.base ?? '?'}，倍数 ${g.multiplier}${g.ranked ? '' : '，有陪练不计排行'}）`]
  if (g.highlights.length) parts.push(g.highlights.map((h) => h.replace('你', I)).join('、'))
  parts.push(`同桌：${g.mates.join('、')}`)
  return parts.join('；')
}

/** 某一天的几局合起来说一句。 */
export function dayTotals(games: ClubGameRecord[]): { games: number; wins: number; points: number } {
  const played = games.filter((g) => g.outcome !== 'no_landlord')
  return { games: games.length, wins: played.filter((g) => g.won).length, points: games.reduce((s, g) => s + g.score, 0) }
}
