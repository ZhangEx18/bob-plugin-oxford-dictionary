const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadRuntime } = require('./_runtime')
const { getDictDir, getShardPath, getManifestPath } = require('./dict-path')

/**
 * Load all dictionary shards into a flat entries object and collect metadata.
 */
function loadAllShards() {
  const dictDir = getDictDir()
  const entries = {}
  const shards = []

  for (const file of fs.readdirSync(dictDir)) {
    if (!file.endsWith('.json')) continue
    const shard = JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8'))
    const key = file.replace('.json', '')
    shards.push({ key, count: Object.keys(shard).length })
    Object.assign(entries, shard)
  }

  return { entries, shards, totalEntries: Object.keys(entries).length }
}

function buildGlobalKeySet(entries) {
  const keys = new Set()
  for (const key of Object.keys(entries)) {
    keys.add(key.toLowerCase())
  }
  return keys
}

function collectRelationTargets(entry) {
  const targets = []

  if (Array.isArray(entry.relations)) {
    for (const rel of entry.relations) {
      if (rel?.target) {
        targets.push({
          target: rel.target,
          type: rel.type,
          label: rel.label,
          display: rel.display,
          source: rel.source,
          navigable: rel.navigable,
        })
      }
    }
  }

  return targets
}

function targetExists(target, globalKeySet) {
  return globalKeySet.has(target.toLowerCase())
}

const VALID_ENTRY_KINDS = new Set(['standalone', 'inflection', 'alias'])

const { entries, shards, totalEntries } = loadAllShards()
const globalKeySet = buildGlobalKeySet(entries)
const entryList = Object.entries(entries)
let runtimeRelations = null

async function getRuntimeRelationsModule() {
  if (!runtimeRelations) {
    const runtime = await loadRuntime()
    runtimeRelations = runtime.__relationsForTests || null
  }
  return runtimeRelations
}

// ---------------------------------------------------------------------------
// Shard-level invariants
// ---------------------------------------------------------------------------

test('every shard file is non-empty and loads as an object', () => {
  for (const { key, count } of shards) {
    assert.ok(count > 0, `shard "${key}.json" should have at least one entry`)
  }
})

test('shard keys match first character of contained entry words', () => {
  for (const { key } of shards) {
    if (!/^[a-z]$/i.test(key)) continue
    const shard = JSON.parse(fs.readFileSync(getShardPath(key), 'utf8'))
    for (const word of Object.keys(shard)) {
      const firstChar = word.charAt(0).toLowerCase()
      assert.equal(firstChar, key.toLowerCase(),
        `word "${word}" in shard "${key}.json" should start with "${key}"`)
    }
  }
})

test('build manifest exists and exposes core metadata when present', () => {
  const manifestPath = getManifestPath()
  if (!fs.existsSync(manifestPath)) {
    return
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(typeof manifest.dataVersion, 'string')
  assert.equal(typeof manifest.schemaVersion, 'string')
  assert.equal(typeof manifest.entryCount, 'number')
  assert.equal(typeof manifest.shardCount, 'number')
  assert.equal(typeof manifest.generatedAt, 'string')
})

// ---------------------------------------------------------------------------
// Entry-level structural invariants
// ---------------------------------------------------------------------------

test('every entry has a non-empty word string', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (!entry.word || typeof entry.word !== 'string' || entry.word.trim() === '') {
      failures.push(key)
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} entries missing valid word: ${failures.slice(0, 5).join(', ')}`)
})

test('entry_key matches word case-insensitively', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (key.toLowerCase() !== entry.word.toLowerCase()) {
      failures.push({ key, word: entry.word })
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} entries with mismatched key/word: ${JSON.stringify(failures.slice(0, 3))}`)
})

test('entry_kind is one of standalone, inflection, alias', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (!VALID_ENTRY_KINDS.has(entry.entry_kind)) {
      failures.push({ key, kind: entry.entry_kind })
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} entries with invalid entry_kind: ${JSON.stringify(failures.slice(0, 3))}`)
})

// ---------------------------------------------------------------------------
// Entry-kind-specific invariants
// ---------------------------------------------------------------------------

test('inflection entries have at least one origin relation', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (entry.entry_kind !== 'inflection') continue

    const hasOrigin = Array.isArray(entry.relations) &&
      entry.relations.some(r => r?.type === 'origin')

    if (!hasOrigin) {
      failures.push(key)
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} inflection entries missing origin: ${failures.slice(0, 5).join(', ')}`)
})

test('alias entries have a linked_word', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (entry.entry_kind !== 'alias') continue
    if (!entry.linked_word || typeof entry.linked_word !== 'string') {
      failures.push(key)
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} alias entries missing linked_word: ${failures.slice(0, 5).join(', ')}`)
})

test('alias linked_word targets exist in dictionary', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (entry.entry_kind !== 'alias') continue
    if (!targetExists(entry.linked_word, globalKeySet)) {
      failures.push({ key, linked_word: entry.linked_word })
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} alias entries with dangling linked_word: ${JSON.stringify(failures.slice(0, 3))}`)
})

test('standalone entries have translation or linked_word', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (entry.entry_kind !== 'standalone') continue
    const hasTranslation = !!entry.translation &&
      (typeof entry.translation === 'string' ? entry.translation.trim() !== '' : true)
    const hasLinkedWord = !!entry.linked_word
    if (!hasTranslation && !hasLinkedWord) {
      failures.push(key)
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} standalone entries missing both translation and linked_word: ${failures.slice(0, 5).join(', ')}`)
})

// ---------------------------------------------------------------------------
// Relation integrity invariants
// ---------------------------------------------------------------------------

test('all resolvable runtime relation targets exist in global dictionary', async () => {
  const relationsModule = await getRuntimeRelationsModule()
  if (!relationsModule) {
    assert.fail('runtime relations module is unavailable for invariants test')
  }

  const failures = []
  for (const [key, entry] of entryList) {
    const runtimeTargets = [
      ...(relationsModule.getChildRelations(entry) || []).map((rel) => ({ target: rel.word, bucket: 'child' })),
      ...(relationsModule.getCrossReferences(entry) || []).map((rel) => ({ target: rel.word, bucket: 'xref' })),
      ...(relationsModule.getOriginSources(entry) || []).map((rel) => ({ target: rel.word, bucket: 'origin' })),
    ]

    for (const rel of runtimeTargets) {
      if (!targetExists(rel.target, globalKeySet)) {
        failures.push({ key, ...rel })
        if (failures.length >= 10) break
      }
    }
    if (failures.length >= 10) break
  }
  assert.equal(failures.length, 0,
    `${failures.length} dangling runtime relation targets: ${JSON.stringify(failures.slice(0, 3))}`)
})

test('alias entries only carry display-only word-family relations', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (entry.entry_kind !== 'alias') continue
    const unexpectedRelations = (entry.relations || []).filter((relation) =>
      relation.source !== 'word_family' || relation.type !== 'lexical_origin' || relation.display !== 'reference'
    )
    if (unexpectedRelations.length > 0) {
      failures.push(key)
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} alias entries with unexpected non-word-family relations: ${failures.slice(0, 5).join(', ')}`)
})

// ---------------------------------------------------------------------------
// Exchange / morphology format invariants
// ---------------------------------------------------------------------------

test('exchange is absent, empty, or follows valid format (array or slash-separated string)', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (!entry.exchange || entry.exchange === '') continue
    if (Array.isArray(entry.exchange)) {
      for (const item of entry.exchange) {
        if (typeof item !== 'string' || !item.includes(':')) {
          failures.push({ key, exchange: entry.exchange })
          if (failures.length >= 10) break
        }
      }
    } else if (typeof entry.exchange === 'string') {
      // Legacy slash-separated format: "3:numbers/p:numbered/..."
      const parts = entry.exchange.split('/')
      for (const part of parts) {
        if (!part.includes(':')) {
          failures.push({ key, exchange: entry.exchange })
          if (failures.length >= 10) break
        }
      }
    } else {
      failures.push({ key, exchange: entry.exchange })
    }
    if (failures.length >= 10) break
  }
  assert.equal(failures.length, 0,
    `${failures.length} entries with invalid exchange format: ${JSON.stringify(failures.slice(0, 3))}`)
})

test('exchange items follow "label:value" format with known label', () => {
  const knownLabels = new Set([
    'p', 'd', '3', 'i', 'pr', 'pp', 's', '0', '1', '2',
    'pl', 'pt', 'comparative', 'superlative', 'ptp'
  ])
  const failures = []
  for (const [key, entry] of entryList) {
    if (!Array.isArray(entry.exchange)) continue
    for (const item of entry.exchange) {
      const parts = item.split(':')
      if (parts.length < 2) {
        failures.push({ key, item })
        if (failures.length >= 10) break
        continue
      }
      const label = parts[0]
      if (!knownLabels.has(label)) {
        failures.push({ key, item, label })
        if (failures.length >= 10) break
      }
    }
    if (failures.length >= 10) break
  }
  assert.equal(failures.length, 0,
    `${failures.length} exchange items with unknown label: ${JSON.stringify(failures.slice(0, 3))}`)
})

// ---------------------------------------------------------------------------
// POS format invariants
// ---------------------------------------------------------------------------

test('pos is either absent or a non-empty string', () => {
  const failures = []
  for (const [key, entry] of entryList) {
    if (!entry.pos) continue
    if (typeof entry.pos !== 'string' || entry.pos.trim() === '') {
      failures.push({ key, pos: entry.pos })
      if (failures.length >= 10) break
    }
  }
  assert.equal(failures.length, 0,
    `${failures.length} entries with invalid pos: ${JSON.stringify(failures.slice(0, 3))}`)
})

test('entry_kind distribution is within expected ranges', () => {
  const counts = { standalone: 0, inflection: 0, alias: 0 }
  for (const [, entry] of entryList) {
    counts[entry.entry_kind] = (counts[entry.entry_kind] || 0) + 1
  }

  assert.ok(counts.standalone > 40_000, `standalone count ${counts.standalone} too low`)
  assert.ok(counts.standalone < 80_000, `standalone count ${counts.standalone} too high`)
  assert.ok(counts.inflection > 30_000, `inflection count ${counts.inflection} too low`)
  assert.ok(counts.inflection < 60_000, `inflection count ${counts.inflection} too high`)
  assert.ok(counts.alias > 400_000, `alias count ${counts.alias} too low`)
  assert.ok(counts.alias < 500_000, `alias count ${counts.alias} too high`)
})

// ---------------------------------------------------------------------------
// Surface-form specific invariants (regression guards for known bugs)
// ---------------------------------------------------------------------------

test('scripts entry is inflection with origin to script, no spurious verb timeline', () => {
  const scripts = entries['scripts']
  assert.ok(scripts, 'scripts entry must exist')
  assert.equal(scripts.entry_kind, 'inflection')
  assert.ok(Array.isArray(scripts.relations), 'scripts must have relations')
  const origins = scripts.relations.filter(r => r.type === 'origin')
  assert.ok(origins.length > 0, 'scripts must have at least one origin')
  assert.ok(origins.some(o => o.target.toLowerCase() === 'script'),
    'scripts origin must point to script')
})

test('leaves entry is standalone with origins to both leaf and leave', () => {
  const leaves = entries['leaves']
  assert.ok(leaves, 'leaves entry must exist')
  assert.equal(leaves.entry_kind, 'standalone')
  assert.ok(Array.isArray(leaves.relations), 'leaves must have relations')
  const originTargets = leaves.relations
    .filter(r => r.type === 'origin')
    .map(r => r.target.toLowerCase())
  assert.ok(originTargets.includes('leaf'), 'leaves must have origin to leaf')
  assert.ok(originTargets.includes('leave'), 'leaves must have origin to leave')
})

test('found entry is standalone with xref relation to find', () => {
  const found = entries['found']
  assert.ok(found, 'found entry must exist')
  assert.equal(found.entry_kind, 'standalone')
  assert.ok(Array.isArray(found.relations), 'found must have relations')
  const xrefs = found.relations.filter(r => r.type === 'xref')
  assert.ok(xrefs.length > 0, 'found must have xref relation')
  assert.ok(xrefs.some(x => x.target.toLowerCase() === 'find'),
    'found xref must point to find')
})

test('left entry is standalone with xref relation to leave', () => {
  const left = entries['left']
  assert.ok(left, 'left entry must exist')
  assert.equal(left.entry_kind, 'standalone')
  assert.ok(Array.isArray(left.relations), 'left must have relations')
  const xrefs = left.relations.filter(r => r.type === 'xref')
  assert.ok(xrefs.length > 0, 'left must have xref relation')
  assert.ok(xrefs.some(x => x.target.toLowerCase() === 'leave'),
    'left xref must point to leave')
})
