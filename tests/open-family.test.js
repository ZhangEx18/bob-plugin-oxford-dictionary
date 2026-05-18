const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadShard(char) {
  const dictPath = path.join(__dirname, '..', 'dict', `${char}.json`)
  return JSON.parse(fs.readFileSync(dictPath, 'utf8'))
}

function loadAllEntries() {
  const dictDir = path.join(__dirname, '..', 'dict')
  const entries = {}

  for (const file of fs.readdirSync(dictDir)) {
    if (!file.endsWith('.json')) continue
    Object.assign(entries, JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8')))
  }

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
const nounSamples = ['a-bomb', 'a-frame', 'a-level', 'a-road', 'a-side', 'a-team', 'aardvark', 'abacus', 'abalone', 'abandonment', 'abasement', 'abatement', 'abattoir', 'abaya', 'abba', 'abbey', 'abbot', 'abbreviation', 'abc', 'abdication', 'abdomen', 'abdominal', 'abductee', 'abduction', 'abductor', 'aberdonian', 'aberration', 'abhorrence', 'ability', 'ablation', 'ablative', 'ableism', 'abm', 'abnegation', 'abnormality']
const nonNounVerbSamples = ['a-cappella', 'a-couple', 'a-fortiori', 'a-gogo', 'a-la', 'a-line', 'a-list', 'a-ok', 'aargh', 'ab-initio', 'aback', 'abaft', 'abandoned', 'abashed', 'abbreviated', 'abed', 'aberrant', 'abeyance', 'abhorrent', 'abiding', 'abiotic', 'abject', 'abjectly', 'ablaze']
const aliasPlusSSamples = ['a-lines', 'a-lists', 'aberrants', 'abeyances', 'abjects', 'ables', 'abnormals', 'abortives', 'aboves', 'abracadabras', 'abroads', 'abrupts', 'absorbents', 'abstinents', 'absurds', 'accidentals', 'accordances', 'achs', 'actuals', 'acutes']
const mixedPosPluralSamples = ['ally', 'baby', 'embargo', 'duck', 'work']
const sameSurfaceNvSamples = ['ally', 'bath', 'belly', 'bivvy', 'bully', 'bus', 'butcher', 'caddie', 'demo', 'echo', 'ferry', 'gas', 'hoof', 'index', 'lasso', 'moo']
const distinctSurfaceNvSamples = [
  { word: 'court-martial', thirdForms: [{ form: 'court-martials', displayWord: 'court-martial', parentWord: 'court-martial' }], pluralForms: [{ form: 'courts martial', displayWord: 'court-martial', parentWord: 'court-martial' }] },
  { word: 'crow', thirdForms: [{ form: 'crows', displayWord: 'crow', parentWord: 'crow' }], pluralForms: [{ form: 'Crows', displayWord: 'crow', parentWord: 'crow' }] },
  { word: 'die', thirdForms: [{ form: 'dies', displayWord: 'die', parentWord: 'die' }], pluralForms: [{ form: 'dice', displayWord: 'dice', parentWord: 'die' }] },
  { word: 'do', thirdForms: [{ form: 'does', displayWord: 'does', parentWord: null }], pluralForms: [{ form: 'dos', displayWord: 'do', parentWord: 'do' }, { form: 'do’s', displayWord: 'do', parentWord: 'do' }] },
  { word: 'focus', thirdForms: [{ form: 'focusses', displayWord: 'focus', parentWord: 'focus' }], pluralForms: [{ form: 'foci', displayWord: 'focus', parentWord: 'focus' }] },
  { word: 'goose', thirdForms: [{ form: 'gooses', displayWord: 'goose', parentWord: 'goose' }], pluralForms: [{ form: 'geese', displayWord: 'geese', parentWord: 'goose' }] },
  { word: 'hang', thirdForms: [{ form: 'hangs', displayWord: 'hang', parentWord: 'hang' }], pluralForms: [{ form: 'hanged', displayWord: 'hang', parentWord: 'hang' }] },
  { word: 'jackknife', thirdForms: [{ form: 'jackknifes', displayWord: 'jackknife', parentWord: 'jackknife' }], pluralForms: [{ form: 'jackknives', displayWord: 'jackknife', parentWord: 'jackknife' }] },
  { word: 'knife', thirdForms: [{ form: 'knifes', displayWord: 'knife', parentWord: 'knife' }], pluralForms: [{ form: 'knives', displayWord: 'knives', parentWord: 'knife' }] },
  { word: 'last', thirdForms: [{ form: 'lasts', displayWord: 'last', parentWord: 'last' }], pluralForms: [{ form: 'the last', displayWord: 'last', parentWord: 'last' }] },
  { word: 'loaf', thirdForms: [{ form: 'loafs', displayWord: 'loaf', parentWord: 'loaf' }], pluralForms: [{ form: 'loaves', displayWord: 'loaves', parentWord: 'loaf' }] },
  { word: 'man', thirdForms: [{ form: 'mans', displayWord: 'man', parentWord: 'man' }], pluralForms: [{ form: 'men', displayWord: 'men', parentWord: 'man' }] },
  { word: 'staff', thirdForms: [{ form: 'staffs', displayWord: 'staff', parentWord: 'staff' }], pluralForms: [{ form: 'staves', displayWord: 'staff', parentWord: 'staff' }] },
  { word: 'tango', thirdForms: [{ form: 'tangoes', displayWord: 'tango', parentWord: 'tango' }], pluralForms: [{ form: 'tangos', displayWord: 'tango', parentWord: 'tango' }] },
  { word: 'wolf', thirdForms: [{ form: 'wolfs', displayWord: 'wolf', parentWord: 'wolf' }], pluralForms: [{ form: 'wolves', displayWord: 'wolves', parentWord: 'wolf' }] },
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
const emptyPosLeakSamples = ['bye byes', 'byebyes', "i's", "is's", 'is.s', "nibs's", 'one-way mirrors', 'smithers']
const relationTargetCoverageSamples = ['staff', 'travel', 'lambast', 'field-of-vision', 'line']

function relationWords(relations = []) {
  return relations.map((relation) => `${relation.label}:${relation.word}`)
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
  assert.equal(oDict.open.parent_relation, null)
  assert.deepEqual(relationWords(oDict.open.child_relations), [
    '第三人称单数:opens',
    '过去式:opened',
    '过去分词:opened',
    '现在分词:opening',
  ])

  assert.equal(oDict.opening.display_word, 'opening')
  assert.equal(oDict.opening.parent_relation, null)
  assert.ok(relationWords(oDict.opening.child_relations).includes('复数:openings'))

  assert.equal(oDict.openings.display_word, 'opening')
  assert.deepEqual(oDict.openings.parent_relation, { word: 'opening', label: '原形' })

  assert.equal(oDict.opens.display_word, 'open')
  assert.deepEqual(oDict.opens.parent_relation, { word: 'open', label: '原形' })

  assert.equal(oDict.opened.display_word, 'open')
  assert.deepEqual(oDict.opened.parent_relation, { word: 'open', label: '原形' })
})

test('child family keeps irregular plurals attached to the standalone parent', () => {
  assert.equal(cDict.child.display_word, 'child')
  assert.equal(cDict.child.parent_relation, null)
  assert.ok(relationWords(cDict.child.child_relations).includes('复数:children'))

  assert.equal(cDict.children.display_word, 'child')
  assert.deepEqual(cDict.children.parent_relation, { word: 'child', label: '原形' })
})

test('tailor family preserves standalone middle entries', () => {
  assert.equal(tDict.tailor.display_word, 'tailor')
  assert.equal(tDict.tailor.parent_relation, null)
  assert.ok(relationWords(tDict.tailor.child_relations).includes('现在分词:tailoring'))

  assert.equal(tDict.tailoring.display_word, 'tailoring')
  assert.equal(tDict.tailoring.parent_relation, null)
  assert.deepEqual(relationWords(tDict.tailoring.child_relations), ['复数:tailorings'])

  assert.equal(tDict.tailorings.display_word, 'tailoring')
  assert.deepEqual(tDict.tailorings.parent_relation, { word: 'tailoring', label: '原形' })
})

test('take family keeps standalone irregular forms on their own entries', () => {
  assert.equal(tDict.take.display_word, 'take')
  assert.equal(tDict.take.parent_relation, null)
  assert.deepEqual(relationWords(tDict.take.child_relations), [
    '第三人称单数:takes',
    '过去式:took',
    '过去分词:taken',
    '现在分词:taking',
  ])

  assert.equal(tDict.takes.display_word, 'take')
  assert.deepEqual(tDict.takes.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.taking.display_word, 'take')
  assert.deepEqual(tDict.taking.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.taken.display_word, 'take')
  assert.deepEqual(tDict.taken.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.took.display_word, 'took')
  assert.deepEqual(tDict.took.parent_relation, { word: 'take', label: '原形' })
})

test('man family does not override standalone plural entries', () => {
  assert.equal(mDict.man.display_word, 'man')
  assert.equal(mDict.man.parent_relation, null)
  assert.ok(relationWords(mDict.man.child_relations).includes('复数:men'))

  assert.equal(mDict.men.display_word, 'men')
  assert.deepEqual(mDict.men.parent_relation, { word: 'man', label: '原形' })
})

test('comparative adjective families participate in morphology navigation', () => {
  assert.equal(hDict.happy.display_word, 'happy')
  assert.equal(hDict.happy.parent_relation, null)
  assert.deepEqual(relationWords(hDict.happy.child_relations), [
    '比较级:happier',
    '最高级:happiest',
  ])

  assert.equal(hDict.happier.display_word, 'happy')
  assert.deepEqual(hDict.happier.parent_relation, { word: 'happy', label: '原形' })
  assert.deepEqual(relationWords(hDict.happier.child_relations), [])

  assert.equal(hDict.happiest.display_word, 'happy')
  assert.deepEqual(hDict.happiest.parent_relation, { word: 'happy', label: '原形' })
  assert.deepEqual(relationWords(hDict.happiest.child_relations), [])

  assert.equal(tDict.tacky.display_word, 'tacky')
  assert.equal(tDict.tacky.parent_relation, null)
  assert.deepEqual(relationWords(tDict.tacky.child_relations), [
    '比较级:tackier',
    '最高级:tackiest',
  ])

  assert.equal(tDict.tackier.display_word, 'tacky')
  assert.deepEqual(tDict.tackier.parent_relation, { word: 'tacky', label: '原形' })
  assert.deepEqual(relationWords(tDict.tackier.child_relations), [])

  assert.equal(tDict.tackiest.display_word, 'tacky')
  assert.deepEqual(tDict.tackiest.parent_relation, { word: 'tacky', label: '原形' })
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
  assert.deepEqual(wDict.worse.parent_relation, { word: 'bad', label: '原形' })
  assert.ok(relationWords(wDict.worse.child_relations).includes('最高级:worst'), `worse should link forward to worst, got: ${relationWords(wDict.worse.child_relations)}`)
  assert.ok(relationWords(wDict.worse.child_relations).includes('最高级:baddest'), `worse should link forward to baddest, got: ${relationWords(wDict.worse.child_relations)}`)

  // better (standalone comparative of good)
  assert.equal(bDict.better.entry_kind, 'standalone')
  assert.deepEqual(bDict.better.parent_relation, { word: 'good', label: '原形' })
  assert.ok(relationWords(bDict.better.child_relations).includes('最高级:best'), `better should link forward to best, got: ${relationWords(bDict.better.child_relations)}`)

  // best (standalone superlative of good)
  assert.equal(bDict.best.entry_kind, 'standalone')
  assert.deepEqual(bDict.best.parent_relation, { word: 'good', label: '原形' })

  // was (standalone past of be)
  assert.equal(wDict.was.entry_kind, 'standalone')
  assert.deepEqual(wDict.was.parent_relation, { word: 'be', label: '原形' })
  assert.ok(relationWords(wDict.was.child_relations).includes('过去分词:been'), `was should link forward to been, got: ${relationWords(wDict.was.child_relations)}`)
  assert.ok(relationWords(wDict.was.child_relations).includes('现在分词:being'), `was should link forward to being, got: ${relationWords(wDict.was.child_relations)}`)

  // least (standalone superlative of little)
  assert.equal(lDict.least.entry_kind, 'standalone')
  assert.deepEqual(lDict.least.parent_relation, { word: 'little', label: '原形' })

  // furthest (standalone superlative of far)
  assert.equal(fDict.furthest.entry_kind, 'standalone')
  assert.deepEqual(fDict.furthest.parent_relation, { word: 'far', label: '原形' })
})

test('standalone non-comparative aliases do not gain synthetic morphology navigation', () => {
  for (const word of ['abroad', 'against', 'alive', 'a-line']) {
    assert.equal(aDict[word].parent_relation, null)
    assert.deepEqual(relationWords(aDict[word].child_relations), [])
  }

  assert.equal(aDict.able.parent_relation, null)
  assert.deepEqual(relationWords(aDict.able.child_relations), [
    '比较级:abler',
    '最高级:ablest',
  ])

  assert.equal(aDict.ables.display_word, 'ables')
  assert.equal(aDict.ables.parent_relation, null)
  assert.deepEqual(relationWords(aDict.ables.child_relations), [])
})

test('batch morphology coverage spans 100+ words across relation categories', () => {
  assert.equal(verbSamples.length + nounSamples.length + nonNounVerbSamples.length + aliasPlusSSamples.length, 114)

  for (const word of verbSamples) {
    const entry = entryFor(word)
    const labels = new Set((entry.child_relations || []).map((relation) => relation.label))

    assert.equal(entry.display_word, word)
    assert.equal(entry.parent_relation, null)
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
    assert.equal(entry.parent_relation, null)
    assert.ok(labels.has('复数'))
  }

  for (const word of nonNounVerbSamples) {
    const entry = entryFor(word)

    assert.equal(entry.display_word, word)
    assert.equal(entry.parent_relation, null)
    assert.deepEqual(relationWords(entry.child_relations), [])
  }

  for (const word of aliasPlusSSamples) {
    const entry = entryFor(word)

    assert.equal(entry.display_word, word)
    assert.equal(entry.parent_relation, null)
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
      assert.deepEqual(formEntry.parent_relation, parentWord ? { word: parentWord, label: '原形' } : null)
    }

    for (const { form, displayWord, parentWord } of pluralForms) {
      assert.ok(groupedLabels.get(form)?.has('复数'), `missing plural relation for ${word} -> ${form}`)
      const formEntry = entryFor(form)
      assert.ok(formEntry, `missing query entry for ${word} -> ${form}`)
      assert.equal(formEntry.display_word, displayWord)
      assert.deepEqual(formEntry.parent_relation, parentWord ? { word: parentWord, label: '原形' } : null)
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
    assert.equal(entry.parent_relation, null)
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
    if (!entry.pos && entry.parent_relation) {
      // Allow parent relations for suppletive forms whose base word has valid POS
      const baseEntry = entryFor(entry.parent_relation.word)
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
