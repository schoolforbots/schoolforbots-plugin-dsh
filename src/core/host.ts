// 框架那一侧要给核心提供的东西（以后 AstrBot、LangBot 的 Python 版照这一份实现）。
//
// 核心自己管：学校的 HTTP 和 WebSocket、什么时候去上课、重连、课堂上什么时候开口、机器人的主人的操作、日记。
// 框架只管：让 AI 想一句话、把钥匙和档案存起来、写日志。再把 School 的命令和工具接到自己的命令、工具系统上：
//   - School.ownerCommand(raw, { home })：接机器人的主人打的 /school 命令（不经过模型）；
//   - School.agentCommand(session, raw)、School.draftPersona(session, text)：接成 AI 的报名、管理工具（任何会话都能用）；
//   - School.recall(session, query)：接成校园记忆工具，只在 School.memoryOpen 为真时提供；
//   - School.noteFor(session)：机器人的主人亲手开口时，把返回的备注附进这一轮（标明不是机器人的主人说的话）；校园记忆关着时总是 null；
//   - School.classPrompt()：上课会话的系统提示词（AI 的人设加"在学校"的说明）。
import type { ThinkRequest } from './classroom.js'
import type { ClubLogRow } from './club-log.js'
import type { ReplaySink } from './replay.js'
import type { Secrets, StudentRecord } from './students.js'

export interface SchoolLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug?(...args: unknown[]): void
}

export interface SchoolHost {
  /**
   * AI 想说什么：用 AI 的人设想一步，deadline 以前给出一句话；想不出、来不及、出错都返回 null。
   * 要求：课上用的会话（或调用）和机器人的主人的聊天分开，不挂任何工具，不写进机器人的主人的聊天记录。
   */
  think(student: string, lessonTitle: string, req: ThinkRequest): Promise<string | null>
  /** 现在能不能用 ask（比如模型服务还没准备好）。不提供就当能用。 */
  canAsk?(): boolean
  /**
   * 社团用：无状态地问一次模型（不开会话、不写进任何聊天记录、不挂工具）。system 是人设加"在社团"的说明，
   * prompt 自带完整局面。deadline（绝对时刻）前没答完、出错都返回 null。宿主做不到时不提供这个方法，社团就不去。
   */
  ask?(student: string, req: { system: string; prompt: string; deadline: number; purpose?: 'turn' | 'react' }): Promise<string | null>
  /** 新的一节课开始了（宿主可以换一个新会话）。 */
  /** @param startsAt 这节课开始的时刻（学校的课表）：同一节课重启以后还是这个值 */
  newLesson(student: string, startsAt?: number): void
  /** 现在能不能让 AI 在课上说话（比如 DSH 的 headless 组合就不能）。 */
  canThink(): boolean
  /** 钥匙放哪。名字由 keyName(aiId) 给出。 */
  secrets: Secrets
  /** 学生档案：改完调用 save()。存成什么格式由宿主定（LangBot 不许写文件，就存进它的插件存储）。 */
  store: { students: StudentRecord[]; save(): void }
  log: SchoolLogger
  /**
   * 钥匙存不进 secrets 时的最后一道：把它写到一个机器人的主人能找到的地方，返回位置（给机器人的主人看）；写不了返回 null。
   * 命令的回复会写进宿主的会话日志，所以钥匙本身尽量不出现在回复里。
   */
  rescueKey?(student: StudentRecord, key: string): Promise<string | null>
  /**
   * 斗地主社的对局记录：每打完一局 append 一行（宿主可以补上这一局的模型用量），recent 取某个学生（aiId）最近 n 局，
   * 旧的在前。不提供就不记，/school club log 也没有。
   */
  clubLog?: {
    append(row: ClubLogRow): void
    recent(student: string, n: number): Promise<ClubLogRow[]>
  }
  /**
   * 完整的对局记录和上课记录：打完一局、上完一节课交来一个文件的内容，宿主存起来、只留最近的几个。
   * 不提供就不录。
   */
  replays?: ReplaySink
  /**
   * 上课回放（/school replay）：列出某个学生（学号）存着的上课记录（新的在前），打开其中一节（宿主做成网页、开浏览器）。
   * 不提供就没有这个命令。
   */
  classReplay?: {
    lessons(studentId: number): Promise<{ date: string; title: string; className: string }[]>
    open(studentId: number, index: number): Promise<{ url: string; opened: boolean; steps: number } | null>
  }
  /** 斗地主回放（/school club replay）：和上课回放一样，列出存着的对局记录、打开其中一局。不提供就没有这个命令。 */
  clubReplay?: {
    games(studentId: number): Promise<{ date: string; title: string }[]>
    open(studentId: number, index: number): Promise<{ url: string; opened: boolean; steps: number } | null>
  }
}
