const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const LEGACY_DICT_DIR = path.join(PROJECT_ROOT, "dict");
const DEFAULT_BUILD_ROOT = path.join(PROJECT_ROOT, ".cache", "oald-build");
const DEFAULT_OUTPUT_ROOT = path.join(DEFAULT_BUILD_ROOT, "output");
const DEFAULT_DICT_DIR = path.join(DEFAULT_OUTPUT_ROOT, "dict");
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_OUTPUT_ROOT, "manifest.json");
const DEFAULT_ECDICT_DIR = path.join(DEFAULT_OUTPUT_ROOT, "ecdict");

function resolveBuildRoot() {
  return process.env.OALD_BUILD_ROOT
    ? path.resolve(process.env.OALD_BUILD_ROOT)
    : DEFAULT_BUILD_ROOT;
}

function resolveOutputRoot() {
  return process.env.OALD_OUTPUT_ROOT
    ? path.resolve(process.env.OALD_OUTPUT_ROOT)
    : path.join(resolveBuildRoot(), "output");
}

function resolveDictDir() {
  if (process.env.OALD_DICT_DIR) {
    return path.resolve(process.env.OALD_DICT_DIR);
  }

  const generatedDir = path.join(resolveOutputRoot(), "dict");
  if (fs.existsSync(generatedDir)) {
    return generatedDir;
  }
  return LEGACY_DICT_DIR;
}

function resolveManifestPath() {
  if (process.env.OALD_MANIFEST_PATH) {
    return path.resolve(process.env.OALD_MANIFEST_PATH);
  }
  return path.join(resolveOutputRoot(), "manifest.json");
}

function resolveEcdictDir() {
  if (process.env.OALD_ECDICT_DIR) {
    return path.resolve(process.env.OALD_ECDICT_DIR);
  }
  const generatedDir = path.join(resolveOutputRoot(), "ecdict");
  if (fs.existsSync(generatedDir)) {
    return generatedDir;
  }
  return DEFAULT_ECDICT_DIR;
}

module.exports = {
  PROJECT_ROOT,
  LEGACY_DICT_DIR,
  DEFAULT_BUILD_ROOT,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_DICT_DIR,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_ECDICT_DIR,
  resolveBuildRoot,
  resolveOutputRoot,
  resolveDictDir,
  resolveManifestPath,
  resolveEcdictDir,
};
