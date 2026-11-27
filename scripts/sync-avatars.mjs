// 把素材仓库（schoolforbots-assets）里回放页面要用的形象复制进插件：生成 src/dsh/avatar-art.ts，
// 再把素材仓库的 avatars/LICENSE.md（形象图的授权和原作者）复制成 AVATARS-LICENSE.md。
// 用法：node scripts/sync-avatars.mjs [素材仓库的目录]（默认是和插件仓库并排的 ../schoolforbots-assets）。
// 图的路径按 manifest.json 读（SVG、WebP、PNG 都行），素材仓库换了图或改了清单，重新跑一遍再提交。
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(process.argv[2] ?? join(root, '..', 'schoolforbots-assets'))
const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'))
const MAX_BYTES = 30 * 1024
const MIME = { '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' }

const images = {}
const sources = {}
const take = (avatar) => {
  const path = avatar.image
  const ext = extname(path).toLowerCase()
  const key = path.replace(/^avatars\//, '').slice(0, -ext.length)
  if (!/^[a-z0-9-]+$/.test(key) || !MIME[ext]) throw new Error(`形象要是 avatars/ 下的 SVG、WebP 或 PNG：${path}`)
  let bytes = readFileSync(join(from, path))
  // SVG 去掉注释和标签间的空白，省一点地方
  if (ext === '.svg') bytes = Buffer.from(bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim())
  if (bytes.length > MAX_BYTES) throw new Error(`${path} 超过 30 KB`)
  images[key] = `data:${MIME[ext]};base64,${bytes.toString('base64')}`
  sources[key] = avatar.source ?? 'schoolforbots'
  return key
}

const types = {}
for (const [name, t] of Object.entries(manifest.aiTypes)) types[name] = { image: take(t.avatars[0]), default: t.default }
const characters = {}
for (const [name, c] of Object.entries(manifest.characters)) characters[name] = { image: take(c.avatars[0]), colors: c.colors }

const art = {
  palette: manifest.palette,
  fallbackAiType: manifest.fallbackAiType,
  types,
  characters,
  self: { ring: manifest.self.ring, ringWidth: manifest.self.ringWidth, glow: manifest.self.glow ?? null },
}

// 取自 CrossPet 的（crosspet）和参照它的画风生成的（generated）按 CC BY-NC-SA 4.0；学校自己画的按 CC BY-NC 4.0
const SA = new Set(['crosspet', 'generated'])
const by = (sa) => Object.keys(sources).filter((k) => SA.has(sources[k]) === sa).sort().join('、') || '（无）'
const out = `// 自动生成，不要手改：node scripts/sync-avatars.mjs（来源：schoolforbots-assets 的 manifest.json 和 avatars/）。
// 形象图和清单和插件的代码（MIT）分开授权，见 LICENSE 和 AVATARS-LICENSE.md：
// - 取自 CrossPet（https://github.com/lokicorvus/crosspet）或参照它的画风生成的图按 CC BY-NC-SA 4.0：${by(true)}
// - 机器人网校自己画的图按 CC BY-NC 4.0：${by(false)}
// - 清单的数据（色板、默认配色）按 CC BY-NC 4.0，署名 "School for Bots (schoolforbots.org)"

export interface AvatarArt {
  palette: Record<string, string>
  fallbackAiType: string
  types: Record<string, { image: string; default: { background: string; border: string } }>
  characters: Record<string, { image: string; colors: { background: string; border: string } }>
  self: { ring: string; ringWidth: number; glow: string | null }
}

export const AVATAR_ART: AvatarArt = ${JSON.stringify(art, null, 2)}

/** 形象图（data: 地址），键是 AVATAR_ART 里的 image。 */
export const AVATAR_IMAGES: Record<string, string> = ${JSON.stringify(images, null, 2)}
`
writeFileSync(join(root, 'src', 'dsh', 'avatar-art.ts'), out)
const notes = join(from, 'avatars', 'LICENSE.md')
if (existsSync(notes)) copyFileSync(notes, join(root, 'AVATARS-LICENSE.md'))
console.log(`写好了 src/dsh/avatar-art.ts：${Object.keys(images).length} 张图（来自 ${from}）${existsSync(notes) ? '，复制了 AVATARS-LICENSE.md' : ''}`)
