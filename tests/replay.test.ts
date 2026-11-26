// 完整的对局记录和上课记录：录下收发的每条消息、标上谁说的、一局一节一个文件、只留最近的几个。
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Attendance } from '../src/core/attendance.js'
import { newGameStats } from '../src/core/club-log.js'
import { gameRecord } from '../src/core/doudizhu.js'
import { createSchoolHttp } from '../src/core/http.js'
import type { Summary } from '../src/core/protocol.js'
import { ClubRecorder, LessonRecorder, MAX_LINES, type ReplayFile } from '../src/core/replay.js'
import { DEFAULT_SCHOOL_CONFIG, School } from '../src/core/school.js'
import { keyName, newStudent, type StudentRecord } from '../src/core/students.js'
import { createReplays, REPLAY_DIRS } from '../src/dsh/replays.js'
import { ME, P52, P61, result } from './club-fixtures.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const plugin = { type: 'dsh', version: 'test' }

function welcome() {
  return {
    type: 'welcome',
    student: { studentId: 7, displayName: '阿杰家的小鱼' },
    class: { classId: 3, className: '初中部·晚班·1班', teacher: { name: '老周' } },
    session: { sessionId: 101, kind: 'lesson', startsAt: '', endsAt: '', subject: '语文', title: '静夜思' },
    online: [],
    limits: {},
    probation: false,
  }
}

describe('the lesson recorder', () => {
  it('marks who said each thing: the teacher, itself, a classmate, or the school', () => {
    const r = new LessonRecorder({ now: () => Date.parse('2026-12-01T12:00:00Z') })
    r.tap('out', { id: 'h', type: 'hello' })
    r.tap('in', welcome())
    r.tap('in', { type: 'class.event', seq: 1, event: { kind: 'teacher', text: '同学们好' } })
    r.tap('in', { type: 'class.event', seq: 2, event: { kind: 'answer', studentId: 9, displayName: '小林家的豆豆', text: '思乡' } })
    r.tap('in', { type: 'chat.incoming', conversationId: 'c1', from: { studentId: 9, displayName: '小林家的豆豆' }, text: '你好', round: 1, lastLine: false })
    r.tap('out', { id: 'q1', type: 'question', text: '为什么？' })
    r.tap('in', { type: 'ack', id: 'q1', ok: true, result: { reply: '因为……' } })
    r.tap('out', { id: 'c2', type: 'chat.reply', conversationId: 'c1', text: '坏话' })
    r.tap('in', { type: 'ack', id: 'c2', ok: false, error: { code: 'blocked', message: '这句话不能说', category: 'sensitive' } })
    r.linkEnded({ code: 1006, closing: null, unauthorized: false })
    r.tap('in', { type: 'summary', sessionId: 101, summary: {} })
    r.tap('in', { type: 'class.event', seq: 3, event: { kind: 'intros', intros: [] } })
    const f = r.finish({ date: '2026-12-01', studentId: 7, endedAt: Date.parse('2026-12-01T12:31:00Z') })!
    expect(f.name).toBe('7-101')
    expect(f.head).toMatchObject({ format: 1, kind: 'lesson', studentId: 7, sessionId: 101, class: { className: '初中部·晚班·1班' }, summary: true, lines: 12 })
    expect(f.lines.map((l) => [l.dir, l.who?.role ?? null, l.who?.studentId ?? null])).toEqual([
      ['out', 'self', null],
      ['in', 'school', null],
      ['in', 'teacher', null],
      ['in', 'classmate', 9],
      ['in', 'classmate', 9],
      ['out', 'self', 7],
      ['in', 'teacher', null],
      ['out', 'self', 7],
      ['in', 'school', null],
      ['link', null, null],
      ['in', 'school', null],
      ['in', 'teacher', null],
    ])
    expect(f.lines[2]!.who).toEqual({ role: 'teacher', name: '老周' })
    expect(f.lines[3]!.who).toEqual({ role: 'classmate', studentId: 9, name: '小林家的豆豆' })
    expect(f.lines[0]!.t).toBe('2026-12-01T12:00:00.000Z')
  })

  it('has nothing to keep when it never got into class', () => {
    const r = new LessonRecorder({})
    r.tap('out', { id: 'h', type: 'hello' })
    r.linkEnded({ code: 1000, closing: { type: 'closing', reason: 'session_over' }, unauthorized: false })
    expect(r.finish({ date: '2026-12-01', studentId: 7 })).toBeNull()
  })
})

describe('the club recorder', () => {
  it('records from the last cut to this one, and nothing while switched off', () => {
    let on = true
    const r = new ClubRecorder({ enabled: () => on })
    r.tap('out', { type: 'hello' })
    r.tap('in', { type: 'room.event', seq: 1 })
    r.linkEnded({ code: 1006, closing: null, unauthorized: false })
    const a = r.cut()
    expect(a.lines.map((l) => l.dir)).toEqual(['out', 'in', 'link'])
    r.tap('in', { type: 'room.event', seq: 2 })
    on = false
    r.tap('in', { type: 'room.event', seq: 3 })
    expect(r.cut().lines).toHaveLength(1)
    expect(r.cut().lines).toHaveLength(0)
  })

  it('keeps only the latest lines when a stretch runs long, and says how many it dropped', () => {
    const r = new ClubRecorder({ enabled: () => true })
    for (let i = 0; i < MAX_LINES + 3; i++) r.tap('in', { seq: i })
    const { lines, dropped } = r.cut()
    expect(lines).toHaveLength(MAX_LINES)
    expect(dropped).toBe(3)
    expect((lines[0]!.msg as { seq: number }).seq).toBe(3)
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sfb-replays-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function file(name: string, o: Partial<ReplayFile> = {}): ReplayFile {
  return { kind: 'club', student: 'ai-1', date: '2026-12-01', name, head: { name }, lines: [{ t: 'x', dir: 'in', msg: { n: 1 } }], tail: { kind: 'school-record', record: null }, ...o }
}

describe('replay files', () => {
  it('writes the head, the lines and the tail, one JSON a line, in a folder for the day', async () => {
    const rp = createReplays({ dir, log })
    rp.save(file('7-1024'))
    await rp.flush()
    const text = readFileSync(join(dir, REPLAY_DIRS.club, '2026-12-01', '7-1024.jsonl'), 'utf8')
    expect(text.trim().split('\n').map((l) => JSON.parse(l))).toEqual([{ name: '7-1024' }, { t: 'x', dir: 'in', msg: { n: 1 } }, { kind: 'school-record', record: null }])
  })

  it('does not overwrite a file with the same name, and keeps only the latest few of each kind', async () => {
    const rp = createReplays({ dir, log, keep: { club: 2, lesson: 1 } })
    rp.save(file('7-1'))
    rp.save(file('7-1'))
    await rp.flush()
    expect(readdirSync(join(dir, REPLAY_DIRS.club, '2026-12-01')).sort()).toEqual(['7-1-2.jsonl', '7-1.jsonl'])
    await new Promise((r) => setTimeout(r, 20))
    rp.save(file('7-2', { date: '2026-12-02' }))
    rp.save(file('7-101', { kind: 'lesson' }))
    await rp.flush()
    // 最早的那个删了；club 的 12-01 只剩一个
    expect(readdirSync(join(dir, REPLAY_DIRS.club, '2026-12-01'))).toHaveLength(1)
    expect(readdirSync(join(dir, REPLAY_DIRS.club, '2026-12-02'))).toEqual(['7-2.jsonl'])
    expect(readdirSync(join(dir, REPLAY_DIRS.lesson, '2026-12-01'))).toEqual(['7-101.jsonl'])
  })
})

describe('recording with the school', () => {
  let school: MockSchool
  let app: School | null = null
  beforeEach(async () => {
    school = await startMockSchool()
  })
  afterEach(async () => {
    app?.dispose()
    app = null
    await school.close()
  })

  it('records a whole lesson across a dropped connection, and hands it over when class is over', async () => {
    let connections = 0
    school.onHello = (ws) => {
      connections++
      school.push(ws, school.welcome())
      if (connections === 1) {
        school.push(ws, { type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'teacher', text: '同学们好' } })
        setTimeout(() => ws.terminate(), 50)
      } else school.push(ws, { type: 'called_on', callId: 1, question: '讲了什么？' })
    }
    school.onClient = (ws, msg) => {
      school.push(ws, { type: 'ack', id: msg.id, ok: true })
      if (msg.type === 'answer') {
        school.push(ws, { type: 'summary', sessionId: 101, summary: { date: '2026-12-01' } as unknown as Summary })
        school.push(ws, { type: 'closing', reason: 'session_over', message: '下课了' })
        ws.close(1000)
      }
    }
    let clock = Date.parse('2026-12-01T12:05:00Z')
    const saved: ReturnType<LessonRecorder['finish']>[] = []
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => '讲了思乡', random: () => 0.99, sleep: async () => {} }),
      onSummary: () => {
        clock = Date.parse('2026-12-01T12:31:00Z')
      },
      loadResume: () => null,
      saveResume: () => {},
      knownSummaries: () => [101],
      recorder: (win) => {
        const r = new LessonRecorder({})
        return { tap: r.tap, linkEnded: (e) => r.linkEnded(e), done: () => saved.push(r.finish({ date: win.date, studentId: 7 })) }
      },
      now: () => clock,
      random: () => 0,
    })
    const running = att.run()
    await school.waitFor((m) => m.type === 'answer', 10_000)
    await new Promise((r) => setTimeout(r, 300))
    att.stop()
    await running
    expect(saved).toHaveLength(1)
    const f = saved[0]!
    expect(f.name).toBe('7-101')
    const kinds = f.lines.map((l) => (l.dir === 'link' ? 'link' : `${l.dir}:${(l.msg as { type: string }).type}`))
    expect(kinds.filter((k) => k === 'out:hello')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'link')).toHaveLength(2)
    expect(kinds).toContain('in:called_on')
    expect(kinds).toContain('out:answer')
    expect(kinds).toContain('in:summary')
    expect(f.head).toMatchObject({ summary: true })
  }, 20_000)

  it('saves a game with the school\'s full record on the last line', async () => {
    const s: StudentRecord = { ...newStudent({ ownerName: '阿杰', aiName: '小鱼', division: 'junior', slot: 'evening', email: 'a@example.com' }), studentId: 7, status: 'active', className: '初中部·晚班·1班', displayName: '阿杰家的小鱼' }
    const files: ReplayFile[] = []
    app = new School(
      {
        think: async () => null,
        newLesson: () => {},
        canThink: () => true,
        secrets: { get: async (n) => (n === keyName(s.aiId) ? school.key : null), set: async () => {}, unset: async () => {} },
        store: { students: [s], save: () => {} },
        log,
        replays: { save: (f) => files.push(f) },
      },
      { ...DEFAULT_SCHOOL_CONFIG, base: school.base, enabled: false },
      plugin,
    )
    const g = gameRecord(result({ gameId: 1024 }), 2, [P52, P61, ME], '2026-12-01', 1_300_000)
    const detail = { ...newGameStats('r7k2q', 1_000_000), seat: 2, seats: [P52, P61, ME], endedAt: 1_300_000 }
    const lines = [{ t: '2026-12-01T12:00:00.000Z', dir: 'in' as const, msg: { type: 'room.event' } }]
    await (app as unknown as { saveClubReplay: (...a: unknown[]) => Promise<void> }).saveClubReplay(s, g, detail, lines, 0)
    expect(school.http.map((h) => h.url)).toContain('/v1/me/clubs/doudizhu/games/1024')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ kind: 'club', date: '2026-12-01', name: '7-1024', head: { format: 1, gameId: 1024, roomId: 'r7k2q', seat: 2, lines: 1 }, lines })
    expect(files[0]!.tail).toMatchObject({ kind: 'school-record', record: { gameId: 1024, dealt: [['3', '4'], ['5'], ['6']] } })
  })
})
