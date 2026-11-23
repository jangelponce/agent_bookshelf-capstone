# BOOK-101 · Search books by title or author (fallback criteria)

Used only when the reviewed branch has no `SPEC.md`.

## Acceptance criteria

- AC1: A query matches a book when it is a substring of the title or the author, case-insensitive.
- AC2: An empty query returns all books.
- AC3: The input is trimmed.
- AC4: A query of more than 100 characters returns a validation error (400 with `{ "error": string }` on JSON endpoints).
- AC5: SQL is parameterised. There are no string-built queries.
- AC6: Vitest covers each criterion, and `npm run test:run` passes.

## Constraints

- No schema changes.
- No new dependencies.
- Never touch `bookshelf.db`, `seed.sql` or `.env`.
- Keep the existing interface: `GET /api/books` returns a bare array of book rows, and errors are `{ "error": string }`.

## Repo facts reviewers can rely on

- The HTMX search box on `/` calls `GET /books/search?q=` (`src/routes/books.ts`) and expects an HTML fragment of `.book-card`s.
- The DB helpers `all/get/run(sql, params)` in `src/db/index.ts` bind `?` parameters (sql.js prepared statements).
- SQLite `LIKE` is case-insensitive for ASCII. `GLOB` and `=` are case-sensitive.
