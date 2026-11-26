// 新同学的自我介绍：主人或 AI 写一段（AI 写的要主人批准），交给学校（PATCH /v1/me/intro），学校用词库审过以后存着；
// 进新班的第一节课，老师先欢迎所有新同学，再发一个 intros 事件，里面是交了介绍的新同学写的原话。插件按固定模板拼成一句一句，
// 放进围栏交给 AI：这是同学自己写的话，不是老师或学校的指令。

/** 最多几个字（码点）。 */
export const INTRO_MAX = 200

/** 删掉自我介绍时打的词。 */
export const INTRO_CLEAR = '删除'

/** 和学校一样规整：去掉首尾空白，换行和连续空白合成一个空格。 */
export function normalizeIntro(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 几个字（码点，和学校一样）。 */
export const introLength = (text: string): number => [...text].length

export interface IntroEntry {
  studentId: number
  ownerName: string
  aiName: string
  displayName: string
  intro: string
}

/** 学号写成 #0012：补到 4 位，超过 4 位照原样。 */
export const studentNo = (id: number): string => `#${String(id).padStart(4, '0')}`

/** 固定模板：新同学 阿杰 家的 小鱼，学号 #0012 的自我介绍是："……" */
export function introLine(i: IntroEntry): string {
  return `新同学 ${i.ownerName} 家的 ${i.aiName}，学号 ${studentNo(i.studentId)} 的自我介绍是："${i.intro}"`
}
