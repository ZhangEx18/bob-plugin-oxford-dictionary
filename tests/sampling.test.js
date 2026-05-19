const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SAMPLE_SIZE_PER_SHARD = 5

function loadAllShards() {
  const dictDir = path.join(__dirname, '..', 'dict')
  const shards = []
  for (const file of fs.readdirSync(dictDir)) {
    if (!file.endsWith('.json')) continue
    const shard = JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8'))
    shards.push({ key: file.replace('.json', ''), entries: shard })
  }
  return shards
}

function buildGlobalKeySet(shards) {
  const keys = new Set()
  for (const { entries } of shards) {
    for (const key of Object.keys(entries)) {
      keys.add(key.toLowerCase())
    }
  }
  return keys
}

function sampleEntries(entries, count) {
  const keys = Object.keys(entries)
  if (keys.length <= count) return keys.map((k) => [k, entries[k]])
  const sampled = []
  const seen = new Set()
  while (sampled.length < count && seen.size < keys.length) {
    const idx = Math.floor(Math.random() * keys.length)
    if (seen.has(idx)) continue
    seen.add(idx)
    const key = keys[idx]
    sampled.push([key, entries[key]])
  }
  return sampled
}

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const rng = seededRandom(42)

const shards = loadAllShards()
const globalKeySet = buildGlobalKeySet(shards)

for (const { key, entries } of shards) {
  const sampled = sampleEntries(entries, SAMPLE_SIZE_PER_SHARD)

  test(`shard "${key}": sampled entries have valid structure`, () => {
    for (const [word, entry] of sampled) {
      assert.ok(entry.word, `sampled "${word}" missing word field`)
      assert.ok(['standalone', 'inflection', 'alias'].includes(entry.entry_kind),
        `sampled "${word}" invalid entry_kind: ${entry.entry_kind}`)
    }
  })

  test(`shard "${key}": sampled standalone entries have translation`, () => {
    for (const [word, entry] of sampled) {
      if (entry.entry_kind !== 'standalone') continue
      const hasTranslation = !!entry.translation &&
        (typeof entry.translation === 'string' ? entry.translation.trim() !== '' : true)
      assert.ok(hasTranslation || entry.linked_word,
        `sampled standalone "${word}" missing translation and linked_word`)
    }
  })

  test(`shard "${key}": sampled inflection entries have origin`, () => {
    for (const [word, entry] of sampled) {
      if (entry.entry_kind !== 'inflection') continue
      const hasOrigin = Array.isArray(entry.relations) &&
        entry.relations.some((r) => r?.type === 'origin')
      const hasLegacyOrigin = !!entry.parent_relation?.target || !!entry.parent_relation?.word
      assert.ok(hasOrigin || hasLegacyOrigin,
        `sampled inflection "${word}" missing origin`)
    }
  })

  test(`shard "${key}": sampled alias entries have linked_word`, () => {
    for (const [word, entry] of sampled) {
      if (entry.entry_kind !== 'alias') continue
      assert.ok(entry.linked_word && typeof entry.linked_word === 'string',
        `sampled alias "${word}" missing linked_word`)
      assert.ok(globalKeySet.has(entry.linked_word.toLowerCase()),
        `sampled alias "${word}" linked_word "${entry.linked_word}" not in dictionary`)
    }
  })

  test(`shard "${key}": sampled relation targets exist`, () => {
    for (const [word, entry] of sampled) {
      const targets = []
      if (Array.isArray(entry.relations)) {
        for (const rel of entry.relations) {
          if (rel?.target) targets.push(rel.target)
        }
      }
      if (entry.parent_relation?.target) targets.push(entry.parent_relation.target)
      if (Array.isArray(entry.child_relations)) {
        for (const child of entry.child_relations) {
          if (child?.target) targets.push(child.target)
        }
      }
      for (const target of targets) {
        assert.ok(globalKeySet.has(target.toLowerCase()),
          `sampled "${word}" relation target "${target}" not in dictionary`)
      }
    }
  })

  test(`shard "${key}": sampled entries have consistent key/word casing`, () => {
    for (const [word, entry] of sampled) {
      assert.equal(word.toLowerCase(), entry.word.toLowerCase(),
        `sampled "${word}" key/word mismatch: ${entry.word}`)
    }
  })
}

test('all shards together have expected total entry count', () => {
  let total = 0
  for (const { entries } of shards) {
    total += Object.keys(entries).length
  }
  assert.ok(total > 500_000, `total entries ${total} too low`)
})

test('no duplicate keys across shards', () => {
  const seen = new Set()
  let duplicates = 0
  for (const { entries } of shards) {
    for (const key of Object.keys(entries)) {
      const lower = key.toLowerCase()
      if (seen.has(lower)) duplicates++
      seen.add(lower)
    }
  }
  assert.equal(duplicates, 0, `${duplicates} duplicate keys across shards`)
})

test('sampled entries have valid exchange format when present', () => {
  let checked = 0
  for (const { entries } of shards) {
    const sampled = sampleEntries(entries, SAMPLE_SIZE_PER_SHARD)
    for (const [, entry] of sampled) {
      if (!entry.exchange || entry.exchange === '') continue
      checked++
      if (Array.isArray(entry.exchange)) {
        for (const item of entry.exchange) {
          assert.ok(typeof item === 'string' && item.includes(':'),
            `invalid exchange item: ${item}`)
        }
      } else if (typeof entry.exchange === 'string') {
        for (const part of entry.exchange.split('/')) {
          assert.ok(part.includes(':'), `invalid exchange part: ${part}`)
        }
      }
    }
  }
  assert.ok(checked > 0, 'no sampled entries with exchange to validate')
})
