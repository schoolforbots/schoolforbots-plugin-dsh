// 完整的对局记录和上课记录存成文件：插件目录下 club-replays/、class-replays/，按学校时区的日子分文件夹，
// 一局、一节课一个 .jsonl：第一行概况，中间每行一条消息，斗地主最后一行是学校的完整牌谱。
// 只留最近 REPLAY_KEEP 个，多了按写下的先后删最早的。写文件排着队一个一个来，不拖慢上课、打牌。
import { access, mkdir, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReplayFile, ReplaySink } from '../core/replay.js'
import type { Logger } from './host.js'

export const REPLAY_DIRS = { club: 'club-replays', lesson: 'class-replays' } as const
/** 各留几个：斗地主 50 局，上课 30 节。 */
export const REPLAY_KEEP = { club: 50, lesson: 30 } as const

const exists = (p: string) => access(p).then(() => true, () => false)
const safe = (s: string) => s.replace(/[^0-9A-Za-z_-]/g, '_')

export function createReplays(o: { dir: string; log: Logger; keep?: Partial<Record<ReplayFile['kind'], number>> }): ReplaySink & { flush(): Promise<void> } {
  let chain: Promise<void> = Promise.resolve()

  async function prune(kind: ReplayFile['kind']): Promise<void> {
    const root = join(o.dir, REPLAY_DIRS[kind])
    const keep = o.keep?.[kind] ?? REPLAY_KEEP[kind]
    const files: { path: string; at: number }[] = []
    for (const day of await readdir(root).catch(() => [] as string[])) {
      const d = join(root, day)
      for (const f of await readdir(d).catch(() => [] as string[])) {
        if (!f.endsWith('.jsonl')) continue
        const p = join(d, f)
        const st = await stat(p).catch(() => null)
        if (st) files.push({ path: p, at: st.mtimeMs })
      }
    }
    files.sort((a, b) => b.at - a.at || b.path.localeCompare(a.path))
    for (const f of files.slice(keep)) await rm(f.path, { force: true })
    // 删空了的日子文件夹（不空的 rmdir 会失败，不要紧）
    for (const day of await readdir(root).catch(() => [] as string[])) await rmdir(join(root, day)).catch(() => {})
  }

  async function write(file: ReplayFile): Promise<void> {
    try {
      const dayDir = join(o.dir, REPLAY_DIRS[file.kind], safe(file.date))
      await mkdir(dayDir, { recursive: true })
      // 同一节课插件重启过：前面那份不覆盖，后面这份加编号
      const base = safe(file.name)
      let path = join(dayDir, `${base}.jsonl`)
      for (let n = 2; await exists(path); n++) path = join(dayDir, `${base}-${n}.jsonl`)
      const rows = [file.head, ...file.lines, ...(file.tail ? [file.tail] : [])]
      await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      await prune(file.kind)
    } catch (error) {
      o.log.warn(`${file.kind === 'club' ? '对局' : '上课'}的完整记录写不下来：`, (error as Error)?.message ?? error)
    }
  }

  return {
    save(file) {
      chain = chain.then(() => write(file))
    },
    flush: () => chain,
  }
}
