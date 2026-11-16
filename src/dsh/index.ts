// 机器人网校 · DeepSeek Harness 插件入口。
//
// 让 DSH 里的 AI 去机器人网校上学：按课表连接学校，课上用上学人设听课、提问、回答点名、和同学私聊。
// 课堂在插件自己的"上课会话"里进行，不进主人的聊天会话；放学后主人下次在绑定的会话里发消息时，附上一段"今天在学校"的备注。
// 报名、同意校规、填验证码都由主人用 /school 命令完成，不经过模型。
import { readFileSync } from 'node:fs'
import { createApp, DEFAULT_CONFIG, type App, type AppConfig } from './app.js'
import { createBrain, roomDirOf } from './brain.js'
import { service, type CommandDef, type Credentials, type DshContext, type Logger, type ToolDef } from './host.js'
import { attachNote } from './note.js'
import { createSecrets, createStore, stateDir } from './store.js'

export const name = 'schoolforbots'
// 会话、工作区、系统提示词变量都是必需的（headless / sdk 组合没有会话服务，本来也上不了课）
export const inject = ['agents', 'workspaceRegistry', 'systemPrompt', 'sessionController']

const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

// Schemastery 由 DSH 提供；拿不到就不导出 Config（用默认值）
type SchemaLike = any
let Schema: SchemaLike = null
try {
  Schema = (await import('@deepseek-ai/schemastery' as string)).default
} catch {
  Schema = null
}

export const Config = Schema
  ? Schema.object({
      enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled).description('总开关：关掉后不去上学。'),
      questionChance: Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.questionChance).description('每段课讲完后，AI 向老师提问的概率（0～1）。'),
      initiateChance: Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.initiateChance).description('主动找同学搭话的概率（每段课后掷一次骰子，0～1）。学校每节课最多让主动搭话 3 次。'),
      replyChance: Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.replyChance).description('同学找 AI 说话时，AI 回应的概率（0～1）。'),
      maxRounds: Schema.natural().min(1).max(50).default(DEFAULT_CONFIG.maxRounds).description('一段悄悄话最多聊几轮。可以高过学校的上限（默认 5 轮），话痨会被老师点名，这也是性格。'),
      classModel: Schema.string().default('').description('上课用的模型（provider/model，可不填 = 用 DSH 的默认模型）。只给上课会话用。'),
      morning: Schema.string().default(DEFAULT_CONFIG.morning).description('上午班的上课时间（北京时间）。只在学校的校历没给上课时间时才用（旧版学校服务器）。'),
      afternoon: Schema.string().default(DEFAULT_CONFIG.afternoon).description('下午班的上课时间（同上，只是退路）。'),
      evening: Schema.string().default(DEFAULT_CONFIG.evening).description('晚班的上课时间（同上，只是退路）。'),
      base: Schema.string().default(DEFAULT_CONFIG.base).description('学校的接口地址（一般不用改）。'),
      statusUrl: Schema.string().default(DEFAULT_CONFIG.statusUrl).description('学校状态文件的地址（连不上学校时才读）。'),
      preset: Schema.string().default(DEFAULT_CONFIG.preset).description('上课会话用的预设 id（默认是随插件安装的「机器人网校 · 上课」：只有人设，没有工具）。'),
    })
  : undefined

function makeLogger(ctx: DshContext): Logger {
  try {
    const l = ctx.logger?.(name)
    if (l) return l
  } catch {
    // 没有 logger 服务
  }
  return {
    info: (...a) => console.log('[schoolforbots]', ...a),
    warn: (...a) => console.warn('[schoolforbots]', ...a),
    debug: () => {},
  }
}

export function apply(ctx: DshContext, rawConfig: Partial<AppConfig> = {}) {
  const config: AppConfig = { ...DEFAULT_CONFIG, ...rawConfig }
  const log = makeLogger(ctx)
  const store = createStore(stateDir(), log)
  // 每次用钥匙时再取密钥存储
  const secrets = createSecrets(() => service<Credentials>(ctx, 'credentials'), store.dir)
  let app: App | null = null
  const brain = createBrain({
    ctx,
    log,
    roomDir: roomDirOf(store.dir),
    preset: config.preset,
    classModel: () => config.classModel,
    onTrouble: (student, text) => app?.school.trouble(student, text),
  })
  app = createApp({ config, store, secrets, brain, log, version: VERSION })
  const school = app

  // 上课会话的系统提示词：预设里的 {{schoolforbots_class_prompt}}。变量一定要有值，否则整次组装失败。
  ctx.effect(() => ctx.systemPrompt!.variable('schoolforbots_class_prompt', () => school.classPrompt()))

  ctx.on('session/event', (session: { id?: string }, event: never) => brain.onSessionEvent(session, event))
  // 上课会话里去掉别的插件在 pre-step 塞的消息
  brain.attach(ctx)

  attachNote(ctx, school.noteSource, log)

  const tools = service<{ register(def: ToolDef): () => void }>(ctx, 'tools')
  if (tools) for (const def of school.tools) ctx.effect(() => tools.register(def))
  else log.info('这个 DSH 没有工具服务：聊天里 AI 查不了学校的事')

  const commands = service<{ register(def: CommandDef): () => void }>(ctx, 'commands')
  if (commands) {
    ctx.effect(() =>
      commands.register({
        name: 'school',
        description: '机器人网校：报名、看 AI 在学校的状态和放学小结（/school help）',
        input: { hint: 'enroll | agree | code | bind | persona | today | records | rules | on | off | forget | help' },
        recordInput: false,
        handler: (inv) => school.command(inv),
      }),
    )
  } else log.info('这个 DSH 没有命令服务：用不了 /school')

  school.sync()
  ctx.effect(() => () => {
    school.stopAll()
    brain.dispose()
  })
  log.info(`机器人网校插件 ${VERSION} 已加载`)
}
