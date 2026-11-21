// 这一轮是不是机器人的主人亲手发起的：报名、同意校规、填验证码、入社这些工具，只在机器人的主人亲手打字发起的轮次里出现、能执行。
//
// 在 agent/pre-step 里看这一步认领到的输入（DSH 在 pre-step 之后才把它们写进会话日志）：
// - 机器人的主人亲手打的（isOwnerTyped）→ 这一轮是机器人的主人的；
// - 别的"人"发来的（转发插件转进来的群聊消息、别的插件唤醒会话塞的消息）→ 不是；
// - 插件附的快照（runtime-context、time-context、plugin:xxx 备注）不算人，不改变判断。
// 同一轮后面的步骤（模型调完工具再接着想）没有新的输入，沿用这一轮开头的判断。
import { isOwnerTyped, type DshContext, type MessageSource, type PreStepDecision, type PreStepPayload } from './host.js'

/** 这条输入是不是"人"发的（机器人的主人或者别人），而不是插件附的上下文快照。 */
export function fromPerson(src: MessageSource | undefined): boolean {
  if (!src) return false
  const kind = String(src.kind ?? '')
  if (kind.startsWith('plugin:') || kind.includes('context') || kind === 'schoolforbots') return false
  if ((src as { form?: unknown }).form === 'snapshot') return false
  return true
}

export function createOwnerTurns() {
  const owner = new Map<string, boolean>()
  return {
    /** 记下这一步的输入；没有人发的输入（同一轮的后续步骤）就不改。 */
    observe(sid: string, inputs: readonly { source?: MessageSource }[]): void {
      const people = inputs.filter((m) => fromPerson(m?.source))
      if (!people.length) return
      owner.set(sid, people.every((m) => isOwnerTyped(m.source)))
    },
    /** 这个会话现在这一轮是不是机器人的主人亲手发起的。 */
    ownerTurn(sid: string): boolean {
      return owner.get(sid) === true
    },
    attach(ctx: DshContext): void {
      ctx.on('agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => {
        const decision = await next()
        try {
          const sid = String(payload?.agent?.session?.id ?? payload?.agent?.id ?? '')
          const inputs = Array.isArray(payload?.messages) ? payload.messages : decision && decision.kind === 'enter' ? decision.messages : []
          if (sid) this.observe(sid, inputs)
        } catch {
          // 只是观察，出错不影响这一步
        }
        return decision
      })
    },
  }
}

export type OwnerTurns = ReturnType<typeof createOwnerTurns>
