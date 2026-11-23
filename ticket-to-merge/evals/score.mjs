#!/usr/bin/env node
// Usage: node score.mjs <manifest.json> <review.json> [<review.json> ...]
import { readFileSync } from 'node:fs'

const [manifestPath, ...reviewPaths] = process.argv.slice(2)
if (!manifestPath || reviewPaths.length === 0) {
  console.error('usage: node score.mjs <manifest.json> <review.json>...')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const realExtras = new Set(manifest.known_real_extras ?? [])

const sameFile = (a, b) => a.replace(/^\.\//, '') === b.replace(/^\.\//, '')
const matches = (finding, bug) =>
  sameFile(finding.file, bug.file) &&
  finding.line >= bug.lines[0] - 2 &&
  finding.line <= bug.lines[1] + 2

const rows = reviewPaths.map((path) => {
  const findings = JSON.parse(readFileSync(path, 'utf8')).findings ?? []
  const found = new Set()
  const unmatched = []
  let real = 0
  for (const f of findings) {
    const bug = manifest.bugs.find((b) => matches(f, b))
    if (bug) {
      found.add(bug.id)
      real++
    } else if (realExtras.has(`${f.file}:${f.line}`)) {
      real++
    } else {
      unmatched.push(`${f.file}:${f.line} ${f.issue}`)
    }
  }
  const recall = found.size / manifest.bugs.length
  const precision = findings.length ? real / findings.length : 1
  return { path, findings: findings.length, found: [...found].sort(), recall, precision, unmatched }
})

for (const r of rows) {
  console.log(`${r.path}\n  findings=${r.findings} found=${r.found.join(',') || '-'} recall=${r.recall.toFixed(2)} precision=${r.precision.toFixed(2)}`)
  for (const u of r.unmatched) console.log(`  unmatched: ${u}`)
}
const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length
console.log(`MEAN recall=${avg('recall').toFixed(2)} precision=${avg('precision').toFixed(2)} over ${rows.length} runs`)
for (const bug of manifest.bugs) {
  const hits = rows.filter((r) => r.found.includes(bug.id)).length
  console.log(`  ${bug.id} ${bug.title}: ${hits}/${rows.length}`)
}
