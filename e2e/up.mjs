// 一条命令跑端到端测试：打包插件 → 起 compose（学校 + DSH）→ 等测试脚本跑完 → 拆掉。
//   npm run e2e
// 环境变量：E2E_MODEL=real（加 DEEPSEEK_API_KEY）用真模型；DSH_VERSION 指定 DSH 版本（默认 latest）；
// SERVER_IMAGE 换服务端镜像；LEAD_MINUTES 几分钟后开课（默认 8）；E2E_KEEP=1 跑完不拆，方便查看。
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// 1. 打包插件，放到 e2e/.build/plugin.tgz（DSH 镜像从这里装）
const build = join(here, '.build')
rmSync(build, { recursive: true, force: true })
mkdirSync(build, { recursive: true })
execFileSync(npm, ['pack', '--pack-destination', build], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
const tgz = readdirSync(build).find((f) => f.endsWith('.tgz'))
if (!tgz) throw new Error('npm pack 没有产出插件包')
copyFileSync(join(build, tgz), join(build, 'plugin.tgz'))

// 2. 后台起 compose，跟着打印日志，等测试脚本（dsh 服务）结束，退出码跟着它。
//    不用 --abort-on-container-exit：生成配置的服务跑完就退出，那样会把整套一起停掉。
const file = ['compose', '-f', join(here, 'compose.yml')]
const compose = (args, opts = {}) => spawnSync('docker', [...file, ...args], { stdio: 'inherit', ...opts })
let code = 1
try {
  const up = compose(['up', '-d', '--build'])
  if (up.status !== 0) throw new Error('docker compose up 失败')
  const logs = spawn('docker', [...file, 'logs', '-f', '--since', '0s', 'config', 'registration', 'class', 'club', 'dsh'], { stdio: 'inherit' })
  const wait = compose(['wait', 'dsh'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })
  code = Number(String(wait.stdout).trim().split(/\s+/).at(-1))
  if (!Number.isInteger(code)) code = 1
  logs.kill()
  console.log(`\n端到端测试${code === 0 ? '通过' : `失败（退出码 ${code}）`}`)
} finally {
  if (process.env.E2E_KEEP !== '1') compose(['down', '-v'])
}
process.exit(code)
