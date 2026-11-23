# Capstone: Ticket to Merge (BOOK-101)

- **Objective:** Take BOOK-101 (search by title or author) to merge-ready with the `ticket-to-merge` plugin, then prove it with tests, planted bugs and a cost report.
- **Due:** Mon 2026-11-23, end of day.
- **Branch:** `feat/book-101-search` on `jangelponce/agent_bookshelf-capstone`, a fork of `abarriosBLA/agent_bookshelf`.
- **TDD:** on (user global config). Runner: `npm run test:run` (Vitest). Hook tests run with `node --test 'ticket-to-merge/hooks/*.test.mjs'`.

## Tasks

- [x] T1 SPEC.md and CLAUDE.md (inline): `f03f40b`
- [x] T2 Plugin: agents, skills, and guardrail hooks with 113 hook tests (hooks delegated to a writer): `5be4625`
- [x] T3 Build with `/ship-ticket build`, priced: `23b2262`, `15dd027` ($0.92)
- [x] T4 Review and fix, priced: review $0.95 (0 confirmed on clean code); fix $1.01 on `fixloop/book-101`
- [x] T5 Planted-bug branch, `/review-pr` 3×: recall 1.00, precision 0.54
- [x] T6 Lever (drop review-tests): $0.91 to $0.72 per review (−21%); recall 1.00, precision 1.00: `da6a619`
- [x] T7 README covering the submission checklist

## Next

- Push `feat/book-101-search`, `planted/book-101` and `fixloop/book-101` to the fork, then submit the repo link. This step needs the user's approval.

## Evidence

- The hook blocked `cd src/db && printf hacked > se""ed.sql` in a live `claude -p` run with `--plugin-dir`.
