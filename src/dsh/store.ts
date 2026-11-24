// 插件的存档：<DSH_HOME>/schoolforbots/state.json（学生档案、日记、续课点）。
// 钥匙不在这里：放 DSH 的密钥存储（ctx.credentials），存不进去时退回同目录的 secrets.json。
//
// - 同一个进程里，同一个文件只有一份内存副本：热重载时新旧实例共用它，旧实例迟到的写入不会把新状态盖掉。
// - Windows 上换文件可能碰到 EPERM/EBUSY（杀毒、索引占用）：短暂重试，还不行就记日志，不把异常抛进上学循环。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeStudent, type Secrets, type StudentRecord } from '../core/students.js'
import type { Credentials, Logger } from './host.js'

/** 插件开过的一个上课会话：用来把旧的归档（brain.ts）。 */
export interface ClassSessionRecord {
  sid: string
  /** 学生的 aiId。 */
  student: string
  /** 这节课开始的时刻：同一节课的会话一样。 */
  lessonAt: number
  /** 这节课中途换掉了（超时、模型出错、改了工具名单）：马上归档。 */
  retired?: true
  /** 机器人的主人在里面打过字，让给了机器人的主人：一直不动。 */
  ownerTook?: true
}

export interface PluginState {
  version: 1
  students: StudentRecord[]
  /** 插件开过、还没归档的上课会话。 */
  classSessions?: ClassSessionRecord[]
}

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function stateDir(): string {
  return join(dshHome(), 'schoolforbots')
}

/**
 * 读一个 JSON 存档。只有文件不存在才用 fallback；内容坏了（解析失败）先把原文件改名成 `*.corrupt-<时间>` 留着，
 * 再用 fallback；别的读错误（比如 Windows 上被杀毒软件短暂占用的 EBUSY）直接抛出——绝不能拿空档当真，
 * 下次保存就把真实的学生档案和钥匙覆盖掉了。
 */
export function readJson<T>(file: string, fallback: T, log?: Pick<Logger, 'warn'>): T {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback
    throw new Error(`读不了 ${file}（${(error as NodeJS.ErrnoException)?.code ?? (error as Error)?.message}），为了不覆盖它，插件先不启动`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const kept = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(file, kept)
    } catch {
      throw new Error(`${file} 的内容坏了，也没法改名备份；为了不覆盖它，插件先不启动`)
    }
    log?.warn(`${file} 的内容坏了，原文件改名成了 ${kept}，从空档开始`)
    return fallback
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 先写临时文件再换过去；换不过去时重试几次。返回有没有写成。 */
export function writeJson(file: string, data: unknown, log?: Logger, rename: (from: string, to: string) => void = renameSync): boolean {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    for (let i = 0; ; i++) {
      try {
        rename(tmp, file)
        return true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && i < 4) {
          sleepSync(50 * (i + 1))
          continue
        }
        throw error
      }
    }
  } catch (error) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // 临时文件删不掉就算了
    }
    log?.warn(`存档写不进去（${(error as NodeJS.ErrnoException).code ?? (error as Error).message}），下次再试`)
    return false
  }
}

export interface Store {
  dir: string
  state: PluginState
  save(): void
}

const stores = new Map<string, Store>()

export function createStore(dir = stateDir(), log?: Logger): Store {
  const existing = stores.get(dir)
  if (existing) return existing
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'state.json')
  const state = readJson<PluginState>(file, { version: 1, students: [] }, log)
  if (!Array.isArray(state.students)) state.students = []
  for (const s of state.students) normalizeStudent(s)
  const store: Store = { dir, state, save: () => void writeJson(file, state, log) }
  stores.set(dir, store)
  return store
}

/** 测试用：忘掉进程里的存档副本。 */
export function forgetStores(): void {
  stores.clear()
}

/**
 * 钥匙放哪：每次用的时候再取 DSH 的密钥存储；读两边都查（先密钥存储，再 secrets.json），
 * 写先写密钥存储，写不进去再写文件。
 */
export function createSecrets(credentials: () => Credentials | undefined, dir = stateDir()): Secrets {
  const file = join(dir, 'secrets.json')
  const cred = () => {
    const c = credentials()
    return c && typeof c.resolve === 'function' && typeof c.set === 'function' ? c : undefined
  }
  const readFile = () => readJson<Record<string, string>>(file, {})
  return {
    async get(name) {
      const c = cred()
      if (c) {
        try {
          const v = (await c.resolve(name))?.value
          if (v) return v
        } catch {
          // 读不出来就看文件
        }
      }
      return readFile()[name] ?? null
    },
    async set(name, value) {
      const c = cred()
      if (c) {
        try {
          await c.set(name, value)
          // 文件里的旧钥匙删掉，免得两边对不上
          const all = readFile()
          if (name in all) {
            delete all[name]
            writeJson(file, all)
          }
          return
        } catch {
          // 存不进密钥存储：写文件
        }
      }
      const all = readFile()
      all[name] = value
      if (!writeJson(file, all)) throw new Error('钥匙文件写不进去')
    },
    async unset(name) {
      const c = cred()
      if (c) await c.unset(name).catch(() => undefined)
      const all = readFile()
      if (name in all) {
        delete all[name]
        writeJson(file, all)
      }
    },
  }
}
