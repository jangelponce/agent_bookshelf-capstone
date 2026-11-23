#!/usr/bin/env bash
# Usage: run-review-eval.sh <branch> <runs> <label> [extra claude args...]
# Runs /ticket-to-merge:review-pr <runs> times on <branch> in a throwaway worktree and saves each result.
set -euo pipefail

branch=$1 runs=$2 label=$3
shift 3
repo=$(git rev-parse --show-toplevel)
plugin="$repo/ticket-to-merge"
out="$repo/docs/capstone/runs"
wt=$(mktemp -d "${TMPDIR:-/tmp}/ttm-eval-XXXXXX")
mkdir -p "$out"

git -C "$repo" worktree add --detach "$wt" "$branch" >/dev/null
trap 'git -C "$repo" worktree remove --force "$wt"' EXIT
ln -s "$repo/node_modules" "$wt/node_modules"

for i in $(seq 1 "$runs"); do
  rm -rf "$wt/.ticket-to-merge"
  (cd "$wt" && claude -p "/ticket-to-merge:review-pr main" \
    --plugin-dir "$plugin" \
    --permission-mode acceptEdits \
    --allowedTools "Agent Skill Read Write Glob Grep Bash(git *) Bash(mkdir *) Bash(cp *) Bash(test *) Bash(ls *)" \
    --output-format json "$@") > "$out/review-$label-$i.usage.json"
  cp "$wt/.ticket-to-merge/last-review.json" "$out/review-$label-$i.json"
  node -e 'const j=require(process.argv[1]);console.log(`run '"$i"': $${j.total_cost_usd.toFixed(3)}`)' "$out/review-$label-$i.usage.json"
done

results=()
for i in $(seq 1 "$runs"); do results+=("$out/review-$label-$i.json"); done
node "$repo/ticket-to-merge/evals/score.mjs" "$repo/ticket-to-merge/evals/planted/manifest.json" "${results[@]}"
