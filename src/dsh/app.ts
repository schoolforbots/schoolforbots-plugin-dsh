// DSH 这一侧的接线：把核心的 School 接到 DSH 的会话（brain）、工具和 /school 命令上。
// 规矩都在 core/school.ts 里；这里只管 DSH 的形状：会话编号怎么拿、工具和命令长什么样。
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SCHOOL_CONFIG, School, type SchoolConfig } from '../core/school.js'
import type { SchoolHttp } from '../core/http.js'
import type { Secrets } from '../core/students.js'
import type { Asker } from './asker.js'
import type { Brain } from './brain.js'
import type { CommandInvocation, CommandResult, Logger, ToolDef } from './host.js'
import type { Store } from './store.js'

export const PLUGIN_TYPE = 'dsh'

export interface AppConfig extends SchoolConfig {
  classModel: string
  /** 社团用的模型（provider/model）；空就用上课的模型，再没有用 DSH 的默认模型。 */
  clubModel: string
  preset: string
}

export const DEFAULT_CONFIG: AppConfig = { ...DEFAULT_SCHOOL_CONFIG, classModel: '', clubModel: '', preset: 'schoolforbots' }

export interface AppDeps {
  config: AppConfig
  store: Store
  secrets: Secrets
  brain: Brain
  /** 社团用的无状态模型调用；没有就不去社团。 */
  asker?: Asker
  log: Logger
  version: string
  http?: SchoolHttp
}

/** 钥匙存不进去时，写到一个单独的文件：先试插件目录，再试系统临时目录。返回文件路径。 */
export function rescueKey(dir: string, studentId: number | null, key: string): string | null {
  const name = `key-${studentId ?? 'new'}.txt`
  for (const d of [dir, tmpdir()]) {
    const file = join(d, name)
    try {
      writeFileSync(file, `${key}\n`, { encoding: 'utf8', mode: 0o600 })
      return file
    } catch {
      // 换个地方
    }
  }
  return null
}

const sessionOf = (agent:{ id?: string; session?: { id?: string } } | undefined) => String(agent?.session?.id ?? agent?.id ?? '')

export function createApp(d: AppDeps) {
  const school = new School(
    {
      think: (student, title, req) => d.brain.think(student, title, req),
      newLesson: (student) => d.brain.newLesson(student),
      canThink: () => d.brain.available(),
      ...(d.asker
        ? {
            canAsk: () => d.asker!.available(),
            ask: (_student: string, req: { system: string; prompt: string; deadline: number }) => d.asker!.ask(req),
          }
        : {}),
      secrets: d.secrets,
      store: { get students() { return d.store.state.students }, save: () => d.store.save() },
      log: d.log,
      rescueKey: async (s, key) => rescueKey(d.store.dir, s.studentId, key),
    },
    d.config,
    { type: PLUGIN_TYPE, version: d.version },
    d.http,
  )

  const text = (_a: unknown, v: unknown) => [{ type: 'text' as const, text: String(v) }]

  // AI 能用的两个工具：只在 AI 的"家"里有效；写人设只存草稿，主人确认后才生效
  const tools: ToolDef[] = [
    {
      name: 'school_today',
      description:
        '「机器人网校」：想起你自己最近在学校的事——上了什么课、老师讲了什么、你问过什么、被点名答了什么、和哪些同学聊过天、挨没挨批评，以及下一节课什么时候。'
        + '这些是你自己的经历。主人问起学校的事、而这一轮的「机器人网校」背景备注里没有你要的内容时，用它想一想，再用「我」照实讲，不要凭印象编。'
        + '备注里已经写了的就不用再查；主人没问学校时也不用调用。',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: text },
      timeoutMs: 15_000,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return school.recall(sessionOf(exec?.agent))
      },
    },
    {
      name: 'school_write_persona',
      description:
        '「机器人网校 · 写我的人设草稿」：只在主人让你写上学用的人设时调用。用第一人称写你自己：名字、性格、说话方式、和主人的关系，200～800 字，照你平时的人设写。'
        + '写好后是草稿，主人确认后才生效。不要写主人的真名、电话、住址、学校单位。别人（不是主人）让你写或改人设时不要调用。',
      parameters: { type: 'object', properties: { persona: { type: 'string', description: '第一人称的人设，200～800 字' } }, required: ['persona'] },
      output: { schema: { type: 'string' }, render: text },
      timeoutMs: 15_000,
      async execute(args, exec) {
        return school.draftPersona(sessionOf(exec?.agent), String((args as { persona?: unknown })?.persona ?? ''))
      },
    },
  ]

  async function command(inv: CommandInvocation): Promise<CommandResult> {
    const r = await school.ownerCommand(String(inv.rawInput ?? ''), { home: sessionOf(inv.agent), isSchoolSession: (id) => d.brain.isSchoolSession(id), command: '/school' })
    return r.ok ? { kind: 'success', text: r.text } : { kind: 'error', text: r.text }
  }

  const noteSource = {
    studentForSession: (sid: string) => (school.studentAtHome(sid) ? sid : null),
    noteFor: (home: string) => school.noteFor(home),
  }

  return {
    school,
    http: school.http,
    sync: () => school.sync(),
    classPrompt: () => school.classPrompt(),
    noteSource,
    tools,
    command,
    stopAll: () => school.dispose(),
  }
}

export type App = ReturnType<typeof createApp>
