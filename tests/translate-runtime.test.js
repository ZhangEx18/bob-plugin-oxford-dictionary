const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runTranslate } = require('./_runtime')
const { getShardPath } = require('./dict-path')
const DISPLAY_SEPARATOR = '\u00A0'

function loadShard(char) {
  const dictPath = getShardPath(char)
  return JSON.parse(fs.readFileSync(dictPath, 'utf8'))
}

function visibleParts(parts) {
  return parts.filter((part) => part.part.trim() || part.means.some((mean) => mean.trim()))
}

function youdaoDictionaryMockResponse(word, overrides = {}) {
  return {
    ec: {
      word: {
        ukphone: "[/ˌəʊvəˈbɔː(r)/]",
        usphone: "/ˌoʊvərˈbɔːr/",
        trs: [
          {
            pos: "v.",
            tran: "overbear 的过去式",
          },
        ],
        wfs: [
          { wf: { name: "原形", value: "overbear" } },
          { wf: { name: "过去分词", value: "overborne" } },
        ],
        prototype: "overbear",
      },
      exam_type: ["TEM8"],
      web_trans: ["被压倒的"],
    },
    blng_sents_part: {
      sentence_pair: [
        { sentence: "He overbore their resistance.", sentence_translation: "他压倒了他们的抵抗。" },
      ],
    },
    ...overrides,
  }
}

test('decide renders phrasal verbs, verb forms, then word-family display once', async () => {
  const result = await runTranslate('decide')

  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts.slice(1))), [
    { part: DISPLAY_SEPARATOR, means: [DISPLAY_SEPARATOR] },
    { part: 'decide on', means: ['v. 决定；选定'] },
    { part: 'decide upon', means: ['v. 决定；选定'] },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.addtions)), [])

  const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
  assert.deepEqual(JSON.parse(JSON.stringify(exchangeRows.slice(-4))), [
    '第三人称单数:decides',
    '过去式:decided',
    '过去分词:decided',
    '现在分词:deciding',
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.relatedWordParts)), [
    {
      words: [
        { word: 'decision', means: ['n.'] },
        { word: 'decisive', means: ['adj.'] },
        { word: 'undecided', means: ['adj.'] },
      ],
    },
  ])
})

test('track phrasal verb renders only on standalone track entry', async () => {
  const track = await runTranslate('track')
  assert.ok(
    track.toDict.parts.some((part) => part.part === 'track down'),
    `track should render track down, got: ${JSON.stringify(track.toDict.parts)}`,
  )

  for (const word of ['tracks', 'tracked']) {
    const result = await runTranslate(word)
    const partNames = result.toDict.parts.map((part) => part.part)
    const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)

    assert.ok(!partNames.includes('track down'), `${word} should not render track down`)
    assert.deepEqual(JSON.parse(JSON.stringify(exchangeRows)), ['原形:track'])
  }
})

test('roots pack remains packaged data and is not rendered in 8.4.2 results', async () => {
  const result = await runTranslate('track', {
    'packs/roots/latest/manifest.json': {
      schemaVersion: '1.0.0',
      dataVersion: 'latest',
      packType: 'roots',
      entryCount: 1,
      shardCount: 1,
      layout: { shardSubdir: 'words', shardExtension: '.json' },
      files: [{ name: 't.json' }],
    },
    'packs/roots/latest/words/t.json': {
      track: { rootBreakdown: 'ROOTS_SENTINEL', etymology: 'test-only roots payload' },
    },
  })

  const rendered = JSON.stringify({
    parts: result.toDict.parts,
    additions: result.toDict.additions,
    addtions: result.toDict.addtions,
  })
  assert.doesNotMatch(rendered, /ROOTS_SENTINEL|test-only roots payload/)
})

test('every is retained as an OALD determiner entry', async () => {
  const result = await runTranslate('every')

  assert.equal(result.toDict.word, 'every')
  assert.ok(result.toDict.parts.length > 0, 'every should render definition parts')
  assert.equal(result.toDict.parts[0].part, 'det.')
  assert.ok(
    result.toDict.parts[0].means.some((meaning) => meaning.includes('每一个') || meaning.includes('每个')),
    `every should include its Chinese definition, got: ${JSON.stringify(result.toDict.parts)}`,
  )
})

test('decision renders OALD word-family peers without generated guesses', async () => {
  const result = await runTranslate('decision')
  const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)

  assert.ok(!exchangeRows.some((row) => row.includes('concision')), `decision should not include generated word-family guesses: ${exchangeRows}`)
  assert.ok(!exchangeRows.some((row) => row.includes('incision')), `decision should not include generated word-family guesses: ${exchangeRows}`)
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.relatedWordParts)), [
    {
      words: [
        { word: 'decide', means: ['v.'] },
        { word: 'decisive', means: ['adj.'] },
        { word: 'undecided', means: ['adj.'] },
      ],
    },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.additions || [])), [])
})

test('OALD miss falls back to Youdao dictionary for missing words like overbore', async () => {
  const result = await runTranslate('overbore', {
    $httpMocks: [
      {
        method: 'POST',
        url: 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4',
        response: youdaoDictionaryMockResponse('overbore'),
        rawData: youdaoDictionaryMockResponse('overbore'),
      },
    ],
  })

  assert.equal(result.toDict.word, 'overbore')
  assert.equal(result.raw.provider, 'youdao-dict')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
    { part: 'v.', means: ['overbear 的过去式'] },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.phonetics)), [
    { type: 'uk', value: 'ˌəʊvəˈbɔː(r)' },
    { type: 'us', value: 'ˌoʊvərˈbɔːr' },
  ])
  assert.ok(result.toDict.exchanges.some((item) => item.name === '原形' && item.words.includes('overbear')))
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), [])
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.additions || [])), [])
})

test('Youdao dictionary also works when Bob passes resp.data as an object', async () => {
  const payload = youdaoDictionaryMockResponse('overbore')
  const result = await runTranslate('overbore', {
    $httpMocks: [
      {
        method: 'POST',
        url: 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4',
        response: payload,
        rawData: payload,
      },
    ],
  })

  assert.equal(result.raw.provider, 'youdao-dict')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
    { part: 'v.', means: ['overbear 的过去式'] },
  ])
})

test('Youdao dictionary miss degrades to translation result for single word query', async () => {
  const result = await runTranslate('overbore', {
    $httpMocks: [
      {
        method: 'POST',
        url: 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4',
        response: {},
      },
      {
        method: 'POST',
        url: 'https://aidemo.youdao.com/trans',
        response: { errorCode: '0', translation: ['压倒了'] },
      },
    ],
  })

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['压倒了'])
})

test('sentence translation uses Youdao translation route', async () => {
  const result = await runTranslate('This is a sentence.', {
    overrides: {
      $httpMocks: [
        {
          method: 'POST',
          url: 'https://aidemo.youdao.com/trans',
          response: { errorCode: '0', translation: ['这是一个句子。'] },
        },
      ],
    },
  })

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['这是一个句子。'])
})

test('sentence translation normalizes OCR line breaks before calling Youdao', async () => {
  const result = await runTranslate('This is a long-\n sentence from OCR.\nIt should read naturally.', {
    overrides: {
      $httpMocks: [
        {
          method: 'POST',
          url: 'https://aidemo.youdao.com/trans',
          match: (options) => options.body?.q === 'This is a long- sentence from OCR. It should read naturally.'
            || options.body?.q === 'This is a long sentence from OCR. It should read naturally.'
            || options.body?.q === 'This is a longsentence from OCR. It should read naturally.',
          response: { errorCode: '0', translation: ['这是一句经过整理的长难句。'] },
        },
      ],
    },
  })

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['这是一句经过整理的长难句。'])
})

test('translation supports a third language pair through Youdao', async () => {
  const result = await runTranslate('bonjour', {
    detectFrom: 'fr',
    detectTo: 'en',
    overrides: {
      $httpMocks: [
        {
          method: 'POST',
          url: 'https://aidemo.youdao.com/trans',
          response: { errorCode: '0', translation: ['hello'] },
        },
      ],
    },
  })

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['hello'])
})

test('runtime uses structured verb_forms when exchange relations are absent', async () => {
  const shard = loadShard('d')
  const decide = shard.decide
  const modifiedShard = {
    ...shard,
    decide: {
      ...decide,
      exchange: '',
      relations: (decide.relations || []).filter((relation) => relation.type !== 'inflection'),
    },
  }

  const result = await runTranslate('decide', {
    'packs/oald/2024.09/dict/d.json': JSON.stringify(modifiedShard),
  })
  const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)

  assert.deepEqual(JSON.parse(JSON.stringify(exchangeRows.slice(-4))), [
    '第三人称单数:decides',
    '过去式:decided',
    '过去分词:decided',
    '现在分词:deciding',
  ])
})

test('fallback display keeps compound OALD POS blocks when origin scope matches', async () => {
  const shard = loadShard('h')
  const happy = shard.happy
  const modifiedShard = {
    ...shard,
    happy: {
      ...happy,
      translation: 'adj. / adv. shared meaning',
      translation_parts: [
        { pos: 'adj. / adv.', meanings: ['shared meaning'] },
      ],
      translation_detail_parts: [
        { pos: 'adj. / adv.', details: [{ text: 'shared meaning' }] },
      ],
    },
  }

  const result = await runTranslate('happier', {
    'packs/oald/2024.09/dict/h.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(visibleParts(result.toDict.parts))), [
    { part: 'adj. / adv.', means: ['shared meaning'] },
  ])
})

test('travel only displays primary American variants in runtime exchanges', async () => {
  const result = await runTranslate('travel')
  const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))

  assert.deepEqual([...exchangeMap.get('过去式')], ['traveled'])
  assert.deepEqual([...exchangeMap.get('过去分词')], ['traveled'])
  assert.deepEqual([...exchangeMap.get('现在分词')], ['traveling'])
  assert.ok(!exchangeMap.get('过去式')?.includes('travelled'))
  assert.ok(!exchangeMap.get('过去分词')?.includes('travelled'))
  assert.ok(!exchangeMap.get('现在分词')?.includes('travelling'))
})

test('travel variants stay queryable while runtime exchange bar stays deduped', async () => {
  const travelled = await runTranslate('travelled')
  const traveling = await runTranslate('traveling')
  const travel = await runTranslate('travel')

  assert.equal(travelled.raw.displayWord, 'travelled')
  assert.equal(traveling.raw.displayWord, 'travel')

  const travelRows = travel.toDict.exchanges.flatMap((item) => item.words.map((word) => `${item.name}:${word}`))
  assert.equal(travelRows.length, new Set(travelRows).size)
  assert.ok(!travelRows.includes('过去式:travelled'))
  assert.ok(!travelRows.includes('过去分词:travelled'))
  assert.ok(!travelRows.includes('现在分词:travelling'))
})

test('comparative variants stay queryable while base entries expose comparative exchanges', async () => {
  const happier = await runTranslate('happier')
  const happiest = await runTranslate('happiest')
  const happy = await runTranslate('happy')

  assert.equal(happier.raw.displayWord, 'happy')
  assert.equal(happiest.raw.displayWord, 'happy')
  assert.deepEqual(JSON.parse(JSON.stringify(happier.toDict.exchanges[0])), { name: '原形', words: ['happy'] })
  assert.deepEqual(JSON.parse(JSON.stringify(happiest.toDict.exchanges[0])), { name: '原形', words: ['happy'] })

  const exchangeMap = new Map(happy.toDict.exchanges.map((item) => [item.name, item.words]))
  assert.deepEqual([...exchangeMap.get('比较级')], ['happier'])
  assert.deepEqual([...exchangeMap.get('最高级')], ['happiest'])
})

test('standalone suppletive forms render back-relations and forward links at runtime', async () => {
  const worse = await runTranslate('worse')
  const better = await runTranslate('better')
  const was = await runTranslate('was')

  const worseMap = new Map(worse.toDict.exchanges.map((item) => [item.name, item.words]))
  assert.deepEqual(JSON.parse(JSON.stringify(worseMap.get('原形'))), ['bad'])
  assert.ok((worseMap.get('最高级') || []).includes('worst'), `worse should show worst as superlative, got: ${JSON.stringify(worse.toDict.exchanges)}`)

  const betterMap = new Map(better.toDict.exchanges.map((item) => [item.name, item.words]))
  assert.deepEqual(JSON.parse(JSON.stringify(betterMap.get('原形'))), ['good'])
  assert.ok((betterMap.get('最高级') || []).includes('best'), `better should show best as superlative, got: ${JSON.stringify(better.toDict.exchanges)}`)

  const wasMap = new Map(was.toDict.exchanges.map((item) => [item.name, item.words]))
  assert.deepEqual(JSON.parse(JSON.stringify(wasMap.get('原形'))), ['be'])
  assert.ok((wasMap.get('过去分词') || []).includes('been'), `was should show been as past participle, got: ${JSON.stringify(was.toDict.exchanges)}`)
  assert.ok((wasMap.get('现在分词') || []).includes('being'), `was should show being as present participle, got: ${JSON.stringify(was.toDict.exchanges)}`)
})

test('comparative forms render under comparative and superlative exchanges at runtime', async () => {
  const cases = [
    { word: 'good', comparativeForms: ['better'], superlativeForms: ['best'] },
    { word: 'bad', comparativeForms: ['worse', 'badder'], superlativeForms: ['worst', 'baddest'] },
    { word: 'little', comparativeForms: ['less'], superlativeForms: ['least'] },
    { word: 'much', comparativeForms: ['more'], superlativeForms: ['most'] },
    { word: 'well', comparativeForms: ['better'], superlativeForms: ['best'] },
    { word: 'far', comparativeForms: ['farther', 'further'], superlativeForms: ['farthest', 'furthest'] },
    { word: 'black', comparativeForms: ['blacker'], superlativeForms: ['blackest'] },
    { word: 'dry', comparativeForms: ['drier'], superlativeForms: ['driest'] },
  ]

  for (const { word, comparativeForms, superlativeForms } of cases) {
    const result = await runTranslate(word)
    const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))
    const pluralWords = exchangeMap.get('复数') || []
    const comparativeWords = exchangeMap.get('比较级') || []
    const superlativeWords = exchangeMap.get('最高级') || []

    for (const form of [...comparativeForms, ...superlativeForms]) {
      assert.ok(!pluralWords.includes(form), `runtime rendered comparative as plural for ${word} -> ${form}`)
    }

    for (const form of comparativeForms) {
      assert.ok(comparativeWords.includes(form), `runtime missed comparative for ${word} -> ${form}`)
    }

    for (const form of superlativeForms) {
      assert.ok(superlativeWords.includes(form), `runtime missed superlative for ${word} -> ${form}`)
    }
  }
})

test('protected homographs show cross-references at runtime instead of parent links', async () => {
  const found = await runTranslate('found')
  const left = await runTranslate('left')

  const foundExchanges = found.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
  assert.ok(foundExchanges.includes('原形:find'), `found should show cross-reference to find, got: ${JSON.stringify(found.toDict.exchanges)}`)
  assert.equal(
    foundExchanges.filter((item) => item === '原形:find').length,
    1,
    `found should only show one 原形:find row, got: ${JSON.stringify(found.toDict.exchanges)}`,
  )

  const leftExchanges = left.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
  assert.ok(leftExchanges.includes('原形:leave'), `left should show cross-reference to leave, got: ${JSON.stringify(left.toDict.exchanges)}`)
  assert.equal(
    leftExchanges.filter((item) => item === '原形:leave').length,
    1,
    `left should only show one 原形:leave row, got: ${JSON.stringify(left.toDict.exchanges)}`,
  )

  const foundRelationTypes = (found.raw.entry.relations || []).map((relation) => relation.type)
  assert.ok(foundRelationTypes.includes('xref'), `found should include xref relation, got: ${JSON.stringify(found.raw.entry.relations)}`)
})

test('leaves aggregates parts from both leaf and leave inflection sources', async () => {
  const result = await runTranslate('leaves')

  assert.equal(result.toDict.word, 'leaves')
  assert.ok(result.toDict.phonetics.length > 0, 'leaves should have phonetics')

  const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))
  const rootWords = exchangeMap.get('原形') || []
  assert.ok(rootWords.includes('leaf'), `leaves exchanges should include leaf as 原形, got: ${rootWords}`)
  assert.ok(rootWords.includes('leave'), `leaves exchanges should include leave as 原形, got: ${rootWords}`)

  const parts = JSON.parse(JSON.stringify(result.toDict.parts))
  assert.ok(parts.length >= 2, `leaves should have at least 2 parts, got: ${parts.length}`)

  const leafPart = parts.find((part) => part.part === '[leaf 的复数]')
  assert.ok(leafPart, `leaves should have [leaf 的复数] part, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(leafPart.means, [
    '叶,叶片', '有…状叶的', '(纸)页', '薄金属片', '活动桌板',
  ])

  const leavePart = parts.find((part) => part.part === '[leave 的 第三人称单数]')
  assert.ok(leavePart, `leaves should have [leave 的 第三人称单数] part, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(leavePart.means, [
    '离开(某人或某处),离开居住地点', '遗弃', '忘了带', '使保留', '留下备用(或销售等)', '使发生', '发布', '不立刻做', '把…留交', '(去世时)遗赠', '(死后)留下(家人)', '剩余',
  ])
})

test('runtime prefers translation_parts when present', async () => {
  const shard = loadShard('o')
  const obtain = shard.obtain
  const modifiedShard = {
    ...shard,
    obtain: {
      ...obtain,
      translation: 'v. fallback line',
      translation_parts: [
        { pos: 'v.', meanings: ['first meaning', 'second meaning'] },
        { pos: 'n.', meanings: ['nominal meaning'] },
      ],
    },
  }

  const result = await runTranslate('obtain', {
    'packs/oald/2024.09/dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(visibleParts(result.toDict.parts))), [
    { part: 'v.', means: ['first meaning', 'second meaning'] },
    { part: 'n.', means: ['nominal meaning'] },
  ])
})

test('runtime falls back to translation string when translation_parts is absent', async () => {
  const shard = loadShard('o')
  const obtain = shard.obtain
  const { translation_parts, ...obtainWithoutParts } = obtain
  const modifiedShard = {
    ...shard,
    obtain: obtainWithoutParts,
  }

  const result = await runTranslate('obtain', {
    'packs/oald/2024.09/dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(visibleParts(result.toDict.parts))), [
    { part: 'v.', means: ['(尤指经努力)获得,赢得；(规则、制度、习俗等)流行'] },
  ])
})

test('runtime falls back to translation string when translation_parts is unusable', async () => {
  const shard = loadShard('o')
  const obtain = shard.obtain
  const modifiedShard = {
    ...shard,
    obtain: {
      ...obtain,
      translation_parts: [{ pos: '', meanings: [] }],
    },
  }

  const result = await runTranslate('obtain', {
    'packs/oald/2024.09/dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(visibleParts(result.toDict.parts))), [
    { part: 'v.', means: ['(尤指经努力)获得,赢得；(规则、制度、习俗等)流行'] },
  ])
})

test('scripts as mixed-POS inflection shows both noun and verb senses', async () => {
  const result = await runTranslate('scripts')
  const parts = JSON.parse(JSON.stringify(result.toDict.parts))

  // scripts is both plural and third-person singular (v3.0.0 plural inference)
  const nounPart = parts.find((part) => part.part === '[script 的复数]')
  assert.ok(nounPart, `scripts should include noun meanings via plural inference, got: ${JSON.stringify(parts)}`)

  const verbPart = parts.find((part) => part.part === '[script 的 第三人称单数]')
  assert.ok(verbPart, `scripts should include verb meanings, got: ${JSON.stringify(parts)}`)

  const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
  assert.equal(exchangeRows.length, 1, `scripts as inflection entry should only show back-navigation, got: ${JSON.stringify(result.toDict.exchanges)}`)
  assert.equal(exchangeRows[0], '原形:script')
  assert.ok(!exchangeRows.includes('复数:scripts'), `scripts should NOT show itself as plural, got: ${JSON.stringify(result.toDict.exchanges)}`)
  assert.ok(!exchangeRows.includes('第三人称单数:scripts'), `scripts should NOT show itself as 3rd person, got: ${JSON.stringify(result.toDict.exchanges)}`)
  assert.ok(!exchangeRows.includes('现在分词:scripting'), `scripts should NOT show scripting as pres part, got: ${JSON.stringify(result.toDict.exchanges)}`)
  assert.ok(!exchangeRows.includes('过去式:scripted'), `scripts should NOT show scripted as past tense, got: ${JSON.stringify(result.toDict.exchanges)}`)
  assert.ok(!exchangeRows.includes('过去分词:scripted'), `scripts should NOT show scripted as past part, got: ${JSON.stringify(result.toDict.exchanges)}`)
})

test('batch irregular verb inflections render correct exchanges at runtime', async () => {
  const cases = [
    { word: 'go', past: ['went'], pastpart: ['gone'], prespart: ['going'] },
    { word: 'fly', thirdps: ['flies'], past: ['flew'], pastpart: ['flown'], prespart: ['flying'] },
    { word: 'run', thirdps: ['runs'], past: ['ran'], prespart: ['running'] },
  ]
  for (const { word, thirdps, past, pastpart, prespart } of cases) {
    const result = await runTranslate(word)
    const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))
    if (thirdps) assert.deepEqual([...exchangeMap.get('第三人称单数')], thirdps, `${word} 3rd person mismatch`)
    if (past) assert.deepEqual([...exchangeMap.get('过去式')], past, `${word} past tense mismatch`)
    if (pastpart) assert.deepEqual([...exchangeMap.get('过去分词')], pastpart, `${word} past part mismatch`)
    if (prespart) assert.deepEqual([...exchangeMap.get('现在分词')], prespart, `${word} pres part mismatch`)
  }
})

test('same-surface past and participle forms still render in runtime exchanges', async () => {
  const result = await runTranslate('put')
  const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))

  assert.deepEqual([...exchangeMap.get('第三人称单数')], ['puts'])
  assert.deepEqual([...exchangeMap.get('过去式')], ['put'])
  assert.deepEqual([...exchangeMap.get('过去分词')], ['put'])
  assert.deepEqual([...exchangeMap.get('现在分词')], ['putting'])
})

test('dug only renders back-navigation at runtime', async () => {
  const result = await runTranslate('dug')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.exchanges)), [{ name: '原形', words: ['dig'] }])
})

test('batch comparative and superlative forms render correct exchanges', async () => {
  const cases = [
    { word: 'good', comparative: ['better'], superlative: ['best'] },
    { word: 'bad', comparative: ['worse', 'badder'], superlative: ['worst', 'baddest'] },
    { word: 'well', comparative: ['better'], superlative: ['best'] },
  ]
  for (const { word, comparative, superlative } of cases) {
    const result = await runTranslate(word)
    const exchangeMap = new Map(result.toDict.exchanges.map((item) => [item.name, item.words]))
    const compWords = exchangeMap.get('比较级') || []
    const supWords = exchangeMap.get('最高级') || []
    for (const form of comparative) {
      assert.ok(compWords.includes(form), `${word} comparative should include ${form}`)
    }
    for (const form of superlative) {
      assert.ok(supWords.includes(form), `${word} superlative should include ${form}`)
    }
  }
})

test('batch protected homographs render cross-references at runtime', async () => {
  const cases = [
    { word: 'found', xref: 'find' },
    { word: 'left', xref: 'leave' },
  ]
  for (const { word, xref } of cases) {
    const result = await runTranslate(word)
    const exchanges = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
    assert.ok(exchanges.includes(`原形:${xref}`), `${word} should show cross-reference to ${xref}, got: ${JSON.stringify(result.toDict.exchanges)}`)
  }
})

test('batch homographs with multiple POS render all parts at runtime', async () => {
  const cases = [
    { word: 'spring', expectedParts: ['n.', 'v.'] },
    { word: 'light', expectedParts: ['n.', 'v.', 'adj.'] },
    { word: 'match', expectedParts: ['n.', 'v.'] },
    { word: 'object', expectedParts: ['n.', 'v.'] },
    { word: 'present', expectedParts: ['n.', 'v.', 'adj.'] },
    { word: 'record', expectedParts: ['n.', 'v.'] },
    { word: 'address', expectedParts: ['n.', 'v.'] },
  ]
  for (const { word, expectedParts } of cases) {
    const result = await runTranslate(word)
    const partNames = result.toDict.parts.map((p) => p.part)
    for (const part of expectedParts) {
      assert.ok(partNames.includes(part), `${word} should have ${part} part, got: ${partNames}`)
    }
  }
})
