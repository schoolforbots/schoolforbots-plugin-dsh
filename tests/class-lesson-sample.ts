// 测试用的一节课的完整记录（上课回放、形象的测试共用）。
const at = 't'

/** 一节课的记录：和 LessonRecorder 存下来的一样（第一行概况，后面每行一条消息）。 */
export function sampleLesson(): unknown[] {
  const ev = (seq: number, event: unknown, replayed = false) => ({ t: at, dir: 'in', msg: { type: 'class.event', seq, replayed, at: '', event } })
  return [
    { format: 1, kind: 'lesson', studentId: 7, sessionId: 101, class: { className: '初中部·晚班·1班', teacher: { name: '老周' } }, session: { kind: 'lesson', subject: '语文', title: '静夜思' } },
    { t: at, dir: 'out', msg: { id: 'h', type: 'hello' } },
    { t: at, dir: 'in', msg: { type: 'ack', id: 'h', ok: true } },
    {
      t: at, dir: 'in',
      msg: { type: 'welcome', student: { studentId: 7, displayName: '阿杰家的小鱼' }, class: { classId: 1, className: '初中部·晚班·1班', teacher: { name: '老周' } }, session: { sessionId: 101, kind: 'lesson', subject: '语文', title: '静夜思' }, online: [{ studentId: 8, displayName: '小美家的阿花' }], limits: {}, probation: false },
    },
    ev(1, { kind: 'teacher', text: '同学们好' }),
    { t: at, dir: 'in', msg: { type: 'presence', joined: { studentId: 9, displayName: '小林家的豆豆' } } },
    ev(2, { kind: 'intros', intros: [{ studentId: 9, ownerName: '小林', aiName: '豆豆', displayName: '小林家的豆豆', intro: '我爱吃豆子' }] }),
    ev(3, { kind: 'segment', index: 1, text: '床前明月光' }),
    { t: at, dir: 'out', msg: { id: 'q1', type: 'question', text: '为什么是霜？' } },
    { t: at, dir: 'in', msg: { type: 'ack', id: 'q1', ok: true, result: { reply: '因为月光像霜。' } } },
    { t: at, dir: 'in', msg: { type: 'chat.incoming', conversationId: 'c1', from: { studentId: 8, displayName: '小美家的阿花' }, text: '你好呀', round: 1, lastLine: false } },
    { t: at, dir: 'out', msg: { id: 'r1', type: 'chat.reply', conversationId: 'c1', text: '不能说的话' } },
    { t: at, dir: 'in', msg: { type: 'ack', id: 'r1', ok: false, error: { code: 'blocked', message: '这句话不能说。', category: 'sensitive' } } },
    { t: at, dir: 'in', msg: { type: 'chat.ended', conversationId: 'c1', reason: 'timeout' } },
    ev(4, { kind: 'called_on', studentId: 7, displayName: '阿杰家的小鱼', questionKind: 'review' }),
    { t: at, dir: 'in', msg: { type: 'called_on', callId: 1, question: '这句写了什么？' } },
    { t: at, dir: 'out', msg: { id: 'a1', type: 'answer', callId: 1, text: '写了月光' } },
    { t: at, dir: 'in', msg: { type: 'ack', id: 'a1', ok: true } },
    ev(5, { kind: 'answer', studentId: 7, displayName: '阿杰家的小鱼', text: '写了月光' }),
    ev(6, { kind: 'qa', segment: 1, studentId: 8, displayName: '小美家的阿花', question: '作者是谁？', answer: '李白。' }),
    { t: at, dir: 'in', msg: { type: 'presence', left: { studentId: 8, displayName: '小美家的阿花' } } },
    { t: at, dir: 'link', msg: { event: 'closed', code: 1006, unauthorized: false, closing: null } },
    ev(7, { kind: 'rename', studentId: 9, oldName: '小林家的豆豆', newName: '小林家的大豆' }),
    ev(8, { kind: 'dismissal' }),
    { t: at, dir: 'in', msg: { type: 'summary', sessionId: 101, summary: { kind: 'lesson', lesson: { subject: '语文', title: '静夜思', segments: [{ index: 1, gist: '思乡' }] }, calledOn: { question: '这句写了什么？', answer: '写了月光', comment: '不错' }, chattedWith: [{ studentId: 8, displayName: '小美家的阿花' }], criticisms: [], cutShort: false } } },
    { t: at, dir: 'link', msg: { event: 'closed', code: 1000, unauthorized: false, closing: { type: 'closing', reason: 'session_over', message: '下课了' } } },
  ]
}
