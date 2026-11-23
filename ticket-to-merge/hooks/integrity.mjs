import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXED_PROTECTED = [
  'bookshelf.db',
  'bookshelf.db-wal',
  'bookshelf.db-shm',
  'bookshelf.db-journal',
  'src/db/seed.sql',
  'src/db/schema.sql',
]

export function projectRoot(input) {
  return resolve(process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd())
}

export function stateDir(root) {
  const id = createHash('sha1').update(root).digest('hex')
  return join(tmpdir(), 'ticket-to-merge', id)
}

function snapshotDir(root, sessionId) {
  const safe = String(sessionId || 'nosession').replace(/[^A-Za-z0-9_.-]/g, '_')
  return join(stateDir(root), safe)
}

function envFiles(root) {
  try {
    return readdirSync(root).filter((n) => n === '.env' || n.startsWith('.env.'))
  } catch {
    return []
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

export function ensureSnapshot(root, sessionId) {
  const dir = snapshotDir(root, sessionId)
  const manifestPath = join(dir, 'manifest.json')
  if (existsSync(manifestPath)) return dir
  mkdirSync(join(dir, 'files'), { recursive: true })
  const entries = {}
  const rels = [...FIXED_PROTECTED, ...envFiles(root)]
  rels.forEach((rel, i) => {
    const abs = join(root, rel)
    if (!isFile(abs)) {
      entries[rel] = { exists: false }
      return
    }
    const copy = `files/${i}`
    copyFileSync(abs, join(dir, copy))
    entries[rel] = { exists: true, sha256: sha256(abs), copy, mode: statSync(abs).mode & 0o777 }
  })
  writeFileSync(manifestPath, JSON.stringify({ root, entries }))
  return dir
}

export function checkAndRestore(root, sessionId) {
  const dir = snapshotDir(root, sessionId)
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return []
  const { entries } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const rels = new Set([...Object.keys(entries), ...envFiles(root)])
  const restored = []
  for (const rel of rels) {
    const abs = join(root, rel)
    const before = entries[rel] ?? { exists: false }
    const present = isFile(abs)
    if (!before.exists) {
      if (present || existsSync(abs)) {
        rmSync(abs, { force: true })
        restored.push(rel)
      }
    } else if (!present || sha256(abs) !== before.sha256) {
      mkdirSync(dirname(abs), { recursive: true })
      copyFileSync(join(dir, before.copy), abs)
      chmodSync(abs, before.mode)
      restored.push(rel)
    }
  }
  return restored
}

function readStdinJson() {
  try {
    const raw = readFileSync(0, 'utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  const input = readStdinJson()
  const root = projectRoot(input)
  if (mode === 'snapshot') {
    ensureSnapshot(root, input.session_id)
  } else if (mode === 'check') {
    const restored = checkAndRestore(root, input.session_id)
    if (restored.length) {
      process.stderr.write(
        `Guardrail: protected file(s) ${restored.join(', ')} were modified and have been restored. Do not modify them.\n`,
      )
      process.exit(2)
    }
  }
  process.exit(0)
}
