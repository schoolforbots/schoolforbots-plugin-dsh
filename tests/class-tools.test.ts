// 上课可用的工具：机器人的主人填的名单怎么解析、怎么过滤，上课会话里怎么放开、怎么把关。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_CLASS_TOOLS, parseClassTools } from '../src/core/class-tools.js'
import { classFrame } from '../src/core/prompts.js'
import { createBrain } from '../src/dsh/brain.js'
import { createClassTools } from '../src/dsh/class-tools.js'
import { createFakeDsh, type FakeDsh } from './fake-dsh.js'

const log = { info: () => {}, warn: () => {}, debug: () => {} }

describe('reading the list of class tools', () => {
  it('takes one tool a line, with an optional note after a colon', () => {
    const { tools, bad } = parseClassTools('memory_search: 查你自己过去的记忆\n\n  recall  \nnotes.find：全角冒号也行\nmemory_search: 重复的不要\n查记忆\n')
    expect(tools).toEqual([
      { name: 'memory_search', note: '查你自己过去的记忆' },
      { name: 'recall', note: '' },
      { name: 'notes.find', note: '全角冒号也行' },
    ])
    expect(bad).toEqual(['查记忆'])
  })

  it('keeps at most a handful of tools', () => {
    const text = Array.from({ length: MAX_CLASS_TOOLS + 3 }, (_, i) => `t${i}`).join('\n')
    expect(parseClassTools(text).tools).toHaveLength(MAX_CLASS_TOOLS)
  })

  it('tells the AI about the tools in the class prompt, and not to tell the owner\'s private matters', () => {
    expect(classFrame({ persona: '' })).not.toContain('可以用的工具')
    const p = classFrame({ persona: '', tools: [{ name: 'memory_search', note: '查你自己过去的记忆' }, { name: 'recall', note: '' }] })
    expect(p).toContain('【你上课时可以用的工具】')
    expect(p).toContain('- memory_search：查你自己过去的记忆')
    expect(p).toContain('- recall\n')
    expect(p).toContain('工具查到的你的主人的私事')
  })
})

describe('which class tools are let through', () => {
  function setup(text: string, registered: string[] | null) {
    const ctx = { tools: registered ? { definitions: () => registered.map((name) => ({ name })) } : {} } as never
    const notices: string[] = []
    const t = createClassTools({ ctx, log, text: () => text, own: () => ['school_status', 'school_memory'], onNotice: (_s, n) => notices.push(n) })
    return { t, notices }
  }

  it('drops the plugin\'s own tools, tools DSH does not have and lines it cannot read, and tells the owner once', () => {
    const { t, notices } = setup('memory_search\nschool_memory\nghost\n查记忆', ['memory_search', 'school_memory'])
    expect(t.forSession('a').map((x) => x.name)).toEqual(['memory_search'])
    expect(notices).toEqual([
      '上课可用的工具：「查记忆」看不懂（一行一个工具名，冒号后面可以写一句说明）。',
      '上课可用的工具：school_memory 是机器人网校插件自己的工具，课上不能用。',
      '上课可用的工具：DSH 里现在没有 ghost 这个工具（名字写对了吗？提供它的插件装了吗？）。',
    ])
    t.forSession('a')
    expect(notices).toHaveLength(3)
    // 给课堂提示词用的：不告诉机器人的主人
    expect(t.allowed().map((x) => x.name)).toEqual(['memory_search'])
    expect(notices).toHaveLength(3)
  })

  it('lets nothing through when DSH cannot list its tools', () => {
    const { t, notices } = setup('memory_search', null)
    expect(t.forSession('a')).toEqual([])
    expect(notices[0]).toContain('查不了有哪些工具')
  })

  it('lets nothing through and says nothing when the setting is empty', () => {
    const { t, notices } = setup('  \n', ['memory_search'])
    expect(t.forSession('a')).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('class sessions with tools', () => {
  let dir: string
  let dsh: FakeDsh
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sfb-tools-'))
    dsh = createFakeDsh()
  })
  afterEach(async () => {
    await dsh.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  function setup(allow: () => string[]) {
    const brain = createBrain({ ctx: dsh.ctx, log, roomDir: join(dir, 'room'), preset: 'schoolforbots', classModel: () => '', tools: () => allow() })
    dsh.ctx.on('session/event', (s: never, e: never) => brain.onSessionEvent(s, e))
    brain.attach(dsh.ctx)
    const sessions = () => [...dsh.sessions.entries()]
    const step = (text: string, recap?: string[]) => brain.think('ai1', 't', { purpose: 'answer', text, deadline: Date.now() + 5_000, ...(recap ? { recap } : {}) })
    return { brain, sessions, step }
  }

  it('lets only the allowed tools through, and moves to a new session with the recap when the list changes', async () => {
    dsh.globalTools = ['memory_search', 'recall', 'send_email']
    let allow = ['memory_search']
    const t = setup(() => allow)
    expect(await t.step('点名')).toBe('好的')
    expect(t.sessions()[0]![1].restricted).toEqual([{ allow: ['memory_search'] }])
    expect(await t.step('再点名')).toBe('好的')
    expect(t.sessions()).toHaveLength(1)

    allow = ['memory_search', 'recall']
    expect(await t.step('又点名', ['老师：同学们好'])).toBe('好的')
    const [, second] = t.sessions()
    expect(second![1].restricted).toEqual([{ allow: ['memory_search', 'recall'] }])
    expect(second![1].messages[0]!.content[0]!.text).toContain('老师：同学们好')
  })

  it('hides every tool when the allowed tool is gone by the time the session starts', async () => {
    const t = setup(() => ['ghost'])
    expect(await t.step('点名')).toBe('好的')
    expect(t.sessions()[0]![1].restricted).toEqual([{ allow: [] }])
    // 名单没变：同一个会话接着用，不反复开新会话
    expect(await t.step('再点名')).toBe('好的')
    expect(t.sessions()).toHaveLength(1)
  })

  it('refuses tool calls that need the owner\'s approval, and more than a few calls a step, only in class sessions', async () => {
    dsh.globalTools = ['memory_search']
    const t = setup(() => ['memory_search'])
    await t.step('点名')
    const sid = t.sessions()[0]![0]
    const asked = await dsh.preExecute(sid, 'memory_search', { kind: 'ask' })
    expect(asked.kind).toBe('deny')
    expect(asked.reason).toContain('要你的主人批准')
    expect((await dsh.preExecute(sid, 'memory_search')).kind).toBe('allow')
    expect((await dsh.preExecute(sid, 'memory_search')).kind).toBe('allow')
    const fourth = await dsh.preExecute(sid, 'memory_search')
    expect(fourth.kind).toBe('deny')
    expect(fourth.reason).toContain('已经调了 3 次工具')
    // 不是上课会话：不管
    const other = await dsh.ctx.sessionController!.create({ workspaceId: 'w', agentPreset: 'standard' })
    expect((await dsh.preExecute(String(other.sessionId), 'memory_search', { kind: 'ask' })).kind).toBe('ask')
  })
})
