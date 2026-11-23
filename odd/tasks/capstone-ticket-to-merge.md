# Capstone: Ticket to Merge (BOOK-101)

- **Objective:** Take BOOK-101 (search by title or author) to merge-ready with the `ticket-to-merge` plugin, then prove it with tests, planted bugs and a cost report.
- **Due:** Mon 2026-11-23, end of day.
- **Branch:** `feat/book-101-search` on `jangelponce/agent_bookshelf-capstone`, a fork of `abarriosBLA/agent_bookshelf`.
- **TDD:** on (user global config). Runner: `npm run test:run` (Vitest). Hook tests run with `node --test 'ticket-to-merge/hooks/*.test.mjs'`.

## Tasks

- [x] T1 SPEC.md and CLAUDE.md (inline): `f03f40b`
- [x] T2 Plugin: agents, skills, and guardrail hooks with 113 hook tests (hooks delegated to a writer): `5be4625`
- [ ] T3 Build with `/ship-ticket build`, priced
- [ ] T4 Review and fix with `/ship-ticket review` and `/ship-ticket fix`, priced
- [ ] T5 Planted-bug branch, `/review-pr` 3×, recall and precision
- [ ] T6 One cost lever, planted bugs re-run
- [ ] T7 README covering the submission checklist

## Evidence

- The hook blocked `cd src/db && printf hacked > se""ed.sql` in a live `claude -p` run with `--plugin-dir`.
