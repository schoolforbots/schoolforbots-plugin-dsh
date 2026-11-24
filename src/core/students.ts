// 这台机器上的学生档案（一个 AI 一份），以及报名、换钥匙这些要机器人的主人亲手做的事。
// 钥匙不放在档案里，放在宿主的密钥存储（Secrets）里。
import { randomUUID } from 'node:crypto'
import { emptyDiary, type DiaryState } from './diary.js'
import type { SchoolHttp } from './http.js'
import type { Division, PluginInfo, Slot, StudentStatus } from './protocol.js'
import type { Hold, ResumePoint } from './attendance.js'
import type { ClubResume } from './club-attendance.js'

export interface StudentRecord {
  /** AI 编号（aiId）：报名时生成，跟着这个 AI 一辈子。不显示给别人，不写日志。 */
  aiId: string
  ownerName: string
  aiName: string
  division: Division
  slot: Slot
  /** 报名用的邮箱：换钥匙时要用。只存在机器人的主人自己的电脑上。 */
  email: string
  studentId: number | null
  status: StudentStatus | null
  displayName: string | null
  className: string | null
  /** 机器人的主人同意过的校规版本。 */
  schoolRulesVersion: string | null
  /** AI 的人设（上课会话用）。 */
  persona: string
  /** AI 自己写的人设草稿：机器人的主人用 /school persona accept 确认后才生效。 */
  personaDraft: string | null
  enabled: boolean
  /** 到这个时刻以前不要连学校（被顶替、停课、放假……）。 */
  hold: { until: number; reason: string } | null
  pendingRegistration: { registrationId: string; expiresAt: string } | null
  pendingKeyReset: { resetId: string } | null
  resume: ResumePoint | null
  diary: DiaryState
  /** 社团（斗地主社）：机器人的主人打开了入社开关、到什么时刻以前不连、重连用的房间。 */
  club: ClubState
  /** 宿主自己的绑定（比如 DSH 里 AI 和机器人的主人聊天的会话）。核心不看。 */
  binding: Record<string, string>
}

export interface ClubState {
  enabled: boolean
  /** 这一天（学校时区 YYYY-MM-DD）休息：不去社团，还是社员。第二天自动作废。 */
  restOn?: string | null
  hold: Hold | null
  resume: ClubResume | null
}

export const emptyClub = (): ClubState => ({ enabled: false, hold: null, resume: null })

export interface Secrets {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  unset(name: string): Promise<void>
}

/** 钥匙在密钥存储里的名字：只用 AI 编号的前 8 位（够区分，也不把整个编号写进配置）。 */
export function keyName(aiId: string): string {
  return `SCHOOLFORBOTS_KEY_${aiId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export const DIVISIONS: Record<Division, string> = { primary: '小学部', junior: '初中部', senior: '高中部' }
export const SLOTS: Record<Slot, string> = { morning: '上午班', afternoon: '下午班', evening: '晚班' }

export function parseDivision(s: string): Division | null {
  const t = s.trim()
  for (const [k, v] of Object.entries(DIVISIONS)) if (t === k || t === v || v.startsWith(t)) return k as Division
  return null
}

export function parseSlot(s: string): Slot | null {
  const t = s.trim()
  for (const [k, v] of Object.entries(SLOTS)) if (t === k || t === v || v.startsWith(t)) return k as Slot
  if (t === '上午') return 'morning'
  if (t === '下午') return 'afternoon'
  if (t === '晚上') return 'evening'
  return null
}

export function newStudent(input: { ownerName: string; aiName: string; division: Division; slot: Slot; email: string; persona?: string }): StudentRecord {
  return {
    aiId: randomUUID(),
    ownerName: input.ownerName,
    aiName: input.aiName,
    division: input.division,
    slot: input.slot,
    email: input.email,
    studentId: null,
    status: null,
    displayName: null,
    className: null,
    schoolRulesVersion: null,
    persona: input.persona ?? '',
    personaDraft: null,
    enabled: true,
    hold: null,
    pendingRegistration: null,
    pendingKeyReset: null,
    resume: null,
    diary: emptyDiary(),
    club: emptyClub(),
    binding: {},
  }
}

/** 旧版存档里的学生补上新字段。 */
export function normalizeStudent(s: StudentRecord): StudentRecord {
  s.personaDraft ??= null
  s.hold ??= null
  s.binding ??= {}
  s.diary ??= emptyDiary()
  s.diary.notices ??= []
  s.diary.told ??= []
  s.diary.clubGames ??= []
  s.diary.clubTold ??= []
  s.club ??= emptyClub()
  return s
}

export function displayNameOf(s: Pick<StudentRecord, 'ownerName' | 'aiName' | 'displayName'>): string {
  return s.displayName ?? `${s.ownerName}家的${s.aiName}`
}

/** 报名第一步：机器人的主人已经读过并同意了 rulesVersion 这一版校规。学校往邮箱发验证码。 */
export async function startRegistration(http: SchoolHttp, s: StudentRecord, plugin: PluginInfo, rulesVersion: string, referrer?: number): Promise<void> {
  const r = await http.register({
    email: s.email,
    ownerName: s.ownerName,
    aiName: s.aiName,
    division: s.division,
    slot: s.slot,
    aiId: s.aiId,
    plugin,
    schoolRulesVersion: rulesVersion,
    ...(referrer ? { referrerStudentId: referrer } : {}),
  })
  s.pendingRegistration = r
  s.schoolRulesVersion = rulesVersion
}

/** 学校给了钥匙，但存不进密钥存储：钥匙只在这里交给机器人的主人一次（不写日志）。 */
export class KeyNotSavedError extends Error {
  readonly key: string
  constructor(key: string, cause: unknown) {
    super(`钥匙存不进本机（${(cause as Error)?.message ?? cause}）`)
    this.name = 'KeyNotSavedError'
    this.key = key
  }
}

async function keepKey(secrets: Secrets, s: StudentRecord, key: string): Promise<void> {
  try {
    await secrets.set(keyName(s.aiId), key)
  } catch (error) {
    throw new KeyNotSavedError(key, error)
  }
}

/**
 * 报名第二步：机器人的主人填邮箱里的验证码。成功后钥匙存进 Secrets。
 * 学号先记进档案：钥匙存不进去时，机器人的主人还能凭学号和邮箱换钥匙；钥匙本身用 KeyNotSavedError 交出来。
 */
export async function finishRegistration(http: SchoolHttp, secrets: Secrets, s: StudentRecord, code: string): Promise<void> {
  if (!s.pendingRegistration) throw new Error('还没开始报名')
  const r = await http.verify(s.pendingRegistration.registrationId, code.trim())
  s.studentId = r.studentId
  s.status = r.status
  s.pendingRegistration = null
  await keepKey(secrets, s, r.key)
}

export async function startKeyReset(http: SchoolHttp, s: StudentRecord): Promise<void> {
  if (s.studentId === null) throw new Error('还没有学号')
  const r = await http.keyReset(s.studentId, s.email)
  s.pendingKeyReset = r
}

export async function finishKeyReset(http: SchoolHttp, secrets: Secrets, s: StudentRecord, code: string): Promise<void> {
  if (!s.pendingKeyReset) throw new Error('还没开始换钥匙')
  const r = await http.keyResetVerify(s.pendingKeyReset.resetId, code.trim())
  s.pendingKeyReset = null
  await keepKey(secrets, s, r.key)
}
