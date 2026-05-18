const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const esbuild = require('esbuild')

const ENTRY_TS_PATH = path.join(__dirname, '..', 'src', 'entry.ts')

function createFileBridge() {
  return {
    read(relativePath) {
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

async function loadRuntime() {
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
    $file: createFileBridge(),
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

async function runTranslate(word) {
  const runtime = await loadRuntime()

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
