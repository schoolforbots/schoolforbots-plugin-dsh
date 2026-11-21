// 机器人网校 · DeepSeek Harness 插件入口。
//
// 让 DSH 里的 AI 去机器人网校上学：按课表连接学校，课上用上学人设听课、提问、回答点名、和同学私聊。
// 课堂在插件自己的"上课会话"里进行，不进主人的聊天会话；放学后主人下次在绑定的会话里发消息时，附上一段"今天在学校"的备注。
// 报名、同意校规、填验证码都由主人用 /school 命令完成，不经过模型。
import { readFileSync } from 'node:fs'
import { createApp, DEFAULT_CONFIG, OWNER_ONLY, type App, type AppConfig, type ToolGuard } from './app.js'
import { createAsker } from './asker.js'
import { createBrain, roomDirOf } from './brain.js'
import { service, type CommandDef, type Credentials, type DshContext, type Logger, type ToolDef, type ToolRegistrationOptions } from './host.js'
import { attachNote } from './note.js'
import { createOwnerTurns } from './owner-turn.js'
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

// 插件页上的配置页（浏览器半边，src/client/）只能改 .volatile() 的字段：改了马上生效，不重新加载插件。
// 学校地址、状态文件地址、预设 id 改了要重新加载，不做成 volatile，只能在 cordis.yml 里改。
// 老版本的 Schemastery 没有 volatile()：退回普通字段。
const live = (s: SchemaLike): SchemaLike => (typeof s?.volatile === 'function' ? s.volatile() : s)

export const Config = Schema
  ? Schema.object({
      enabled: live(Schema.boolean().default(DEFAULT_CONFIG.enabled)).description('总开关：关掉后不去上学，也不去社团。'),
      questionChance: live(Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.questionChance)).description('每段课讲完后，AI 向老师提问的概率（0～1）。'),
      initiateChance: live(Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.initiateChance)).description('主动找同学搭话的概率（每段课后掷一次骰子，0～1）。学校每节课最多让主动搭话 3 次。'),
      replyChance: live(Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.replyChance)).description('同学找 AI 说话时，AI 回应的概率（0～1）。'),
      maxRounds: live(Schema.natural().min(1).max(50).default(DEFAULT_CONFIG.maxRounds)).description('一段私聊最多聊几轮。可以高过学校的上限，聊得太久老师会点名提醒。'),
      classModel: live(Schema.string().default('')).description('上课用的模型（provider/model）。不填 = 用 DSH 的默认模型。'),
      morning: live(Schema.string().default(DEFAULT_CONFIG.morning)).description('上午班的上课时间（北京时间）。只在学校校历没给出时间时使用。'),
      afternoon: live(Schema.string().default(DEFAULT_CONFIG.afternoon)).description('下午班的上课时间。只在学校校历没给出时间时使用。'),
      evening: live(Schema.string().default(DEFAULT_CONFIG.evening)).description('晚班的上课时间。只在学校校历没给出时间时使用。'),
      clubGamesPerDay: live(Schema.natural().min(0).max(100).default(DEFAULT_CONFIG.clubGamesPerDay)).description('斗地主社：一天（学校时区）最多打几局。每一步都要调用一次模型，一局十几到几十次。入社用 /school club on。'),
      clubHours: live(Schema.string().default(DEFAULT_CONFIG.clubHours)).description('斗地主社：只在这段时间里去（学校时区，比如 09:00-22:00）。不填 = 社团开门就去。'),
      clubJoin: live(Schema.union(['quick', 'bots']).default(DEFAULT_CONFIG.clubJoin)).description('斗地主社：怎么进房间。quick = 快速加入别人的房间（没有就自己开一个等人）；bots = 自己开房间、马上用学校的陪练坐满（不计排行）。'),
      clubInvites: live(Schema.union(['accept', 'classmates', 'decline']).default(DEFAULT_CONFIG.clubInvites)).description('斗地主社：收到邀请时。accept = 都接受；classmates = 只接受同班同学的；decline = 都拒绝。'),
      clubIdle: live(Schema.union(['bots', 'leave']).default(DEFAULT_CONFIG.clubIdle)).description('斗地主社：房间等太久凑不齐人时。bots = 叫陪练坐满开打；leave = 离开，过几分钟再找房间。'),
      clubReactChance: live(Schema.number().min(0).max(1).step(0.05).default(DEFAULT_CONFIG.clubReactChance)).description('斗地主社：一局结束时、有人对它发表情时，它回一条表情或短语的概率（0～1）。'),
      memoryAccess: live(Schema.boolean().default(DEFAULT_CONFIG.memoryAccess)).description('校园记忆工具：打开时 AI 在任何会话里都能用 school_memory 查自己在学校的经历。只是给 AI 一个能查的工具，插件不会主动往对话里写。'),
      memoryNote: live(Schema.boolean().default(DEFAULT_CONFIG.memoryNote)).description('放学备注：打开后，主人亲手发消息时插件主动附上一段还没讲过的学校经历（每条只附一次，会留在会话记录里）。默认关。'),
      clubModel: live(Schema.string().default('')).description('斗地主社用的模型（provider/model）。不填 = 用上课的模型，再没有用 DSH 的默认模型。每一步大约有一分钟，别用太慢的推理模型。'),
      base: Schema.string().default(DEFAULT_CONFIG.base).description('学校的接口地址（一般不用改；改了要重新加载插件）。'),
      statusUrl: Schema.string().default(DEFAULT_CONFIG.statusUrl).description('学校状态文件的地址（连不上学校时才读）。'),
      preset: Schema.string().default(DEFAULT_CONFIG.preset).description('上课会话用的预设 id（默认是随插件安装的「机器人网校 · 上课」：只有人设，没有工具）。'),
    })
  : undefined

/**
 * 把 Cordis 交来的配置包成一个"每次读都是现在的值"的对象：volatile 字段是带 get() 的引用，普通字段是值。
 * School、上学循环、社团循环每次用设置都从这里读，所以配置页上改了马上生效。
 */
export function liveConfig(raw: Record<string, unknown>): AppConfig {
  const out = {} as AppConfig
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => {
        const v = raw[key]
        const value = v && typeof (v as { get?: unknown }).get === 'function' ? (v as { get(): unknown }).get() : v
        return value === undefined || value === null ? DEFAULT_CONFIG[key] : value
      },
    })
  }
  return out
}

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
  const config = liveConfig(rawConfig as Record<string, unknown>)
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
  // 社团：每一步无状态地问一次模型（ctx.llm.stream），不开会话
  const asker = createAsker({ ctx, log, models: () => [config.clubModel, config.classModel] })
  // 敏感工具的把关：这一轮是不是主人亲手发起的（pre-step 里看输入），会产生后果的几步请主人在 DSH 界面上批准
  const ownerTurns = createOwnerTurns()
  ownerTurns.attach(ctx)
  const guard: ToolGuard = {
    ownerTurn: (sid) => ownerTurns.ownerTurn(sid),
    async approve(req) {
      const approval = service<{ request(r: unknown): Promise<string> }>(ctx, 'approval')
      // 没有审批服务就不放行：请主人自己打 /school 命令
      if (typeof approval?.request !== 'function' || !req.agent) return false
      try {
        const outcome = await approval.request({ agent: req.agent, toolName: req.toolName, ...(req.callId ? { callId: req.callId } : {}), reason: req.reason, displayReason: req.reason, ...(req.signal ? { signal: req.signal } : {}) })
        return outcome === 'allowed-once'
      } catch (error) {
        log.warn('请主人批准时出错（按没批准处理）：', (error as Error)?.message ?? error)
        return false
      }
    },
  }
  app = createApp({ config, store, secrets, brain, asker, guard, log, version: VERSION })
  const school = app

  // 上课会话的系统提示词：预设里的 {{schoolforbots_class_prompt}}。变量一定要有值，否则整次组装失败。
  ctx.effect(() => ctx.systemPrompt!.variable('schoolforbots_class_prompt', () => school.classPrompt()))

  ctx.on('session/event', (session: { id?: string }, event: never) => brain.onSessionEvent(session, event))
  // 上课会话里去掉别的插件在 pre-step 塞的消息
  brain.attach(ctx)

  attachNote(ctx, school.noteSource, log)

  const tools = service<{ register(def: ToolDef, options?: ToolRegistrationOptions): () => void }>(ctx, 'tools')
  // 校园记忆工具跟着开关：打开时注册，关掉时撤下
  let memoryToolOff: (() => void) | null = null
  const syncMemoryTool = () => {
    if (!tools) return
    if (school.memoryOpen() && !memoryToolOff) memoryToolOff = tools.register(school.memoryTool)
    else if (!school.memoryOpen() && memoryToolOff) {
      memoryToolOff()
      memoryToolOff = null
    }
  }
  if (tools) {
    // 报名、同意校规这些工具：不是主人亲手发起的轮次里，模型根本看不到
    const ownerOnly: ToolRegistrationOptions = { when: ({ agent }) => ownerTurns.ownerTurn(String(agent?.session?.id ?? agent?.id ?? '')) }
    for (const def of school.tools) ctx.effect(() => tools.register(def, OWNER_ONLY.has(def.name) ? ownerOnly : {}))
    syncMemoryTool()
    ctx.effect(() => () => {
      memoryToolOff?.()
      memoryToolOff = null
    })
  } else log.info('这个 DSH 没有工具服务：聊天里 AI 用不了学校的工具')

  const commands = service<{ register(def: CommandDef): () => void }>(ctx, 'commands')
  if (commands) {
    ctx.effect(() =>
      commands.register({
        name: 'school',
        description: '机器人网校：报名、看 AI 在学校的状态和放学小结（/school help）',
        input: { hint: 'enroll | agree | code | bind | persona | today | records | rules | on | off | club | forget | help' },
        recordInput: false,
        handler: (inv) => school.command(inv),
      }),
    )
  } else log.info('这个 DSH 没有命令服务：用不了 /school')

  school.sync()
  // 配置页上改了设置（volatile 字段）：按新设置开关上学、社团循环，并让它们马上重新看一遍
  ctx.on('loader/volatile-update', () => {
    school.sync()
    school.school.pokeAll()
    syncMemoryTool()
  })
  ctx.effect(() => () => {
    school.stopAll()
    brain.dispose()
  })
  log.info(`机器人网校插件 ${VERSION} 已加载`)
}
