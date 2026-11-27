// 回放页面上的形象：把记录里每个人的样子（类型、底色、边框）按素材清单查成要画的图和色值，只带上这一页用到的图。
// 画法（素材仓库 README）：先画一个圆填底色，再画一圈边框，形象叠在上面；自家的在边框外再加一圈光环。
// 不认识的类型用清单的 fallbackAiType（other），不认识的颜色当没选（用这个类型的默认配色）。
// 老师、陪练没有类型，用清单里固定的角色；记录里没带形象的同学（比如只在悄悄话里出现过）用"匿名同学"。
import type { Look } from '../core/avatar.js'
import { AVATAR_ART, AVATAR_IMAGES } from './avatar-art.js'

/** 页面上画一个人要的东西：图的键（在 images 里）、底色、边框色（#RRGGBB）。 */
export interface Face {
  img: string
  bg: string
  border: string
}

/** 交给回放页面的形象：每个人（键由页面自己定）画成什么样、用到的图（data: 地址）、自家的光环。 */
export interface PageArt {
  faces: Record<string, Face>
  images: Record<string, string>
  self: { ring: string; ringWidth: number; glow: string | null }
}

export type Character = 'teacher' | 'sparring' | 'anonymous'

const color = (name: string | null | undefined, fallback: string) => AVATAR_ART.palette[name ?? ''] ?? AVATAR_ART.palette[fallback] ?? '#9CA3AF'

/** 一个学生的样子。 */
export function faceOf(look: Look): Face {
  const t = AVATAR_ART.types[look.aiType] ?? AVATAR_ART.types[AVATAR_ART.fallbackAiType]!
  return { img: t.image, bg: color(look.background, t.default.background), border: color(look.border, t.default.border) }
}

/** 老师、陪练、匿名同学。 */
export function characterFace(name: Character): Face {
  const c = AVATAR_ART.characters[name] ?? AVATAR_ART.characters.anonymous!
  return { img: c.image, bg: color(c.colors.background, 'gray'), border: color(c.colors.border, 'gray') }
}

const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`

/** 把这一页的人凑成 PageArt：只带用到的图。 */
export function pageArt(faces: Record<string, Face>): PageArt {
  const images: Record<string, string> = {}
  for (const f of Object.values(faces)) {
    const svg = AVATAR_IMAGES[f.img]
    if (svg && !images[f.img]) images[f.img] = dataUrl(svg)
  }
  return { faces, images, self: AVATAR_ART.self }
}
