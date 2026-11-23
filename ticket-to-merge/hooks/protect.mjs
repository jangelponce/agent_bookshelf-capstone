import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { ensureSnapshot, FIXED_PROTECTED, projectRoot } from './integrity.mjs'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MANIFESTS = new Set(['package.json', 'package-lock.json'])
const PROTECTED_RELS = new Set(FIXED_PROTECTED)
const PROTECTED_BASENAMES = /bookshelf\.db|seed\.sql|schema\.sql/
const GLOB_CANDIDATES = [
  'bookshelf.db',
  'bookshelf.db-wal',
  'bookshelf.db-shm',
  'bookshelf.db-journal',
  'seed.sql',
  'schema.sql',
  '.env',
  '.env.local',
  '.env.production',
  '.env.x',
]

const WRAPPERS = new Set([
  '{', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until',
  'time', 'command', 'builtin', 'exec', 'nohup', 'sudo', 'env', 'xargs',
])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const SEPARATORS = ';&|\n()`'
const WRITE_PROGRAMS = new Set([
  'rm', 'mv', 'cp', 'tee', 'truncate', 'dd', 'ln', 'chmod', 'chown', 'install',
  'rsync', 'shred', 'unlink', 'rmdir', 'touch', 'sqlite3', 'patch',
])
const READ_PROGRAMS = new Set([
  'cat', 'bat', 'head', 'tail', 'less', 'more', 'rg', 'grep', 'egrep', 'fgrep', 'wc', 'ls',
  'eza', 'file', 'stat', 'diff', 'cmp', 'sha256sum', 'shasum', 'md5', 'md5sum', 'od',
  'hexdump', 'xxd', 'strings', 'echo', 'fd', 'find', 'sed', 'test', '[', 'realpath', 'basename', 'dirname',
])
const GIT_READ = new Set(['diff', 'log', 'show', 'status', 'blame', 'ls-files', 'cat-file', 'grep', 'rev-parse', 'branch'])
const GIT_WRITE = new Set([
  'checkout', 'restore', 'reset', 'stash', 'clean', 'rm', 'mv', 'apply', 'am',
  'cherry-pick', 'revert', 'merge', 'rebase', 'switch',
])
const DEP_ADD = new Set(['install', 'i', 'add', 'uninstall', 'remove', 'rm', 'un', 'update', 'up'])
const INLINE_FLAGS = {
  node: /^(-e|-p|--eval|--print|-pe|-ep)$/,
  nodejs: /^(-e|-p|--eval|--print|-pe|-ep)$/,
  python: /^-c$/,
  python3: /^-c$/,
  perl: /^-[a-zA-Z]*[eE]$/,
  ruby: /^-[a-z]*e$/,
  bun: /^(-e|--eval|-p|--print)$/,
  php: /^-r$/,
}
const FS_WRITE_CALL = new RegExp(
  [
    '\\b(writefile|writefilesync|appendfile|appendfilesync|rmsync|unlink|unlinksync|truncate|truncatesync)\\b',
    '\\b(rename|renamesync|copyfile|copyfilesync|cpsync|createwritestream|writesync|rmtree|write_text|write_bytes)\\b',
    '\\bos\\.(remove|unlink|rename|removedirs)\\b|\\bshutil\\b|\\bfileutils\\b|\\bfile\\.(write|delete|binwrite)\\b',
    '\\.rm\\(|\\bunlink\\s*\\(',
    '\\bopen(sync)?\\s*\\([^)]*,\\s*[a-z]*[wax]',
    '\\bopen\\s*\\([^)]*>',
    'mode\\s*=\\s*[wa]',
  ].join('|'),
)

function block(rule, detail) {
  process.stderr.write(`Guardrail [${rule}]: ${detail}\n`)
  process.exit(2)
}

function splitSegments(command) {
  const segments = []
  let tokens = []
  let word = ''
  let inWord = false
  let quote = null
  const endWord = () => {
    if (inWord) tokens.push(word)
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (tokens.length) segments.push(tokens)
    tokens = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else word += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) word += command[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\') {
      const next = command[++i]
      if (next === undefined) break
      if (next !== '\n') {
        word += next
        inWord = true
      }
    } else if (SEPARATORS.includes(c)) {
      endSegment()
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endSegment()
  return segments
}

function parseSegment(tokens) {
  let i = 0
  let wrapped = false
  while (i < tokens.length) {
    const token = tokens[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) i++
    else if (WRAPPERS.has(token)) {
      wrapped = true
      i++
    } else if (wrapped && token.startsWith('-')) i++
    else break
  }
  if (i >= tokens.length) return null
  return { program: basename(tokens[i]), rest: tokens.slice(i + 1) }
}

function gitSubcommand(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-C' || rest[i] === '-c') i++
    else if (!rest[i].startsWith('-')) return rest[i]
  }
  return ''
}

function isWriteSegment({ program, rest }) {
  if (WRITE_PROGRAMS.has(program)) return true
  if (program === 'sed' || program === 'perl') return rest.some((t) => /^-[a-z]*i/.test(t) || t.startsWith('--in-place'))
  if (program === 'awk' || program === 'gawk') return rest.includes('inplace')
  if (program === 'find') return rest.some((t) => ['-delete', '-exec', '-execdir', '-ok', '-fprint'].includes(t))
  if (program === 'git') return GIT_WRITE.has(gitSubcommand(rest))
  return false
}

function isReadOnly(parsed, tokens) {
  if (tokens.some((t) => t.includes('>') || t.includes('<('))) return false
  if (isWriteSegment(parsed)) return false
  if (parsed.program === 'git') return GIT_READ.has(gitSubcommand(parsed.rest))
  return READ_PROGRAMS.has(parsed.program)
}

function globToRegex(glob) {
  let out = ''
  let braces = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2)
      if (end === -1) out += '\\['
      else {
        let cls = glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')
        out += `[${cls}]`
        i = end
      }
    } else if (c === '{' && glob.indexOf('}', i) !== -1 && glob.slice(i, glob.indexOf('}', i)).includes(',')) {
      out += '(?:'
      braces++
    } else if (c === '}' && braces > 0) {
      out += ')'
      braces--
    } else if (c === ',' && braces > 0) out += '|'
    else out += c.replace(/[.+^$()|\\{}\]]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

function isGlob(token) {
  return /[*?[]/.test(token) || /\{[^}]*,[^}]*\}/.test(token)
}

function globHitsProtected(token, root, cwd) {
  const slash = token.lastIndexOf('/')
  const base = token.slice(slash + 1)
  if (!base) return false
  const dir = slash === -1 ? '' : token.slice(0, slash)
  if (dir && !isGlob(dir)) {
    const rel = relative(root, resolve(cwd, dir)).toLowerCase()
    if (rel !== '' && rel !== 'src' && rel !== 'src/db') return false
  }
  let re
  try {
    re = globToRegex(base)
  } catch {
    return true
  }
  return GLOB_CANDIDATES.some((c) => re.test(c))
}

function checkDependencies({ program, rest }) {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(program)) return null
  const args = rest.filter((t) => !t.startsWith('-'))
  const sub = args[0]
  if (sub === 'pkg' && program === 'npm' && ['set', 'delete', 'fix'].includes(args[1])) return 'npm pkg modifies package.json'
  if (DEP_ADD.has(sub) && args.length > 1) return `${program} ${sub} with a package changes dependencies`
  return null
}

function checkInterpreter(parsed, norm, hasHeredoc) {
  const { program, rest } = parsed
  const name = program.replace(/\d+(\.\d+)*$/, (m) => (program.startsWith('python') ? m : m))
  let inline = false
  if (program === 'deno') inline = rest[0] === 'eval'
  else {
    const flag = INLINE_FLAGS[program] ?? INLINE_FLAGS[name]
    inline = Boolean(flag) && rest.some((t) => flag.test(t))
    if (!inline && /^(node|nodejs|python[0-9.]*|perl|ruby|bun|deno)$/.test(program) && hasHeredoc) inline = true
  }
  if (!inline) return null
  return FS_WRITE_CALL.test(norm) ? `inline ${program} code performs a filesystem write` : null
}

function checkOpaque(raw) {
  if (/\|&?\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*\/)?(?:sh|bash|zsh|dash|ksh)(?=$|[\s;&|)<`])/.test(raw)) return 'piping into a shell'
  if (/\bbase64\b[^\n;&|]*\s(-[a-zA-Z]*[dD][a-zA-Z]*|--decode)(\s|$)/.test(raw)) return 'base64 decoding'
  if (/\bxxd\b[^\n;&|]*\s-[a-zA-Z]*r/.test(raw)) return 'xxd -r decoding'
  if (/\$'/.test(raw)) return 'ANSI-C quoted string'
  if (/\bprintf\b/.test(raw) && /\\x[0-9a-fA-F]|\\[0-7]{3}/.test(raw) && /\||\$\(|`/.test(raw)) return 'printf with escape sequences'
  if (/(^|[\s;&|(])(source|\.)\s+<\(/.test(raw)) return 'source of process substitution'
  return null
}

function checkBashCommand(command, ctx, depth = 0) {
  const raw = command
  const norm = raw.toLowerCase().replace(/['"\\]/g, '')
  const opaque = checkOpaque(raw)
  if (opaque) block('opaque-execution', `${opaque} can hide writes to protected files`)

  if (/(^|[\s/=])\.env($|[\s./;|&)><])/.test(norm)) block('secrets', 'commands touching .env files are not allowed')

  const cleaned = raw.replace(/&>>?\s*\/dev\/null/g, ' ').replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/\d*[<>]&\d+-?/g, ' ')
  const segments = splitSegments(cleaned).map((tokens) => tokens.map((t) => t.toLowerCase()))
  const hasHeredoc = /<<-?\s*['"]?\w/.test(raw)

  const parsedSegments = []
  for (const tokens of segments) {
    const parsed = parseSegment(tokens)
    if (!parsed) continue
    parsedSegments.push({ tokens, parsed })
    const { program, rest } = parsed

    if (program === 'eval') block('opaque-execution', 'eval can hide writes to protected files')
    if (SHELLS.has(program) && depth < 4) {
      const c = rest.findIndex((t) => /^-[a-z]*c$/.test(t))
      if (c !== -1 && rest[c + 1] !== undefined) checkBashCommand(rest[c + 1], ctx, depth + 1)
    }

    const dep = checkDependencies(parsed)
    if (dep) block('dependencies', `${dep}; ask the user before changing dependencies`)
    if (program === 'git' && ['clean', 'stash'].includes(gitSubcommand(rest))) {
      block('git-destructive', `git ${gitSubcommand(rest)} can discard protected files`)
    }
    const interp = checkInterpreter(parsed, norm, hasHeredoc)
    if (interp) block('inline-write', interp)

    const segText = tokens.join(' ')
    if (PROTECTED_BASENAMES.test(segText) && !isReadOnly(parsed, tokens)) {
      block('protected-file', 'this command may modify a protected database or SQL file')
    }
  }

  const writes = parsedSegments.filter(({ tokens, parsed }) => isWriteSegment(parsed) || tokens.some((t) => t.includes('>')))

  for (const { tokens, parsed } of writes) {
    for (const t of parsed.rest.length ? tokens : []) {
      if (t.startsWith('-') || !isGlob(t)) continue
      if (globHitsProtected(t, ctx.root, ctx.cwd)) block('glob', `glob "${t}" could match a protected file`)
    }
    if (['rm', 'mv', 'rmdir', 'shred'].includes(parsed.program)) {
      for (const t of parsed.rest) {
        if (t.startsWith('-') || isGlob(t)) continue
        const rel = relative(ctx.root, resolve(ctx.cwd, t)).toLowerCase()
        if (rel === '' || rel === 'src' || rel === 'src/db') block('protected-dir', `"${t}" contains protected files`)
      }
    }
  }

  const dbContext = /src\/db|(^|[\s;&|(])(cd|pushd)\s+\S*\bdb\b|(^|[\s;&|(])(cd|pushd)\s+(\.\/)?src\b/.test(norm)
  if (dbContext && writes.length) block('protected-dir', 'write operations in src/db are not allowed')

  if (ctx.agent === 'ticket-to-merge:implementer') {
    const testsContext = norm.includes('tests/') || /(^|[\s;&|(])(cd|pushd)\s+(\.\/)?tests\b/.test(norm)
    if (testsContext && writes.length) block('role:implementer', 'the implementer must not modify tests/')
  }
}

function pathViews(root, filePath) {
  const abs = resolve(root, filePath)
  const real = (p) => {
    const parts = []
    let cur = p
    for (;;) {
      try {
        return resolve(realpathSync(cur), ...parts.reverse())
      } catch {
        parts.push(basename(cur))
        const up = dirname(cur)
        if (up === cur) return p
        cur = up
      }
    }
  }
  const views = [[root, abs]]
  try {
    views.push([realpathSync(root), real(abs)])
  } catch {}
  return views.map(([r, a]) => ({ rel: relative(r, a).replace(/\\/g, '/').toLowerCase(), abs: a.toLowerCase() }))
}

function isEnvName(name) {
  return name === '.env' || name.startsWith('.env.')
}

function checkFileTool(tool, filePath, ctx) {
  const views = pathViews(ctx.root, filePath)
  if (tool === 'Read') {
    if (views.some((v) => isEnvName(basename(v.abs)))) block('secrets', 'reading .env files is not allowed')
    return
  }
  for (const v of views) {
    if (PROTECTED_RELS.has(v.rel) || isEnvName(basename(v.rel)) || MANIFESTS.has(v.rel)) {
      block('protected-file', `${filePath} is protected and must not be edited`)
    }
  }
  if (ctx.agent === 'ticket-to-merge:implementer' && views.some((v) => v.rel === 'tests' || v.rel.startsWith('tests/'))) {
    block('role:implementer', 'the implementer must not modify tests/')
  }
  if (ctx.agent === 'ticket-to-merge:test-writer' && !views.every((v) => v.rel.startsWith('tests/'))) {
    block('role:test-writer', 'the test-writer may only write inside tests/')
  }
}

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
  if (input === null || typeof input !== 'object') throw new Error('not an object')
} catch {
  block('fail-closed', 'could not parse hook input')
}

const root = projectRoot(input)
try {
  ensureSnapshot(root, input.session_id)
} catch {}

const tool = input.tool_name
const toolInput = input.tool_input ?? {}
const agent = typeof input.agent_type === 'string' ? input.agent_type : ''
const ctx = { root, cwd: resolve(typeof input.cwd === 'string' ? input.cwd : root), agent }

if (agent.startsWith('ticket-to-merge:review') && (EDIT_TOOLS.has(tool) || tool === 'Bash')) {
  block('role:reviewer', 'reviewers are read-only')
}

if (EDIT_TOOLS.has(tool) || tool === 'Read') {
  const p = toolInput.file_path ?? toolInput.notebook_path
  if (typeof p !== 'string' || !p) {
    if (tool !== 'Read') block('fail-closed', 'missing file path')
  } else checkFileTool(tool, p, ctx)
} else if (tool === 'Bash') {
  if (typeof toolInput.command !== 'string') block('fail-closed', 'missing command')
  checkBashCommand(toolInput.command, ctx)
}
process.exit(0)
