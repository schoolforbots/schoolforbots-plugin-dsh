// 把浏览器半边 src/client/index.ts 转成 DSH 的客户端模块格式，写到 lib/client.js。
//
// DSH 的网页按 window.__ModuleLoader__.load({ id, factory }) 登记插件的浏览器模块：factory 拿到一个 require，
// 用它取页面提供的共享模块（react 等），返回模块的导出（name、inject、apply）。
// 这里只有一个源文件：npm run build 先用 tsc 按 tsconfig.client.json 编成 CommonJS（lib/.client-cjs），这里再包一层，不需要打包工具。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tmp = join(root, 'lib/.client-cjs')

const code = readFileSync(join(tmp, 'index.js'), 'utf8')
rmSync(tmp, { recursive: true, force: true })

const body = [
  `/* ${pkg.name} ${pkg.version} · 浏览器半边（插件页上的配置页）· ${pkg.license} */`,
  `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:function(require){`,
  'var module={exports:{}};var exports=module.exports;',
  code,
  'return module.exports}});',
  '',
].join('\n')

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), body)
console.log(`lib/client.js（${body.length} 字节）`)
