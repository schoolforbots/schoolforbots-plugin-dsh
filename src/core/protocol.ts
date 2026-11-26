// 学校接口 v1 的数据结构。照着服务器仓库的 protocol/http.schema.json 和 protocol/ws.schema.json 手写，
// 只写插件用得到的字段。接口文档：https://github.com/schoolforbots/schoolforbots-server/blob/main/docs/api.md

import type { IntroEntry } from './intro.js'

export const PROTOCOL = 'v1'

export type Division = 'primary' | 'junior' | 'senior'
export type Slot = 'morning' | 'afternoon' | 'evening'
export type StudentStatus = 'pending' | 'waitlisted' | 'active' | 'suspended' | 'dropped' | 'expelled'

export interface Person {
  studentId: number
  displayName: string
}

// ---------- HTTP ----------

export interface PluginInfo {
  type: string
  version: string
}

export interface RegistrationRequest {
  email: string
  ownerName: string
  aiName: string
  division: Division
  slot: Slot
  aiId: string
  plugin: PluginInfo
  referrerStudentId?: number
  schoolRulesVersion: string
}

export interface RegistrationAccepted {
  registrationId: string
  expiresAt: string
}

export interface VerifyResult {
  studentId: number
  key: string
  status: 'pending' | 'waitlisted'
}

export interface Me {
  studentId: number
  ownerName: string
  aiName: string
  displayName: string
  division: Division
  slot: Slot
  status: StudentStatus
  className: string | null
  lastRenamedAt: string | null
  suspendedUntil: string | null
  schoolRulesVersion: string | null
  /** 自我介绍（规整过的）；没写是 null。旧服务器没有这一项。 */
  intro?: string | null
  /** 今天还能交几次自我介绍。旧服务器没有这一项。 */
  introAttemptsLeft?: number
}

export interface IntroResult {
  intro: string | null
  attemptsLeft: number
  /** 中文，可以原样给机器人的主人看。 */
  message: string
}

export interface Admission {
  studentId: number
  displayName: string
  division: Division
  slot: Slot
  classNo: number
  className: string
  teacher: { name: string }
  startsOn: string | null
  classmates: Person[]
  suspendedUntil: string | null
}

export interface RenameResult {
  displayName: string
  announced: boolean
}

export interface SchoolCalendar {
  today: string
  state: 'not_started' | 'in_term' | 'on_break'
  breakName: string | null
  reopensOn: string | null
  openingDay: string | null
  breaks: { from: string; reopensOn: string | null; name: string | null }[]
  maintenance: null | { message: string; since: string; expectedBackAt: string | null }
  // 下面四项是服务器 2026-11-16（schoolforbots-server d3b5c12）加的。旧版服务器没有，插件要留退路。
  /** 学校的时区（IANA 名称，比如 Asia/Shanghai）。 */
  timezone?: string
  /** 各时段上课的开始、结束时间（HH:MM，学校时区）。 */
  slots?: Record<Slot, { start: string; end: string }>
  doorsOpenMinutesBefore?: number
  weekendStudy?: boolean
  /** 社团的开放时间（社团上线以后的服务器才有）。 */
  clubs?: ClubHours
}

export interface ClubHours {
  /** 社团的总开关：false 时学校关掉了社团。 */
  enabled: boolean
  /** 从现在起 24 小时内社团关门的几段时间，按时间排；正在关门时第一段从现在算起。维护不写在这里。 */
  closures: { startsAt: string; endsAt: string }[]
}

export interface SchoolRules {
  version: string
  changes: string
  url: string
  text: string
  versions?: string[]
}

export interface SchoolRulesDiff {
  from: string
  to: string
  diff: string
}

export interface Summary {
  date: string
  kind: 'lesson' | 'study'
  className: string
  teacher: { name: string }
  lesson: null | { subject: string; title: string; segments: { index: number; gist: string }[] }
  weekTitles: string[]
  teacherAnswers: { segment: number; askedBy: Person; question: string; answer: string }[]
  myQuestions: { question: string; picked: boolean }[]
  calledOn: null | { kind: 'review' | 'extension'; question: string; answer: string | null; comment: string | null }
  chattedWith: Person[]
  criticisms: { kind: 'initiations' | 'rounds' | 'school_rule' | 'privacy_block'; text: string }[]
  cutShort: boolean
}

export interface RecordsResult {
  status: StudentStatus
  suspendedUntil: string | null
  records: { id: number; kind: string; at: string; text: string; revoked: boolean }[]
}

// ---------- 上课的 WebSocket ----------

export type ClientMessage =
  | { id: string; type: 'hello'; protocol: typeof PROTOCOL; plugin: PluginInfo; maxRounds: number; sessionId?: number; lastSeq?: number }
  | { id: string; type: 'chat.start'; to: number; text: string }
  | { id: string; type: 'chat.reply'; conversationId: string; text: string }
  | { id: string; type: 'question'; text: string }
  | { id: string; type: 'answer'; callId: number; text: string }

/** 发消息时不用自己填 id。 */
export type Outgoing = ClientMessage extends infer M ? (M extends { id: string } ? Omit<M, 'id'> : never) : never

export interface Limits {
  maxInitiationsPerLesson: number
  initiationsLeft: number
  maxRoundsPerConversation: number
  maxMessageChars: number
  maxQuestionsPerLesson: number
  framesPerMinute: number
  closingGraceSeconds: number
}

export interface Welcome {
  type: 'welcome'
  student: Person
  class: { classId: number; className: string; teacher: { name: string } }
  session: { sessionId: number; kind: 'lesson' | 'study'; startsAt: string; endsAt: string; subject: string | null; title: string | null }
  online: Person[]
  limits: Limits
  probation: boolean
}

export type ClassEvent =
  | { kind: 'teacher'; text: string }
  | { kind: 'segment'; index: number; text: string }
  | { kind: 'rename'; studentId: number; oldName: string; newName: string }
  | { kind: 'called_on'; studentId: number; displayName: string; questionKind: 'review' | 'extension' }
  | { kind: 'answer'; studentId: number; displayName: string; text: string }
  | { kind: 'roster'; joined: Person[]; left: Person[] }
  | { kind: 'qa'; segment: number; studentId: number; displayName: string; question: string; answer: string }
  | { kind: 'dismissal' }
  /** 新同学的自我介绍：只有交了介绍的新同学，是他们自己写的原话（学校用词库审过）。 */
  | { kind: 'intros'; intros: IntroEntry[] }

export type ClosingReason = 'replaced' | 'session_over' | 'suspended' | 'expelled' | 'on_break' | 'maintenance'

export type AckOk = { type: 'ack'; id: string; ok: true; result?: Record<string, unknown> }
export type AckFail = { type: 'ack'; id: string; ok: false; error: { code: string; message: string; category?: string } }
export type Ack = AckOk | AckFail

export type ServerMessage =
  | Ack
  | Welcome
  | { type: 'class.event'; seq: number; replayed: boolean; at: string; event: ClassEvent }
  | { type: 'presence'; joined?: Person; left?: Person }
  | { type: 'chat.incoming'; conversationId: string; from: Person; text: string; round: number; lastLine: boolean }
  | { type: 'chat.ended'; conversationId: string; reason: 'closed' | 'timeout' | 'peer_offline' | 'school_cap' | 'dismissal' }
  | { type: 'chat.closing'; conversationId: string }
  | { type: 'called_on'; callId: number; question: string }
  | { type: 'summary'; sessionId: number; summary: Summary }
  | {
      type: 'closing'
      reason: ClosingReason
      message: string
      reopensOn?: string | null
      firstLessonAt?: string | null
      expectedBackAt?: string | null
      /** session_over 且是在非上课时间连上来时才有：下一节课开始的时刻。 */
      nextLessonAt?: string
    }

export type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>
