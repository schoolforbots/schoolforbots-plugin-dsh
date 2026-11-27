// 回放里的形象：记录里带了形象的同学画成形象（底色、边框按清单查，不认识的类型当 other、颜色当没选），
// 老师、陪练用固定角色，没带形象的用匿名同学；旧记录照旧是名字第一个字。页面只带用到的图，图只认 data:。
import { describe, expect, it } from 'vitest'
import { buildClassReplay } from '../src/core/class-replay.js'
import { buildClubReplay } from '../src/core/club-replay.js'
import { AVATAR_ART } from '../src/dsh/avatar-art.js'
import { characterFace, faceOf } from '../src/dsh/avatar-look.js'
import { clubArt, clubReplayPage } from '../src/dsh/club-replay-page.js'
import { classArt, replayPage } from '../src/dsh/replay-page.js'
import { sampleLesson } from './class-lesson-sample.js'
import { sampleGame } from './club-game-sample.js'

const P = AVATAR_ART.palette

/** sampleLesson 里的同学带上形象：自己选了 claude 蓝底，8 号是学校以后才有的类型和颜色，9 号（presence 进来的）没选颜色。 */
function lessonWithLooks(): unknown[] {
  const rows = sampleLesson() as { msg?: Record<string, unknown> }[]
  for (const r of rows) {
    const m = r.msg
    if (m?.type === 'welcome') {
      m.student = { studentId: 7, displayName: '阿杰家的小鱼', aiType: 'claude', avatar: { background: 'blue', border: null } }
      m.online = [{ studentId: 8, displayName: '小美家的阿花', aiType: 'grok', avatar: { background: 'gold', border: 'pink' } }]
    }
    if (m?.type === 'presence' && m.joined) m.joined = { studentId: 9, displayName: '小林家的豆豆', aiType: 'kimi', avatar: { background: null, border: null } }
  }
  return rows
}

describe('looks in a lesson replay', () => {
  it('keeps how each classmate looked when they connected', () => {
    const r = buildClassReplay(lessonWithLooks())
    expect(r.seats.map((s) => [s.studentId, s.look])).toEqual([
      [7, { aiType: 'claude', background: 'blue', border: null }],
      [8, { aiType: 'grok', background: 'gold', border: 'pink' }],
      [9, { aiType: 'kimi', background: null, border: null }],
    ])
  })

  it('draws them from the manifest, with the teacher\'s fixed look and only the pictures it uses', () => {
    const art = classArt(buildClassReplay(lessonWithLooks()))!
    expect(art.faces['7']).toEqual({ img: 'claude', bg: P.blue, border: P[AVATAR_ART.types.claude!.default.border] })
    // 不认识的类型当 other，不认识的颜色当没选
    expect(art.faces['8']).toEqual({ img: 'other', bg: P[AVATAR_ART.types.other!.default.background], border: P.pink })
    expect(art.faces['9']).toEqual(faceOf({ aiType: 'kimi', background: null, border: null }))
    expect(art.faces.teacher).toEqual(characterFace('teacher'))
    expect(Object.keys(art.images).sort()).toEqual(['claude', 'kimi', 'other', 'teacher'])
    for (const src of Object.values(art.images)) expect(src).toMatch(/^data:image\/(svg\+xml|webp|png);base64,/)
    const html = replayPage(buildClassReplay(lessonWithLooks()))
    expect(html).toContain("img-src data:")
    expect(html).toContain('"art":')
  })

  it('keeps letters for an old record without looks', () => {
    const r = buildClassReplay(sampleLesson())
    expect(r.seats.every((s) => s.look === undefined)).toBe(true)
    expect(classArt(r)).toBeNull()
    expect(replayPage(r)).not.toContain('"art":')
  })
})

describe('looks in a game replay', () => {
  it('draws students from the game record and the sparring partner with its fixed look', () => {
    const seats = [
      { studentId: 8, displayName: '小美家的阿花', bot: false, aiType: 'gemini', avatar: { background: 'teal', border: 'black' } },
      { studentId: null, displayName: '陪练小黑', bot: true },
      { studentId: 7, displayName: '阿杰家的小鱼', bot: false, aiType: 'deepseek', avatar: { background: null, border: null } },
    ]
    const r = buildClubReplay(sampleGame({ seats } as never))
    expect(r.seats.map((s) => s.look)).toEqual([{ aiType: 'gemini', background: 'teal', border: 'black' }, undefined, { aiType: 'deepseek', background: null, border: null }])
    const art = clubArt(r)!
    expect(art.faces['0']).toEqual({ img: 'gemini', bg: P.teal, border: P.black })
    expect(art.faces['1']).toEqual(characterFace('sparring'))
    expect(clubReplayPage(r)).toContain('"art":')
  })

  it('keeps letters for an old game without looks', () => {
    const r = buildClubReplay(sampleGame())
    expect(clubArt(r)).toBeNull()
  })
})
