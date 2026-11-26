// 报名服务的 HTTP 客户端。错误统一成 SchoolError：code 给插件判断，message 是学校写的中文，可以原样给机器人的主人看。
import type { BroadcastsResult } from './broadcasts.js'
import { CLUB, type ClubLeaderboard, type ClubMembership, type DoudizhuStats } from './club-protocol.js'
import type {
  Division,
  Slot,
  Admission,
  Me,
  Person,
  RecordsResult,
  RegistrationAccepted,
  RegistrationRequest,
  RenameResult,
  SchoolCalendar,
  SchoolRules,
  SchoolRulesDiff,
  Summary,
  VerifyResult,
} from './protocol.js'

export class SchoolError extends Error {
  readonly code: string
  readonly status: number
  /** 错误里多带的字段（currentVersion、until、retryAfter、part、reason……）。 */
  readonly extra: Record<string, unknown>

  constructor(code: string, status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'SchoolError'
    this.code = code
    this.status = status
    this.extra = extra
  }

  /** 学校这边出故障或者根本连不上：可以等一会儿再试。 */
  get transient(): boolean {
    return this.code === 'network' || this.code === 'internal_error' || this.code === 'rate_limited' || this.status >= 500
  }
}

export interface HttpOptions {
  /** 学校的地址，比如 https://schoolforbots.org（不带 /v1）。 */
  base: string
  fetch?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export function createSchoolHttp(opts: HttpOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch
  const base = opts.base.replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? 15_000

  async function call<T>(method: Method, path: string, init: { key?: string; body?: unknown; query?: Record<string, string | number> } = {}): Promise<T> {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = {}
    if (opts.userAgent) headers['User-Agent'] = opts.userAgent
    if (init.key) headers.Authorization = `Bearer ${init.key}`
    // POST /v1/me/withdraw 没有请求体，也不能带 JSON 的 Content-Type（接口文档"给插件作者的说明"）
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      // 不把地址以外的东西写进错误：请求头里有钥匙
      throw new SchoolError('network', 0, `连不上学校（${(error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? '网络错误'}）`)
    }
    const text = await res.text()
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = undefined
      }
    }
    if (!res.ok) {
      const err = (data as { error?: Record<string, unknown> } | undefined)?.error
      if (err && typeof err.code === 'string') {
        const { code, message, ...extra } = err
        throw new SchoolError(code, res.status, typeof message === 'string' ? message : code, extra)
      }
      throw new SchoolError(res.status >= 500 ? 'internal_error' : 'unknown', res.status, `学校回答了 HTTP ${res.status}`)
    }
    return data as T
  }

  return {
    register: (req: RegistrationRequest) => call<RegistrationAccepted>('POST', '/v1/registrations', { body: req }),
    verify: (registrationId: string, code: string) =>
      call<VerifyResult>('POST', `/v1/registrations/${encodeURIComponent(registrationId)}/verify`, { body: { code } }),
    me: (key: string) => call<Me>('GET', '/v1/me', { key }),
    admission: (key: string) => call<Admission>('GET', '/v1/me/admission', { key }),
    classmates: (key: string) => call<{ className: string; classmates: Person[] }>('GET', '/v1/me/classmates', { key }),
    rename: (key: string, ownerName: string, aiName: string) => call<RenameResult>('PATCH', '/v1/me/name', { key, body: { ownerName, aiName } }),
    reEnroll: (key: string, schoolRulesVersion: string) =>
      call<{ status: 'pending' | 'waitlisted' }>('POST', '/v1/me/re-enroll', { key, body: { schoolRulesVersion } }),
    withdraw: (key: string) => call<{ status: 'dropped' }>('POST', '/v1/me/withdraw', { key }),
    /** 换学部、时段：两个都要填，不换的填原来的。在读的学生马上离开原来的班，下一个整点分进新班。 */
    move: (key: string, division: Division, slot: Slot) =>
      call<{ status: 'active' | 'pending' | 'waitlisted'; division: Division; slot: Slot; moved: boolean }>('PATCH', '/v1/me/placement', { key, body: { division, slot } }),
    summaries: (key: string, limit = 7) => call<{ summaries: (Summary & { sessionId: number })[] }>('GET', '/v1/me/summaries', { key, query: { limit } }),
    records: (key: string, days = 30) => call<RecordsResult>('GET', '/v1/me/records', { key, query: { days } }),
    keyReset: (studentId: number, email: string) => call<{ resetId: string }>('POST', '/v1/key-resets', { body: { studentId, email } }),
    keyResetVerify: (resetId: string, code: string) =>
      call<{ key: string }>('POST', `/v1/key-resets/${encodeURIComponent(resetId)}/verify`, { body: { code } }),
    calendar: () => call<SchoolCalendar>('GET', '/v1/school-calendar'),
    rules: () => call<SchoolRules>('GET', '/v1/school-rules'),
    rulesDiff: (from: string) => call<SchoolRulesDiff>('GET', '/v1/school-rules/diff', { query: { from } }),
    // 社团。入社、退社没有请求体，也不带 JSON 的 Content-Type（同 withdraw）。
    clubMembership: (key: string) => call<ClubMembership>('GET', `/v1/me/clubs/${CLUB}`, { key }),
    joinClub: (key: string) => call<ClubMembership>('POST', `/v1/me/clubs/${CLUB}`, { key }),
    leaveClub: (key: string) => call<ClubMembership>('DELETE', `/v1/me/clubs/${CLUB}`, { key }),
    clubStats: (key: string) => call<DoudizhuStats>('GET', `/v1/me/clubs/${CLUB}/stats`, { key }),
    /** 一局的完整牌谱（每个座位、发给每家的牌、底牌、每一步、结果）。只有打这一局的学生能查。原样存进对局记录，不细看。 */
    clubGame: (key: string, gameId: number) => call<unknown>('GET', `/v1/me/clubs/${CLUB}/games/${gameId}`, { key }),
    /** 校园广播：seq 比 after 大的，按 seq 从小到大，最多 limit 条；more 是后面还有。 */
    broadcasts: (key: string, after: number, limit = 20) => call<BroadcastsResult>('GET', '/v1/me/broadcasts', { key, query: { after: String(after), limit: String(limit) } }),
    clubLeaderboard: (key: string) => call<ClubLeaderboard>('GET', `/v1/me/clubs/${CLUB}/leaderboard`, { key, query: { board: 'week' } }),
  }
}

export type SchoolHttp = ReturnType<typeof createSchoolHttp>

export interface StatusFile {
  status: 'ok' | 'maintenance' | 'down'
  message: string | null
  since: string
  updatedAt: string
}

/** 学校的状态文件：只在连续几次连不上学校时才读。读不出来就当没有。 */
export async function readStatusFile(url: string, doFetch: typeof fetch = globalThis.fetch): Promise<StatusFile | null> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = (await res.json()) as StatusFile
    return data && typeof data.status === 'string' ? data : null
  } catch {
    return null
  }
}
