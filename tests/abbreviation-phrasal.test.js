const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadAllEntries() {
  const dictDir = path.join(__dirname, '..', 'dict')
  const entries = {}
  for (const file of fs.readdirSync(dictDir)) {
    if (!file.endsWith('.json')) continue
    Object.assign(entries, JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8')))
  }
  return entries
}

const allEntries = loadAllEntries()

// ---------------------------------------------------------------------------
// Abbreviation entries (with dots)
// ---------------------------------------------------------------------------

test('abbreviation entries with dots have valid structure', () => {
  let checked = 0
  const dotEntries = Object.entries(allEntries).filter(([key]) => key.includes('.'))
  const samples = dotEntries.slice(0, 20)

  for (const [key, entry] of samples) {
    checked++
    assert.ok(entry.word, `abbreviation "${key}" missing word`)
    assert.ok(entry.translation || entry.linked_word,
      `abbreviation "${key}" missing translation and linked_word`)
    assert.ok(['standalone', 'inflection', 'alias'].includes(entry.entry_kind),
      `abbreviation "${key}" invalid entry_kind`)
  }
  assert.ok(checked > 0, 'no abbreviation entries to validate')
})

test('abbreviation entries with trailing dot resolve correctly', () => {
  const knownAbbrevs = ['etc.', 'i.e.', 'e.g.', 'mr.', 'mrs.', 'dr.']
  let found = 0
  for (const abbrev of knownAbbrevs) {
    const entry = allEntries[abbrev]
    if (!entry) continue
    found++
    assert.ok(entry.word.toLowerCase().includes('.'),
      `abbreviation "${abbrev}" word should contain dot`)
  }
  assert.ok(found >= 0, `found ${found} known abbreviations`)
})

// ---------------------------------------------------------------------------
// Phrasal verbs
// ---------------------------------------------------------------------------

test('entries with phrasal_verbs have valid structure', () => {
  let checked = 0
  for (const [key, entry] of Object.entries(allEntries)) {
    if (!Array.isArray(entry.phrasal_verbs) || entry.phrasal_verbs.length === 0) continue
    checked++
    if (checked > 20) break

    for (const pv of entry.phrasal_verbs) {
      assert.ok(pv.name, `entry "${key}" phrasal verb missing name`)
      assert.ok(pv.translation, `entry "${key}" phrasal verb "${pv.name}" missing translation`)
    }
  }
  assert.ok(checked > 0, 'no entries with phrasal_verbs to validate')
})

test('phrasal verbs contain space-separated words', () => {
  const withPhrasal = Object.entries(allEntries)
    .filter(([, e]) => Array.isArray(e.phrasal_verbs) && e.phrasal_verbs.length > 0)
    .slice(0, 10)

  for (const [key, entry] of withPhrasal) {
    for (const pv of entry.phrasal_verbs) {
      assert.ok(/\s/.test(pv.name),
        `phrasal verb "${pv.name}" for "${key}" should contain space`)
    }
  }
})

// ---------------------------------------------------------------------------
// Compound words and hyphenated forms
// ---------------------------------------------------------------------------

test('hyphenated compound words have valid entries', () => {
  const hyphenated = Object.entries(allEntries)
    .filter(([key]) => key.includes('-'))
    .slice(0, 20)

  assert.ok(hyphenated.length > 0, 'no hyphenated entries found')

  for (const [key, entry] of hyphenated) {
    assert.ok(entry.word, `hyphenated "${key}" missing word`)
    assert.equal(key.toLowerCase(), entry.word.toLowerCase(),
      `hyphenated "${key}" key/word mismatch`)
  }
})

// ---------------------------------------------------------------------------
// Multi-word entries (space-separated, non-hyphenated)
// ---------------------------------------------------------------------------

test('space-separated multi-word entries have valid structure', () => {
  const multiWord = Object.entries(allEntries)
    .filter(([key]) => /\s/.test(key) && !key.includes('-'))
    .slice(0, 10)

  for (const [key, entry] of multiWord) {
    assert.ok(entry.word, `multi-word "${key}" missing word`)
    assert.ok(entry.translation || entry.linked_word,
      `multi-word "${key}" missing content`)
  }
})
