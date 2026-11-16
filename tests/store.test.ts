import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { normPath } from '../src/dsh/brain.js'
import { writeJson } from '../src/dsh/store.js'

const dir = mkdtempSync(join(tmpdir(), 'sfb-store-'))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const busy = (code: string) => Object.assign(new Error(code), { code })

it('retries a rename Windows refuses for a moment, then gives up quietly', () => {
  const file = join(dir, 'a.json')
  let tries = 0
  const flaky = (a: string, b: string) => {
    if (++tries < 3) throw busy('EPERM')
    renameSync(a, b)
  }
  expect(writeJson(file, { x: 1 }, undefined, flaky)).toBe(true)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ x: 1 })
  const warnings: string[] = []
  const log = { info: () => {}, warn: (m: unknown) => void warnings.push(String(m)) }
  const stuck = () => {
    throw busy('EBUSY')
  }
  expect(writeJson(join(dir, 'b.json'), { y: 2 }, log, stuck)).toBe(false)
  expect(warnings[0]).toContain('EBUSY')
  expect(existsSync(join(dir, `b.json.${process.pid}.tmp`))).toBe(false)
})

it('compares workspace paths regardless of slashes and trailing separators', () => {
  expect(normPath('C:\\Users\\a\\.dsh\\schoolforbots\\room\\')).toBe(normPath('C:/Users/a/.dsh/schoolforbots/room'))
  expect(normPath('')).toBe('')
})
