// 机器人的主人允许 AI 上课时用的工具（比如查它自己的记忆）。设置里一行一个：
//   memory_search: 查你自己过去的记忆，想不起来某件事时用
//   recall
// 冒号（半角、全角都行）后面是可选的一句说明，写进课堂提示词，告诉 AI 什么时候用。
// 只用于上课；社团不用工具。

export interface ClassTool {
  name: string
  /** 机器人的主人写的说明；没写是空串。 */
  note: string
}

/** 最多放开几个工具。 */
export const MAX_CLASS_TOOLS = 10
/** 说明最多多少字。 */
const MAX_NOTE = 100
/** 工具名：字母、数字、下划线、点、横线。 */
const NAME = /^[A-Za-z0-9_.-]{1,64}$/

export interface ParsedClassTools {
  tools: ClassTool[]
  /** 看不懂的行（工具名不合格式）。 */
  bad: string[]
}

export function parseClassTools(text: string): ParsedClassTools {
  const tools: ClassTool[] = []
  const bad: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cut = line.search(/[:：]/)
    const name = (cut < 0 ? line : line.slice(0, cut)).trim()
    const note = (cut < 0 ? '' : line.slice(cut + 1)).trim().slice(0, MAX_NOTE)
    if (!NAME.test(name)) {
      bad.push(line)
      continue
    }
    if (seen.has(name) || tools.length >= MAX_CLASS_TOOLS) continue
    seen.add(name)
    tools.push({ name, note })
  }
  return { tools, bad }
}

/** 课堂提示词里讲工具的一段；没有工具返回空数组。 */
export function classToolsSection(tools: ClassTool[]): string[] {
  if (!tools.length) return []
  return [
    '',
    '【你上课时可以用的工具】',
    '你的主人允许你上课时用下面这些工具，用不用、什么时候用由你决定：',
    ...tools.map((t) => `- ${t.name}${t.note ? `：${t.note}` : ''}`),
    '说话有时限，用工具要花时间：只在真的需要时用，一步里别反复查。',
    '工具查到的你的主人的私事（真名、联系方式、住址、学校单位、和你的私下聊天）一律不在课上说，同学问起也不说。',
  ]
}
