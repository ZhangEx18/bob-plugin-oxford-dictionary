const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const BUILD_ROOT = '/private/tmp/oald-pipeline-smoke'
const DB_PATH = path.join(BUILD_ROOT, 'build_state.sqlite')

test('build_oald_data extract stage creates sqlite state tables', () => {
  fs.rmSync(BUILD_ROOT, { recursive: true, force: true })

  execFileSync('./.venv/bin/python', ['scripts/build_oald_data.py', '--stage', 'extract', '--build-root', BUILD_ROOT], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })

  assert.ok(fs.existsSync(DB_PATH), 'build_state.sqlite should exist after extract stage')

  const output = execFileSync('python3', ['-c', `
import sqlite3
conn=sqlite3.connect(${JSON.stringify(DB_PATH)})
tables=[row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("\\n".join(sorted(tables)))
conn.close()
`], { cwd: process.cwd(), encoding: 'utf8' })

  for (const table of ['extract_lookup', 'extract_links', 'normalized_entries', 'final_entries', 'build_metrics', 'meta']) {
    assert.ok(output.includes(table), `missing sqlite table: ${table}`)
  }
})
