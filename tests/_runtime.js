const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const esbuild = require('esbuild')

const ENTRY_TS_PATH = path.join(__dirname, '..', 'src', 'index.ts')

let cachedRuntime = null

function createFileBridge(overrides = {}) {
  return {
    read(relativePath) {
      const override = overrides[relativePath]
      if (override != null) {
        return { toUTF8() { return override } }
      }
      const fullPath = path.join(__dirname, '..', relativePath)
      if (!fs.existsSync(fullPath)) return null
      return { toUTF8() { return fs.readFileSync(fullPath, 'utf8') } }
    },
  }
}

function createHttpBridge(httpMocks = []) {
  return {
    request(options) {
      const match = httpMocks.find((mock) => {
        if (mock.method && mock.method !== options.method) return false
        if (typeof mock.match === 'function') return mock.match(options)
        if (mock.url && mock.url !== options.url) return false
        return true
      })

      if (!match) {
        throw new Error(`No $http mock for ${options.method} ${options.url}`)
      }

      const payload = typeof match.response === 'function'
        ? match.response(options)
        : match.response

      options.handler({
        data: match.rawData !== undefined
          ? match.rawData
          : {
              toString() {
                return typeof payload === 'string' ? payload : JSON.stringify(payload)
              },
            },
        error: match.error,
        response: match.httpResponse,
      })
    },
  }
}

async function loadRuntime(overrides = {}) {
  if (!cachedRuntime) {
    const buildResult = await esbuild.build({
      entryPoints: [ENTRY_TS_PATH],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      treeShaking: false,
      external: ['@bob-plug/core'],
    })
    cachedRuntime = buildResult.outputFiles[0].text
  }

  const source = cachedRuntime
  const context = {
    $file: createFileBridge(overrides),
    $http: createHttpBridge(overrides.$httpMocks || []),
    module: { exports: {} },
    exports: {},
    require,
    console,
    Map,
    Set,
    JSON,
  }

  vm.runInNewContext(`${source}\nmodule.exports = { translate, supportLanguages, __relationsForTests: typeof __relationsForTests !== 'undefined' ? __relationsForTests : null };`, context, {
    filename: ENTRY_TS_PATH,
  })

  return context.module.exports
}

async function runTranslate(word, options = {}) {
  // Compatibility: translate-runtime.test.js passes overrides directly;
  // edge-cases.test.js passes { detectFrom, overrides }
  const isDirectOverrides = options != null && Object.keys(options).some((k) => k.startsWith('dict/') || k === '$httpMocks')
  const detectFrom = isDirectOverrides ? 'en' : (options?.detectFrom || 'en')
  const detectTo = isDirectOverrides ? 'zh-Hans' : (options?.detectTo || 'zh-Hans')
  const overrides = isDirectOverrides ? options : (options?.overrides || {})
  const runtime = await loadRuntime(overrides)

  return new Promise((resolve, reject) => {
    runtime.translate({ text: word, detectFrom, detectTo }, (payload) => {
      if (payload.error) {
        reject(Object.assign(new Error(`translate failed: ${payload.error.type}`), {
          errorType: payload.error.type,
          payload,
        }))
        return
      }
      resolve(payload.result)
    })
  })
}

module.exports = { loadRuntime, runTranslate }
