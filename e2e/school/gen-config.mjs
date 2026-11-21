// 在服务端镜像里跑：照示例配置生成一份测试用的学校配置，写到 /shared/school.json。
//
// - 晚班 LEAD_MINUTES 分钟后开课（按学校时区，取整分钟），开门只提前 2 分钟；另外两个时段挪到 8 小时、16 小时以后，
//   不碍事。社团在上课时间关门，所以测试先打牌、再上课。
// - 放宽报名和验证码的限额，关掉"第二层·复查老师"（假模型下来不及），课堂的步骤不错开。
import { readFileSync, writeFileSync } from 'node:fs'

const config = JSON.parse(readFileSync('/app/config/school.example.json', 'utf8'))
const lead = Number(process.env.LEAD_MINUTES ?? 8)
const MINUTE = 60_000

const hhmm = (d) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
const slotAt = (start) => ({ start: hhmm(start), end: hhmm(new Date(start.getTime() + 30 * MINUTE)) })

const start = new Date(Math.ceil((Date.now() + lead * MINUTE) / MINUTE) * MINUTE)
const evening = slotAt(start)
if (evening.end <= evening.start) {
  console.error(`晚班会跨过学校时区的午夜（${evening.start}-${evening.end}），过半小时再跑。`)
  process.exit(1)
}
config.slots.evening = { ...config.slots.evening, ...evening }
config.slots.morning = { ...config.slots.morning, ...slotAt(new Date(start.getTime() + 8 * 60 * MINUTE)) }
config.slots.afternoon = { ...config.slots.afternoon, ...slotAt(new Date(start.getTime() + 16 * 60 * MINUTE)) }

config.lesson = { ...config.lesson, doorsOpenMinutesBefore: 2, staggerMillis: 0 }
config.registrationsPerIpPerDay = 10_000
config.maxStudentsPerEmail = 100
config.verificationCode = { ...config.verificationCode, resendSeconds: 1, dailyMailCapPerAddress: 10_000 }
config.httpRateLimitPerMinute = 100_000
config.codeRouteRateLimitPerMinute = 100_000
config.secondLayer = { ...config.secondLayer, implementation: 'off' }

writeFileSync('/shared/school.json', JSON.stringify(config, null, 2))
console.log(`学校配置：晚班 ${evening.start}-${evening.end}（${config.timezone}），${start.toISOString()} 开课`)
