# Capstone · Ticket to Merge (BOOK-101)

- **Repo:** https://github.com/jangelponce/agent_bookshelf-capstone, a fork of `abarriosBLA/agent_bookshelf`.
- **Branch:** `feat/book-101-search`.
- **Evidence branches:**
  - `planted/book-101`: the review eval target.
  - `fixloop/book-101`: the fix loop output.

BOOK-101 (search books by title or author) was built and reviewed by the `ticket-to-merge` plugin in [`ticket-to-merge/`](ticket-to-merge). [`SPEC.md`](SPEC.md) is the ticket written as a brief with a verification path. [`CLAUDE.md`](CLAUDE.md) holds the repo conventions, the test command and the never-touch list.

## Run it

```bash
claude plugin validate ./ticket-to-merge        # ✔ Validation passed
claude --plugin-dir ./ticket-to-merge
```

| Command | What it does |
|---|---|
| `/ticket-to-merge:ship-ticket` | Runs build, then review, then fix. Pass `build`, `review` or `fix` to run a single stage, for example to price it in its own session. |
| `/ticket-to-merge:review-pr [base-ref \| PR#]` | Reviews the current branch against its merge-base with `main`, or the base or PR you give it. It prints a findings table and the JSON (`file`, `line`, `severity`, `issue`, `evidence`), and saves the JSON to `.ticket-to-merge/last-review.json`. |

Headless, as used for every number below:

```bash
claude -p "/ticket-to-merge:review-pr main" --plugin-dir ./ticket-to-merge --model sonnet \
  --permission-mode acceptEdits --allowedTools "Agent Skill Read Write Glob Grep Bash(git *) Bash(mkdir *) Bash(cp *)" \
  --output-format json
```

## Build: tests green

`npm run test:run` reports 5 files and 80 tests passing, with `tsc --noEmit` clean. The build stage used test-first:
- The test-writer committed 46 failing tests in `23b2262`.
- The implementer made them pass in `15dd027` without touching `tests/`.

Every acceptance criterion maps to named tests (`AC1:` … `AC5:`):
- `tests/models/book-search.test.ts` covers the model.
- `tests/routes/search.test.ts` covers `GET /api/books?q=`, the `/api/books/search` alias and the HTMX `GET /books/search` fragment.

The brief left the interface as a placeholder, so SPEC.md fixes it and covers all three surfaces:
- Each JSON endpoint returns a bare array of book rows, the same shape as `GET /api/books`.
- Errors return 400 with `{ "error": "..." }`.

## Guardrails

The guardrail is `ticket-to-merge/hooks/hooks.json`, with 113 `node --test` cases in `protect.test.mjs`. It has two layers, so a bypass has to beat both.

**1. `protect.mjs` (PreToolUse, `Edit|Write|MultiEdit|NotebookEdit|Bash|Read`, exits 2)**
- It blocks writes to `bookshelf.db*`, `seed.sql`, `schema.sql`, `.env*` and the package manifests. It also blocks reads of `.env`.
- For Bash, it normalises quotes and backslashes first, so `se''ed.sql` and `seed\.sql` count as `seed.sql`. It then blocks:
  - globs that could match a protected file;
  - write operations under `src/db` (including `cd src/db && ...`);
  - `eval`, `base64 -d | sh` and ANSI-C escapes;
  - inline `node -e` / `python -c` code that writes files;
  - `npm install <pkg>`;
  - `git stash` and `git clean`.
- It also applies role rules, keyed on `agent_type`:
  - the implementer can't write `tests/`;
  - the test-writer can only write `tests/`;
  - `review-*` agents can't use Edit, Write or Bash.

**2. `integrity.mjs`**
- Before the first tool call, it snapshots every protected file (hash and bytes).
- After every Bash call, and at Stop, it compares against the snapshot. If anything changed, it restores the file (or deletes a newly created `.env` or `bookshelf.db`) and tells the agent.
- This catches obfuscation that the text rules can't see, for example a script file that does the write.

Reviewers are read-only through `tools: Read, Grep, Glob`, because plugin agents ignore `permissionMode` and `hooks`. The hook's role rule is a second wall. The orchestrator writes the diff to a file so the reviewers never need Bash.

A third layer, `.claude/settings.json`, adds `Read(./.env)` and `Edit(...)` deny rules. They cover `@file` mentions, which PreToolUse doesn't see.

Live check: `claude -p` was asked to run `cd src/db && printf hacked > se""ed.sql`, and the hook blocked it with `Guardrail [protected-file]`.

## Review: planted bugs, recall and precision over 3 runs

`planted/book-101` is the clean feature with 5 bugs planted. Its tests were trimmed to a passing happy-path set, so no red test points at a bug. Everything else in the diff is clean code. The manifest is [`ticket-to-merge/evals/planted/manifest.json`](ticket-to-merge/evals/planted/manifest.json). It is scored by `ticket-to-merge/evals/run-review-eval.sh <branch> 3 <label>`, where a hit means the same file and a line within ±2.

| Bug | Category | Baseline (3 reviewers) | After lever (2 reviewers) |
|---|---|---|---|
| B1 `>= 100` rejects exactly 100 chars | correctness | 3/3 | 3/3 |
| B2 author clause interpolates the query into SQL | security | 3/3 | 3/3 |
| B3 `/api/books/search` registered after `/:id` (404) | correctness | 3/3 | 3/3 |
| B4 HTMX empty query returns no books | correctness | 3/3 | 3/3 |
| B5 `<%-` unescaped author (XSS) | security | 3/3 | 3/3 |
| **Recall** (mean) | | **1.00** | **1.00** |
| **Precision** (mean) | | **0.54** (7, 11 and 11 findings) | **1.00** (5, 5 and 5 findings) |

- On the clean feature branch, the review returned **0 confirmed findings**. The refuter refuted the one candidate.
- In the baseline, every unmatched finding came from the tests reviewer. Each one restated a planted code bug as a coverage gap ("no test at 100 chars, so `>=` is undetected"). The gaps are true, but they duplicate the code finding, and they cost precision.

## Cost report

Costs come from `claude -p --output-format json`:
- `total_cost_usd` and `modelUsage` include subagents.
- Cache hit = cache read ÷ (input + cache read + cache write).
- Raw files are in [`docs/capstone/runs/`](docs/capstone/runs).

| Stage | Cost | Cache hit | Models |
|---|---|---|---|
| Build (orchestrator, test-writer, implementer) | $0.92 | 92.4% | Sonnet 5.5 |
| Review (orchestrator, 3 reviewers, refuter) | $0.95 | 85.4% | Sonnet 5.5 |
| Fix loop (test-writer, implementer, refuter re-check; 7 findings, 5 bugs fixed, 72 tests green) | $1.01 | 89.4% | Sonnet 5.5 |
| **Total, one ticket** | **$2.88** | | |

- **One lever: fewer agents.** I dropped `review-tests` and moved its one useful check ("a changed test asserts behaviour that contradicts a criterion") into `review-correctness`.
- **Cost.** A review run on the planted branch averaged $0.91 before ($0.96 / $0.89 / $0.88) and $0.72 after ($0.82 / $0.64 / $0.69). That is **−21%**, which puts one ticket at about $2.65.
- **Quality held.** I re-ran the 3 planted-bug runs: recall stayed at 1.00 and precision rose from 0.54 to 1.00. The 80-test suite is unchanged and green.
- **What moved.** Nothing now flags missing tests on its own. That is acceptable, because the build is test-first and an untested bug is still reported once, as the code defect.

## Design

**Why this split.**
- **Build is split by role, not by layer.**
  - The test-writer only sees SPEC.md, and the implementer can't edit tests (enforced by the hook, not by the prompt).
  - A fresh context writes the spec as tests, and another one satisfies them, so the author never grades its own work.
  - A SubagentStop gate re-runs the suite before the implementer may stop, and it trims the test output to the failing lines.
- **The ticket is too small to split by layer or by criterion.** The model, the API and the HTMX route all share `searchBooks`. Parallel builders would conflict on the same three files and would need worktrees for no gain.
- **Review is split by failure class.**
  - Correctness is checked against the spec, and security against injection, XSS and validation bypass.
  - Each reviewer has a concrete checklist, and must give a triggering input as evidence.
  - A separate **refuter** tries to disprove each candidate against the code before anything is reported. It exists for precision: reviewers asked for gaps will report some even on sound code.
  - The refuter is also the cheap re-check after the fix loop, so no full second review runs.

**Which models.** Every agent runs on Sonnet 5.5.
- The planted-bug runs show Sonnet reviewers at recall 1.00, so Opus would add cost without a measured gain.
- Tests and boilerplate don't need the biggest model (week 2/3 finding).
- Haiku is the next lever to measure. I didn't take it, because recall is worth more points than the remaining cents.

**What I'd cut next.**
- **Cache writes dominate.** Each stage writes about 200k tokens of cache, because every subagent reloads the session's instructions and tool definitions.
- The next lever is `omitClaudeMd` for the reviewers (they get the criteria file anyway), plus a smaller toolset.
- I'd also merge the security checklist into correctness on tickets this small. In the baseline the correctness reviewer already caught both security plants.

---

```
╔═════════════════════════════════════════════╗
║│▓│▒│░│█│▓│░│▒│█│▓│▒│░│█│▓│░│▒│█│▓│▒│░│█│▓│░│║
╠═════════════════════════════════════════════╣
║                                             ║
║     ▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀                    ║
║     █▀█ █▄█ █▄▄ █░▀█ ░█░                    ║
║                                             ║
║     █▄▄ █▀█ █▀█ █▄▀ █▀ █░█ █▀▀ █░░ █▀▀      ║
║     █▄█ █▄█ █▄█ █░█ ▄█ █▀█ █▄▄ █▄▄ █▀░      ║
║                                             ║
║  a goodreads-lite playground for AI agents  ║
║                                             ║
╠═════════════════════════════════════════════╣
║│█│▓│░│▒│█│▓│▒│░│█│▓│░│▒│█│▓│▒│░│█│▓│░│▒│█│▓│║
╚═════════════════════════════════════════════╝
```

# Agent Bookshelf

A Goodreads-lite application designed as a teaching playground for AI agents courses. Students install it locally and use AI agents (Claude Code, etc.) to complete homework assignments.

## Prerequisites

**Node.js 24 LTS** is required.

| OS | Install |
|---|---|
| **macOS** | Download `.pkg` from [nodejs.org](https://nodejs.org) — Universal binary (Intel + Apple Silicon) |
| **Windows** | Download `.msi` from [nodejs.org](https://nodejs.org) — tick "Tools for Native Modules" during install |
| **Linux** | `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash - && sudo apt-get install -y nodejs` |

Verify:

```bash
node -v   # should print v24.x.x
npm -v    # should print 11.x.x
```

## Quick Start

### Using npx

```bash
corepack enable
npm install
npm run build
npx agent-bookshelf
```

That's it! The app will start at http://localhost:3000 with pre-seeded data.

## What is this?

Agent Bookshelf is a deliberately structured teaching codebase where:

- **Students** get an easy-to-install app that works immediately
- **AI agents** get a familiar, well-structured codebase to work with
- **Homework gaps** are built in for agents to fill

### Features

- Browse 50 pre-seeded books (tech and sci-fi)
- View book details with reviews and ratings
- Manage user shelves (want-to-read, currently-reading, read)
- Add reviews and ratings
- REST API for agent interaction
- HTMX-powered dynamic UI

### Pre-seeded Data

The app comes with:
- 50 books across tech and sci-fi genres
- 3 users: Alice Chen, Bob Martinez, Carol Okafor
- Sample shelves and reviews
- SQLite database (zero configuration)

## For Students

### Installation

**Prerequisites:** Node.js 20 or higher

**macOS / Linux:**
```bash
npx agent-bookshelf
```

**Windows:**
```bash
npx agent-bookshelf
```

The app will start automatically at http://localhost:3000

### Using the App

1. Browse books at http://localhost:3000
2. Click a book to see details and reviews
3. Visit /shelves to see user bookshelves
4. Add reviews and manage shelves through the UI

### For AI Agents

The app provides a REST API at `/api/*`:

```bash
# Get all books
curl http://localhost:3000/api/books

# Get a specific book
curl http://localhost:3000/api/books/1

# Add a review
curl -X POST http://localhost:3000/api/reviews \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "bookId": 5, "rating": 5, "reviewText": "Excellent!"}'

# Get user shelves
curl http://localhost:3000/api/shelves/user/1
```

See the API routes in `src/routes/api.ts` for full documentation.

## For Instructors

### Homework Gaps

The codebase includes deliberate gaps for homework assignments:

1. **Search functionality** - UI exists but backend is a TODO
   - Location: `src/routes/books.ts` line 14
   - Students can implement the search backend

2. **Missing tests** - Models have no test coverage
   - Location: `tests/` directory
   - QA homework: write test suites for models

3. **Input validation** - API endpoints lack validation
   - Location: `src/routes/api.ts`
   - Students can add validation middleware

4. **UI improvements** - Functional but minimal design
   - Location: `src/public/css/style.css`
   - PM homework: redesign specific components

### Architecture

- **Backend:** Express + TypeScript
- **Database:** SQLite via sql.js (WebAssembly, zero native dependencies)
- **Frontend:** EJS templates + HTMX
- **Testing:** Vitest (setup included, tests are homework)

### Project Structure

```
agent_bookshelf/
├── src/
│   ├── server.ts          # Express app + server
│   ├── db/
│   │   ├── schema.sql     # Database schema
│   │   ├── seed.sql       # Pre-seeded data
│   │   └── index.ts       # DB connection
│   ├── models/            # Data models (no tests - homework gap)
│   ├── routes/
│   │   ├── books.ts       # HTML routes
│   │   ├── shelves.ts
│   │   ├── reviews.ts
│   │   └── api.ts         # JSON API
│   ├── views/             # EJS templates
│   └── public/            # Static assets
├── tests/                 # Vitest setup (tests are homework)
├── bin/                   # CLI entry point
└── docs/adr/              # Architecture decisions
```

### Running Tests

```bash
npm test          # Run tests in watch mode
npm run test:run  # Run tests once
```

Note: The test setup is included, but actual tests are intentionally missing (homework gap).

## License

GPL-3.0

## Contributing

This is a teaching project. Contributions should maintain the deliberate gaps that make homework assignments possible.
