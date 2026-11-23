import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PROTECT = join(here, 'protect.mjs')
const INTEGRITY = join(here, 'integrity.mjs')
const GATE = join(here, 'test-gate.mjs')

let root
let tmp
let counter = 0

function makeProject(testRunScript) {
  const dir = mkdtempSync(join(tmpdir(), 'ttm-proj-'))
  mkdirSync(join(dir, 'src', 'db'), { recursive: true })
  mkdirSync(join(dir, 'src', 'books'), { recursive: true })
  mkdirSync(join(dir, 'tests', 'routes'), { recursive: true })
  writeFileSync(join(dir, 'src', 'db', 'seed.sql'), 'insert into books values (1);\n')
  writeFileSync(join(dir, 'src', 'db', 'schema.sql'), 'create table books (id int);\n')
  writeFileSync(join(dir, 'bookshelf.db'), 'DBBYTES')
  writeFileSync(join(dir, '.env'), 'SECRET=1\n')
  writeFileSync(join(dir, 'tests', 'a.test.ts'), 'test\n')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { 'test:run': testRunScript ?? 'node -e "process.exit(0)"' } }),
  )
  return dir
}

function run(script, input, { cwd = root, args = [], raw } = {}) {
  const res = spawnSync('node', [script, ...args], {
    input: raw ?? JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, TMPDIR: tmp },
  })
  return { status: res.status, stderr: res.stderr, stdout: res.stdout }
}

function pre(tool_name, tool_input, extra = {}) {
  return { session_id: `s${++counter}`, cwd: root, hook_event_name: 'PreToolUse', tool_name, tool_input, ...extra }
}

const bash = (command, extra, cwd) => run(PROTECT, pre('Bash', { command }, extra), { cwd })
const blocked = (r) => {
  assert.equal(r.status, 2, `expected block, got ${r.status} stderr=${r.stderr}`)
  assert.match(r.stderr, /Guardrail/)
}
const allowed = (r) => {
  assert.equal(r.status, 0, `expected allow, got ${r.status} stderr=${r.stderr}`)
  assert.equal(r.stdout, '')
}

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ttm-tmp-'))
  root = makeProject()
})
after(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
})

describe('protect: file tools', () => {
  const protectedPaths = [
    'bookshelf.db',
    'bookshelf.db-wal',
    'bookshelf.db-shm',
    'bookshelf.db-journal',
    'src/db/seed.sql',
    'src/db/schema.sql',
    '.env',
    '.env.local',
    'package.json',
    'package-lock.json',
    './src/db/../db/seed.sql',
    'SRC/DB/SEED.SQL',
  ]
  for (const p of protectedPaths) {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      test(`${tool} ${p} is blocked`, () => blocked(run(PROTECT, pre(tool, { file_path: p }))))
    }
  }
  test('absolute path is blocked', () => {
    blocked(run(PROTECT, pre('Write', { file_path: join(root, 'src/db/seed.sql') })))
  })
  test('NotebookEdit notebook_path is blocked', () => {
    blocked(run(PROTECT, pre('NotebookEdit', { notebook_path: 'src/db/seed.sql' })))
  })
  test('symlink to a protected file is blocked', () => {
    symlinkSync(join(root, 'src/db/seed.sql'), join(root, 'link.txt'))
    blocked(run(PROTECT, pre('Write', { file_path: 'link.txt' })))
  })
  test('normal source write is allowed', () => {
    allowed(run(PROTECT, pre('Edit', { file_path: 'src/books/routes.ts' })))
    allowed(run(PROTECT, pre('Write', { file_path: join(root, 'src/books/new.ts') })))
  })
  test('Read .env blocked, .env.local blocked', () => {
    blocked(run(PROTECT, pre('Read', { file_path: '.env' })))
    blocked(run(PROTECT, pre('Read', { file_path: join(root, '.env.local') })))
  })
  test('Read seed.sql and schema.sql allowed', () => {
    allowed(run(PROTECT, pre('Read', { file_path: 'src/db/seed.sql' })))
    allowed(run(PROTECT, pre('Read', { file_path: join(root, 'src/db/schema.sql') })))
  })
  test('unparseable stdin fails closed', () => {
    const r = run(PROTECT, null, { raw: 'not json' })
    assert.equal(r.status, 2)
  })
})

describe('protect: bash blocked', () => {
  const cases = [
    'echo x > src/db/seed.sql',
    'rm src/db/*',
    'rm *.sql',
    'rm bookshelf.*',
    'cp /dev/null .e*',
    'rm {seed,schema}.sql',
    'cat .env',
    'source .env',
    'f=se; rm src/db/${f}ed.sql',
    'echo cm0gc3JjL2RiL3NlZWQuc3Fs | base64 -d | sh',
    'eval "$(echo cm0gc3JjL2RiL3NlZWQuc3Fs | base64 -d)"',
    'echo hi | bash',
    'rm "$(printf \'\\x73eed.sql\')"',
    "rm $'\\x73eed.sql'",
    'source <(echo hi)',
    `node -e "require('fs').writeFileSync('src/db/se'+'ed.sql','')"`,
    `python3 -c "open('.e'+'nv','w')"`,
    `python3 -c "import os; os.remove('x')"`,
    `perl -e 'unlink("x")'`,
    `node <<EOF\nrequire('fs').rmSync('x')\nEOF`,
    'npm install lodash',
    'npm i -D zod',
    'pnpm add zod',
    'yarn add zod',
    'npm uninstall hono',
    'git stash',
    'git clean -fd',
    'git checkout -- src/db/seed.sql',
    'git restore src/db/seed.sql',
    'sqlite3 bookshelf.db "drop table books"',
    'sed -i s/a/b/ src/db/schema.sql',
    'truncate -s 0 bookshelf.db-wal',
    'bash -c "rm src/db/seed.sql"',
    'sudo rm bookshelf.db',
    'ls && rm -rf src/db',
  ]
  for (const c of cases) test(`blocks: ${c}`, () => blocked(bash(c)))

  test('blocks: cd src/db && cat /dev/null > se\'\'ed.sql (cwd src/db)', () => {
    blocked(bash(`cd src/db && cat /dev/null > se''ed.sql`, {}, join(root, 'src/db')))
  })
  test('blocks: cd src && cd db && write', () => {
    blocked(bash('cd src && cd db && cat /dev/null > x'))
  })
  test('blocks: pushd src/db then rm', () => {
    blocked(bash('pushd src/db; rm -f x'))
  })
  test('blocks: quoted/backslash obfuscation', () => {
    blocked(bash(`rm "seed".sql`))
    blocked(bash('rm seed\\.sql'))
  })
})

describe('protect: bash allowed', () => {
  const cases = [
    'npm run test:run',
    'npx vitest run tests/routes/search.test.ts',
    'npx tsc --noEmit',
    'git diff main -- src',
    'git status',
    'cat src/db/schema.sql',
    'rg searchBooks src',
    'node -e "console.log(process.env.HOME)"',
    'npm install',
    'npm ci',
    'rm -rf dist/*',
    'rm tests/tmp.log',
    'rg seed src 2>&1',
    'git log --oneline -5',
    'echo hello > /tmp/out.txt',
  ]
  for (const c of cases) test(`allows: ${c}`, () => allowed(bash(c)))
})

describe('protect: roles', () => {
  const impl = { agent_type: 'ticket-to-merge:implementer', agent_id: 'a1' }
  const tw = { agent_type: 'ticket-to-merge:test-writer', agent_id: 'a2' }
  const rev = { agent_type: 'ticket-to-merge:reviewer-quality', agent_id: 'a3' }

  test('implementer cannot edit tests/', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      blocked(run(PROTECT, pre(tool, { file_path: 'tests/a.test.ts' }, impl)))
    }
    blocked(run(PROTECT, pre('Write', { file_path: join(root, 'tests/routes/x.test.ts') }, impl)))
  })
  test('implementer can edit src/', () => {
    allowed(run(PROTECT, pre('Edit', { file_path: 'src/books/routes.ts' }, impl)))
  })
  test('implementer bash writes to tests/ blocked', () => {
    blocked(bash('echo x > tests/a.test.ts', impl))
    blocked(bash('rm tests/a.test.ts', impl))
    blocked(bash('sed -i s/a/b/ tests/a.test.ts', impl))
    blocked(bash('git checkout -- tests/a.test.ts', impl))
  })
  test('implementer bash reads/runs tests allowed', () => {
    allowed(bash('npm run test:run', impl))
    allowed(bash('npx vitest run tests/routes/search.test.ts', impl))
    allowed(bash('cat tests/a.test.ts', impl))
    allowed(bash('rg searchBooks tests/', impl))
  })
  test('main session may edit tests/', () => {
    allowed(run(PROTECT, pre('Write', { file_path: 'tests/new.test.ts' })))
  })
  test('test-writer only writes inside tests/', () => {
    blocked(run(PROTECT, pre('Write', { file_path: 'src/books/x.ts' }, tw)))
    blocked(run(PROTECT, pre('Edit', { file_path: '../outside.ts' }, tw)))
    allowed(run(PROTECT, pre('Write', { file_path: 'tests/routes/x.test.ts' }, tw)))
    allowed(run(PROTECT, pre('Edit', { file_path: join(root, 'tests/a.test.ts') }, tw)))
  })
  test('reviewers are read-only', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      blocked(run(PROTECT, pre(tool, { file_path: 'src/x.ts', notebook_path: 'x.ipynb' }, rev)))
    }
    blocked(bash('git status', rev))
    allowed(run(PROTECT, pre('Read', { file_path: 'src/books/routes.ts' }, rev)))
  })
})

describe('integrity', () => {
  function project() {
    const dir = makeProject()
    return dir
  }
  function runIn(dir, sid, mode) {
    const res = spawnSync('node', [INTEGRITY, mode], {
      input: JSON.stringify({ session_id: sid, cwd: dir, hook_event_name: 'PostToolUse' }),
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: tmp },
    })
    return { status: res.status, stderr: res.stderr, stdout: res.stdout }
  }

  test('check without a snapshot exits 0', () => {
    const dir = project()
    assert.equal(runIn(dir, 'none', 'check').status, 0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('modified protected file is restored and exit is 2', () => {
    const dir = project()
    assert.equal(runIn(dir, 'i1', 'snapshot').status, 0)
    const original = readFileSync(join(dir, 'src/db/seed.sql'), 'utf8')
    writeFileSync(join(dir, 'src/db/seed.sql'), 'tampered')
    const r = runIn(dir, 'i1', 'check')
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Guardrail: protected file\(s\) .*seed\.sql.* were modified and have been restored\. Do not modify them\./)
    assert.equal(readFileSync(join(dir, 'src/db/seed.sql'), 'utf8'), original)
    assert.equal(runIn(dir, 'i1', 'check').status, 0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('file created after snapshot is deleted', () => {
    const dir = project()
    rmSync(join(dir, '.env'))
    assert.equal(runIn(dir, 'i2', 'snapshot').status, 0)
    writeFileSync(join(dir, '.env'), 'X=1')
    writeFileSync(join(dir, '.env.local'), 'Y=1')
    const r = runIn(dir, 'i2', 'check')
    assert.equal(r.status, 2)
    assert.equal(existsSync(join(dir, '.env')), false)
    assert.equal(existsSync(join(dir, '.env.local')), false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('deleted protected file is restored', () => {
    const dir = project()
    runIn(dir, 'i3', 'snapshot')
    rmSync(join(dir, 'bookshelf.db'))
    assert.equal(runIn(dir, 'i3', 'check').status, 2)
    assert.equal(readFileSync(join(dir, 'bookshelf.db'), 'utf8'), 'DBBYTES')
    rmSync(dir, { recursive: true, force: true })
  })

  test('snapshot is never overwritten for the same session', () => {
    const dir = project()
    runIn(dir, 'i4', 'snapshot')
    writeFileSync(join(dir, 'src/db/seed.sql'), 'tampered')
    runIn(dir, 'i4', 'snapshot')
    assert.equal(runIn(dir, 'i4', 'check').status, 2)
    assert.match(readFileSync(join(dir, 'src/db/seed.sql'), 'utf8'), /insert into books/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('protect creates the snapshot lazily on first call', () => {
    const dir = project()
    const sid = 'lazy1'
    const input = { session_id: sid, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/db/seed.sql' } }
    const res = spawnSync('node', [PROTECT], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: tmp },
    })
    assert.equal(res.status, 0)
    writeFileSync(join(dir, 'src/db/seed.sql'), 'tampered')
    assert.equal(runIn(dir, sid, 'check').status, 2)
    assert.match(readFileSync(join(dir, 'src/db/seed.sql'), 'utf8'), /insert into books/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('test-gate', () => {
  function gate(dir, agentId) {
    const res = spawnSync('node', [GATE], {
      input: JSON.stringify({
        session_id: 'g',
        cwd: dir,
        hook_event_name: 'SubagentStop',
        agent_type: 'ticket-to-merge:implementer',
        agent_id: agentId,
        stop_hook_active: false,
      }),
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, TMPDIR: tmp },
    })
    return { status: res.status, stdout: res.stdout, stderr: res.stderr }
  }

  test('passing suite exits 0 silently', () => {
    const dir = makeProject('node -e "process.exit(0)"')
    const r = gate(dir, 'pass1')
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    rmSync(dir, { recursive: true, force: true })
  })

  test('failing suite blocks up to 3 times then lets the agent stop', () => {
    const dir = makeProject(`node -e "console.log('FAIL tests/a.test.ts'); console.log('AssertionError: boom'); console.log('noise line'); process.exit(1)"`)
    for (let i = 0; i < 3; i++) {
      const r = gate(dir, 'fail1')
      assert.equal(r.status, 0)
      const out = JSON.parse(r.stdout)
      assert.equal(out.decision, 'block')
      assert.match(out.reason, /^Tests are failing\. Fix the implementation, never the tests\./)
      assert.match(out.reason, /FAIL tests\/a\.test\.ts/)
      assert.match(out.reason, /AssertionError: boom/)
      assert.doesNotMatch(out.reason, /noise line/)
    }
    const fourth = gate(dir, 'fail1')
    assert.equal(fourth.status, 0)
    assert.equal(fourth.stdout, '')
    rmSync(dir, { recursive: true, force: true })
  })

  test('counter is per agent_id', () => {
    const dir = makeProject('node -e "process.exit(1)"')
    for (let i = 0; i < 3; i++) gate(dir, 'agentA')
    assert.equal(gate(dir, 'agentA').stdout, '')
    assert.equal(JSON.parse(gate(dir, 'agentB').stdout).decision, 'block')
    rmSync(dir, { recursive: true, force: true })
  })
})
