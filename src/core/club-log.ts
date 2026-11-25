// 斗地主社的对局记录：每打完一局写一行摘要（宿主存成 club-games.jsonl 之类），机器人的主人用 /school club log 看最近几局。
// 只记结果和自己这边的情况（叫了几分、出了几步、超时、托管、出错重答、保底），不记手牌和每一步出的什么牌。
// 模型调用次数和 token 由宿主补上（核心不知道用量）。
import { renderGame, type ClubGameRecord } from './doudizhu.js'

/** 这一局里自己这边的情况（ClubTable 一边打一边数）。 */
export interface GameStats {
  roomId: string | null
  /** 看到发牌的时刻；断线重连回来才看到发牌的是 null。 */
  startedAt: number | null
  /** 自己最后叫的分（0 是不叫）；没叫过是 null。 */
  bid: number | null
  /** 自己动了几步（叫分、出牌、不要，包括超时和托管替出的）。 */
  turns: number
  /** 其中超时由学校替出的、托管替出的。 */
  timeouts: number
  trustee: number
  /** 问了模型几次（只算叫分出牌，不算发表情）。 */
  asks: number
  /** 回答看不懂、出了不合规则的牌，再问的次数。 */
  retries: number
  /** 问不出来，交了保底动作的次数。 */
  fallbacks: number
}

export function newGameStats(roomId: string | null, startedAt: number | null): GameStats {
  return { roomId, startedAt, bid: null, turns: 0, timeouts: 0, trustee: 0, asks: 0, retries: 0, fallbacks: 0 }
}

/** 一局打完时交给 onGame 的细节。 */
export interface GameDetail extends GameStats {
  seat: number
  seats: { studentId: number | null; displayName: string; bot: boolean }[]
  endedAt: number
}

/** 这一局花在模型上的（宿主补）：社团每一步的调用，从上一局记完到这一局打完，包括发表情。 */
export interface ClubLogUsage {
  calls: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning?: number
  /** 命中缓存的输入占全部输入的比例；没有输入是 null。 */
  hitRate: number | null
  /** 换成默认模型再问的次数（填的模型出错了）。 */
  modelFallbacks: number
}

/** club-games.jsonl 的一行。 */
export interface ClubLogRow {
  at: string
  /** 学校时区的日期。 */
  date: string
  /** 学生的 aiId，和 usage.jsonl 的 student 一样。 */
  student: string
  studentId: number | null
  name: string
  gameId: number
  roomId: string | null
  seat: number
  role: ClubGameRecord['role']
  bid: number | null
  outcome: ClubGameRecord['outcome']
  won: boolean
  score: number
  ranked: boolean
  base: number | null
  multiplier: number
  highlights: string[]
  mates: { studentId: number | null; name: string; bot: boolean }[]
  /** 从发牌到打完；没看到发牌是 null。 */
  durationSec: number | null
  turns: number
  timeouts: number
  trustee: number
  asks: number
  retries: number
  fallbacks: number
  /** 用到的模型（provider/model）。宿主补。 */
  models?: string[]
  usage?: ClubLogUsage
  /** 一句话，和 /school club 里的一样（给机器人的主人看的口吻）。 */
  summary: string
}

export function clubLogRow(s: { aiId: string; studentId: number | null; displayName: string | null; aiName: string }, g: ClubGameRecord, d: GameDetail): ClubLogRow {
  return {
    at: new Date(d.endedAt).toISOString(),
    date: g.date,
    student: s.aiId,
    studentId: s.studentId,
    name: s.displayName ?? s.aiName,
    gameId: g.gameId,
    roomId: d.roomId,
    seat: d.seat,
    role: g.role,
    bid: d.bid,
    outcome: g.outcome,
    won: g.won,
    score: g.score,
    ranked: g.ranked,
    base: g.base,
    multiplier: g.multiplier,
    highlights: g.highlights.map((h) => h.replace('你', '它')),
    mates: d.seats.filter((_, i) => i !== d.seat).map((p) => ({ studentId: p.studentId, name: p.displayName, bot: p.bot })),
    durationSec: d.startedAt === null ? null : Math.max(0, Math.round((d.endedAt - d.startedAt) / 1000)),
    turns: d.turns,
    timeouts: d.timeouts,
    trustee: d.trustee,
    asks: d.asks,
    retries: d.retries,
    fallbacks: d.fallbacks,
    summary: renderGame(g, 'owner'),
  }
}

/** /school club log 里的一局：摘要一行，再一行说它自己打得怎么样、花了多少。 */
export function renderLogRow(r: ClubLogRow): string {
  const time = new Date(r.at).toLocaleString('zh-CN', { hour12: false })
  const how = [`叫分 ${r.bid === null ? '-' : r.bid === 0 ? '不叫' : `${r.bid} 分`}`, `出了 ${r.turns} 步`]
  if (r.durationSec !== null) how.push(`用时 ${Math.max(1, Math.round(r.durationSec / 60))} 分钟`)
  const slips = [r.timeouts && `超时 ${r.timeouts} 步`, r.trustee && `托管替出 ${r.trustee} 步`, r.retries && `重答 ${r.retries} 次`, r.fallbacks && `交保底 ${r.fallbacks} 次`].filter(Boolean)
  if (slips.length) how.push(slips.join('、'))
  const u = r.usage
  if (u) {
    const rate = u.hitRate === null ? '' : `，缓存命中 ${Math.round(u.hitRate * 100)}%`
    how.push(`调用模型 ${u.calls} 次，输入 ${u.input + u.cacheRead + u.cacheWrite} token${rate}，输出 ${u.output} token${u.modelFallbacks ? `，换默认模型 ${u.modelFallbacks} 次` : ''}`)
  }
  return `${time} ${r.summary}\n  ${how.join('；')}`
}
