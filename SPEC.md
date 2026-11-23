# SPEC · BOOK-101 · Search books by title or author

## Goal

Readers can find a book by typing part of its title or its author's name, from the
search box on `/` and from the JSON API.

## Acceptance criteria

| ID | Criterion |
|----|-----------|
| AC1 | A query matches a book when it is a substring of the title **or** the author, case-insensitive (`dune`, `DUNE`, `herbert` all find *Dune* by Frank Herbert). |
| AC2 | An empty query (missing, `""`, or only whitespace) returns all books, in the same order as `GET /api/books`. |
| AC3 | The query is trimmed before matching (`"  dune  "` behaves like `"dune"`). |
| AC4 | A trimmed query longer than 100 characters is a validation error. Exactly 100 characters is allowed. |
| AC5 | SQL is parameterised. No query text is concatenated or interpolated into SQL. `%` and `_` typed by the user match themselves, not "anything". |
| AC6 | Vitest covers each criterion above, and `npm run test:run` passes. |

## Interface

The brief leaves the interface open (`[endpoint and response shape]`). This spec fixes it, and
adds no changes to any existing response.

### Model: `src/models/book.ts`

```ts
export const SEARCH_MAX_LENGTH = 100;
export class SearchValidationError extends Error {}
export function searchBooks(query: string): Book[];
```

- Trims `query`, then:
  - if it is empty, returns all books ordered by title (same as `getAllBooks()`);
  - if it is longer than 100 characters, throws `SearchValidationError`;
  - otherwise returns the books whose `title` or `author` contains it, case-insensitive,
    ordered by title.
- It uses `LIKE ? ESCAPE '\'` with bound parameters, and escapes `\`, `%` and `_` in the
  query before binding them.

### JSON API: `src/routes/api.ts`

| Request | Response |
|---------|----------|
| `GET /api/books?q=<text>` | `200`, bare JSON array of `Book` rows (same shape as `GET /api/books`) |
| `GET /api/books/search?q=<text>` | identical to the line above (alias) |
| `GET /api/books` (no `q`) | unchanged: all 50 books |
| `q` longer than 100 chars after trim | `400 { "error": "Search query must be 100 characters or fewer" }` |
| `q` given more than once (`?q=a&q=b`) | `400 { "error": "Search query must be a single string" }` |

`/api/books/search` must be registered before `/api/books/:id`. Otherwise `search` is read
as an id and the call returns 404.

### HTML / HTMX: `src/routes/books.ts`

`GET /books/search?q=<text>` replaces the TODO stub. It returns an HTML fragment for
`#search-results`: a `.book-grid` of `.book-card` elements in the same markup as
`views/books/index.ejs`, rendered from a new partial `views/books/search-results.ejs`.

- No match: `<p class="search-message">No books found.</p>`.
- Validation error: status `400` with `<p class="search-message error">…</p>`.
- Titles and authors are HTML-escaped (EJS `<%= %>`). No hand-built HTML strings
  with user input.

## Out of scope

- Schema changes (`src/db/schema.sql`), seed changes (`src/db/seed.sql`), `bookshelf.db*`, `.env`.
- New dependencies, or edits to `package.json` / `package-lock.json`.
- Full-text search, ranking, pagination, and accent- or Unicode-folding (SQLite `LIKE` folds
  ASCII only).
- Any change to existing endpoints other than the new optional `q` on `GET /api/books`.

## Tests to add

- `tests/models/book-search.test.ts`: model behaviour for AC1–AC5. This covers the
  title match, the author match, the case variants, empty and whitespace queries, trim,
  lengths 100 and 101, a query with no match (`[]`), and `%` / `_` as literals.
- `tests/routes/search.test.ts`: the API and HTMX surfaces through supertest. It checks
  status codes and the error JSON shape, and that the `/search` alias is not caught by
  `/:id`. It also checks that the HTMX fragment escapes `<script>`.
- Each test file uses a fresh DB: `initDb('/tmp/<file>.db')` in `beforeEach`, and
  `closeDb()` plus deleting the file in `afterEach` (same pattern as `tests/routes/api.test.ts`).

## Verification (end to end)

```bash
npm run test:run        # all suites green, including the new ones
npx tsc --noEmit        # no type errors
git diff --stat main -- src/db package.json package-lock.json   # empty
```
