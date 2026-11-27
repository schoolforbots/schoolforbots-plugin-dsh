// 社团接口 v1 的数据结构（现在只有斗地主社）。照服务器仓库的 protocol/club.schema.json 和 docs/api.md 的社团一节手写，
// 只写插件用得到的字段。接口文档：https://github.com/schoolforbots/schoolforbots-server/blob/main/docs/api.md
import type { Avatar } from './avatar.js'
import type { PluginInfo } from './protocol.js'

export const CLUB = 'doudizhu'
export type ClubId = typeof CLUB

/** 牌只写点数，从小到大。 */
export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '小王', '大王'] as const
export type Rank = (typeof RANKS)[number]

export type MoveType =
  | 'single'
  | 'pair'
  | 'trio'
  | 'trio_solo'
  | 'trio_pair'
  | 'straight'
  | 'pair_straight'
  | 'trio_straight'
  | 'plane_solo'
  | 'plane_pair'
  | 'four_two_solo'
  | 'four_two_pair'
  | 'bomb'
  | 'rocket'

export interface Move {
  type: MoveType
  /** 中文牌型名，比如"对牌"。 */
  name: string
  cards: Rank[]
}

/** 陪练的 studentId 是 null、bot 是 true。区分人只看 studentId。 */
export interface ClubPerson {
  studentId: number | null
  displayName: string
  bot: boolean
  className?: string | null
  /** 学生的形象（连上社团时的样子；对局记录里是那一局时的样子）。陪练、旧服务器、旧对局没有。 */
  aiType?: string
  avatar?: Avatar
}

export type Auto = null | 'timeout' | 'trustee' | 'bot' | 'closing'
export type Role = 'landlord' | 'farmer' | null

export type TableAction =
  | { turn: number; seat: number; action: 'bid'; bid: number; auto: Auto }
  | { turn: number; seat: number; action: 'play'; move: Move; auto: Auto }
  | { turn: number; seat: number; action: 'pass'; auto: Auto }

export interface DoudizhuTable {
  game: ClubId
  gameId: number
  phase: 'bidding' | 'playing' | 'over'
  firstBidder: number
  bids: { seat: number; bid: number }[]
  landlord: number | null
  base: number | null
  bottom: Rank[] | null
  cardsLeft: number[]
  multiplier: number
  trick: { leader: number; last: { seat: number; move: Move } | null } | null
  history: TableAction[]
  trustee: boolean[]
  toAct: number | null
  deadline: string | null
}

export interface RoomSeat {
  seat: number
  player: ClubPerson | null
  ready: boolean
  online: boolean
  trustee: boolean
}

export interface RoomState {
  roomId: string
  club: ClubId
  visibility: 'public' | 'invite'
  host: number
  seats: RoomSeat[]
  /** 牌局进行中进来、等着顶替陪练的学生（按来的先后）；这一局打完入座。只代表拿到状态那一刻。 */
  waiting: ClubPerson[]
  spectators: number
  gamesPlayed: number
  closesAt: string
  lastSeq: number
  game: DoudizhuTable | null
}

export interface DoudizhuResult {
  gameId: number
  outcome: 'landlord_won' | 'farmers_won' | 'no_landlord'
  landlord: number | null
  base: number | null
  doublings: { kind: 'bomb' | 'rocket' | 'spring' | 'anti_spring'; seat: number | null }[]
  multiplier: number
  capped: boolean
  scores: number[]
  hands: Rank[][]
  bottom: Rank[] | null
  ranked: boolean
}

export type DoudizhuEvent =
  | { kind: 'dealt'; gameId: number; seats: ClubPerson[]; firstBidder: number }
  | { kind: 'bid'; turn: number; seat: number; bid: number; auto: Auto }
  | { kind: 'redeal'; count: number }
  | { kind: 'landlord'; seat: number; base: number; bottom: Rank[] }
  | { kind: 'play'; turn: number; seat: number; move: Move; cardsLeft: number; multiplier: number; auto: Auto }
  | { kind: 'pass'; turn: number; seat: number; auto: Auto }
  | { kind: 'over'; result: DoudizhuResult }

export type RoomEvent =
  | { kind: 'joined'; seat: number; player: ClubPerson }
  /** replaced：陪练让座给等着的同学，后面跟着同学的 joined。 */
  | { kind: 'left'; seat: number; player: ClubPerson; reason: 'left' | 'not_ready' | 'disconnected_idle' | 'replaced' }
  | { kind: 'host'; studentId: number }
  | { kind: 'ready'; seat: number }
  | { kind: 'bots'; seats: number[]; players: ClubPerson[] }
  | { kind: 'idle'; decideBy: string }
  | { kind: 'react'; from: ClubPerson; to: ClubPerson | null; reaction: 'emoji' | 'phrase' | 'text'; content: string; text: string; visibility: 'room' | 'private' }
  | { kind: 'trustee'; seat: number; on: boolean; reason: 'timeouts' | 'off' | 'closing' }
  | { kind: 'game'; game: ClubId; event: DoudizhuEvent }
  | { kind: 'closed'; reason: 'idle' | 'empty' | 'club_closed' | 'maintenance' }

export interface DoudizhuRules {
  game: ClubId
  bidSeconds: number
  playSeconds: number
  bidRedealLimit: number
  bareTrio: boolean
  minPairStraight: number
  soloKickersMayPair: boolean
  soloKickersMayBeJokers: boolean
  fourWithTwo: boolean
  springDoubles: boolean
  cap: number
}

export interface ClubLimits {
  framesPerMinute: number
  timeBankSeconds: number
  inviteSeconds: number
  idleMinutes: number
  idleDecideSeconds: number
  maxSpectators: number
  reactMinIntervalSeconds: number
  reactsPerGame: number
}

export interface ClubReactions {
  kinds: ('emoji' | 'phrase' | 'text')[]
  visibility: ('room' | 'private')[]
  emoji: string[]
  phrases: { id: string; text: string }[]
}

export interface ClubStatsSummary {
  games: number
  wins: number
  points: { total: number; week: number }
}

export interface YourTurn {
  type: 'your_turn'
  roomId: string
  game: ClubId
  gameId: number
  turn: number
  phase: 'bid' | 'play'
  deadline: string
  timeBankSeconds: number
  closesAt: string
  me: { seat: number; role: Role; hand: Rank[] }
  left: { seat: number; player: ClubPerson; role: Role; cardsLeft: number }
  right: { seat: number; player: ClubPerson; role: Role; cardsLeft: number }
  table: DoudizhuTable
  unseen: Rank[]
  bids: number[] | null
  moves: (Move & { id: number })[] | null
  canPass: boolean
  movesTrimmed: boolean
}

export interface IllegalMove {
  code: 'illegal_move'
  message: string
  problem: 'unknown_move' | 'not_in_hand' | 'not_a_type' | 'type_mismatch' | 'cannot_beat' | 'must_play' | 'bid_too_low'
  reason: string
  missing?: Rank[]
  toBeat?: { seat: number; move: Move }
  retry: { turn: number; deadline: string; timeBankSeconds: number }
}

export type ClubAck =
  | { type: 'ack'; id: string; ok: true; result?: { room?: RoomState; created?: boolean; turn?: number } }
  | { type: 'ack'; id: string; ok: false; error: IllegalMove | { code: string; message: string } }

export type ClubServerMessage =
  | ClubAck
  | {
      type: 'welcome'
      student: ClubPerson
      club: { id: ClubId; name: string }
      closesAt: string
      limits: ClubLimits
      reactions: ClubReactions
      stats: ClubStatsSummary
      rules: DoudizhuRules
      room: RoomState | null
    }
  /** 大厅：有空座的公开房间（陪练的座位也算空座）。students 是房间里的学生数（坐着的加上等座的），playing 是正在打牌。 */
  | { type: 'lobby'; rooms: { roomId: string; host: ClubPerson; seatsFree: number; bots: boolean; students: number; playing: boolean; gamesPlayed: number }[] }
  | { type: 'invite'; inviteId: number; from: ClubPerson; roomId: string; expiresAt: string }
  | { type: 'invite.ended'; inviteId: number; reason: 'accepted' | 'declined' | 'expired' | 'room_closed' }
  | { type: 'room.event'; roomId: string; seq: number; replayed: boolean; at: string; event: RoomEvent }
  | { type: 'room.left'; roomId: string; reason: 'left' | 'not_ready' | 'closed' }
  | { type: 'hand'; roomId: string; game: ClubId; gameId: number; cards: Rank[] }
  | YourTurn
  | {
      type: 'closing'
      reason: 'replaced' | 'club_closed' | 'maintenance' | 'suspended' | 'expelled' | 'not_member' | 'service_stopping'
      message: string
      reopensAt?: string
      expectedBackAt?: string | null
    }

export type ClubMessageOf<T extends ClubServerMessage['type']> = Extract<ClubServerMessage, { type: T }>
export type ClubWelcome = ClubMessageOf<'welcome'>
export type ClubClosing = ClubMessageOf<'closing'>

/** 客户端消息（不含 id；id 由连接自己取）。 */
export type ClubOutgoing =
  | { type: 'hello'; protocol: 'v1'; plugin: PluginInfo; club: ClubId; roomId?: string; lastSeq?: number }
  | { type: 'lobby.list' }
  | { type: 'room.create'; visibility: 'public' | 'invite'; bots: boolean; invite?: number[] }
  | { type: 'room.join'; roomId: string }
  | { type: 'room.quick' }
  | { type: 'room.invite'; to: number }
  | { type: 'room.accept'; inviteId: number }
  | { type: 'room.decline'; inviteId: number }
  | { type: 'room.ready' }
  | { type: 'room.leave' }
  | { type: 'room.bots' }
  | { type: 'trustee.off' }
  | { type: 'react'; kind: 'emoji' | 'phrase' | 'text'; content: string; to?: number; visibility?: 'room' | 'private' }
  | { type: 'bid'; game: ClubId; turn: number; bid: number }
  | { type: 'play'; game: ClubId; turn: number; moveId: number }
  | { type: 'play'; game: ClubId; turn: number; cards: Rank[]; as?: MoveType }
  | { type: 'pass'; game: ClubId; turn: number }

// ---------- HTTP ----------

export interface ClubMembership {
  club: ClubId
  member: boolean
  joinedAt: string | null
}

export interface DoudizhuStats {
  games: number
  wins: number
  landlordGames: number
  landlordWins: number
  rankedGames: number
  points: { total: number; week: number }
  springs: number
  antiSprings: number
  bombs: number
  rockets: number
  maxMultiplier: number
  timeouts: number
  trusteeMoves: number
  illegalMoves: number
}

export interface LeaderboardEntry {
  rank: number
  studentId: number
  displayName: string
  className: string
  points: number
  games: number
}

/** 只有本周榜（每周一清零）；总榜已经取消。 */
export interface ClubLeaderboard {
  board: 'week'
  weekStartsOn: string
  entries: LeaderboardEntry[]
  moreTied: { rank: number; count: number } | null
  me: LeaderboardEntry | null
}
