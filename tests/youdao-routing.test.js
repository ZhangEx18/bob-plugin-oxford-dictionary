const test = require('node:test')
const assert = require('node:assert/strict')
const { runTranslate, loadRuntime } = require('./_runtime')

// ---------------------------------------------------------------------------
// Youdao regression safety net.
//
// Youdao is the last resort for every query the offline dictionaries cannot
// answer. These tests lock the routing and the request/response contract so
// refactors of the offline path cannot silently steal or break it.
//
// They deliberately do NOT need the private OALD shards: when no shard is
// readable the runtime misses offline and must fall through to Youdao, which is
// exactly the path under test. That keeps this file runnable in CI.
//
// runTranslate treats a top-level `$httpMocks` key as direct overrides and then
// forces detectFrom to "en". Always pass mocks nested under `overrides`.
// ---------------------------------------------------------------------------

const YOUDAO_DICT_URL = 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4'
const YOUDAO_TRANS_URL = 'https://aidemo.youdao.com/trans'

function dictPayload(word, overrides = {}) {
  return {
    ec: {
      word: {
        ukphone: '[/test/]',
        usphone: '/test/',
        trs: [{ pos: 'v.', tran: `${word} 的释义` }],
        wfs: [],
      },
    },
    ...overrides,
  }
}

// Records every request the runtime makes so tests can assert what Youdao saw.
function recordingMock(url, respond) {
  const calls = []
  return {
    method: 'POST',
    url,
    calls,
    response(options) {
      calls.push({ url: options.url, body: options.body })
      return respond(options, calls.length - 1)
    },
  }
}

const okTranslation = (text) => ({ errorCode: '0', translation: [text] })

function query(text, mocks, options = {}) {
  return runTranslate(text, { ...options, overrides: { $httpMocks: mocks } })
}

// ---------------------------------------------------------------------------
// Translation route (sentences, multi-word, non-English)
// ---------------------------------------------------------------------------

test('sentence goes to Youdao translation with en -> zh-CHS', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('这是一个句子。'))
  const result = await query('This is a sentence.', [mock])

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['这是一个句子。'])
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].body.from, 'en')
  assert.equal(mock.calls[0].body.to, 'zh-CHS')
})

test('multi-word query goes to Youdao translation, not the offline path', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('你好，世界'))
  const result = await query('hello world', [mock])

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['你好，世界'])
})

test('non-English token goes to Youdao translation with mapped languages', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('hello'))
  const result = await query('你好', [mock], { detectFrom: 'zh-Hans', detectTo: 'en' })

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['hello'])
  assert.equal(mock.calls[0].body.from, 'zh-CHS')
  assert.equal(mock.calls[0].body.to, 'en')
})

// ---------------------------------------------------------------------------
// Dictionary route and its degradation into translation
// ---------------------------------------------------------------------------

test('offline miss falls back to Youdao dictionary', async () => {
  const mock = recordingMock(YOUDAO_DICT_URL, () => dictPayload('zzznotindict'))
  const result = await query('zzznotindict', [mock])

  assert.equal(result.raw.provider, 'youdao-dict')
  assert.equal(result.toDict.word, 'zzznotindict')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toDict.parts)), [
    { part: 'v.', means: ['zzznotindict 的释义'] },
  ])
})

test('Youdao dictionary miss degrades to Youdao translation for a single word', async () => {
  const dictMock = recordingMock(YOUDAO_DICT_URL, () => ({}))
  const transMock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('降级译文'))
  const result = await query('zzznotindict', [dictMock, transMock])

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['降级译文'])
  assert.equal(dictMock.calls.length, 1, 'dictionary route must be tried first')
  assert.equal(transMock.calls.length, 1, 'translation route must be the fallback')
})

// ---------------------------------------------------------------------------
// Failure handling must stay distinguishable
// ---------------------------------------------------------------------------

test('Youdao non-zero errorCode surfaces as notFound', async () => {
  const dictMock = recordingMock(YOUDAO_DICT_URL, () => ({}))
  const transMock = recordingMock(YOUDAO_TRANS_URL, () => ({ errorCode: '1', translation: [] }))

  await assert.rejects(
    () => query('zzznotindict', [dictMock, transMock]),
    (err) => err.errorType === 'notFound',
  )
})

test('contraction-shaped token missing from the dictionary still reaches Youdao', async () => {
  // Relaxing the word-query character class must not strand queries: a token
  // with an apostrophe that the offline data does not have still needs the
  // dictionary-then-translation fallback.
  const dictMock = recordingMock(YOUDAO_DICT_URL, () => ({}))
  const transMock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('兜底译文'))
  const result = await query("zzzdon'ttest", [dictMock, transMock])

  assert.equal(result.raw.provider, 'youdao-translate')
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['兜底译文'])
  assert.equal(dictMock.calls.length, 1, 'dictionary route must still be tried first')
})

// The live endpoint reports a successful call with the string "0" but the
// rate-limit code as the number 411. Both spellings are exercised so a fix that
// only handles one of them cannot pass, which is how the first version of this
// retry shipped broken while its test was green.
const RATE_LIMITED_RESPONSES = [
  { label: 'number', body: { errorCode: 411, msg: '请求频率过快' } },
  { label: 'string', body: { errorCode: '411', msg: '请求频率过快' } },
]

for (const { label, body } of RATE_LIMITED_RESPONSES) {
  test(`a refused request (errorCode as ${label}) is sent once more`, async () => {
    const calls = []
    let refusedOnce = false
    const mock = {
      method: 'POST',
      url: YOUDAO_TRANS_URL,
      response() {
        calls.push(calls.length)
        if (!refusedOnce) {
          refusedOnce = true
          return body
        }
        return okTranslation('重试后成功')
      },
    }

    const result = await query('hello world', [mock])
    assert.equal(result.raw.provider, 'youdao-translate')
    assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), ['重试后成功'])
    assert.equal(calls.length, 2, 'the refused request must be sent again')
  })
}

test('a refused request waits a full window before retrying', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => ({ errorCode: 411 }))
  const runtime = await loadRuntime({ $httpMocks: [mock] })

  await new Promise((resolve) => {
    runtime.translate({ text: 'hello world', detectFrom: 'en', detectTo: 'zh-Hans' }, resolve)
  })

  // One wait for the refusal window; retrying sooner only burns quota, because
  // a refused request still counts against the budget.
  assert.ok(
    runtime.__pendingTimers.includes(30),
    `expected a 30s wait, got ${JSON.stringify(runtime.__pendingTimers)}`,
  )
  assert.equal(mock.calls.length, 2, 'one retry, not an unbounded loop')
})

test('long text paces its requests instead of exhausting the endpoint budget', async () => {
  // The endpoint serves six requests then refuses for ~30s, and a single
  // request is capped near 1,000 characters, so segments past the sixth must
  // wait. Without pacing a ~10k character text failed outright.
  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(240).trim()
  const mock = recordingMock(YOUDAO_TRANS_URL, (_options, index) => okTranslation(`第${index + 1}段`))
  const runtime = await loadRuntime({ $httpMocks: [mock] })

  const result = await new Promise((resolve) => {
    runtime.translate({ text, detectFrom: 'en', detectTo: 'zh-Hans' }, resolve)
  })

  assert.equal(result.error, undefined, `expected success, got ${JSON.stringify(result.error)}`)
  assert.ok(mock.calls.length > 6, `expected more than 6 segments, got ${mock.calls.length}`)
  assert.ok(
    runtime.__pendingTimers.length > 0,
    'requests past the burst budget must wait for a slot',
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.result.toParagraphs)),
    mock.calls.map((_call, index) => `第${index + 1}段`),
  )
})

test('transport failure surfaces as network, not notFound', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => {
    throw new Error('socket hang up')
  })

  await assert.rejects(
    () => query('hello world', [mock]),
    (err) => err.errorType === 'network',
  )
})

// ---------------------------------------------------------------------------
// Long text: segmentation must preserve order and stay all-or-nothing
// ---------------------------------------------------------------------------

test('long text is split into ordered segments and reassembled', async () => {
  const sentence = 'The quick brown fox jumps over the lazy dog. '
  const longText = sentence.repeat(30).trim()
  assert.ok(longText.length > 900, 'fixture must exceed the 900 char segment limit')

  const mock = recordingMock(YOUDAO_TRANS_URL, (_options, index) => okTranslation(`第${index + 1}段`))
  const result = await query(longText, [mock])

  assert.ok(mock.calls.length > 1, `expected multiple segments, got ${mock.calls.length}`)
  const expected = mock.calls.map((_call, index) => `第${index + 1}段`)
  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), expected)
  for (const call of mock.calls) {
    assert.ok(call.body.q.length <= 900, `segment exceeded limit: ${call.body.q.length}`)
  }
})

test('a single failing segment fails the whole translation', async () => {
  const sentence = 'The quick brown fox jumps over the lazy dog. '
  const longText = sentence.repeat(30).trim()

  const mock = recordingMock(YOUDAO_TRANS_URL, (_options, index) => (
    index === 1 ? { errorCode: '1', translation: [] } : okTranslation(`第${index + 1}段`)
  ))

  await assert.rejects(
    () => query(longText, [mock]),
    (err) => err.errorType === 'notFound',
  )
})

// ---------------------------------------------------------------------------
// Chinese output normalization must not damage non-Chinese output
// ---------------------------------------------------------------------------

test('Chinese target normalizes punctuation', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('他说 : hello , world !'))
  const result = await query('hello world', [mock], { detectTo: 'zh-Hans' })

  const [paragraph] = result.toParagraphs
  assert.ok(paragraph.includes('！'), `expected fullwidth bang: ${paragraph}`)
  assert.ok(paragraph.includes('，'), `expected fullwidth comma: ${paragraph}`)
  assert.ok(!/ !$/.test(paragraph), `trailing space before fullwidth bang: ${paragraph}`)
})

test('Chinese target converts double quotes without doubling them', async () => {
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation('他说 "hi" 很大声'))
  const result = await query('hello world', [mock], { detectTo: 'zh-Hans' })

  const [paragraph] = result.toParagraphs
  assert.ok(paragraph.includes('”'), `expected curly double quote: ${paragraph}`)
  assert.ok(!paragraph.includes('"'), `ascii double quote should not survive: ${paragraph}`)
  assert.ok(!paragraph.includes('””'), `quote must not be duplicated: ${paragraph}`)
})

test('non-Chinese target keeps the raw translation untouched', async () => {
  const raw = 'He said, "hello" ; done !'
  const mock = recordingMock(YOUDAO_TRANS_URL, () => okTranslation(raw))
  const result = await query('hello world', [mock], { detectTo: 'en' })

  assert.deepEqual(JSON.parse(JSON.stringify(result.toParagraphs)), [raw])
})
