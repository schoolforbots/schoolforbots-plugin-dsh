// 上课回放的本地网页：/school replay 时找到这节课的记录文件，做成回放页面，在本机起一个只给自己看的小网页服务，用默认浏览器打开。
// - 只监听 127.0.0.1，端口交给系统挑一个空着的；地址里带一段随机口令，本机别的网页猜不到。
// - 第一次用时才起服务，几个回放共用一个；30 分钟没人看就关掉，插件卸载时也关。
// - 打不开浏览器（没有图形界面、DSH 跑在别的机器上）就把地址交给机器人的主人自己开。
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { buildClassReplay } from '../core/class-replay.js'
import { buildClubReplay } from '../core/club-replay.js'
import { clubReplayPage } from './club-replay-page.js'
import type { Logger } from './host.js'
import { replayPage } from './replay-page.js'
import { REPLAY_DIRS } from './replays.js'

const IDLE_MS = 30 * 60_000

export interface SavedLesson {
  path: string
  date: string
  /** 文件名（不带 .jsonl）。 */
  name: string
  title: string
  className: string
  at: number
}

/** 用默认浏览器打开地址。打不开返回 false。 */
export function openBrowser(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

export function createReplayViewer(o: { dir: string; log: Logger; open?: (url: string) => Promise<boolean>; idleMs?: number }) {
  const pages = new Map<string, string>()
  let server: Server | null = null
  let base = ''
  let idle: NodeJS.Timeout | null = null

  function touch(): void {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => close(), o.idleMs ?? IDLE_MS)
    idle.unref?.()
  }

  function close(): void {
    if (idle) clearTimeout(idle)
    idle = null
    pages.clear()
    server?.close()
    server = null
    base = ''
  }

  async function ensureServer(): Promise<string> {
    if (server && base) return base
    const s = createServer((req, res) => {
      touch()
      const m = /^\/r\/([0-9a-f]{32})\/?$/.exec(req.url ?? '')
      const html = m && req.method === 'GET' ? pages.get(m[1]!) : undefined
      if (!html) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('没有这个回放（可能已经过期了，回 DSH 再打一次 /school replay）。')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
      res.end(html)
    })
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => resolve())
    })
    s.unref()
    server = s
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    return base
  }

  /** 某个学生（学号）存着的上课记录，新的在前。 */
  /** 某个学生（学号）存着的斗地主对局记录，新的在前。title 是"第几局 · 地主/农民 · 输赢 · 得分"。 */
  async function games(studentId: number): Promise<SavedLesson[]> {
    const root = join(o.dir, REPLAY_DIRS.club)
    const out: SavedLesson[] = []
    for (const day of await readdir(root).catch(() => [] as string[])) {
      for (const f of await readdir(join(root, day)).catch(() => [] as string[])) {
        if (!f.endsWith('.jsonl') || !f.startsWith(`${studentId}-`)) continue
        const path = join(root, day, f)
        const st = await stat(path).catch(() => null)
        if (!st) continue
        const head = await readHead(path)
        const g = (head?.game ?? {}) as Record<string, unknown>
        const role = g.role === 'landlord' ? '地主' : g.role === 'farmer' ? '农民' : ''
        const result = g.outcome === 'no_landlord' ? '作废' : typeof g.won === 'boolean' ? (g.won ? '赢' : '输') : ''
        const score = typeof g.score === 'number' ? `${g.score > 0 ? '+' : ''}${g.score}` : ''
        const title = [`第 ${String(head?.gameId ?? '?')} 局`, role, result, score].filter(Boolean).join(' · ')
        out.push({ path, date: day, name: f.slice(0, -'.jsonl'.length), title, className: '', at: st.mtimeMs })
      }
    }
    return out.sort((a, b) => b.at - a.at)
  }

  async function lessons(studentId: number): Promise<SavedLesson[]> {
    const root = join(o.dir, REPLAY_DIRS.lesson)
    const out: SavedLesson[] = []
    for (const day of await readdir(root).catch(() => [] as string[])) {
      for (const f of await readdir(join(root, day)).catch(() => [] as string[])) {
        if (!f.endsWith('.jsonl') || !f.startsWith(`${studentId}-`)) continue
        const path = join(root, day, f)
        const st = await stat(path).catch(() => null)
        if (!st) continue
        const head = await readHead(path)
        const session = (head?.session ?? {}) as Record<string, unknown>
        const title = session.kind === 'study' ? '自习课' : `${String(session.subject ?? '')}${session.title ? `《${String(session.title)}》` : ''}`
        out.push({ path, date: day, name: f.slice(0, -'.jsonl'.length), title: title || '（没有课名）', className: String((head?.class as Record<string, unknown> | undefined)?.className ?? ''), at: st.mtimeMs })
      }
    }
    return out.sort((a, b) => b.at - a.at)
  }

  async function readHead(path: string): Promise<Record<string, unknown> | null> {
    const text = await readFile(path, 'utf8').catch(() => '')
    const nl = text.indexOf('\n')
    const first = nl < 0 ? text : text.slice(0, nl)
    try {
      return JSON.parse(first) as Record<string, unknown>
    } catch {
      return null
    }
  }

  async function readRows(path: string): Promise<unknown[]> {
    const rows: unknown[] = []
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line))
      } catch {
        // 写到一半的行：跳过
      }
    }
    return rows
  }

  return {
    lessons,
    games,
    /** 做好一节课的回放页面，起服务、开浏览器。返回地址和浏览器打开了没有。 */
    async open(lesson: SavedLesson): Promise<{ url: string; opened: boolean; steps: number }> {
      const replay = buildClassReplay(await readRows(lesson.path))
      const token = randomBytes(16).toString('hex')
      const url = `${await ensureServer()}/r/${token}/`
      pages.set(token, replayPage(replay))
      touch()
      const opened = await (o.open ?? openBrowser)(url)
      if (!opened) o.log.info(`上课回放：打不开浏览器，地址是 ${url}`)
      return { url, opened, steps: replay.steps.length }
    },
    /** 做好一局斗地主的回放页面，起服务、开浏览器。 */
    async openGame(game: SavedLesson): Promise<{ url: string; opened: boolean; steps: number }> {
      const replay = buildClubReplay(await readRows(game.path))
      const token = randomBytes(16).toString('hex')
      const url = `${await ensureServer()}/r/${token}/`
      pages.set(token, clubReplayPage(replay))
      touch()
      const opened = await (o.open ?? openBrowser)(url)
      if (!opened) o.log.info(`斗地主回放：打不开浏览器，地址是 ${url}`)
      return { url, opened, steps: replay.steps.length }
    },
    close,
  }
}

export type ReplayViewer = ReturnType<typeof createReplayViewer>
