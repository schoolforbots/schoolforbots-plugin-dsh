// 这一轮是不是机器人的主人亲手发起的：报名、同意校规、填验证码、入社这些工具，只在机器人的主人亲手打字发起的轮次里出现、能执行。
//
// 判断的依据是这一轮的输入：
// - 主要靠会话事件：一轮开始前，DSH 先写 agent/inbox/spliced（带着要进来的消息），再写 turn/start，然后才准备第一步、
//   决定这一步有哪些工具（when 条件）。所以在 spliced 时记下"下一轮"是谁发起的，turn/start 时才算数——
//   正在回话时排队进来的消息，不会改变正在进行的这一轮。
// - 再在 agent/pre-step 里按这一步认领到的输入核对一遍（真 DSH 上 when 条件比 pre-step 先判断，所以它只是第二道）。
// 输入怎么算：
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
  /** 排队等下一轮的输入是不是都是机器人的主人亲手打的。 */
  const pending = new Map<string, boolean>()
  const judge = (inputs: readonly { source?: MessageSource }[]): boolean | null => {
    const people = inputs.filter((m) => fromPerson(m?.source))
    return people.length ? people.every((m) => isOwnerTyped(m.source)) : null
  }
  return {
    /** 会话事件：spliced 记下一轮的输入，turn/start 让它生效。 */
    onSessionEvent(sid: string, event: { type?: string; data?: unknown } | undefined): void {
      if (!sid || !event) return
      if (event.type === 'agent/inbox/spliced') {
        const inserted = (event.data as { inserted?: unknown } | undefined)?.inserted
        if (!Array.isArray(inserted) || !inserted.length) return
        const v = judge(inserted as { source?: MessageSource }[])
        if (v === null) return
        // 排队的几条里只要有一条不是机器人的主人亲手打的，这一轮就不算
        pending.set(sid, (pending.get(sid) ?? true) && v)
      } else if (event.type === 'turn/start') {
        if (pending.has(sid)) {
          owner.set(sid, pending.get(sid)!)
          pending.delete(sid)
        }
      }
    },
    /** 记下这一步的输入；没有人发的输入（同一轮的后续步骤）就不改。 */
    observe(sid: string, inputs: readonly { source?: MessageSource }[]): void {
      const v = judge(inputs)
      if (v !== null) owner.set(sid, v)
    },
    /** 这个会话现在这一轮是不是机器人的主人亲手发起的。 */
    ownerTurn(sid: string): boolean {
      return owner.get(sid) === true
    },
    attach(ctx: DshContext): void {
      ctx.on('session/event', (session: { id?: string } | undefined, event: { type?: string; data?: unknown } | undefined) => {
        try {
          this.onSessionEvent(String(session?.id ?? ''), event)
        } catch {
          // 只是观察
        }
      })
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
