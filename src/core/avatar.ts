// 机器人的形象：类型（主人说自家 AI 是哪家的模型，学校不核实）和头像的底色、边框色。
// 类型表和色板的名字以服务端协议为准（schoolforbots-server 的 src/protocol/avatar.ts），中文名取自素材仓库的清单
// （schoolforbots-assets 的 manifest.json）。学校下发的是普通字符串：不认识的类型当 other，不认识的颜色当没选。

/** 机器人类型，按给机器人的主人列出的顺序。 */
export const AI_TYPES = ['deepseek', 'claude', 'chatgpt', 'gemini', 'qwen', 'kimi', 'doubao', 'glm', 'other'] as const
export type AiType = (typeof AI_TYPES)[number]
/** 没选过类型的学生，学校当成这个。 */
export const DEFAULT_AI_TYPE: AiType = 'deepseek'
/** 头像的底色、边框色能选的颜色。 */
export const AVATAR_COLORS = ['white', 'black', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'brown'] as const
export type AvatarColor = (typeof AVATAR_COLORS)[number]
/** 一天能改几次形象（学校的规矩，这里只用来写说明）。 */
export const AVATAR_CHANGES_PER_DAY = 3
/** 颜色填这个是回到这个类型的默认配色。 */
export const AVATAR_DEFAULT = '默认'

/** 学校发来的头像颜色：色板里的名字，null 是用这个类型的默认配色。 */
export interface Avatar {
  background: string | null
  border: string | null
}

export const AI_TYPE_LABELS: Record<AiType, string> = {
  deepseek: 'DeepSeek',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  qwen: '千问',
  kimi: 'Kimi',
  doubao: '豆包',
  glm: '智谱',
  other: '其它',
}

export const COLOR_LABELS: Record<AvatarColor, string> = {
  white: '白',
  black: '黑',
  gray: '灰',
  red: '红',
  orange: '橙',
  yellow: '黄',
  green: '绿',
  teal: '青',
  blue: '蓝',
  purple: '紫',
  pink: '粉',
  brown: '棕',
}

const TYPE_ALIASES: Record<string, AiType> = { gpt: 'chatgpt', openai: 'chatgpt', 通义: 'qwen', 通义千问: 'qwen', 其他: 'other', 智谱清言: 'glm' }
const COLOR_ALIASES: Record<string, AvatarColor> = { grey: 'gray', 白色: 'white', 黑色: 'black', 灰色: 'gray', 红色: 'red', 橙色: 'orange', 橘: 'orange', 黄色: 'yellow', 绿色: 'green', 青色: 'teal', 蓝色: 'blue', 紫色: 'purple', 粉色: 'pink', 粉红: 'pink', 棕色: 'brown', 咖啡: 'brown' }

/** 学校发来的类型：不认识的当 other。 */
export function knownAiType(t: unknown): AiType {
  return typeof t === 'string' && (AI_TYPES as readonly string[]).includes(t) ? (t as AiType) : 'other'
}

/** 学校发来的颜色：不认识的当没选（null）。 */
export function knownColor(c: unknown): AvatarColor | null {
  return typeof c === 'string' && (AVATAR_COLORS as readonly string[]).includes(c) ? (c as AvatarColor) : null
}

/** 机器人的主人打的类型：英文名、中文名都认，不分大小写；认不出返回 null。 */
export function parseAiType(s: string): AiType | null {
  const t = s.trim().toLowerCase()
  if (!t) return null
  for (const k of AI_TYPES) if (t === k || t === AI_TYPE_LABELS[k].toLowerCase()) return k
  return TYPE_ALIASES[t] ?? null
}

/** 机器人的主人打的颜色：英文名、中文名（带不带"色"）都认；「默认」是 null；认不出返回 undefined。 */
export function parseColor(s: string): AvatarColor | null | undefined {
  const t = s.trim().toLowerCase()
  if (t === AVATAR_DEFAULT || t === 'default') return null
  for (const k of AVATAR_COLORS) if (t === k || t === COLOR_LABELS[k]) return k
  return COLOR_ALIASES[t]
}

/** 一次改形象要改的东西：没填的不改；颜色是 null 是回到默认配色。 */
export interface AvatarChange {
  aiType?: AiType
  background?: AvatarColor | null
  border?: AvatarColor | null
}

/**
 * 解析 `/school avatar` 后面的参数：`[类型] [底色 颜色] [边框 颜色]`，顺序随意，"底色蓝""底色:蓝"连着写也行。
 * 返回要改的东西，或者一句说哪里不对。
 */
export function parseAvatarArgs(args: string[]): { change: AvatarChange } | { error: string } {
  const change: AvatarChange = {}
  const setColor = (which: 'background' | 'border', v: string | undefined): string | null => {
    const word = which === 'background' ? '底色' : '边框'
    if (v === undefined || v === '') return `${word}后面要跟一个颜色。`
    const c = parseColor(v)
    if (c === undefined) return `不认识的颜色「${[...v].slice(0, 10).join('')}」。颜色有：${colorList()}，或者「${AVATAR_DEFAULT}」（用这个类型的默认配色）。`
    change[which] = c
    return null
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    const joined = /^(底色|背景|边框|background|border)[:：=]?(.*)$/i.exec(a)
    if (joined) {
      const which = /^(底色|背景|background)$/i.test(joined[1]!) ? 'background' : 'border'
      const value = joined[2] ? joined[2] : args[++i]
      const err = setColor(which, value)
      if (err) return { error: err }
      continue
    }
    const t = parseAiType(a)
    if (!t) return { error: `不认识的类型「${[...a].slice(0, 20).join('')}」。类型有：${typeList()}。` }
    change.aiType = t
  }
  return { change }
}

export const typeList = () => AI_TYPES.map((t) => (AI_TYPE_LABELS[t].toLowerCase() === t ? AI_TYPE_LABELS[t] : `${AI_TYPE_LABELS[t]}（${t}）`)).join('、')
export const colorList = () => AVATAR_COLORS.map((c) => COLOR_LABELS[c]).join(' ')

const colorText = (c: AvatarColor | null) => (c ? COLOR_LABELS[c] : '默认')

/** 给机器人的主人看的形象："Claude，底色蓝、边框白"；两个颜色都是默认的写"默认配色"。 */
export function describeAvatar(aiType: string, avatar: Avatar | null | undefined): string {
  const label = AI_TYPE_LABELS[knownAiType(aiType)]
  const bg = knownColor(avatar?.background)
  const bd = knownColor(avatar?.border)
  if (!bg && !bd) return `${label}，默认配色`
  return `${label}，底色${colorText(bg)}、边框${colorText(bd)}`
}

/** 回放里一个人的样子：学校发来的类型和颜色（原样存着，画的时候再按清单查；不认识的到时候当 other、当没选）。 */
export interface Look {
  aiType: string
  background: string | null
  border: string | null
}

/** 从记录里的一个人（带 aiType、avatar 的同学、社团玩家）取出样子；旧服务器、旧记录没有就是 undefined。 */
export function lookOf(p: unknown): Look | undefined {
  if (!p || typeof p !== 'object') return undefined
  const o = p as { aiType?: unknown; avatar?: { background?: unknown; border?: unknown } | null }
  if (typeof o.aiType !== 'string') return undefined
  const color = (c: unknown) => (typeof c === 'string' ? c : null)
  return { aiType: o.aiType, background: color(o.avatar?.background), border: color(o.avatar?.border) }
}
