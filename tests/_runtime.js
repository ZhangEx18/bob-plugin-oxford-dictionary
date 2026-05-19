const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const esbuild = require('esbuild')

const ENTRY_TS_PATH = path.join(__dirname, '..', 'src', 'entry.ts')

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

async function runTranslate(word, options = {}) {
  // Compatibility: translate-runtime.test.js passes overrides directly;
  // edge-cases.test.js passes { detectFrom, overrides }
  const isDirectOverrides = options != null && Object.keys(options).some(k => k.startsWith('dict/'))
  const detectFrom = isDirectOverrides ? 'en' : (options?.detectFrom || 'en')
  const overrides = isDirectOverrides ? options : (options?.overrides || {})
  const runtime = await loadRuntime(overrides)

  return new Promise((resolve, reject) => {
    runtime.translate({ text: word, detectFrom }, (payload) => {
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
