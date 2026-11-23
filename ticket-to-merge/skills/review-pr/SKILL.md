---
name: review-pr
description: Review the current branch (or a given base ref or PR number) against the ticket's acceptance criteria with three read-only specialist reviewers plus a refuter, and report only confirmed findings as JSON with file, line and evidence. Use when asked to review a PR, a branch or a diff.
argument-hint: "[base-ref | PR number]"
---

# Review PR

You orchestrate. Reviewers do the reading; you do not review the code yourself, and you never edit source files in this skill. Arguments: `$ARGUMENTS`.

## 1. Build the review inputs

Run each step with Bash:

1. `mkdir -p .ticket-to-merge`.
2. Choose the diff:
   - If the argument is a number, run `gh pr diff <n> > .ticket-to-merge/diff.patch`.
   - Otherwise the base is the argument if it is given. If not, use the first ref that exists among `origin/main`, `upstream/main` and `main`. Compute `MB=$(git merge-base <base> HEAD)`.
   - Then run `git diff --no-ext-diff "$MB" -- . ':(exclude)ticket-to-merge' ':(exclude).ticket-to-merge' ':(exclude)odd' ':(exclude)SPEC.md' ':(exclude)CLAUDE.md' > .ticket-to-merge/diff.patch`. This compares against the working tree, so uncommitted changes are reviewed too.
3. If the diff is empty, report `No changes to review` and stop.
4. Criteria: if `SPEC.md` exists, use it. Otherwise copy `${CLAUDE_SKILL_DIR}/book-101-criteria.md` to `.ticket-to-merge/criteria.md` and use that.
5. List the changed files: `git diff --name-only "$MB"`.

## 2. Fan out: three reviewers in parallel

In ONE message, launch these three agents. Give each the same short prompt with the diff path, the criteria path and the changed-file list. Tell each to read the full changed files, and to answer with ONLY its JSON array.

- `ticket-to-merge:review-correctness`
- `ticket-to-merge:review-security`
- `ticket-to-merge:review-tests`

Do not pass your own opinions or hypotheses to them.

## 3. Merge

1. Parse each reviewer's JSON array. If one returns invalid JSON, re-ask that same agent once for the JSON only.
2. Give the findings ids by reviewer: `C1..` for correctness, `S1..` for security, `T1..` for tests.
3. Drop exact duplicates, meaning the same file, a line within ±2, and the same root cause. Keep the higher severity.
4. Write the result to `.ticket-to-merge/candidates.json`.
5. If there are zero candidates, skip step 4.

## 4. Second opinion: the refuter

Launch `ticket-to-merge:review-refuter` with the paths to `candidates.json`, the diff and the criteria. Keep only the findings with the verdict `confirmed`. When the refuter merged two findings as duplicates, keep the one it confirmed.

## 5. Report

1. Write the confirmed findings to `.ticket-to-merge/last-review.json` as `{"base":"<ref>","head":"<git rev-parse --short HEAD>","findings":[...]}`. Each finding keeps `{id, file, line, severity, category, criterion, issue, evidence}`, plus `refuter_reason`.
2. Your final answer has three parts:
   1. One line: `N confirmed findings (H high, M medium, L low); R candidates refuted.`
   2. A table with the columns `id | severity | file:line | issue`, sorted by severity (high, then medium, then low).
   3. A fenced `json` block with the exact `findings` array.
3. Add nothing else. In particular, no list of what was checked and found fine.
