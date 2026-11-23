// 端到端测试用的 DSH 辅助插件，只装在测试容器里：
// - 假模型（provider e2e-fake）：不联网、不要钥匙，按场景给出确定的回答；
// - 自动审批：插件的审批请求（同意校规、填验证码、入社）一律"允许"，代替机器人的主人点按钮；
// - 自动作答：模型用 ask_user_question 再问一遍主人（真模型常这样确认校规、入社）时，选表示同意的那一项。
// 真模型模式（E2E_MODEL=real）下默认模型不指向它，只有自动审批和自动作答起作用。
import { randomUUID } from 'node:crypto'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

const PROVIDER = 'e2e-fake'

const textOf = (message) =>
  (Array.isArray(message?.content) ? message.content : [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')

/** 这次请求的系统提示词：一次性调用在 options.system，会话里的在开头的 system 消息。 */
function systemOf(options) {
  if (typeof options.system === 'string') return options.system
  return (options.messages ?? []).filter((m) => m?.role === 'system').map(textOf).join('\n')
}

/** 最后一条模型回答之后进来的用户输入（主人说的话，加上插件附的快照）。 */
function latestInput(messages) {
  const out = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'assistant' || m?.role === 'tool') break
    if (m?.role === 'user') out.unshift(textOf(m))
  }
  return out.join('\n')
}

const OWNER = {
  email: process.env.E2E_EMAIL ?? 'e2e@example.test',
  owner_name: '测试员',
  ai_name: '小测',
  division: '初中部',
  slot: '晚班',
}

/** 机器人的主人的会话：按他说的话决定调哪个工具。返回 { tool, args } 或 { text }。 */
function ownerTurn(messages) {
  const last = messages.at(-1)
  if (last?.role === 'tool') return { text: `办好了：${textOf(last).slice(0, 300)}` }
  const said = latestInput(messages)
  const code = /(?<!\d)(\d{6})(?!\d)/.exec(said)?.[1]
  if (code && said.includes('验证码')) return { tool: 'school_verify_code', args: { code } }
  if (said.includes('入社')) return { tool: 'school_club', args: { action: 'on' } }
  if (said.includes('同意')) {
    const history = messages.map(textOf).join('\n')
    const version = [...history.matchAll(/版本\s*(\d{4}-\d{2}-\d{2})/g)].at(-1)?.[1]
    return version ? { tool: 'school_agree_rules', args: { version } } : { text: '没找到校规的版本号。' }
  }
  if (said.includes('报名')) return { tool: 'school_enroll', args: OWNER }
  if (said.includes('学校')) return { tool: 'school_memory', args: { scope: 'recent' } }
  return { text: '好的。' }
}

/** 斗地主：叫 1 分；出牌选清单里第一手；别的（发表情）不发。 */
function clubTurn(prompt) {
  if (prompt.includes('轮到你叫分')) return '1'
  const first = /^(\d+)\. /m.exec(prompt)?.[1]
  if (prompt.includes('能出的牌')) return first ?? '不要'
  return '[沉默]'
}

/** 上课：提问的那一步不问；别的说一句短话。 */
function classTurn(prompt) {
  if (prompt.includes('没什么想问的')) return '[沉默]'
  if (prompt.includes('点名') || prompt.includes('老师问')) return '我觉得这一段写得很生动。'
  return '你好呀，一起好好听课吧。'
}

class FakeAdapter extends LlmAdapter {
  async *stream(options) {
    const messages = options.messages ?? []
    const system = systemOf(options)
    let reply
    if (system.includes('斗地主社')) reply = { text: clubTurn(latestInput(messages)) }
    else if (system.includes('你现在在机器人网校上学')) reply = { text: classTurn(latestInput(messages)) }
    else reply = ownerTurn(messages)

    if (reply.tool) {
      const id = `e2e-${randomUUID()}`
      const args = JSON.stringify(reply.args)
      console.log(`[e2e-fake] 调用工具 ${reply.tool} ${args}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: reply.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: reply.tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = reply.text
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const YES = /同意|确认|允许|继续|可以|好的|是的|^是|yes|ok|approve|allow|confirm/i

/** 一个问题怎么答：审批式的选"允许"那项；有选项的选看着像同意的（没有就第一项）；没有选项的打一句话。 */
function answerOf(q) {
  if (q.intent?.kind === 'approval' || q.intent?.kind === 'plan-review') return { id: q.id, selected: [q.intent.approve] }
  const options = q.options ?? []
  if (options.length === 0) return { id: q.id, selected: [], custom: '同意，请继续。' }
  const pick = options.find((o) => YES.test(o.label)) ?? options[0]
  return { id: q.id, selected: [pick.label] }
}

export const name = 'schoolforbots-e2e-harness'
export const inject = ['llm']

export function apply(ctx) {
  ctx.llm.registerAdapter([PROVIDER], new FakeAdapter())
  // 代替机器人的主人点"允许"
  ctx.on(
    'approval/request',
    async (req) => {
      console.log(`[e2e-approval] 允许 ${req?.toolName ?? '?'}：${req?.reason ?? ''}`)
      return 'allowed-once'
    },
    { prepend: true },
  )
  // 代替机器人的主人回答模型的提问
  ctx.on(
    'user-questions/request',
    async (req) => {
      const answers = (req?.questions ?? []).map(answerOf)
      for (const [i, q] of (req?.questions ?? []).entries()) {
        const a = answers[i]
        console.log(`[e2e-question] ${q.question} → ${a.custom ?? a.selected.join('、')}`)
      }
      return { answers }
    },
    { prepend: true },
  )
}
