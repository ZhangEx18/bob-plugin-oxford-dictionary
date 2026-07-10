const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const LEGACY_DICT_DIR = path.join(PROJECT_ROOT, "dict");
const DEFAULT_BUILD_ROOT = path.join(PROJECT_ROOT, ".cache", "oald-build");
const DEFAULT_OUTPUT_ROOT = path.join(DEFAULT_BUILD_ROOT, "output");
const DEFAULT_DICT_DIR = path.join(DEFAULT_OUTPUT_ROOT, "dict");
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_OUTPUT_ROOT, "manifest.json");
const DEFAULT_ECDICT_DIR = path.join(DEFAULT_OUTPUT_ROOT, "ecdict");
const DEFAULT_ROOTS_DIR = path.join(DEFAULT_OUTPUT_ROOT, "roots");
const DEFAULT_DATA_PACK_ROOT = path.join(PROJECT_ROOT, "data", "packs");
const DEFAULT_OALD_PACK_ROOT = path.join(DEFAULT_DATA_PACK_ROOT, "oald", "2024.09");
const DEFAULT_ECDICT_PACK_ROOT = path.join(DEFAULT_DATA_PACK_ROOT, "ecdict", "latest");
const DEFAULT_ROOTS_PACK_ROOT = path.join(DEFAULT_DATA_PACK_ROOT, "roots", "latest");

function firstExistingPath(candidates, fallback) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || fallback;
}

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

function usesCustomBuildRoot() {
  return Boolean(process.env.OALD_BUILD_ROOT || process.env.OALD_OUTPUT_ROOT);
}

function resolveDictDir() {
  if (process.env.OALD_DICT_DIR) {
    return path.resolve(process.env.OALD_DICT_DIR);
  }

  const externalPackDir = path.join(DEFAULT_OALD_PACK_ROOT, "dict");
  const generatedPackDir = path.join(resolveOutputRoot(), "packs", "oald", "2024.09", "dict");
  const legacyGeneratedDir = path.join(resolveOutputRoot(), "dict");
  const compatiblePaths = usesCustomBuildRoot()
    ? [externalPackDir, generatedPackDir, legacyGeneratedDir]
    : [externalPackDir, generatedPackDir, legacyGeneratedDir, LEGACY_DICT_DIR];
  return firstExistingPath(
    compatiblePaths,
    generatedPackDir,
  );
}

function resolveManifestPath() {
  if (process.env.OALD_MANIFEST_PATH) {
    return path.resolve(process.env.OALD_MANIFEST_PATH);
  }
  const externalManifestPath = path.join(DEFAULT_OALD_PACK_ROOT, "manifest.json");
  const generatedManifestPath = path.join(resolveOutputRoot(), "packs", "oald", "2024.09", "manifest.json");
  const legacyManifestPath = path.join(resolveOutputRoot(), "manifest.json");
  return firstExistingPath(
    [externalManifestPath, generatedManifestPath, legacyManifestPath],
    generatedManifestPath,
  );
}

function resolveEcdictDir() {
  if (process.env.OALD_ECDICT_DIR) {
    return path.resolve(process.env.OALD_ECDICT_DIR);
  }
  const externalPackDir = path.join(DEFAULT_ECDICT_PACK_ROOT, "dict");
  const generatedPackDir = path.join(resolveOutputRoot(), "packs", "ecdict", "latest", "dict");
  const legacyGeneratedDir = path.join(resolveOutputRoot(), "ecdict");
  return firstExistingPath(
    [externalPackDir, generatedPackDir, legacyGeneratedDir],
    generatedPackDir,
  );
}

function resolveRootsDir() {
  if (process.env.OALD_ROOTS_DIR) {
    return path.resolve(process.env.OALD_ROOTS_DIR);
  }
  const externalPackDir = path.join(DEFAULT_ROOTS_PACK_ROOT, "words");
  const generatedPackDir = path.join(resolveOutputRoot(), "packs", "roots", "latest", "words");
  const legacyGeneratedDir = path.join(resolveOutputRoot(), "roots");
  return firstExistingPath(
    [externalPackDir, generatedPackDir, legacyGeneratedDir],
    generatedPackDir,
  );
}

module.exports = {
  PROJECT_ROOT,
  LEGACY_DICT_DIR,
  DEFAULT_BUILD_ROOT,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_DICT_DIR,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_ECDICT_DIR,
  DEFAULT_ROOTS_DIR,
  DEFAULT_DATA_PACK_ROOT,
  DEFAULT_OALD_PACK_ROOT,
  DEFAULT_ECDICT_PACK_ROOT,
  DEFAULT_ROOTS_PACK_ROOT,
  resolveBuildRoot,
  resolveOutputRoot,
  resolveDictDir,
  resolveManifestPath,
  resolveEcdictDir,
  resolveRootsDir,
};
