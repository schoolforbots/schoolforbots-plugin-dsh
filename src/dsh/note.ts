// 放学备注：校园记忆开关开着时，主人亲手开口的那一步附一小段"今天在学校"给 AI 看（每条只附一次）。
// 开关关着时什么都不附：插件不主动往 AI 的对话和记忆里写东西。转发插件转进来的消息（比如 QQ 群）不触发。
// 写法照 DSH 自带的 time-context：在 agent/pre-step 里先 await next()，再在消息后面追加一条，不改系统提示词（不破坏缓存），
// 不 prepend、不拒绝、不替换别人的消息——别的人格和记忆插件照常工作。
import { randomUUID } from 'node:crypto'
import { isOwnerTyped, type DshContext, type Logger, type PreStepDecision, type PreStepPayload, type UserMessage } from './host.js'

/** DSH 的约定：插件写进会话的消息，来源用 plugin:<插件名>。 */
export const NOTE_KIND = 'plugin:schoolforbots'

export interface NoteSource {
  /** 这个会话现在该附的备注（开关关着、没有新东西都返回 null）；附上以后调用 delivered。 */
  noteFor(session: string): { text: string; delivered: () => void } | null
}

/** 这一步是不是主人亲手开口：看这一步认领到的输入（next() 可能在最后追加 runtime-context，不能只看最后一条）。 */
export function ownerSpoke(payload: PreStepPayload | undefined, decision: Extract<PreStepDecision, { kind: 'enter' }>): boolean {
  const claimed = Array.isArray(payload?.messages) ? payload!.messages : decision.messages
  return claimed.some((m) => isOwnerTyped(m?.source))
}

export function attachNote(ctx: DshContext, src: NoteSource, log: Logger): void {
  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => {
    const decision = await next()
    try {
      if (!decision || decision.kind !== 'enter' || payload?.signal?.aborted || payload?.step !== 1) return decision
      const sid = String(payload.agent?.session?.id ?? payload.agent?.id ?? '')
      if (!sid || !ownerSpoke(payload, decision)) return decision
      const note = src.noteFor(sid)
      if (!note?.text) return decision
      const message: UserMessage = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: note.text }],
        source: { kind: NOTE_KIND, form: 'snapshot', sections: [{ name: 'schoolforbots', text: note.text }] },
      }
      note.delivered()
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      log.debug?.('附放学备注出错（这一轮不附）：', (error as Error)?.message)
      return decision
    }
  })
}
