const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const esbuild = require('esbuild')

const ENTRY_TS_PATH = path.join(__dirname, '..', 'src', 'entry.ts')

function loadShard(char) {
  const dictPath = path.join(__dirname, '..', 'dict', `${char}.json`)
  return JSON.parse(fs.readFileSync(dictPath, 'utf8'))
}

function createFileBridge(overrides = {}) {
  return {
    read(relativePath) {
      const override = overrides[relativePath]
      if (override != null) {
        return {
          toUTF8() {
            return override
          },
        }
      }

      const fullPath = path.join(__dirname, '..', relativePath)
      if (!fs.existsSync(fullPath)) return null

      return {
        toUTF8() {
          return fs.readFileSync(fullPath, 'utf8')
        },
      }
    },
  }
}

async function loadRuntime(overrides = {}) {
  const buildResult = await esbuild.build({
    entryPoints: [ENTRY_TS_PATH],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    treeShaking: false,
    external: ['@bob-plug/core'],
  })
  const source = buildResult.outputFiles[0].text
  const context = {
    $file: createFileBridge(overrides),
    module: { exports: {} },
    exports: {},
    require,
    console,
    Map,
    Set,
    JSON,
  }

  vm.runInNewContext(`${source}\nmodule.exports = { translate, supportLanguages };`, context, {
    filename: ENTRY_TS_PATH,
  })

  return context.module.exports
}

async function runTranslate(word, overrides = {}) {
  const runtime = await loadRuntime(overrides)

  return new Promise((resolve, reject) => {
    runtime.translate({ text: word, detectFrom: 'en' }, (payload) => {
      if (payload.error) {
        reject(new Error(`translate failed for ${word}: ${payload.error.type}`))
        return
      }

      resolve(payload.result)
    })
  })
}

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
  assert.deepEqual(JSON.parse(JSON.stringify(happier.toDict.exchanges)), [{ name: '原形', words: ['happy'] }])
  assert.deepEqual(JSON.parse(JSON.stringify(happiest.toDict.exchanges)), [{ name: '原形', words: ['happy'] }])

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

  const nounParts = parts.filter((part) => part.part === 'n.')
  assert.equal(nounParts.length, 1, `leaves should merge noun parts, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(nounParts[0]?.means || [], [
    '叶,叶片；有…状叶的；(纸)页；薄金属片；活动桌板\n[leaf 的复数]',
    '假期,休假；准许\n[leave 的复数]',
  ])

  const verbParts = parts.filter((part) => part.part === 'v.')
  assert.equal(verbParts.length, 1, `leaves should merge verb parts, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(verbParts[0]?.means || [], [
    '离开(某人或某处),离开居住地点(或群体、工作单位等)；遗弃；忘了带；使保留；留下备用(或销售等)；使发生；发布；不立刻做；把…留交；(去世时)遗赠；(死后)留下(家人)；剩余\n[leave 的 第三人称单数]',
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
    'dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
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
    'dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
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
    'dict/o.json': JSON.stringify(modifiedShard),
  })

  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
    { part: 'v.', means: ['(尤指经努力)获得,赢得；(规则、制度、习俗等)流行'] },
  ])
})

test('scripts aggregates countable noun plural senses and verb third-person senses', async () => {
  const result = await runTranslate('scripts')
  const parts = JSON.parse(JSON.stringify(result.toDict.parts))

  const nounPart = parts.find((part) => part.part === 'n.')
  assert.ok(nounPart, `scripts should include noun meanings, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(nounPart.means, [
    '剧本,电影剧本；(一种语言的)字母系统；笔试答卷；脚本(程序)(计算机的一系列指令)\n[script 的复数]',
  ])
  assert.ok(!nounPart.means[0].includes('笔迹'), `scripts plural noun should exclude uncountable sense, got: ${nounPart.means[0]}`)

  const verbPart = parts.find((part) => part.part === 'v.')
  assert.ok(verbPart, `scripts should include verb meanings, got: ${JSON.stringify(parts)}`)
  assert.deepEqual(verbPart.means, ['为(电影或戏剧等)写剧本\n[script 的 第三人称单数]'])

  const exchangeRows = result.toDict.exchanges.map((item) => `${item.name}:${item.words.join(',')}`)
  assert.equal(exchangeRows.filter((row) => row === '原形:script').length, 1, `scripts should show one root exchange, got: ${JSON.stringify(result.toDict.exchanges)}`)
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
