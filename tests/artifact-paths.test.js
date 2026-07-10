const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const artifactPaths = require("../scripts/artifact_paths");

const ENV_KEYS = [
  "OALD_OUTPUT_ROOT",
  "OALD_DICT_DIR",
  "OALD_MANIFEST_PATH",
  "OALD_ECDICT_DIR",
  "OALD_ROOTS_DIR",
];

function withTemporaryOutput(run) {
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oald-artifacts-"));
  process.env.OALD_OUTPUT_ROOT = outputRoot;

  try {
    run(outputRoot);
  } finally {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

test("explicit artifact paths override discovered pack paths", () => {
  withTemporaryOutput((outputRoot) => {
    const overrides = {
      OALD_DICT_DIR: path.join(outputRoot, "custom-dict"),
      OALD_MANIFEST_PATH: path.join(outputRoot, "custom-manifest.json"),
      OALD_ECDICT_DIR: path.join(outputRoot, "custom-ecdict"),
      OALD_ROOTS_DIR: path.join(outputRoot, "custom-roots"),
    };
    Object.assign(process.env, overrides);

    assert.equal(artifactPaths.resolveDictDir(), overrides.OALD_DICT_DIR);
    assert.equal(artifactPaths.resolveManifestPath(), overrides.OALD_MANIFEST_PATH);
    assert.equal(artifactPaths.resolveEcdictDir(), overrides.OALD_ECDICT_DIR);
    assert.equal(artifactPaths.resolveRootsDir(), overrides.OALD_ROOTS_DIR);
  });
});

test("generated pack layout takes precedence over legacy output", () => {
  withTemporaryOutput((outputRoot) => {
    const packRoot = path.join(outputRoot, "packs", "oald", "2024.09");
    const packDict = path.join(packRoot, "dict");
    const legacyDict = path.join(outputRoot, "dict");
    fs.mkdirSync(packDict, { recursive: true });
    fs.mkdirSync(legacyDict, { recursive: true });
    fs.writeFileSync(path.join(packRoot, "manifest.json"), "{}");
    fs.writeFileSync(path.join(outputRoot, "manifest.json"), "{}");

    assert.equal(artifactPaths.resolveDictDir(), packDict);
    assert.equal(artifactPaths.resolveManifestPath(), path.join(packRoot, "manifest.json"));
  });
});

test("legacy output remains readable while migration is active", () => {
  withTemporaryOutput((outputRoot) => {
    const legacyDict = path.join(outputRoot, "dict");
    const legacyManifest = path.join(outputRoot, "manifest.json");
    fs.mkdirSync(legacyDict, { recursive: true });
    fs.writeFileSync(legacyManifest, "{}");

    assert.equal(artifactPaths.resolveDictDir(), legacyDict);
    assert.equal(artifactPaths.resolveManifestPath(), legacyManifest);
  });
});

test("missing artifacts resolve to the generated pack target", () => {
  withTemporaryOutput((outputRoot) => {
    const packRoot = path.join(outputRoot, "packs", "oald", "2024.09");

    assert.equal(artifactPaths.resolveDictDir(), path.join(packRoot, "dict"));
    assert.equal(artifactPaths.resolveManifestPath(), path.join(packRoot, "manifest.json"));
  });
});
