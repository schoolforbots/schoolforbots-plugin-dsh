// 上课会话不越积越多：中途换掉的马上归档，每个学生只留最近 3 节课的，机器人的主人打过字的不动。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBrain, KEEP_LESSONS } from '../src/dsh/brain.js'
import type { ClassSessionRecord } from '../src/dsh/store.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

describe('archiving class sessions', () => {
  let dir: string
  let dsh: FakeDsh
  let saved: ClassSessionRecord[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sfb-archive-'))
    dsh = createFakeDsh()
    saved = []
  })
  afterEach(async () => {
    await dsh.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  function setup(allow: () => string[] = () => []) {
    const brain = createBrain({
      ctx: dsh.ctx,
      log,
      roomDir: join(dir, 'room'),
      preset: 'schoolforbots',
      classModel: () => '',
      tools: () => allow(),
      ledger: { load: () => saved, save: (r) => (saved = r.map((x) => ({ ...x }))) },
    })
    dsh.ctx.on('session/event', (s: never, e: never) => brain.onSessionEvent(s, e))
    brain.attach(dsh.ctx)
    const step = (student = 'ai1') => brain.think(student, 't', { purpose: 'answer', text: '点名', deadline: Date.now() + 5_000 })
    /** 上一节课：开课、说一句。 */
    const lesson = async (student = 'ai1') => {
      await tick()
      brain.newLesson(student)
      await tick()
      await step(student)
    }
    const sids = () => [...dsh.sessions.keys()]
    return { brain, step, lesson, sids }
  }

  it('keeps the last few lessons of each student and archives the earlier ones', async () => {
    const t = setup()
    for (let i = 0; i < 5; i++) await t.lesson()
    await t.lesson('ai2')
    await tick()
    const [s1, s2, s3, s4, s5, other] = t.sids()
    expect(KEEP_LESSONS).toBe(3)
    expect(dsh.archived).toEqual([s1, s2])
    expect(saved.map((r) => r.sid)).toEqual([s3, s4, s5, other])
  })

  it('archives a session it moved away from in the middle of a lesson at once', async () => {
    dsh.globalTools = ['memory_search']
    let allow: string[] = []
    const t = setup(() => allow)
    await t.lesson()
    allow = ['memory_search']
    await t.step()
    await tick()
    const [first, second] = t.sids()
    expect(dsh.archived).toEqual([first])
    expect(saved.map((r) => r.sid)).toEqual([second])
  })

  it('never archives a session the owner has typed in', async () => {
    const t = setup()
    await t.lesson()
    const [owned] = t.sids()
    await dsh.ownerSays(owned!, '我来看看')
    for (let i = 0; i < 4; i++) await t.lesson()
    await tick()
    expect(dsh.archived).not.toContain(owned)
    expect(saved.find((r) => r.sid === owned)).toMatchObject({ ownerTook: true })
  })

  it('tidies up after a restart, from the sessions in the save file', async () => {
    saved = [
      { sid: 'old1', student: 'ai1', lessonAt: 1 },
      { sid: 'old2', student: 'ai1', lessonAt: 2 },
      { sid: 'old3', student: 'ai1', lessonAt: 3 },
      { sid: 'old4', student: 'ai1', lessonAt: 4 },
      { sid: 'cut', student: 'ai1', lessonAt: 4, retired: true },
      { sid: 'mine', student: 'ai1', lessonAt: 1, ownerTook: true },
    ]
    const t = setup()
    await t.brain.tidy()
    expect(dsh.archived.sort()).toEqual(['cut', 'old1'])
    expect(saved.map((r) => r.sid)).toEqual(['old2', 'old3', 'old4', 'mine'])
  })

  it('stops keeping track of a session it cannot archive', async () => {
    saved = [
      { sid: 'gone', student: 'ai1', lessonAt: 1, retired: true },
    ]
    dsh.archiveFails = true
    const t = setup()
    await t.brain.tidy()
    expect(saved).toEqual([])
  })
})
