# Agent Bookshelf

Goodreads-lite teaching app: Express 4, sql.js (SQLite in WebAssembly), EJS + HTMX views,
Vitest + supertest. TypeScript ESM.

## Commands

- `npm run test:run` runs every test once. Run it before saying any change is done.
- `npx tsc --noEmit` type-checks. It must report zero errors.
- Do not run `npm run dev`, `npm start`, `npm run build` or `npx agent-bookshelf`. They create or
  write `bookshelf.db`. Verify through tests only.

## Layout

- `src/server.ts` builds the Express app (default export `app`). It mounts `routes/books.ts`,
  `routes/reviews.ts` and `routes/shelves.ts` at `/`, and `routes/api.ts` at `/api`. Importing it
  does not listen.
- `src/db/index.ts` holds `initDb(path?)`, `closeDb()` and the query helpers `all/get/run(sql, params)`.
  All SQL goes through these helpers with bound `?` parameters.
- `src/models/*.ts` hold data access (one file per table). `src/routes/*.ts` hold HTTP handlers.
- `src/views/**` hold EJS templates. HTMX endpoints return fragments rendered from partials.
- `tests/**/*.test.ts` hold the tests (see `vitest.config.ts`).

## Rules

- Relative imports end in `.js` (`'../models/book.js'`).
- JSON errors are `res.status(<code>).json({ error: '<message>' })`: 400 for invalid input,
  404 for a missing resource.
- SQL is always parameterised. Never build SQL with template strings or `+`, even for
  `LIKE` patterns: bind the pattern as a parameter.
- HTML that contains data goes through EJS `<%= %>` (escaped). Never send hand-built HTML
  strings containing user input or DB values.
- Express routes with a literal segment (`/books/search`) are registered before the
  parameterised ones (`/books/:id`).
- Every test file gets its own DB: `initDb('/tmp/<name>.db')` in `beforeEach`, and `closeDb()`
  plus unlinking the file in `afterEach`. Never point tests at `bookshelf.db`.
- Tests are written from `SPEC.md` acceptance criteria, before the implementation, and are
  seen failing first.
- Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Never touch

- `bookshelf.db`, `bookshelf.db-wal`, `bookshelf.db-shm`, `src/db/seed.sql`, `src/db/schema.sql`
  and `.env*`. The ticket forbids schema changes, and the ticket-to-merge guardrail hook blocks
  any of these.
- `package.json` and `package-lock.json` dependencies: no new packages.

## Current ticket

`SPEC.md` (BOOK-101, search by title or author) is the source of truth for the interface.
