const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const esbuild = require("esbuild");

const moduleCache = new Map();
const SOURCE_ROOT = path.join(__dirname, "..", "apps", "bob-plugin", "src");

function createFileBridge() {
  return {
    read(relativePath) {
      if (relativePath === "packs/oald/2024.09/manifest.json") {
        return {
          toUTF8() {
            return JSON.stringify({
              schemaVersion: "1.0.0",
              dataVersion: "test",
              packType: "oald",
              shardCount: 1,
              entryCount: 1,
              layout: { shardSubdir: "dict", shardExtension: ".json" },
            });
          },
        };
      }

      if (relativePath.startsWith("packs/oald/2024.09/dict/")) {
        const fallbackPath = relativePath.replace("packs/oald/2024.09/", "");
        const fullFallbackPath = path.join(__dirname, "..", fallbackPath);
        if (fs.existsSync(fullFallbackPath)) {
          return {
            toUTF8() {
              return fs.readFileSync(fullFallbackPath, "utf8");
            },
          };
        }
      }

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
  };
}

async function loadModule(modulePath) {
  const fullPath = path.join(SOURCE_ROOT, modulePath);
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
