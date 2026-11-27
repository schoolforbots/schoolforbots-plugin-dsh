// 把素材仓库（schoolforbots-assets）里回放页面要用的形象复制进插件：生成 src/dsh/avatar-art.ts。
// 用法：node scripts/sync-avatars.mjs [素材仓库的目录]（默认是和插件仓库并排的 ../schoolforbots-assets）。
// 素材仓库换了图或改了清单，重新跑一遍再提交。图按 CC BY-NC 4.0 授权，生成的文件开头写明。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(process.argv[2] ?? join(root, '..', 'schoolforbots-assets'))
const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'))
const MAX_BYTES = 30 * 1024

const images = {}
const take = (path) => {
  const key = path.replace(/^avatars\//, '').replace(/\.svg$/, '')
  if (!/^[a-z0-9-]+$/.test(key) || !path.endsWith('.svg')) throw new Error(`形象要是 avatars/ 下的 SVG：${path}`)
  const svg = readFileSync(join(from, path), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()
  if (Buffer.byteLength(svg) > MAX_BYTES) throw new Error(`${path} 超过 30 KB`)
  images[key] = svg
  return key
}

const types = {}
for (const [name, t] of Object.entries(manifest.aiTypes)) types[name] = { image: take(t.avatars[0].image), default: t.default }
const characters = {}
for (const [name, c] of Object.entries(manifest.characters)) characters[name] = { image: take(c.avatars[0].image), colors: c.colors }

const art = {
  palette: manifest.palette,
  fallbackAiType: manifest.fallbackAiType,
  types,
  characters,
  self: { ring: manifest.self.ring, ringWidth: manifest.self.ringWidth, glow: manifest.self.glow ?? null },
}

const out = `// 自动生成，不要手改：node scripts/sync-avatars.mjs（来源：schoolforbots-assets 的 manifest.json 和 avatars/）。
// 形象图和清单按 CC BY-NC 4.0 授权（https://creativecommons.org/licenses/by-nc/4.0/），署名 "School for Bots (schoolforbots.org)"，
// 和插件的代码（MIT）分开授权，见 LICENSE。

export interface AvatarArt {
  palette: Record<string, string>
  fallbackAiType: string
  types: Record<string, { image: string; default: { background: string; border: string } }>
  characters: Record<string, { image: string; colors: { background: string; border: string } }>
  self: { ring: string; ringWidth: number; glow: string | null }
}

export const AVATAR_ART: AvatarArt = ${JSON.stringify(art, null, 2)}

/** 形象图（SVG 原文），键是 AVATAR_ART 里的 image。 */
export const AVATAR_IMAGES: Record<string, string> = ${JSON.stringify(images, null, 2)}
`
writeFileSync(join(root, 'src', 'dsh', 'avatar-art.ts'), out)
console.log(`写好了 src/dsh/avatar-art.ts：${Object.keys(images).length} 张图（来自 ${from}）`)
