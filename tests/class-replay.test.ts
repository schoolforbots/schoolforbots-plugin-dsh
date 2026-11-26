// 上课回放：记录 → 一步一步的事件；本地网页服务；/school replay。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildClassReplay } from '../src/core/class-replay.js'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { newStudent, type StudentRecord } from '../src/core/students.js'
import { createReplayViewer } from '../src/dsh/replay-viewer.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
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

describe('building a lesson replay', () => {
  it('seats everyone who showed up, marks its own student, and knows who was there at the start', () => {
    const r = buildClassReplay(sampleLesson())
    expect(r).toMatchObject({ title: '语文《静夜思》', className: '初中部·晚班·1班', teacher: '老周', me: 7 })
    expect(r.seats).toEqual([
      { studentId: 7, name: '阿杰家的小鱼', self: true },
      { studentId: 8, name: '小美家的阿花', self: false },
      { studentId: 9, name: '小林家的豆豆', self: false },
    ])
    expect(r.online.sort()).toEqual([7, 8])
  })

  it('turns the lesson into steps in order, one thing said per step', () => {
    const r = buildClassReplay(sampleLesson())
    const brief = r.steps.map((s) => `${s.actor.kind === 'student' ? s.actor.studentId : s.actor.kind}>${s.to.kind === 'student' ? s.to.studentId : s.to.kind}:${s.tag ?? ''}:${s.text.slice(0, 8)}${s.blocked ? '(拦)' : ''}`)
    expect(brief).toEqual([
      'school>class:开始:上课了：初中部·',
      'teacher>class::同学们好',
      'teacher>class:自我介绍:新同学 小林 家',
      'teacher>class:第 1 段:床前明月光',
      '7>teacher:提问:为什么是霜？',
      'teacher>7:回答你的提问:因为月光像霜。',
      '8>7:悄悄话:你好呀',
      '7>8:悄悄话:不能说的话(拦)',
      'school>class:悄悄话:和「小美家的阿花',
      'teacher>7:点你的名:这句写了什么？',
      '7>teacher:回答点名:写了月光',
      '8>teacher:提问:作者是谁？',
      'teacher>class:答疑:李白。',
      'school>class:断线:（和学校的连接断',
      'school>class:改名:「小林家的豆豆」',
      'teacher>class:下课:下课了。',
      'school>class:课后小结:语文《静夜思》\n',
    ])
    expect(r.steps[7]!.blocked).toBe('这句话不能说。')
    expect(r.steps.at(-1)!.text).toContain('老师说：不错')
  })

  it('marks which classmate an intro or a call-on is about', () => {
    const rows = sampleLesson()
    rows.splice(5, 0, { t: at, dir: 'in', msg: { type: 'class.event', seq: 9, replayed: false, at: '', event: { kind: 'called_on', studentId: 8, displayName: '小美家的阿花', questionKind: 'review' } } })
    const r = buildClassReplay(rows)
    expect(r.steps.find((s) => s.tag === '自我介绍')!.about).toBe(9)
    expect(r.steps.find((s) => s.tag === '点名')!.about).toBe(8)
    expect(r.steps.find((s) => s.tag === '第 1 段')!.about).toBeUndefined()
  })

  it('splits a packed intros event into one step per classmate, marking the name and the number', () => {
    const rows = sampleLesson()
    ;(rows[6] as { msg: { event: { intros: unknown[] } } }).msg.event.intros.push({ studentId: 7, ownerName: '阿杰', aiName: '小鱼', displayName: '阿杰家的小鱼', intro: '我是小鱼' })
    const intros = buildClassReplay(rows).steps.filter((s) => s.tag === '自我介绍')
    expect(intros).toHaveLength(2)
    expect(intros[0]!.parts).toEqual([
      { text: '新同学 ' },
      { text: '小林 家的 豆豆', mark: 'name' },
      { text: '，学号 ' },
      { text: '#0009', mark: 'no' },
      { text: ' 的自我介绍是："我爱吃豆子"' },
    ])
    expect(intros[0]!.text).toBe(intros[0]!.parts!.map((p) => p.text).join(''))
    expect(intros[1]!.parts![1]).toEqual({ text: '阿杰 家的 小鱼', mark: 'self' })
    expect(intros[0]!.intro).toEqual({ studentId: 9, ownerName: '小林', aiName: '豆豆', text: '我爱吃豆子' })
  })

  it('folds who came and went into the next step instead of a step of its own', () => {
    const r = buildClassReplay(sampleLesson())
    expect(r.steps[2]!.changes).toEqual([{ kind: 'online', studentId: 9, online: true }])
    expect(r.steps[13]!.changes).toEqual([{ kind: 'online', studentId: 8, online: false }])
    expect(r.steps[14]!.changes).toEqual([{ kind: 'rename', studentId: 9, name: '小林家的大豆' }])
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-replay-view-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function save(day: string, name: string, rows: unknown[]) {
  mkdirSync(join(dir, 'class-replays', day), { recursive: true })
  writeFileSync(join(dir, 'class-replays', day, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

describe('the replay page', () => {
  it('lists a student\'s lessons newest first, and serves one on 127.0.0.1 behind a random path', async () => {
    save('2026-12-01', '7-101', sampleLesson())
    await new Promise((r) => setTimeout(r, 20))
    const evil = sampleLesson()
    ;(evil[4] as { msg: { event: { text: string } } }).msg.event.text = '</script><script>alert(1)</script>'
    save('2026-12-02', '7-102', evil)
    save('2026-12-02', '8-102', sampleLesson())
    const opened: string[] = []
    const v = createReplayViewer({ dir, log, open: async (u) => (opened.push(u), true) })
    try {
      const list = await v.lessons(7)
      expect(list.map((l) => l.name)).toEqual(['7-102', '7-101'])
      expect(list[0]).toMatchObject({ date: '2026-12-02', title: '语文《静夜思》', className: '初中部·晚班·1班' })
      const r = await v.open(list[0]!)
      expect(r.opened).toBe(true)
      expect(r.steps).toBe(17)
      expect(opened).toEqual([r.url])
      expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/r\/[0-9a-f]{32}\/$/)
      const res = await fetch(r.url)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('id="replay-data"')
      // 同学写的 </script> 关不掉数据标签
      expect(html).not.toContain('</script><script>alert(1)')
      expect(html).toContain('\\u003c/script>')
      expect((await fetch(r.url.replace(/[0-9a-f]{32}/, '0'.repeat(32)))).status).toBe(404)
      v.close()
      await expect(fetch(r.url)).rejects.toThrow()
    } finally {
      v.close()
    }
  })
})

describe('/school replay', () => {
  it('opens the latest lesson, lists them, and checks the number', async () => {
    const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active' }
    s.binding.home = 'home'
    save('2026-12-01', '7-101', sampleLesson())
    const v = createReplayViewer({ dir, log, open: async () => false })
    const app = new School(
      {
        think: async () => null,
        newLesson: () => {},
        canThink: () => true,
        secrets: { get: async () => null, set: async () => {}, unset: async () => {} },
        store: { students: [s], save: () => {} },
        log,
        classReplay: { lessons: (id) => v.lessons(id), open: async (id, i) => { const l = (await v.lessons(id))[i]; return l ? v.open(l) : null } },
      },
      { ...DEFAULT_SCHOOL_CONFIG, enabled: false },
      { type: 'dsh', version: 'test' },
    )
    try {
      const run = (raw: string) => app.ownerCommand(raw, { home: 'home' })
      const r = await run('replay')
      expect(r.ok).toBe(true)
      expect(r.text).toContain('打不开浏览器，请自己打开这个地址')
      expect(r.text).toContain('2026-12-01 语文《静夜思》，一共 17 步')
      expect(r.text).toMatch(/http:\/\/127\.0\.0\.1:\d+\/r\//)
      expect((await run('replay list')).text).toContain('1. 2026-12-01 语文《静夜思》（初中部·晚班·1班）')
      expect((await run('replay 2')).ok).toBe(false)
    } finally {
      app.dispose()
      v.close()
    }
  })
})

describe('the command list for the AI', () => {
  it('covers every command in /school help', () => {
    const app = new School(
      { think: async () => null, newLesson: () => {}, canThink: () => true, secrets: { get: async () => null, set: async () => {}, unset: async () => {} }, store: { students: [], save: () => {} }, log },
      { ...DEFAULT_SCHOOL_CONFIG, enabled: false },
      { type: 'dsh', version: 'test' },
    )
    const agent = app.agentHelp()
    const verbs = app.help().split('\n').map((l) => /^\/school( [a-z-]+(?: [a-z|-]+)?)?/.exec(l)?.[0]).filter((v): v is string => !!v)
    expect(verbs.length).toBeGreaterThan(20)
    for (const v of verbs) expect(agent, v).toContain(v)
    app.dispose()
  })
})
