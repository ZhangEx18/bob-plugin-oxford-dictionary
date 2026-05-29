const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { getDictDir, getShardPath } = require('./dict-path')

function toLegacyRelation(edge) {
  return {
    word: edge.target,
    target: edge.target,
    label: edge.label,
  }
}

function hasEntry(allEntries, word) {
  return !!allEntries[word?.toLowerCase?.()]
}

function decorateEntry(entry, allEntries) {
  if (!entry || entry.__legacyDecorated) {
    return entry
  }

  const relations = Array.isArray(entry.relations) ? entry.relations : []
  const childRelations = relations
    .filter((edge) => (
      edge.type === 'inflection'
      && edge.direction === 'outgoing'
      && edge.display === 'exchange'
      && edge.navigable
      && hasEntry(allEntries, edge.target)
    ))
    .map(toLegacyRelation)

  const crossReferences = relations
    .filter((edge) => edge.type === 'xref' && edge.direction === 'outgoing' && edge.navigable && hasEntry(allEntries, edge.target))
    .map(toLegacyRelation)

  const originRelations = relations
    .filter((edge) => edge.type === 'origin' && edge.direction === 'outgoing' && edge.navigable && hasEntry(allEntries, edge.target))
    .map((edge) => ({
      word: edge.target,
      target: edge.target,
      label: edge.label,
      posScope: edge.pos_scope || [],
      primary: !!edge.primary,
    }))

  const xrefInflectionSources = relations
    .filter((edge) => (
      edge.type === 'xref'
      && edge.direction === 'outgoing'
      && edge.navigable
      && hasEntry(allEntries, edge.target)
      && ['第三人称单数', '过去式', '过去分词', '现在分词', '复数', '比较级', '最高级'].includes(edge.label)
    ))
    .map((edge) => ({
      word: edge.target,
      target: edge.target,
      label: edge.label,
      posScope: edge.pos_scope || [],
      primary: !!edge.primary,
    }))

  const inflectionSources = [...originRelations, ...xrefInflectionSources]
    .filter((item, index, items) => items.findIndex((other) => `${other.word}:${other.label}` === `${item.word}:${item.label}`) === index)

  const primaryOrigin = originRelations.find((item) => item.primary) || originRelations[0] || null

  Object.assign(entry, {
    child_relations: childRelations,
    cross_references: crossReferences,
    parent_relation: primaryOrigin ? { word: primaryOrigin.word, label: '原形' } : null,
    inflection_sources: entry.entry_kind === 'standalone' && inflectionSources.length > 1 ? inflectionSources : undefined,
    __legacyDecorated: true,
  })

  return entry
}

function loadShard(char) {
  const dictPath = getShardPath(char)
  const shard = JSON.parse(fs.readFileSync(dictPath, 'utf8'))
  const allEntries = loadAllEntries()
  for (const entry of Object.values(shard)) {
    decorateEntry(entry, allEntries)
  }
  return shard
}

function loadAllEntries() {
  if (loadAllEntries.cache) {
    return loadAllEntries.cache
  }
  const dictDir = getDictDir()
  const entries = {}

  for (const file of fs.readdirSync(dictDir)) {
    if (!file.endsWith('.json')) continue
    Object.assign(entries, JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8')))
  }

  for (const entry of Object.values(entries)) {
    decorateEntry(entry, entries)
  }

  loadAllEntries.cache = entries
  return entries
}

const aDict = loadShard('a')
const oDict = loadShard('o')
const cDict = loadShard('c')
const hDict = loadShard('h')
const tDict = loadShard('t')
const mDict = loadShard('m')
const allEntries = loadAllEntries()

const verbSamples = ['abandon', 'abase', 'abate', 'abbreviate', 'abdicate', 'abduct', 'abet', 'abhor', 'abide', 'abjure', 'abolish', 'abominate', 'abort', 'abound', 'abrade', 'abridge', 'abrogate', 'abscond', 'abseil', 'absent', 'absolve', 'absorb', 'abstain', 'abstract', 'abuse', 'abut', 'accede', 'accelerate', 'accent', 'accentuate', 'accept', 'access', 'accessorize', 'acclaim', 'acclimate']
const nounSamples = ['a-bomb', 'a-frame', 'a-level', 'a-road', 'a-side', 'a-team', 'aardvark', 'abacus', 'abalone', 'abandonment', 'abasement', 'abatement', 'abattoir', 'abaya', 'abba', 'abbey', 'abbot', 'abbreviation', 'abc', 'abdication', 'abdomen', 'abdominal', 'abductee', 'abduction', 'abductor', 'aberdonian', 'aberration', 'abeyance', 'abhorrence', 'ability', 'ablation', 'ablative', 'ableism', 'abm', 'abnegation', 'abnormality']
const nonNounVerbSamples = ['a-cappella', 'a-couple', 'a-fortiori', 'a-gogo', 'a-la', 'a-line', 'a-list', 'a-ok', 'aargh', 'ab-initio', 'aback', 'abaft', 'abandoned', 'abashed', 'abbreviated', 'abed', 'aberrant', 'abhorrent', 'abiding', 'abiotic', 'abject', 'abjectly', 'ablaze']
const aliasPlusSSamples = ['a-lines', 'a-lists', 'aberrants', 'abjects', 'ables', 'abnormals', 'abortives', 'aboves', 'abracadabras', 'abroads', 'abrupts', 'absorbents', 'abstinents', 'absurds', 'accidentals', 'achs', 'actuals', 'acutes']
const mixedPosPluralSamples = ['ally', 'baby', 'embargo', 'duck', 'work']
const sameSurfaceNvSamples = ['ally', 'bath', 'belly', 'bivvy', 'bully', 'bus', 'butcher', 'caddie', 'demo', 'echo', 'ferry', 'gas', 'hoof', 'index', 'lasso', 'moo']
const distinctSurfaceNvSamples = [
  { word: 'court-martial', thirdForms: [{ form: 'court-martials', displayWord: 'court-martial', parentWord: 'court-martial' }], pluralForms: [{ form: 'courts martial', displayWord: 'court-martial', parentWord: 'court-martial' }] },
  { word: 'crow', thirdForms: [{ form: 'crows', displayWord: 'crow', parentWord: 'crow' }], pluralForms: [{ form: 'Crows', displayWord: 'crow', parentWord: 'crow' }] },
  { word: 'die', thirdForms: [{ form: 'dies', displayWord: 'die', parentWord: 'die' }], pluralForms: [{ form: 'dice', displayWord: 'dice', parentWord: 'die' }] },
  { word: 'do', thirdForms: [{ form: 'does', displayWord: 'does', parentWord: null }], pluralForms: [{ form: 'dos', displayWord: 'dos', parentWord: null }, { form: 'do’s', displayWord: 'do', parentWord: 'do' }] },
  { word: 'focus', thirdForms: [{ form: 'focusses', displayWord: 'focus', parentWord: 'focus' }], pluralForms: [{ form: 'foci', displayWord: 'focus', parentWord: 'focus' }] },
  { word: 'goose', thirdForms: [{ form: 'gooses', displayWord: 'goose', parentWord: 'goose' }], pluralForms: [{ form: 'geese', displayWord: 'geese', parentWord: 'goose' }] },
  { word: 'hang', thirdForms: [{ form: 'hangs', displayWord: 'hang', parentWord: 'hang' }], pluralForms: [{ form: 'hanged', displayWord: 'hang', parentWord: 'hang' }] },
  { word: 'jackknife', thirdForms: [{ form: 'jackknifes', displayWord: 'jackknife', parentWord: 'jackknife' }], pluralForms: [{ form: 'jackknives', displayWord: 'jackknife', parentWord: 'jackknife' }] },
  { word: 'knife', thirdForms: [{ form: 'knifes', displayWord: 'knife', parentWord: 'knife' }], pluralForms: [{ form: 'knives', displayWord: 'knives', parentWord: null }] },
  { word: 'last', thirdForms: [{ form: 'lasts', displayWord: 'last', parentWord: 'last' }], pluralForms: [{ form: 'the last', displayWord: 'last', parentWord: 'last' }] },
  { word: 'loaf', thirdForms: [{ form: 'loafs', displayWord: 'loaf', parentWord: 'loaf' }], pluralForms: [{ form: 'loaves', displayWord: 'loaves', parentWord: null }] },
  { word: 'man', thirdForms: [{ form: 'mans', displayWord: 'man', parentWord: 'man' }], pluralForms: [{ form: 'men', displayWord: 'men', parentWord: 'man' }] },
  { word: 'staff', thirdForms: [], pluralForms: [{ form: 'staves', displayWord: 'staff', parentWord: 'staff' }] },
  { word: 'tango', thirdForms: [{ form: 'tangoes', displayWord: 'tango', parentWord: 'tango' }], pluralForms: [{ form: 'tangos', displayWord: 'tango', parentWord: 'tango' }] },
  { word: 'wolf', thirdForms: [{ form: 'wolfs', displayWord: 'wolf', parentWord: 'wolf' }], pluralForms: [{ form: 'wolves', displayWord: 'wolves', parentWord: null }] },
]
const mixedPosComparativeLeakSamples = ['base', 'black', 'blind', 'brief', 'brown', 'calm', 'chill', 'dry', 'fancy', 'gross', 'tidy']
const irregularComparativeLeakSamples = [
  { word: 'much', blockedPluralForms: ['more', 'most'] },
  { word: 'little', blockedPluralForms: ['less', 'least'] },
]
const comparativeExchangeSamples = [
  { word: 'good', comparativeForms: ['better'], superlativeForms: ['best'] },
  { word: 'bad', comparativeForms: ['worse', 'badder'], superlativeForms: ['worst', 'baddest'] },
  { word: 'little', comparativeForms: ['less'], superlativeForms: ['least'] },
  { word: 'much', comparativeForms: ['more'], superlativeForms: ['most'] },
  { word: 'well', comparativeForms: ['better'], superlativeForms: ['best'] },
  { word: 'far', comparativeForms: ['farther', 'further'], superlativeForms: ['farthest', 'furthest'] },
  { word: 'black', comparativeForms: ['blacker'], superlativeForms: ['blackest'] },
  { word: 'dry', comparativeForms: ['drier'], superlativeForms: ['driest'] },
]
const emptyPosLeakSamples = ['bye byes', 'byebyes', "i's", "is's", 'is.s', "nibs's", 'smithers']
const relationTargetCoverageSamples = ['staff', 'travel', 'lambast', 'field-of-vision', 'line']

function relationWords(relations = []) {
  return relations.map((relation) => `${relation.label}:${relation.word}`)
}

function findOrigin(entry) {
  return (entry.relations || []).find((r) => r.type === 'origin' && r.direction === 'outgoing')
}

function findInflections(entry) {
  return (entry.relations || []).filter((r) => r.type === 'inflection' && r.direction === 'outgoing')
}

function entryFor(word) {
  const shard = loadShard(word[0].toLowerCase())
  return shard?.[word] || shard?.[word.toLowerCase()]
}

function posKeys(entry) {
  return new Set(
    (entry.pos || '')
      .split('/')
      .map((item) => item.split(':', 1)[0])
      .filter(Boolean),
  )
}

test('open family relation metadata stays correct', () => {
  assert.equal(oDict.open.display_word, 'open')
  assert.ok(!findOrigin(oDict.open), 'open should not have origin relation')
  assert.deepEqual(relationWords(oDict.open.child_relations), [
    '第三人称单数:opens',
    '过去式:opened',
    '过去分词:opened',
    '现在分词:opening',
    '复数:opens',
  ])

  const openRelationRows = (oDict.open.relations || [])
    .filter((relation) => relation.type === 'inflection')
    .map((relation) => `${relation.label}:${relation.target}:${relation.display}:${relation.navigable}`)
  assert.ok(openRelationRows.includes('第三人称单数:opens:exchange:true'))
  assert.ok(openRelationRows.includes('过去式:opened:exchange:true'))
  assert.ok(openRelationRows.includes('过去分词:opened:exchange:true'))
  assert.ok(openRelationRows.includes('现在分词:opening:exchange:true'))

  assert.equal(oDict.opening.display_word, 'opening')
  assert.ok(!findOrigin(oDict.opening), 'opening should not have origin relation')
  assert.ok(relationWords(oDict.opening.child_relations).includes('复数:openings'))

  assert.equal(oDict.openings.display_word, 'opening')
  const openingsOrigin = findOrigin(oDict.openings)
  assert.ok(openingsOrigin, 'openings should have origin relation')
  assert.equal(openingsOrigin.target, 'opening')

  assert.equal(oDict.opens.display_word, 'open')
  const opensOrigin = findOrigin(oDict.opens)
  assert.ok(opensOrigin, 'opens should have origin relation')
  assert.equal(opensOrigin.target, 'open')

  assert.equal(oDict.opened.display_word, 'open')
  const openedOrigin = findOrigin(oDict.opened)
  assert.ok(openedOrigin, 'opened should have origin relation')
  assert.equal(openedOrigin.target, 'open')
})

test('child family keeps irregular plurals attached to the standalone parent', () => {
  assert.equal(cDict.child.display_word, 'child')
  assert.ok(!findOrigin(cDict.child), 'child should not have origin relation')
  assert.ok(relationWords(cDict.child.child_relations).includes('复数:children'))

  assert.equal(cDict.children.display_word, 'child')
  const childrenOrigin = findOrigin(cDict.children)
  assert.ok(childrenOrigin, 'children should have origin relation')
  assert.equal(childrenOrigin.target, 'child')
})

test('tailor family preserves standalone middle entries', () => {
  assert.equal(tDict.tailor.display_word, 'tailor')
  assert.ok(!findOrigin(tDict.tailor), 'tailor should not have origin relation')
  assert.ok(relationWords(tDict.tailor.child_relations).includes('现在分词:tailoring'))

  assert.equal(tDict.tailoring.display_word, 'tailoring')
  assert.ok(!findOrigin(tDict.tailoring), 'tailoring should not have origin relation')
  assert.deepEqual(relationWords(tDict.tailoring.child_relations), ['复数:tailorings'])

  assert.equal(tDict.tailorings.display_word, 'tailoring')
  const tailoringsOrigin = findOrigin(tDict.tailorings)
  assert.ok(tailoringsOrigin, 'tailorings should have origin relation')
  assert.equal(tailoringsOrigin.target, 'tailoring')
})

test('take family keeps standalone irregular forms on their own entries', () => {
  assert.equal(tDict.take.display_word, 'take')
  assert.ok(!findOrigin(tDict.take), 'take should not have origin relation')
  assert.deepEqual(relationWords(tDict.take.child_relations), [
    '第三人称单数:takes',
    '过去式:took',
    '过去分词:taken',
    '现在分词:taking',
    '复数:takes',
  ])

  assert.equal(tDict.takes.display_word, 'take')
  const takesOrigin = findOrigin(tDict.takes)
  assert.ok(takesOrigin, 'takes should have origin relation')
  assert.equal(takesOrigin.target, 'take')

  assert.equal(tDict.taking.display_word, 'take')
  const takingOrigin = findOrigin(tDict.taking)
  assert.ok(takingOrigin, 'taking should have origin relation')
  assert.equal(takingOrigin.target, 'take')

  assert.equal(tDict.taken.display_word, 'take')
  const takenOrigin = findOrigin(tDict.taken)
  assert.ok(takenOrigin, 'taken should have origin relation')
  assert.equal(takenOrigin.target, 'take')

  assert.equal(tDict.took.display_word, 'took')
  const tookOrigin = findOrigin(tDict.took)
  assert.ok(tookOrigin, 'took should have origin relation')
  assert.equal(tookOrigin.target, 'take')
})

test('man family does not override standalone plural entries', () => {
  assert.equal(mDict.man.display_word, 'man')
  assert.ok(!findOrigin(mDict.man), 'man should not have origin relation')
  assert.ok(relationWords(mDict.man.child_relations).includes('复数:men'))

  assert.equal(mDict.men.display_word, 'men')
  const menOrigin = findOrigin(mDict.men)
  assert.ok(menOrigin, 'men should have origin relation')
  assert.equal(menOrigin.target, 'man')
})

test('comparative adjective families participate in morphology navigation', () => {
  assert.equal(hDict.happy.display_word, 'happy')
  assert.ok(!findOrigin(hDict.happy), 'happy should not have origin relation')
  assert.deepEqual(relationWords(hDict.happy.child_relations), [
    '比较级:happier',
    '最高级:happiest',
  ])

  assert.equal(hDict.happier.display_word, 'happy')
  const happierOrigin = findOrigin(hDict.happier)
  assert.ok(happierOrigin, 'happier should have origin relation')
  assert.equal(happierOrigin.target, 'happy')
  assert.deepEqual(relationWords(hDict.happier.child_relations), [])

  assert.equal(hDict.happiest.display_word, 'happy')
  const happiestOrigin = findOrigin(hDict.happiest)
  assert.ok(happiestOrigin, 'happiest should have origin relation')
  assert.equal(happiestOrigin.target, 'happy')
  assert.deepEqual(relationWords(hDict.happiest.child_relations), [])

  assert.equal(tDict.tacky.display_word, 'tacky')
  assert.ok(!findOrigin(tDict.tacky), 'tacky should not have origin relation')
  assert.deepEqual(relationWords(tDict.tacky.child_relations), [
    '比较级:tackier',
    '最高级:tackiest',
  ])

  assert.equal(tDict.tackier.display_word, 'tacky')
  const tackierOrigin = findOrigin(tDict.tackier)
  assert.ok(tackierOrigin, 'tackier should have origin relation')
  assert.equal(tackierOrigin.target, 'tacky')
  assert.deepEqual(relationWords(tDict.tackier.child_relations), [])

  assert.equal(tDict.tackiest.display_word, 'tacky')
  const tackiestOrigin = findOrigin(tDict.tackiest)
  assert.ok(tackiestOrigin, 'tackiest should have origin relation')
  assert.equal(tackiestOrigin.target, 'tacky')
  assert.deepEqual(relationWords(tDict.tackiest.child_relations), [])
})

test('standalone suppletive forms link back to base and forward to subsequent forms', () => {
  const bDict = loadShard('b')
  const wDict = loadShard('w')
  const gDict = loadShard('g')
  const lDict = loadShard('l')
  const fDict = loadShard('f')

  // worse (standalone comparative of bad)
  assert.equal(wDict.worse.entry_kind, 'standalone')
  const worseOrigin = findOrigin(wDict.worse)
  assert.ok(worseOrigin, 'worse should have origin relation')
  assert.equal(worseOrigin.target, 'bad')
  assert.ok(relationWords(wDict.worse.child_relations).includes('最高级:worst'), `worse should link forward to worst, got: ${relationWords(wDict.worse.child_relations)}`)
  assert.ok(!relationWords(wDict.worse.child_relations).includes('最高级:baddest'), `worse should NOT link to baddest (different inflection path), got: ${relationWords(wDict.worse.child_relations)}`)

  // better (standalone comparative of good)
  assert.equal(bDict.better.entry_kind, 'standalone')
  const betterOrigin = findOrigin(bDict.better)
  assert.ok(betterOrigin, 'better should have origin relation')
  assert.equal(betterOrigin.target, 'good')
  assert.ok(relationWords(bDict.better.child_relations).includes('最高级:best'), `better should link forward to best, got: ${relationWords(bDict.better.child_relations)}`)

  // best (standalone superlative of good)
  assert.equal(bDict.best.entry_kind, 'standalone')
  const bestOrigin = findOrigin(bDict.best)
  assert.ok(bestOrigin, 'best should have origin relation')
  assert.equal(bestOrigin.target, 'good')

  // was (standalone past of be)
  assert.equal(wDict.was.entry_kind, 'standalone')
  const wasOrigin = findOrigin(wDict.was)
  assert.ok(wasOrigin, 'was should have origin relation')
  assert.equal(wasOrigin.target, 'be')
  assert.ok(relationWords(wDict.was.child_relations).includes('过去分词:been'), `was should link forward to been, got: ${relationWords(wDict.was.child_relations)}`)
  assert.ok(relationWords(wDict.was.child_relations).includes('现在分词:being'), `was should link forward to being, got: ${relationWords(wDict.was.child_relations)}`)

  // least (standalone superlative of little)
  assert.equal(lDict.least.entry_kind, 'standalone')
  const leastOrigin = findOrigin(lDict.least)
  assert.ok(leastOrigin, 'least should have origin relation')
  assert.equal(leastOrigin.target, 'little')

  // furthest (standalone superlative of far)
  assert.equal(fDict.furthest.entry_kind, 'standalone')
  const furthestOrigin = findOrigin(fDict.furthest)
  assert.ok(furthestOrigin, 'furthest should have origin relation')
  assert.equal(furthestOrigin.target, 'far')
})

test('protected homographs stay standalone with cross-references instead of parent relations', () => {
  const fDict = loadShard('f')
  const lDict = loadShard('l')
  const gDict = loadShard('g')
  const sDict = loadShard('s')
  const bDict = loadShard('b')

  // found (past tense of find, but also standalone verb/noun)
  assert.equal(fDict.found.entry_kind, 'standalone')
  assert.ok(
    relationWords(fDict.found.cross_references || []).includes('过去式:find'),
    `found should cross-reference find, got: ${relationWords(fDict.found.cross_references || [])}`,
  )

  // left (past tense of leave, but also standalone adj/noun)
  assert.equal(lDict.left.entry_kind, 'standalone')
  assert.ok(
    relationWords(lDict.left.cross_references || []).includes('过去式:leave'),
    `left should cross-reference leave, got: ${relationWords(lDict.left.cross_references || [])}`,
  )

  // ground (past tense of grind, but also standalone noun)
  assert.equal(gDict.ground.entry_kind, 'standalone')
  assert.ok(
    relationWords(gDict.ground.cross_references || []).includes('过去式:grind'),
    `ground should cross-reference grind, got: ${relationWords(gDict.ground.cross_references || [])}`,
  )

  // saw (past tense of see, but also standalone noun/verb)
  assert.equal(sDict.saw.entry_kind, 'standalone')
  assert.ok(
    relationWords(sDict.saw.cross_references || []).includes('过去式:see'),
    `saw should cross-reference see, got: ${relationWords(sDict.saw.cross_references || [])}`,
  )

  // bound (past tense of bind, but also standalone adj)
  assert.equal(bDict.bound.entry_kind, 'standalone')
  assert.ok(
    relationWords(bDict.bound.cross_references || []).includes('过去式:bind'),
    `bound should cross-reference bind, got: ${relationWords(bDict.bound.cross_references || [])}`,
  )
})

test('standalone non-comparative aliases do not gain synthetic morphology navigation', () => {
  for (const word of ['abroad', 'against', 'alive', 'a-line']) {
    assert.ok(!findOrigin(aDict[word]), `${word} should not have origin relation`)
    assert.deepEqual(relationWords(aDict[word].child_relations), [])
  }

  assert.ok(!findOrigin(aDict.able), 'able should not have origin relation')
  assert.deepEqual(relationWords(aDict.able.child_relations), [
    '比较级:abler',
    '最高级:ablest',
  ])

  assert.equal(aDict.ables.display_word, 'ables')
  assert.ok(!findOrigin(aDict.ables), 'ables should not have origin relation')
  assert.deepEqual(relationWords(aDict.ables.child_relations), [])
})

test('batch morphology coverage spans 100+ words across relation categories', () => {
  assert.equal(verbSamples.length + nounSamples.length + nonNounVerbSamples.length + aliasPlusSSamples.length, 112)

  for (const word of verbSamples) {
    const entry = entryFor(word)
    const labels = new Set((entry.child_relations || []).map((relation) => relation.label))

    assert.equal(entry.display_word, word)
    assert.ok(!findOrigin(entry), `${word} should not have origin relation`)
    assert.equal(entry.entry_kind, 'standalone')
    assert.ok(labels.has('第三人称单数'))
    assert.ok(labels.has('过去式'))
    assert.ok(labels.has('过去分词'))
    assert.ok(labels.has('现在分词'))
  }

  for (const word of nounSamples) {
    const entry = entryFor(word)
    const labels = new Set((entry.child_relations || []).map((relation) => relation.label))

    assert.equal(entry.display_word, word)
    assert.ok(!findOrigin(entry), `${word} should not have origin relation`)
    assert.ok(labels.has('复数'))
  }

  for (const word of nonNounVerbSamples) {
    const entry = entryFor(word)

    assert.equal(entry.display_word, word)
    assert.deepEqual(relationWords(entry.child_relations), [])
  }

  for (const word of aliasPlusSSamples) {
    const entry = entryFor(word)

    assert.equal(entry.display_word, word)
    assert.deepEqual(relationWords(entry.child_relations), [])
  }

  for (const word of mixedPosPluralSamples) {
    const entry = entryFor(word)
    const relations = relationWords(entry.child_relations)

    assert.ok(relations.some((relation) => relation.startsWith('复数:')))
  }

  for (const word of sameSurfaceNvSamples) {
    const entry = entryFor(word)
    const exchangeForms = new Set(
      (entry.exchange || '')
        .split('/')
        .filter((item) => item.startsWith('3:') || item.startsWith('s:'))
        .map((item) => item.split(':', 2)[1]),
    )
    const groupedLabels = new Map()

    for (const relation of entry.child_relations || []) {
      if (!exchangeForms.has(relation.word)) continue
      const labels = groupedLabels.get(relation.word) || new Set()
      labels.add(relation.label)
      groupedLabels.set(relation.word, labels)
    }

    const overlappingForms = [...groupedLabels.entries()]
      .filter(([, labels]) => labels.has('第三人称单数') && labels.has('复数'))
      .map(([form]) => form)

    assert.ok(overlappingForms.length >= 1, `expected overlapping noun/verb s-form for ${word}`)

    for (const form of overlappingForms) {
      const formEntry = entryFor(form)
      assert.equal(formEntry.display_word, word)
      assert.deepEqual(formEntry.parent_relation, { word, label: '原形' })
    }
  }

  for (const { word, thirdForms, pluralForms } of distinctSurfaceNvSamples) {
    const entry = entryFor(word)
    const groupedLabels = new Map()

    for (const relation of entry.child_relations || []) {
      const labels = groupedLabels.get(relation.word) || new Set()
      labels.add(relation.label)
      groupedLabels.set(relation.word, labels)
    }

    for (const { form, displayWord, parentWord } of thirdForms) {
      assert.ok(groupedLabels.get(form)?.has('第三人称单数'), `missing third-person relation for ${word} -> ${form}`)
      const formEntry = entryFor(form)
      assert.ok(formEntry, `missing query entry for ${word} -> ${form}`)
      assert.equal(formEntry.display_word, displayWord)
      if (parentWord) {
        const origin = findOrigin(formEntry)
        assert.ok(origin, `${form} should have origin relation`)
        assert.equal(origin.target, parentWord)
      }
    }

    for (const { form, displayWord, parentWord } of pluralForms) {
      assert.ok(groupedLabels.get(form)?.has('复数'), `missing plural relation for ${word} -> ${form}`)
      const formEntry = entryFor(form)
      assert.ok(formEntry, `missing query entry for ${word} -> ${form}`)
      assert.equal(formEntry.display_word, displayWord)
      if (parentWord) {
        const origin = findOrigin(formEntry)
        assert.ok(origin, `${form} should have origin relation`)
        assert.equal(origin.target, parentWord)
      }
    }
  }

  for (const word of mixedPosComparativeLeakSamples) {
    const entry = entryFor(word)
    const pluralRelations = (entry.child_relations || [])
      .filter((relation) => relation.label === '复数')
      .map((relation) => relation.word)

    assert.ok(!pluralRelations.includes(`${word}er`))
    assert.ok(!pluralRelations.includes(`${word}est`))
  }

  for (const { word, blockedPluralForms } of irregularComparativeLeakSamples) {
    const entry = entryFor(word)
    const pluralRelations = (entry.child_relations || [])
      .filter((relation) => relation.label === '复数')
      .map((relation) => relation.word)

    for (const form of blockedPluralForms) {
      assert.ok(!pluralRelations.includes(form), `irregular comparative leaked as plural for ${word} -> ${form}`)
    }
  }

  for (const { word, comparativeForms, superlativeForms } of comparativeExchangeSamples) {
    const entry = entryFor(word)
    const exchangeValues = (entry.exchange || '')
      .split('/')
      .reduce((map, item) => {
        const [key, value] = item.split(':', 2)
        if (!key || !value) return map
        const values = map.get(key) || []
        map.set(key, [...values, value])
        return map
      }, new Map())

    const pluralForms = exchangeValues.get('s') || []
    const actualComparativeForms = exchangeValues.get('c') || []
    const actualSuperlativeForms = exchangeValues.get('sup') || []

    for (const form of [...comparativeForms, ...superlativeForms]) {
      assert.ok(!pluralForms.includes(form), `irregular comparative leaked into plural exchange for ${word} -> ${form}`)
    }

    assert.deepEqual(actualComparativeForms, comparativeForms)
    assert.deepEqual(actualSuperlativeForms, superlativeForms)
  }

  for (const word of emptyPosLeakSamples) {
    const entry = entryFor(word)
    assert.ok(entry)
    assert.ok(!findOrigin(entry), `${word} should not have origin relation`)
  }

  for (const word of relationTargetCoverageSamples) {
    const entry = entryFor(word)
    assert.ok(entry, `missing base entry for ${word}`)

    for (const relation of entry.child_relations || []) {
      const relationEntry = entryFor(relation.word)
      assert.ok(relationEntry, `missing query entry for ${word} -> ${relation.word}`)
    }
  }

  for (const [word, entry] of Object.entries(allEntries)) {
    const origin = findOrigin(entry)
    if (!entry.pos && origin) {
      // Allow parent relations for suppletive forms whose base word has valid POS
      const baseEntry = entryFor(origin.target)
      if (!baseEntry?.pos) {
        assert.fail(`empty pos still has parent relation: ${word}`)
      }
    }

    const keys = posKeys(entry)
    const pluralRelations = (entry.child_relations || [])
      .filter((relation) => relation.label === '复数')
      .map((relation) => relation.word)

    if (keys.has('n') && keys.has('v') && keys.has('adj')) {
      assert.ok(!pluralRelations.includes(`${word}er`), `comparative leaked as plural for ${word}`)
      assert.ok(!pluralRelations.includes(`${word}est`), `superlative leaked as plural for ${word}`)
    }
  }
})

test('leaves has inflection_sources with separate labels per relation', () => {
  const lDict = loadShard('l')
  const leaves = lDict.leaves

  assert.ok(leaves.inflection_sources, 'leaves should have inflection_sources')
  assert.ok(Array.isArray(leaves.relations), 'leaves should have relations array')
  // leaf/复数 + leave/第三人称单数 = 2 distinct sources (leave/复数 removed in v3.0.0)
  assert.equal(leaves.inflection_sources.length, 2, `leaves should have exactly 2 inflection_sources, got: ${leaves.inflection_sources?.length || 0}`)

  const leafPlural = leaves.inflection_sources.find((s) => s.word === 'leaf' && s.label === '复数')
  const leaveThirdPs = leaves.inflection_sources.find((s) => s.word === 'leave' && s.label === '第三人称单数')

  assert.ok(leafPlural, `leaves should have source leaf/复数`)
  assert.ok(leaveThirdPs, `leaves should have source leave/第三人称单数`)

  const originRows = leaves.relations
    .filter((relation) => relation.type === 'origin')
    .map((relation) => `${relation.label}:${relation.target}`)
  assert.ok(originRows.includes('复数:leaf'), `leaves relations should include 复数:leaf, got: ${originRows}`)
  assert.ok(originRows.includes('第三人称单数:leave'), `leaves relations should include 第三人称单数:leave, got: ${originRows}`)

  const originPosScopes = leaves.relations
    .filter((relation) => relation.type === 'origin')
    .map((relation) => `${relation.label}:${relation.target}:${(relation.pos_scope || []).join(',')}`)
  assert.ok(originPosScopes.includes('复数:leaf:n'), `leaves origin should preserve noun scope for leaf, got: ${originPosScopes}`)
  assert.ok(originPosScopes.includes('第三人称单数:leave:v'), `leaves origin should preserve verb scope for leave third-person, got: ${originPosScopes}`)
})

test('scripts inflection entry carries only its own exchange slots, not parent verb timeline', () => {
  const sDict = loadShard('s')
  const scripts = sDict.scripts

  assert.ok(scripts, 'scripts should exist in dict')
  assert.equal(scripts.entry_kind, 'inflection', `scripts should be inflection, got: ${scripts.entry_kind}`)

  // exchange should only contain 3 and s slots, not p/d/i
  const exchangeValues = (scripts.exchange || '')
    .split('/')
    .reduce((map, item) => {
      const [key, value] = item.split(':', 2)
      if (key && value) {
        const values = map.get(key) || []
        map.set(key, [...values, value])
      }
      return map
    }, new Map())

  assert.ok(exchangeValues.has('3'), `scripts exchange should have 3 slot, got: ${scripts.exchange}`)
  assert.ok(!exchangeValues.has('p'), `scripts exchange should NOT have p slot, got: ${scripts.exchange}`)
  assert.ok(!exchangeValues.has('d'), `scripts exchange should NOT have d slot, got: ${scripts.exchange}`)
  assert.ok(!exchangeValues.has('i'), `scripts exchange should NOT have i slot, got: ${scripts.exchange}`)

  // relations should only be origin edges pointing back to script
  const relationTypes = (scripts.relations || []).map((r) => r.type)
  assert.ok(relationTypes.includes('origin'), `scripts should have origin relations`)
  assert.ok(!relationTypes.includes('inflection'), `scripts should NOT have inflection relations`)

  // scripts is both third-person singular and plural (inferred in v3.0.0)
  const originRelations = (scripts.relations || []).filter((r) => r.type === 'origin')
  const originLabels = originRelations.map((r) => r.label)
  assert.ok(originLabels.includes('第三人称单数'), `scripts should have 第三人称单数 origin, got: ${originLabels}`)
  assert.ok(originLabels.includes('复数'), `scripts should have 复数 origin via inference, got: ${originLabels}`)
})

test('batch irregular noun plurals preserve correct relations', () => {
  const cases = [
    { word: 'child', plural: 'children', baseLabel: '原形', pluralLabel: '复数' },
    { word: 'leaf', plural: 'leaves', baseLabel: '原形', pluralLabel: '复数' },
  ]
  for (const { word, plural, baseLabel, pluralLabel } of cases) {
    const entry = entryFor(word)
    const pEntry = entryFor(plural)
    assert.ok(entry, `${word} should exist`)
    assert.ok(pEntry, `${plural} should exist`)
    assert.equal(entry.entry_kind, 'standalone', `${word} should be standalone`)
    // Homographic forms like "leaves" (both leaf plural and leave 3rd person) stay standalone
    if (pEntry.inflection_sources) {
      assert.equal(pEntry.entry_kind, 'standalone', `${plural} should be standalone (homographic inflection)`)
      assert.ok(pEntry.inflection_sources.some((s) => s.word === word), `${plural} should have ${word} in inflection_sources`)
    } else {
      assert.equal(pEntry.entry_kind, 'inflection', `${plural} should be inflection`)
      const origin = findOrigin(pEntry)
      assert.ok(origin, `${plural} should have origin relation`)
      assert.equal(origin.target, word)
    }
    assert.ok(relationWords(entry.child_relations).includes(`${pluralLabel}:${plural}`), `${word} should have ${pluralLabel}:${plural}`)
  }
})

test('batch irregular verb inflections preserve correct relations', () => {
  const cases = [
    { word: 'go', past: 'went', pastpart: 'gone', prespart: 'going' },
    { word: 'fly', thirdps: 'flies', past: 'flew', pastpart: 'flown', prespart: 'flying' },
    { word: 'run', thirdps: 'runs', past: 'ran', prespart: 'running' },
  ]
  for (const { word, thirdps, past, pastpart, prespart } of cases) {
    const entry = entryFor(word)
    assert.ok(entry, `${word} should exist`)
    assert.equal(entry.entry_kind, 'standalone')
    const childWords = relationWords(entry.child_relations)
    if (thirdps) assert.ok(childWords.includes(`第三人称单数:${thirdps}`), `${word} should have 3rd person ${thirdps}`)
    if (past) assert.ok(childWords.includes(`过去式:${past}`), `${word} should have past ${past}`)
    if (pastpart) assert.ok(childWords.includes(`过去分词:${pastpart}`), `${word} should have past part ${pastpart}`)
    if (prespart) assert.ok(childWords.includes(`现在分词:${prespart}`), `${word} should have pres part ${prespart}`)
  }
})

test('same-surface irregular verb inflections stay visible in relation metadata', () => {
  const cases = [
    { word: 'put', labels: ['过去式:put', '过去分词:put'] },
    { word: 'cast', labels: ['过去式:cast', '过去分词:cast'] },
    { word: 'cost', labels: ['过去式:cost', '过去分词:cost'] },
    { word: 'become', labels: ['过去分词:become'] },
    { word: 'come', labels: ['过去分词:come'] },
    { word: 'beat', labels: ['过去式:beat'] },
  ]

  for (const { word, labels } of cases) {
    const entry = entryFor(word)
    assert.ok(entry, `${word} should exist`)
    const childRows = new Set(relationWords(entry.child_relations))
    const relationRows = new Set(
      (entry.relations || [])
        .filter((relation) => relation.type === 'inflection')
        .map((relation) => `${relation.label}:${relation.target}`),
    )

    for (const label of labels) {
      assert.ok(childRows.has(label), `${word} child_relations should include ${label}, got: ${[...childRows]}`)
      assert.ok(relationRows.has(label), `${word} relations should include ${label}, got: ${[...relationRows]}`)
    }
  }
})

test('dug keeps only strict back-navigation metadata', () => {
  const dDict = loadShard('d')
  const dug = dDict.dug
  assert.ok(dug, 'dug should exist')
  const dugOrigin = findOrigin(dug)
  assert.ok(dugOrigin, 'dug should have origin relation')
  assert.equal(dugOrigin.target, 'dig')
  assert.ok(!relationWords(dug.child_relations).includes('现在分词:digging'), `dug should not link forward to digging, got: ${relationWords(dug.child_relations)}`)
  const inflectionRows = (dug.relations || [])
    .filter((relation) => relation.type === 'inflection')
    .map((relation) => `${relation.label}:${relation.target}`)
  assert.ok(!inflectionRows.includes('现在分词:digging'), `dug relations should not include 现在分词:digging, got: ${inflectionRows}`)
})

test('batch comparative and superlative families preserve correct relations', () => {
  const cases = [
    { word: 'good', comparative: 'better', superlative: 'best' },
    { word: 'bad', comparative: 'worse', superlative: 'worst' },
    { word: 'well', comparative: 'better', superlative: 'best' },
  ]
  for (const { word, comparative, superlative } of cases) {
    const entry = entryFor(word)
    const cEntry = entryFor(comparative)
    const sEntry = entryFor(superlative)
    assert.ok(entry, `${word} should exist`)
    assert.ok(cEntry, `${comparative} should exist`)
    assert.ok(sEntry, `${superlative} should exist`)
    assert.equal(entry.entry_kind, 'standalone')
    assert.equal(cEntry.entry_kind, 'standalone')
    assert.equal(sEntry.entry_kind, 'standalone')
    // Shared irregular forms like better/best may point to a different primary parent
    const cOrigin = findOrigin(cEntry)
    if (cOrigin?.target === word) {
      assert.equal(cOrigin.target, word)
    }
    const sOrigin = findOrigin(sEntry)
    if (sOrigin?.target === word) {
      assert.equal(sOrigin.target, word)
    }
    assert.ok(relationWords(entry.child_relations).includes(`比较级:${comparative}`))
    assert.ok(relationWords(entry.child_relations).includes(`最高级:${superlative}`))
  }
})

test('batch protected homographs stay standalone with cross-references', () => {
  const cases = [
    { word: 'found', xrefWord: 'find', xrefLabel: '过去式' },
    { word: 'left', xrefWord: 'leave', xrefLabel: '过去式' },
  ]
  for (const { word, xrefWord, xrefLabel } of cases) {
    const entry = entryFor(word)
    assert.ok(entry, `${word} should exist`)
    assert.equal(entry.entry_kind, 'standalone')
    assert.ok(
      relationWords(entry.cross_references || []).includes(`${xrefLabel}:${xrefWord}`),
      `${word} should cross-reference ${xrefWord}, got: ${relationWords(entry.cross_references || [])}`,
    )
  }
})

test('batch inflection sources for homographic forms', () => {
  const lDict = loadShard('l')
  const cases = [
    { word: 'leaves', expectedSources: ['leaf', 'leave'], minSources: 2 },
  ]
  for (const { word, expectedSources, minSources } of cases) {
    const entry = lDict[word]
    assert.ok(entry, `${word} should exist`)
    assert.ok(entry.inflection_sources, `${word} should have inflection_sources`)
    assert.ok(entry.inflection_sources.length >= minSources, `${word} should have at least ${minSources} inflection_sources, got: ${entry.inflection_sources.length}`)
    for (const src of expectedSources) {
      assert.ok(entry.inflection_sources.some((s) => s.word === src), `${word} should have inflection source ${src}`)
    }
  }
})

test('batch homographs with multiple POS stay standalone without parent relations', () => {
  const cases = [
    { word: 'spring', expectedPos: new Set(['v', 'n']) },
    { word: 'light', expectedPos: new Set(['v', 'n', 'adj']) },
    { word: 'sound', expectedPos: new Set(['v', 'n', 'adj', 'adv']) },
    { word: 'close', expectedPos: new Set(['v', 'n', 'adj', 'adv']) },
    { word: 'match', expectedPos: new Set(['v', 'n']) },
    { word: 'round', expectedPos: new Set(['v', 'n', 'adj', 'adv', 'prep']) },
    { word: 'watch', expectedPos: new Set(['v', 'n']) },
    { word: 'object', expectedPos: new Set(['v', 'n']) },
    { word: 'present', expectedPos: new Set(['v', 'n', 'adj']) },
    { word: 'content', expectedPos: new Set(['v', 'n', 'adj']) },
    { word: 'desert', expectedPos: new Set(['v', 'n']) },
    { word: 'refuse', expectedPos: new Set(['v', 'n']) },
    { word: 'permit', expectedPos: new Set(['v', 'n']) },
    { word: 'subject', expectedPos: new Set(['v', 'n', 'adj']) },
    { word: 'contract', expectedPos: new Set(['v', 'n']) },
    { word: 'record', expectedPos: new Set(['v', 'n']) },
    { word: 'address', expectedPos: new Set(['v', 'n']) },
  ]
  for (const { word, expectedPos } of cases) {
    const entry = entryFor(word)
    assert.ok(entry, `${word} should exist`)
    assert.equal(entry.entry_kind, 'standalone', `${word} should be standalone`)
    assert.ok(!findOrigin(entry), `${word} should not have origin relation`)
    const actualPos = posKeys(entry)
    for (const pos of expectedPos) {
      assert.ok(actualPos.has(pos), `${word} should have ${pos} POS, got: ${[...actualPos]}`)
    }
  }
})

test('batch protected homographs with cross-references include ground and bound', () => {
  const cases = [
    { word: 'ground', xrefWord: 'grind', xrefLabel: '过去式' },
    { word: 'bound', xrefWord: 'bind', xrefLabel: '过去式' },
  ]
  for (const { word, xrefWord, xrefLabel } of cases) {
    const entry = entryFor(word)
    assert.ok(entry, `${word} should exist`)
    assert.equal(entry.entry_kind, 'standalone')
    assert.ok(
      relationWords(entry.cross_references || []).includes(`${xrefLabel}:${xrefWord}`),
      `${word} should cross-reference ${xrefWord}, got: ${relationWords(entry.cross_references || [])}`,
    )
    const relationRows = (entry.relations || [])
      .filter((relation) => relation.type === 'xref')
      .map((relation) => `${relation.label}:${relation.target}`)
    assert.ok(
      relationRows.includes(`${xrefLabel}:${xrefWord}`),
      `${word} relations should include ${xrefLabel}:${xrefWord}, got: ${relationRows}`,
    )
  }
})

test('single-sense parts keep the full meaning line while multi-sense parts dedupe bracket noise', () => {
  assert.equal(oDict.objection.translation, 'n. 反对的理由；反对；异议')
  assert.equal(oDict.obligation.translation, 'n. 义务,职责；责任')
  assert.equal(oDict.obtain.translation, 'v. (尤指经努力)获得,赢得；(规则、制度、习俗等)流行')

  assert.deepEqual(oDict.obtain.translation_parts, [
    { pos: 'v.', meanings: ['(尤指经努力)获得,赢得', '(规则、制度、习俗等)流行'] },
  ])
  assert.deepEqual(oDict.obligation.translation_parts, [
    { pos: 'n.', meanings: ['义务,职责', '责任'] },
  ])

  const sDict = loadShard('s')
  assert.deepEqual(sDict.script.translation_parts, [
    {
      pos: 'n.',
      meanings: ['剧本,电影剧本', '笔迹', '(一种语言的)字母系统', '笔试答卷', '脚本(程序)'],
    },
    { pos: 'v.', meanings: ['为(电影或戏剧等)写剧本'] },
  ])

  const obscure = oDict.obscure
  assert.ok(obscure, 'obscure should exist')
  assert.ok(
    obscure.translation.includes('v. 使模糊；使隐晦；使费解'),
    `obscure verb line should keep the full single sense, got: ${obscure.translation}`,
  )

  assert.equal(aDict.aback.translation, 'adv. 被(…)吓了一跳；大吃一惊；震惊')
  assert.equal(aDict.abeyance.translation, 'n. 搁置；暂停使用；暂时中止')
})

test('entries preserve source POS order for translation and pos summary', () => {
  const dDict = loadShard('d')
  const down = dDict.down
  assert.equal(down.pos, 'adv:50/prep:11/v:14/adj:11/n:14')
  assert.ok(down.translation.startsWith('adv. '), `down translation should start with adv, got: ${down.translation}`)
  assert.ok(down.translation.includes('\nprep. '), `down translation should keep prep before verb, got: ${down.translation}`)
  assert.ok(down.translation.includes('\nv. '), `down translation should include verb line, got: ${down.translation}`)
  assert.ok(down.translation.includes('\nadj. '), `down translation should include adjective line, got: ${down.translation}`)
  assert.ok(down.translation.includes('\nn. '), `down translation should end with noun line, got: ${down.translation}`)
  assert.ok(down.translation.indexOf('\nprep. ') < down.translation.indexOf('\nv. '), 'down prep should appear before verb')
  assert.ok(down.translation.indexOf('\nv. ') < down.translation.indexOf('\nadj. '), 'down verb should appear before adj')
  assert.ok(down.translation.indexOf('\nadj. ') < down.translation.indexOf('\nn. '), 'down adj should appear before noun')

  const round = loadShard('r').round
  assert.equal(round.pos, 'adj:10/adv:26/prep:16/n:39/v:10')
  assert.ok(round.translation.startsWith('adj. '), `round translation should start with adj, got: ${round.translation}`)
  assert.ok(round.translation.indexOf('\nadv. ') > 0, 'round should include adv after adj')
  assert.ok(round.translation.indexOf('\nprep. ') > round.translation.indexOf('\nadv. '), 'round prep should appear after adv')
  assert.ok(round.translation.indexOf('\nn. ') > round.translation.indexOf('\nprep. '), 'round noun should appear after prep')
  assert.ok(round.translation.indexOf('\nv. ') > round.translation.indexOf('\nn. '), 'round verb should appear after noun')
})
