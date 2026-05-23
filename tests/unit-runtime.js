const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const esbuild = require("esbuild");

const moduleCache = new Map();

async function loadModule(modulePath) {
  const fullPath = path.join(__dirname, "..", "src", modulePath);
  const cacheKey = fullPath;

  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey);
  }

  const buildResult = await esbuild.build({
    entryPoints: [fullPath],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    treeShaking: false,
    external: ["@bob-plug/core"],
  });

  const source = buildResult.outputFiles[0].text;
  const context = {
    $file: {
      read(relativePath) {
        const fullPath = path.join(__dirname, "..", relativePath);
        if (!fs.existsSync(fullPath)) {
          return null;
        }
        return {
          toUTF8() {
            return fs.readFileSync(fullPath, "utf8");
          },
        };
      },
    },
    module: { exports: {} },
    exports: {},
    require,
    console,
    Map,
    Set,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    global: {},
    Buffer,
    process: { env: {} },
  };

  vm.runInNewContext(`${source}\nmodule.exports = module.exports;`, context, {
    filename: fullPath,
  });

  const exports = context.module.exports;
  moduleCache.set(cacheKey, exports);
  return exports;
}

module.exports = { loadModule };
