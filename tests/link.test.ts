import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Attendance } from '../src/core/attendance.js'
import { ClassLink } from '../src/core/class-link.js'
import { createSchoolHttp } from '../src/core/http.js'
import type { ServerMessage, Summary } from '../src/core/protocol.js'
import { startMockSchool, type MockSchool } from './mock-school.js'

let school: MockSchool
beforeEach(async () => {
  school = await startMockSchool()
})
afterEach(async () => {
  await school.close()
})

const plugin = { type: 'dsh', version: 'test' }

describe('ClassLink', () => {
  it('says hello with the key in the upgrade request, then matches acks', async () => {
    const got: ServerMessage[] = []
    const link = new ClassLink({ url: school.classUrl, key: school.key, plugin, maxRounds: 4, onMessage: (m) => got.push(m) })
    await school.waitFor((m) => m.type === 'hello')
    expect(school.hellos[0]).toMatchObject({ protocol: 'v1', plugin, maxRounds: 4 })
    expect(school.hellos[0]).not.toHaveProperty('sessionId')
    await new Promise((r) => setTimeout(r, 50))
    expect(link.sessionId).toBe(101)
    const ack = await link.send({ type: 'question', text: '为什么？' })
    expect(ack.ok).toBe(true)
    link.close()
    await link.ended
  })

  it('reports an unauthorized key', async () => {
    const link = new ClassLink({ url: school.classUrl, key: 'wrong', plugin, maxRounds: 4, onMessage: () => {} })
    const end = await link.ended
    expect(end.unauthorized).toBe(true)
  })

  it('resumes with sessionId and lastSeq and ignores events it has seen', async () => {
    const got: ServerMessage[] = []
    const link = new ClassLink({ url: school.classUrl, key: school.key, plugin, maxRounds: 4, resume: { sessionId: 101, lastSeq: 5 }, onMessage: (m) => got.push(m) })
    await school.waitFor((m) => m.type === 'hello')
    expect(school.hellos[0]).toMatchObject({ sessionId: 101, lastSeq: 5 })
    await new Promise((r) => setTimeout(r, 30))
    school.pushLast({ type: 'class.event', seq: 5, replayed: true, at: '', event: { kind: 'teacher', text: '旧的' } })
    school.pushLast({ type: 'class.event', seq: 6, replayed: true, at: '', event: { kind: 'teacher', text: '新的' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(got.filter((m) => m.type === 'class.event')).toHaveLength(1)
    expect(link.lastSeq).toBe(6)
    link.close()
    await link.ended
  })

  it('keeps the closing message', async () => {
    school.onHello = (ws) => {
      school.push(ws, { type: 'closing', reason: 'on_break', message: '放假啦', reopensOn: '2027-01-04', firstLessonAt: null })
      ws.close(1000)
    }
    const link = new ClassLink({ url: school.classUrl, key: school.key, plugin, maxRounds: 4, onMessage: () => {} })
    const end = await link.ended
    expect(end.closing?.reason).toBe('on_break')
  })
})

describe('Attendance', () => {
  it('goes to class in the window, answers a call-on, reconnects after a drop with lastSeq, and keeps the summary', async () => {
    const now = Date.parse('2026-12-01T12:05:00Z') // 北京 20:05，晚班正在上课
    let resume: { date: string; sessionId: number; lastSeq: number } | null = null
    const summaries: number[] = []
    let connections = 0
    school.onHello = (ws, hello) => {
      connections++
      school.push(ws, school.welcome())
      if (connections === 1) {
        school.push(ws, { type: 'class.event', seq: 1, replayed: false, at: '', event: { kind: 'teacher', text: '同学们好' } })
        school.push(ws, { type: 'class.event', seq: 2, replayed: false, at: '', event: { kind: 'segment', index: 1, text: '床前明月光' } })
        setTimeout(() => ws.terminate(), 50) // 网络断了
      } else {
        expect(hello).toMatchObject({ sessionId: 101, lastSeq: 2 })
        school.push(ws, { type: 'called_on', callId: 1, question: '讲了什么？' })
      }
    }
    school.onClient = (ws, msg) => {
      school.push(ws, { type: 'ack', id: msg.id, ok: true })
      if (msg.type === 'answer') {
        const summary: Summary = {
          date: '2026-12-01', kind: 'lesson', className: '初中部·晚班·1班', teacher: { name: '老周' },
          lesson: { subject: '语文', title: '静夜思', segments: [{ index: 1, gist: '思乡' }] }, weekTitles: [], teacherAnswers: [], myQuestions: [],
          calledOn: { kind: 'review', question: '讲了什么？', answer: msg.text, comment: '不错' }, chattedWith: [], criticisms: [], cutShort: false,
        }
        school.push(ws, { type: 'summary', sessionId: 101, summary })
        school.push(ws, { type: 'closing', reason: 'session_over', message: '下课了' })
        ws.close(1000)
      }
    }
    let clock = now
    const att: Attendance = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => '讲了思乡', random: () => 0.99, sleep: async () => {} }),
      onSummary: (_s, id) => {
        summaries.push(id)
        clock = Date.parse('2026-12-01T12:31:00Z') // 下课了
      },
      loadResume: () => resume,
      saveResume: (r) => (resume = r),
      knownSummaries: () => summaries,
      now: () => clock,
      random: () => 0,
    })
    const running = att.run()
    await school.waitFor((m) => m.type === 'answer', 10_000)
    await new Promise((r) => setTimeout(r, 300))
    att.stop()
    await running
    expect(connections).toBe(2)
    expect(summaries).toEqual([101])
    expect(resume).toMatchObject({ date: '2026-12-01', sessionId: 101 })
  }, 20_000)

  it('waits for the next lesson outside the window', async () => {
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => null }),
      onSummary: () => {},
      loadResume: () => null,
      saveResume: () => {},
      knownSummaries: () => [],
      now: () => Date.parse('2026-12-01T06:00:00Z'),
    })
    const running = att.run()
    await new Promise((r) => setTimeout(r, 200))
    expect(att.status.phase).toBe('waiting')
    expect(att.status.nextLessonAt).toBe(Date.parse('2026-12-01T12:00:00Z'))
    att.stop()
    await running
    expect(school.sockets).toHaveLength(0)
  })

  it('goes back to waiting until nextLessonAt when the school says the doors are not open yet', async () => {
    // 插件以为晚班 20:00 上课（退路时间），学校其实改到了 21:00
    const realStart = '2026-12-01T13:00:00.000Z'
    school.onHello = (ws) => {
      school.push(ws, { type: 'closing', reason: 'session_over', message: '现在不在上课时间，下一节课在 21:00 开始。', nextLessonAt: realStart })
      ws.close(1000)
    }
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => null }),
      onSummary: () => {},
      loadResume: () => null,
      saveResume: () => {},
      knownSummaries: () => [],
      now: () => Date.parse('2026-12-01T12:05:00Z'),
      random: () => 0,
    })
    const running = att.run()
    await new Promise((r) => setTimeout(r, 400))
    expect(school.hellos).toHaveLength(1)
    expect(att.status.phase).toBe('waiting')
    expect(att.status.nextLessonAt).toBe(Date.parse(realStart))
    att.stop()
    await running
  })

  it('does not reconnect at once when the doors of this very lesson are not open yet', async () => {
    // 插件按校历在 19:51 去了，上课服务还没开门：学校说下一节就是 20:00 这节
    let refusals = 2
    school.onHello = (ws) => {
      if (refusals-- > 0) {
        school.push(ws, { type: 'closing', reason: 'session_over', message: '现在不在上课时间，下一节课在 20:00 开始。', nextLessonAt: '2026-12-01T12:00:00.000Z' })
        ws.close(1000)
      } else school.push(ws, school.welcome())
    }
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => null }),
      onSummary: () => {},
      loadResume: () => null,
      saveResume: () => {},
      knownSummaries: () => [],
      now: () => Date.parse('2026-12-01T11:51:00Z'),
      random: () => 0,
    })
    const running = att.run()
    await new Promise((r) => setTimeout(r, 500))
    expect(school.hellos).toHaveLength(1) // 以前会马上重连，一秒钟几十次
    // 按 random=0 退避：1 秒后、再 2 秒后重连，第三次进了门
    for (let i = 0; i < 80 && school.hellos.length < 3; i++) await new Promise((r) => setTimeout(r, 100))
    expect(school.hellos).toHaveLength(3)
    await new Promise((r) => setTimeout(r, 300))
    expect(school.hellos).toHaveLength(3) // 进了门就待着
    expect(att.status.phase).toBe('in-class')
    att.stop()
    await running
  }, 15_000)

  it('remembers being replaced, so a new loop (hot reload) does not connect again before the lesson ends', async () => {
    school.onHello = (ws) => {
      school.push(ws, { type: 'closing', reason: 'replaced', message: '同一个学生在别处连上了。' })
      ws.close(1000)
    }
    let hold: { until: number; reason: string } | null = null
    const alerts: string[] = []
    const make = () =>
      new Attendance({
        http: createSchoolHttp({ base: school.base }),
        classUrl: school.classUrl,
        plugin,
        maxRounds: () => 5,
        getKey: async () => school.key,
        classroom: () => ({ think: async () => null }),
        onSummary: () => {},
        onAlert: (t) => alerts.push(t),
        loadResume: () => null,
        saveResume: () => {},
        loadHold: () => hold,
        saveHold: (h) => (hold = h),
        knownSummaries: () => [],
        now: () => Date.parse('2026-12-01T12:05:00Z'),
        random: () => 0,
      })
    const first = make()
    const r1 = first.run()
    await new Promise((r) => setTimeout(r, 300))
    first.stop()
    await r1
    expect(school.hellos).toHaveLength(1)
    expect(hold!.until).toBe(Date.parse('2026-12-01T12:31:00Z'))
    expect(alerts).toHaveLength(1)
    // 热重载：新的循环
    const second = make()
    const r2 = second.run()
    await new Promise((r) => setTimeout(r, 300))
    second.poke()
    await new Promise((r) => setTimeout(r, 300))
    second.stop()
    await r2
    expect(school.hellos).toHaveLength(1)
  })

  it('holds off until the suspension ends, the first lesson after a break, or a few minutes in maintenance', async () => {
    const holdFor = async (closing: object, me: Partial<typeof school.me> = {}) => {
      school.me = { ...school.me, ...me }
      school.calendar = { ...school.calendar, timezone: 'Asia/Shanghai', doorsOpenMinutesBefore: 10 }
      school.onHello = (ws) => {
        school.push(ws, { type: 'closing', message: '回去吧', ...closing } as never)
        ws.close(1000)
      }
      let hold: { until: number; reason: string } | null = null
      const att = new Attendance({
        http: createSchoolHttp({ base: school.base }),
        classUrl: school.classUrl,
        plugin,
        maxRounds: () => 5,
        getKey: async () => school.key,
        classroom: () => ({ think: async () => null }),
        onSummary: () => {},
        loadResume: () => null,
        saveResume: () => {},
        loadHold: () => hold,
        saveHold: (h) => (hold = h ?? hold),
        knownSummaries: () => [],
        now: () => Date.parse('2026-12-01T12:05:00Z'),
        random: () => 0,
      })
      const running = att.run()
      await new Promise((r) => setTimeout(r, 300))
      att.stop()
      await running
      return hold!.until
    }
    const now = Date.parse('2026-12-01T12:05:00Z')
    // 停课两小时：hold 到停课结束，不是一律 6 小时（服务器说停课时 /v1/me 就是 suspended）
    expect(await holdFor({ reason: 'suspended' }, { status: 'active', suspendedUntil: '2026-12-01T14:05:00Z' })).toBe(Date.parse('2026-12-01T14:05:00Z'))
    school.me = { ...school.me, status: 'active', suspendedUntil: null }
    expect(await holdFor({ reason: 'on_break', reopensOn: '2027-01-04', firstLessonAt: '2027-01-04T12:00:00Z' })).toBe(Date.parse('2027-01-04T11:50:00Z'))
    expect(await holdFor({ reason: 'on_break', reopensOn: '2027-01-04', firstLessonAt: null })).toBe(Date.parse('2027-01-03T16:00:00Z'))
    expect(await holdFor({ reason: 'maintenance' })).toBe(now + 5 * 60_000)
    // 学校给的停课结束时间已经过去、却还说在停课：至少等 5 分钟
    expect(await holdFor({ reason: 'suspended' }, { status: 'active', suspendedUntil: '2026-12-01T12:00:00Z' })).toBe(now + 5 * 60_000)
  })

  it('does not write the resume point after it has been stopped', async () => {
    school.onHello = (ws) => school.push(ws, school.welcome())
    let saves = 0
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => null }),
      onSummary: () => {},
      loadResume: () => null,
      saveResume: () => saves++,
      knownSummaries: () => [],
      now: () => Date.parse('2026-12-01T12:05:00Z'),
    })
    const running = att.run()
    await school.waitFor((m) => m.type === 'hello')
    await new Promise((r) => setTimeout(r, 100))
    att.stop()
    await running
    await new Promise((r) => setTimeout(r, 100))
    expect(saves).toBe(0)
  })

  it('reports maintenance from the calendar without connecting', async () => {
    school.calendar = { ...school.calendar, maintenance: { message: '换硬盘', since: '2026-12-01T00:00:00Z', expectedBackAt: null } }
    const att = new Attendance({
      http: createSchoolHttp({ base: school.base }),
      classUrl: school.classUrl,
      plugin,
      maxRounds: () => 5,
      getKey: async () => school.key,
      classroom: () => ({ think: async () => null }),
      onSummary: () => {},
      loadResume: () => null,
      saveResume: () => {},
      knownSummaries: () => [],
      now: () => Date.parse('2026-12-01T12:05:00Z'),
    })
    const running = att.run()
    await new Promise((r) => setTimeout(r, 200))
    expect(att.status.phase).toBe('maintenance')
    expect(att.status.message).toContain('换硬盘')
    att.stop()
    await running
  })
})
