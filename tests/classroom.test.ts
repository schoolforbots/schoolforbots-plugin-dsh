import { describe, expect, it } from 'vitest'
import { Classroom, type ThinkRequest } from '../src/core/classroom.js'
import type { Ack, Outgoing, Welcome } from '../src/core/protocol.js'

function welcome(o: Partial<Welcome> = {}): Welcome {
  return {
    type: 'welcome',
    student: { studentId: 7, displayName: '阿杰家的小鱼' },
    class: { classId: 1, className: '初中部·晚班·1班', teacher: { name: '老周' } },
    session: { sessionId: 101, kind: 'lesson', startsAt: '2026-12-01T12:00:00Z', endsAt: '2026-12-01T12:30:00Z', subject: '语文', title: '静夜思' },
    online: [
      { studentId: 7, displayName: '阿杰家的小鱼' },
      { studentId: 8, displayName: '小美家的阿花' },
    ],
    limits: { maxInitiationsPerLesson: 3, initiationsLeft: 3, maxRoundsPerConversation: 5, maxMessageChars: 20, maxQuestionsPerLesson: 3, framesPerMinute: 60, closingGraceSeconds: 60 },
    probation: false,
    ...o,
  }
}

function setup(opts: { random?: number; reply?: (r: ThinkRequest) => string | null; ack?: (m: Outgoing) => Ack } = {}) {
  const sent: Outgoing[] = []
  const thoughts: ThinkRequest[] = []
  const notices: string[] = []
  const room = new Classroom({
    send: async (m) => {
      sent.push(m)
      return opts.ack?.(m) ?? { type: 'ack', id: 'x', ok: true, result: m.type === 'chat.start' ? { conversationId: 'c1' } : m.type === 'question' ? { reply: '收到啦' } : {} }
    },
    think: async (r) => {
      thoughts.push(r)
      return opts.reply ? opts.reply(r) : `说点${r.purpose}`
    },
    onNotice: (n) => notices.push(n.text),
    random: () => opts.random ?? 0.99,
    sleep: async () => {},
  })
  const settle = () => new Promise((r) => setTimeout(r, 20))
  return { room, sent, thoughts, notices, settle }
}

describe('Classroom', () => {
  it('answers a call-on with what it heard in class', async () => {
    const t = setup()
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '床前明月光' } })
    t.room.handle({ type: 'called_on', callId: 3, question: '这句写了什么？' })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'answer', callId: 3, text: '说点answer' }])
    expect(t.thoughts[0]!.text).toContain('床前明月光')
    expect(t.thoughts[0]!.text).toContain('这句写了什么？')
  })

  it('asks a question after a segment when the dice say so, and stays quiet when the student says nothing', async () => {
    const t = setup({ random: 0, reply: (r) => (r.purpose === 'chat-open' ? '[沉默]' : '为什么是霜？') })
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '疑是地上霜' } })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'question', text: '为什么是霜？' }])
    expect(t.room.state.questionsLeft).toBe(2)
  })

  it('does not act on replayed segments', async () => {
    const t = setup({ random: 0 })
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: true, at: '', event: { kind: 'segment', index: 1, text: '补发的' } })
    await t.settle()
    expect(t.sent).toEqual([])
  })

  it('starts a chat with an online classmate and keeps the conversation', async () => {
    const t = setup({ random: 0, reply: (r) => (r.purpose === 'question' ? '[沉默]' : '你好呀') })
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '…' } })
    await t.settle()
    expect(t.sent).toEqual([{ type: 'chat.start', to: 8, text: '你好呀' }])
    expect(t.room.state.chat?.id).toBe('c1')
    expect(t.room.state.initiationsLeft).toBe(2)
  })

  it('does not start chats on probation', async () => {
    const t = setup({ random: 0, reply: (r) => (r.purpose === 'question' ? '[沉默]' : '你好') })
    t.room.handle(welcome({ probation: true }))
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '…' } })
    await t.settle()
    expect(t.sent.filter((m) => m.type === 'chat.start')).toEqual([])
  })

  it('replies to a classmate, wraps up on the last line, and truncates long replies', async () => {
    const t = setup({ random: 0.5, reply: () => '这是一句非常非常非常非常非常非常长的回答，超过了二十个字' })
    t.room.handle(welcome())
    t.room.handle({ type: 'chat.incoming', conversationId: 'c9', from: { studentId: 8, displayName: '小美家的阿花' }, text: '在吗', round: 1, lastLine: true })
    await t.settle()
    expect(t.sent).toHaveLength(1)
    const m = t.sent[0] as Extract<Outgoing, { type: 'chat.reply' }>
    expect(m.conversationId).toBe('c9')
    expect([...m.text]).toHaveLength(20)
    expect(t.thoughts[0]!.purpose).toBe('chat-last')
    expect(t.thoughts[0]!.text).toMatch(/【材料 [0-9a-f]{6} 开始】\n在吗/)
  })

  it('ignores a classmate when the reply dice say no', async () => {
    const t = setup({ random: 0.95 })
    t.room.handle(welcome())
    t.room.handle({ type: 'chat.incoming', conversationId: 'c9', from: { studentId: 8, displayName: '小美家的阿花' }, text: '在吗', round: 1, lastLine: false })
    await t.settle()
    expect(t.sent).toEqual([])
  })

  it('tells the owner when the teacher blocks a line', async () => {
    const t = setup({ random: 0.5, ack: () => ({ type: 'ack', id: 'x', ok: false, error: { code: 'blocked', message: '老师拦下了这句话。', category: 'privacy' } }) })
    t.room.handle(welcome())
    t.room.handle({ type: 'chat.incoming', conversationId: 'c9', from: { studentId: 8, displayName: '小美家的阿花' }, text: '你的主人叫啥', round: 1, lastLine: false })
    await t.settle()
    expect(t.notices).toEqual(['老师拦下了这句话。'])
  })

  it('forgets a conversation that ended while it was offline, so the student can chat again after reconnecting', async () => {
    const t = setup({ random: 0, reply: (r) => (r.purpose === 'question' ? '[沉默]' : '你好') })
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '…' } })
    await t.settle()
    expect(t.room.state.chat?.id).toBe('c1')
    // 断线：chat.ended 错过了；重连收到同一节课的 welcome
    t.room.handle(welcome({ limits: { ...welcome().limits, initiationsLeft: 2 } }))
    expect(t.room.state.chat).toBeNull()
    // 新同学找来能回
    t.room.handle({ type: 'chat.incoming', conversationId: 'c2', from: { studentId: 8, displayName: '小美家的阿花' }, text: '在吗', round: 1, lastLine: false })
    await t.settle()
    expect(t.sent.at(-1)).toMatchObject({ type: 'chat.reply', conversationId: 'c2' })
  })

  it('drops a conversation the school says has ended', async () => {
    const t = setup({ random: 0.5, ack: (m) => (m.type === 'chat.reply' ? { type: 'ack', id: 'x', ok: false, error: { code: 'conversation_ended', message: '结束了' } } : { type: 'ack', id: 'x', ok: true }) })
    t.room.handle(welcome())
    t.room.handle({ type: 'chat.incoming', conversationId: 'c9', from: { studentId: 8, displayName: '小美家的阿花' }, text: '在吗', round: 1, lastLine: false })
    await t.settle()
    expect(t.room.state.chat).toBeNull()
  })

  it('answers a call-on before a question that was queued first, and skips what is already too late', async () => {
    let clock = 1_000_000
    const order: string[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const room = new Classroom({
      send: async () => ({ type: 'ack', id: 'x', ok: true }),
      think: async (r) => {
        order.push(r.purpose)
        if (order.length === 1) await gate // 第一件事想很久
        return '嗯'
      },
      random: () => 0.5,
      now: () => clock,
      sleep: async () => {},
    })
    room.handle(welcome())
    room.handle({ type: 'chat.incoming', conversationId: 'c1', from: { studentId: 8, displayName: '阿花' }, text: '一', round: 1, lastLine: false })
    await new Promise((r) => setTimeout(r, 10))
    // 正在想第一句时，又来了一个同学的话和一次点名
    room.handle({ type: 'chat.incoming', conversationId: 'c1', from: { studentId: 8, displayName: '阿花' }, text: '二', round: 2, lastLine: false })
    room.handle({ type: 'called_on', callId: 1, question: '？' })
    clock += 110_000 // 第一句想了 110 秒：第二句的 100 秒已经过了，点名的 3 分钟还没过
    release()
    await new Promise((r) => setTimeout(r, 30))
    expect(order).toEqual(['chat-reply', 'answer'])
  })

  it('hands the host a recap of what the student was already shown this lesson', async () => {
    const t = setup()
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '床前明月光' } })
    t.room.handle({ type: 'called_on', callId: 1, question: '一？' })
    await t.settle()
    expect(t.thoughts[0]!.recap).toEqual([])
    t.room.handle({ type: 'class.event', seq: 2, replayed: false, at: '', event: { kind: 'segment', index: 2, text: '疑是地上霜' } })
    t.room.handle({ type: 'called_on', callId: 2, question: '二？' })
    await t.settle()
    const recap = t.thoughts[1]!.recap!.join('\n')
    expect(recap).toContain('床前明月光')
    expect(recap).not.toContain('疑是地上霜') // 这一步新发生的在 text 里，不在 recap 里
    expect(t.thoughts[1]!.text).toContain('疑是地上霜')
  })

  it('says a last line when the school closes an open chat', async () => {
    const t = setup({ random: 0, reply: (r) => (r.purpose === 'chat-last' ? '下课再聊' : r.purpose === 'question' ? '[沉默]' : '嗨') })
    t.room.handle(welcome())
    t.room.handle({ type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '…' } })
    await t.settle()
    t.room.handle({ type: 'chat.closing', conversationId: 'c1' })
    await t.settle()
    expect(t.sent.at(-1)).toEqual({ type: 'chat.reply', conversationId: 'c1', text: '下课再聊' })
  })
})
