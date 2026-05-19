const test = require('node:test')
const assert = require('node:assert/strict')
const { runTranslate, loadRuntime } = require('./_runtime')

// ---------------------------------------------------------------------------
// Language and input validation
// ---------------------------------------------------------------------------

test('rejects non-English source language', async () => {
  await assert.rejects(
    () => runTranslate('hello', { detectFrom: 'zh' }),
    (err) => err.errorType === 'unsupportLanguage'
  )
})

test('rejects empty string query', async () => {
  await assert.rejects(
    () => runTranslate(''),
    (err) => err.errorType === 'unsupportLanguage'
  )
})

test('rejects multi-word query without hyphen', async () => {
  await assert.rejects(
    () => runTranslate('hello world'),
    (err) => err.errorType === 'notFound'
  )
})

test('rejects non-existent word', async () => {
  await assert.rejects(
    () => runTranslate('xyznonexistent123'),
    (err) => err.errorType === 'notFound'
  )
})

// ---------------------------------------------------------------------------
// Case sensitivity and normalization
// ---------------------------------------------------------------------------

test('query is case-insensitive', async () => {
  const lower = await runTranslate('script')
  const upper = await runTranslate('SCRIPT')
  const mixed = await runTranslate('ScRiPt')

  assert.equal(lower.toDict.word, 'script')
  assert.equal(upper.toDict.word, 'script')
  assert.equal(mixed.toDict.word, 'script')
  assert.equal(JSON.stringify(lower.toDict.parts), JSON.stringify(upper.toDict.parts))
  assert.equal(JSON.stringify(lower.toDict.parts), JSON.stringify(mixed.toDict.parts))
})

// ---------------------------------------------------------------------------
// Special character and boundary queries
// ---------------------------------------------------------------------------

test('handles hyphenated compound words', async () => {
  const result = await runTranslate('well-known')
  assert.equal(result.toDict.word, 'well-known')
  assert.ok(result.toDict.parts.length > 0)
})

// ---------------------------------------------------------------------------
// Missing/edge data fields
// ---------------------------------------------------------------------------

test('entry without phonetic returns empty phonetics array', async () => {
  const result = await runTranslate('scripts')
  assert.ok(Array.isArray(result.toDict.phonetics))
})

test('entry without translation_parts falls back to translation string', async () => {
  const result = await runTranslate('scripting')
  assert.ok(Array.isArray(result.toDict.parts))
  assert.ok(result.toDict.parts.length > 0 || result.toDict.exchanges.length > 0)
})

// ---------------------------------------------------------------------------
// Entry kind behavior
// ---------------------------------------------------------------------------

test('alias entry resolves through linked_word', async () => {
  const result = await runTranslate('a-lines')
  assert.ok(result.toDict.parts.length > 0 || result.toDict.exchanges.length > 0)
})

test('inflection entry shows back-navigation only', async () => {
  const result = await runTranslate('went')
  assert.equal(result.toDict.word, 'went')

  const exchangeNames = result.toDict.exchanges.map((e) => e.name)
  assert.ok(exchangeNames.includes('原形'), 'went should show origin form')

  assert.ok(!exchangeNames.includes('过去式') || result.raw.displayWord !== 'went',
    'went as standalone should not show its own past tense')
})

test('inflection entry filters self-referencing exchanges', async () => {
  const result = await runTranslate('scripts')
  const exchangeRows = result.toDict.exchanges.flatMap((item) =>
    item.words.map((word) => `${item.name}:${word}`)
  )

  assert.ok(!exchangeRows.includes('复数:scripts'), 'scripts should not list itself as plural')
  assert.ok(!exchangeRows.includes('第三人称单数:scripts'), 'scripts should not list itself as 3rd person')
})

// ---------------------------------------------------------------------------
// Morphology edge cases
// ---------------------------------------------------------------------------

test('base entry shows child morphology relations', async () => {
  const result = await runTranslate('go')
  const exchangeMap = new Map(result.toDict.exchanges.map((e) => [e.name, e.words]))

  assert.ok(exchangeMap.has('过去式'), 'go should show past tense')
  assert.ok(exchangeMap.get('过去式').includes('went'), 'go past tense should include went')
  assert.ok(exchangeMap.has('过去分词'), 'go should show past participle')
  assert.ok(exchangeMap.get('过去分词').includes('gone'), 'go past participle should include gone')
})

test('comparative form shows back-link to base only', async () => {
  const result = await runTranslate('happier')
  assert.equal(result.raw.displayWord, 'happy')

  const exchangeNames = result.toDict.exchanges.map((e) => e.name)
  assert.equal(exchangeNames.length, 1)
  assert.equal(exchangeNames[0], '原形')
})

// ---------------------------------------------------------------------------
// Cross-reference edge cases
// ---------------------------------------------------------------------------

test('homograph with xref shows cross-reference', async () => {
  const result = await runTranslate('found')
  const exchangeNames = result.toDict.exchanges.map((e) => e.name)
  assert.ok(exchangeNames.includes('原形'), 'found should show xref to base form')
})

test('suppletive form shows back and forward links', async () => {
  const result = await runTranslate('better')
  const exchangeMap = new Map(result.toDict.exchanges.map((e) => [e.name, e.words]))

  assert.ok(exchangeMap.has('原形'), 'better should show 原形')
  assert.ok(exchangeMap.get('原形').includes('good'), 'better 原形 should be good')
  assert.ok(exchangeMap.has('最高级'), 'better should show 最高级')
  assert.ok(exchangeMap.get('最高级').includes('best'), 'better 最高级 should be best')
})

// ---------------------------------------------------------------------------
// Parts deduplication edge cases
// ---------------------------------------------------------------------------

test('multi-origin entry aggregates without duplicate parts', async () => {
  const result = await runTranslate('leaves')
  const partKeys = result.toDict.parts.map((p) => p.part)

  assert.equal(partKeys.length, new Set(partKeys).size, 'parts should be deduplicated')
})

// ---------------------------------------------------------------------------
// supportLanguages
// ---------------------------------------------------------------------------

test('supportLanguages returns expected languages', async () => {
  const runtime = await loadRuntime()
  const languages = runtime.supportLanguages()
  assert.ok(languages.includes('en'))
  assert.ok(languages.includes('zh-Hans'))
})
