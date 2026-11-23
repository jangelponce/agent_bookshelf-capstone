---
name: ship-ticket
description: Take the ticket in SPEC.md to merge-ready, test-first. A test-writer agent writes failing tests, an implementer agent makes them pass behind a guarded test suite, the read-only review runs, and confirmed findings go through one fix loop. Use when asked to ship, build or implement a ticket.
argument-hint: "[build | review | fix | all]  (default: all)"
---

# Ship ticket

You orchestrate. Agents write the tests and the code. You run the gates and make the commits, and you never edit `src/` or `tests/` yourself. Arguments: `$ARGUMENTS`. The stage is the first word, `all` by default. Stages can run in separate sessions so each one is priced alone.

## Preconditions (every stage)

Run each check with Bash. Stop and report if one fails.

- `SPEC.md` exists.
- The current branch is not `main` or `master`.
- `git status --porcelain` shows no changes outside `.ticket-to-merge/`.

Then run `mkdir -p .ticket-to-merge`.

## Stage: build

1. **Red.** Launch `ticket-to-merge:test-writer`: "Write failing tests for every acceptance criterion in SPEC.md, in the test files SPEC.md names."
2. **Verify red yourself** with `npm run test:run`. Pass the gate only if:
   - the new tests fail;
   - the failures come from missing behaviour (a failed assertion, or a missing export or route), not from a syntax or import mistake in the test;
   - every test that existed before still passes.
   If the gate fails, send the output back to the same agent once.
3. Commit the tests: `git add tests && git commit -m "test: add failing tests for <ticket id>"`. Save that commit's sha as `TESTS_SHA`. Commit messages carry no AI attribution trailers.
4. **Green.** Launch `ticket-to-merge:implementer`: "Make the failing tests in <files> pass, following SPEC.md." A SubagentStop gate re-runs the suite and returns the agent to work while it is red.
5. **Verify green yourself.** Each check must pass:
   - `npm run test:run`: all tests pass.
   - `npx tsc --noEmit`: zero errors.
   - `git diff --stat "$TESTS_SHA" -- tests`: empty. The implementer must not have changed any test.
   - `git status --porcelain -- src/db package.json package-lock.json`: empty. Secret files are checked by the guardrail hook's integrity snapshot, not by you; never name them in commands.
   If a check fails, resume the implementer once with the failure output. If it still fails, stop and report.
6. Commit: `git add -A src && git commit -m "feat: <ticket summary>"`.

## Stage: review

Invoke the skill `ticket-to-merge:review-pr` with no arguments. It writes `.ticket-to-merge/last-review.json`.

## Stage: fix (one loop, at most)

1. Read `.ticket-to-merge/last-review.json`. Select the findings with `severity` high or medium. If there are none, report "nothing to fix" and stop.
2. For the selected findings about behaviour (category correctness or security), launch `ticket-to-merge:test-writer`: "Write one regression test per finding id in .ticket-to-merge/last-review.json: <ids>. Each must fail on the current code." Verify red as in build step 2, then commit `test: add regression tests for review findings`. Save that commit's sha as `TESTS_SHA` for the step 5 gates.
3. Launch `ticket-to-merge:implementer` with the findings file path and the ids: "Fix the root cause of these confirmed findings, then make the full suite pass. Test-coverage findings (category tests) are handled by the test-writer, not you."
4. For findings in the category tests, the test-writer adds the missing tests in step 2, together with the behaviour tests.
5. Run the build step 5 gates again, then commit `fix: address review findings <ids>`.
6. Re-review once, cheaply. Launch only `ticket-to-merge:review-refuter`, giving it the fixed findings and the new diff (`git diff <base>`), and asking which findings still reproduce. Do not run a second full review.

## Stage: all

Run build, review, then fix, in that order.

## Final report

```
STAGE(S): <what ran>
COMMITS:  <git log --oneline <base>..HEAD>
TESTS:    <npm run test:run summary line>
TSC:      <result>
REVIEW:   <N confirmed (H/M/L)>, <fixed ids>, <still open ids>
```
