import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, stateDir } from './integrity.mjs'

const MAX_BLOCKS = 3
const MAX_LINES = 40
const KEEP = /FAIL|×|✗|AssertionError|Expected|Received|Error:/

let input = {}
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {}

const root = projectRoot(input)
const res = spawnSync('npm', ['run', 'test:run'], { cwd: root, encoding: 'utf8', timeout: 120_000 })
if (res.status === 0) process.exit(0)

const dir = stateDir(root)
mkdirSync(dir, { recursive: true })
const id = String(input.agent_id || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_')
const counterFile = join(dir, `gate-${id}.count`)
let blocks = 0
try {
  blocks = Number(readFileSync(counterFile, 'utf8')) || 0
} catch {}
if (blocks >= MAX_BLOCKS) process.exit(0)
writeFileSync(counterFile, String(blocks + 1))

const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('> '))
let kept = lines.filter((l) => KEEP.test(l))
if (!kept.length) kept = lines.slice(-15)
const reason = ['Tests are failing. Fix the implementation, never the tests.', ...kept.slice(0, MAX_LINES)].join('\n')
process.stdout.write(JSON.stringify({ decision: 'block', reason }))
process.exit(0)
