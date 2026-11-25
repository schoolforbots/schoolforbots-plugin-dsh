// 端到端测试脚本：在 DSH 容器里跑。
//
// 1. 等学校就绪；按模式写一份 profile 覆盖层（假模型、插件指向本地学校），启动 `dsh web`，用它打印的 token 换 cookie。
// 2. 建一个会话，以机器人的主人的身份说话（DSH 的 session/prompt，来源是 user）：报名 → 同意校规 → 验证码 → 入社。
//    假模型据此调用插件的工具；审批由辅助插件自动"允许"；验证码从 mailpit 取。
// 3. 校园广播：报完名以后插件自己拉到开测前发的两条；机器人的主人下一次开口时，重要的那条附进这一轮（放学备注没开，普通的不附）。
// 4. 等插件的档案里出现打完的一局、上完的一节课，再问一句"今天在学校怎么样"。
// 失败时打印插件的档案，退出码 1。
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const SCHOOL = 'http://school'
const MAIL = 'http://mailpit:8025'
const REAL = process.env.E2E_MODEL === 'real'
const STATE = `${process.env.DSH_HOME}/schoolforbots/state.json`
const deadline = Date.now() + Number(process.env.E2E_TIMEOUT_MINUTES ?? 25) * 60_000
const started = Date.now()

const log = (...a) => console.log(`[e2e ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(label, check, { every = 2_000, timeoutMs = deadline - Date.now(), onSlow } = {}) {
  const until = Math.min(deadline, Date.now() + timeoutMs)
  let nudged = false
  log(`等：${label}`)
  for (;;) {
    let value
    try {
      value = await check()
    } catch {
      value = undefined
    }
    if (value) {
      log(`好了：${label}`)
      return value
    }
    if (Date.now() > until) throw new Error(`超时：${label}`)
    // 真模型可能先追问一句：过一会儿还没进展，就补一句话
    if (onSlow && !nudged && Date.now() > until - timeoutMs / 2) {
      nudged = true
      await onSlow()
    }
    await sleep(every)
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'))
  } catch {
    return null
  }
}
const student = () => readState()?.students?.[0]

// ---------- 启动 DSH ----------

function writePatch() {
  const rows = []
  if (!REAL) {
    rows.push({ id: 'agent-default-model', config: { provider: 'e2e-fake', model: 'e2e-fake' } })
    rows.push({ id: 'session-title', disabled: true })
    rows.push({ id: 'session-title-llm', disabled: true })
  }
  rows.push({
    id: 'schoolforbots',
    config: { base: SCHOOL, statusUrl: '', clubJoin: 'bots', clubGamesPerDay: 1, clubReactChance: 0, memoryAccess: true },
  })
  // JSON 也是合法的 YAML
  writeFileSync('/e2e/test.patch.yml', JSON.stringify(rows, null, 2))
}

let stopping = false

function startDsh() {
  mkdirSync('/work', { recursive: true })
  const args = ['web', '--patch', '/e2e/test.patch.yml', '--host', '127.0.0.1', '--port', '3080', '--no-open']
  const env = { ...process.env, DEEPSEEK_API_KEY: REAL ? process.env.DEEPSEEK_API_KEY : 'keyless-e2e-no-call' }
  const child = spawn('dsh', args, { cwd: '/work', env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const echo = (tag) => (chunk) => {
    const text = String(chunk)
    out += text
    for (const line of text.split('\n')) if (line.trim()) console.log(`[dsh${tag}] ${line}`)
  }
  child.stdout.on('data', echo(''))
  child.stderr.on('data', echo(':err'))
  child.once('exit', (code) => {
    if (stopping) return
    log(`dsh 意外退出了（${code}）`)
    log('插件档案：', JSON.stringify(readState(), null, 2)?.slice(0, 4000))
    process.exit(1)
  })
  return {
    child,
    url: () => /dsh web: (http:\/\/\S+)/.exec(out)?.[1],
  }
}

async function connect(launchUrl) {
  const res = await fetch(launchUrl, { redirect: 'manual' })
  const cookie = res.headers.getSetCookie?.()[0]?.split(';', 1)[0]
  if (!cookie) throw new Error(`换不到 cookie（HTTP ${res.status}）`)
  const origin = new URL(launchUrl).origin
  return async function rpc(method, args) {
    const rpcId = randomUUID()
    const r = await fetch(`${origin}/api/${method}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} 失败：HTTP ${r.status} ${text.slice(0, 500)}`)
    const envelope = JSON.parse(text)
    return envelope.result
  }
}

// ---------- 邮件 ----------

async function latestCode() {
  const list = await (await fetch(`${MAIL}/api/v1/messages`)).json()
  const id = list?.messages?.[0]?.ID
  if (!id) return null
  const msg = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json()
  return /(?<!\d)(\d{6})(?!\d)/.exec(`${msg?.Text ?? ''}\n${msg?.HTML ?? ''}`)?.[1] ?? null
}

// ---------- 流程 ----------

async function main() {
  log(`模式：${REAL ? '真模型' : '假模型'}`)
  await waitFor('学校就绪', async () => (await fetch(`${SCHOOL}/v1/school-calendar`)).ok)
  const calendar = await (await fetch(`${SCHOOL}/v1/school-calendar`)).json()
  log(`学校：${calendar.state}，晚班 ${calendar.slots?.evening?.start}-${calendar.slots?.evening?.end}（${calendar.timezone}）`)

  writePatch()
  const dsh = startDsh()
  const launchUrl = await waitFor('DSH 启动', () => dsh.url(), { every: 500, timeoutMs: 120_000 })
  const rpc = await connect(launchUrl)

  const created = await rpc('session/create', { request: { cwd: '/work' } })
  log('建会话：', JSON.stringify(created).slice(0, 300))
  const sessionId = created?.value?.sessionId ?? created?.sessionId ?? created?.value?.id ?? created?.id
  if (!sessionId) throw new Error('拿不到会话编号')

  const say = async (text) => {
    log(`机器人的主人说：${text}`)
    const r = await rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] } })
    if (r && r.ok === false) log('发消息的回答：', JSON.stringify(r).slice(0, 300))
  }

  await say('帮我报名机器人网校：邮箱 e2e@example.test，我的称呼是测试员，你叫小测，初中部，晚班。')
  await waitFor('插件里有了报名草稿', () => student(), {
    timeoutMs: 180_000,
    onSlow: () => say('请直接用 school_enroll 工具报名，信息就是上面那些。'),
  })

  await say('我读过校规了，同意。')
  const code = await waitFor('验证码邮件', () => latestCode(), {
    timeoutMs: 180_000,
    onSlow: () => say('我确认同意这一版校规，请继续，把验证码发到我的邮箱。'),
  })
  await say(`验证码是 ${code}`)
  await waitFor('报名完成（有学号）', () => student()?.studentId, { timeoutMs: 180_000 })

  // 插件报完名以后半分钟左右第一次拉广播
  const casts = await waitFor('拉到两条校园广播', () => (student()?.broadcasts?.items?.length >= 2 ? student().broadcasts.items : null), { timeoutMs: 120_000 })
  const important = casts.find((b) => b.title === 'e2e 重要广播')
  const normal = casts.find((b) => b.title === 'e2e 普通广播')
  if (!important || !normal) throw new Error(`广播不对：${JSON.stringify(casts)}`)
  if (typeof important.id !== 'number' || important.audience !== '全校' || important.importance !== 'important' || important.told || normal.told) {
    throw new Error(`广播的字段不对：${JSON.stringify(casts)}`)
  }
  log('广播：', JSON.stringify(casts.map(({ id, seq, title, importance, audience, told }) => ({ id, seq, title, importance, audience, told }))))

  await say('帮我入社，加入斗地主社，我知道每一步都要花模型费用。')
  // 这一轮附上了重要的那条（附上就记成告诉过）；放学备注没开，普通的那条不附
  await waitFor('重要广播附进了机器人的主人这一轮', () => student()?.broadcasts?.items?.find((b) => b.title === 'e2e 重要广播')?.told, { timeoutMs: 60_000 })
  if (student().broadcasts.items.find((b) => b.title === 'e2e 普通广播')?.told) throw new Error('放学备注没开，普通广播不该附进对话')
  await waitFor('入了斗地主社', () => student()?.club?.enabled, {
    timeoutMs: 180_000,
    onSlow: () => say('确认入社，请继续。'),
  })

  const games = await waitFor('打完一局斗地主', () => student()?.diary?.clubGames?.length > 0 && student().diary.clubGames, {
    every: 5_000,
    timeoutMs: 15 * 60_000,
  })
  log('牌局：', JSON.stringify(games[0]))

  const summaries = await waitFor('上完一节课（收到放学小结）', () => student()?.diary?.summaries?.length > 0 && student().diary.summaries, {
    every: 5_000,
  })
  log('小结：', JSON.stringify(summaries[0]).slice(0, 400))

  await say('今天在学校怎么样？')
  await sleep(5_000)

  const s = student()
  log('通过：', JSON.stringify({ studentId: s.studentId, className: s.className, games: s.diary.clubGames.length, lessons: s.diary.summaries.length, broadcasts: s.broadcasts.items.length }))
  stopping = true
  dsh.child.kill()
  process.exit(0)
}

main().catch((error) => {
  log(`失败：${error?.message ?? error}`)
  log('插件档案：', JSON.stringify(readState(), null, 2)?.slice(0, 4000))
  process.exit(1)
})
