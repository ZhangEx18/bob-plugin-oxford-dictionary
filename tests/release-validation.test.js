const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateSourcePack } = require("../scripts/release_validation");

function createOaldPack(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oald-release-pack-"));
  const shardDir = path.join(root, "dict");
  const manifestPath = path.join(root, "manifest.json");
  fs.mkdirSync(shardDir);
  fs.writeFileSync(path.join(shardDir, "t.json"), JSON.stringify({ track: { word: "track" } }));
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: "2.0.0",
    dataVersion: "oald-2024.09",
    packType: "oald",
    pipelineVersion: "6.1.0",
    generatedAt: "2026-07-10T00:00:00.000Z",
    entryCount: 1,
    shardCount: 1,
    counts: { standalone: 1 },
    danglingNavigableTargets: 0,
    syntheticRelationCount: 0,
    wordFamilyMissingCount: 0,
    verbFormMissingCount: 0,
    layout: { shardSubdir: "dict", shardExtension: ".json" },
    files: [{ name: "t.json" }],
    ...overrides,
  }));
  return { root, shardDir, manifestPath };
}

test("release gate accepts a complete OALD pack", () => {
  const pack = createOaldPack();
  try {
    const result = validateSourcePack({
      manifestPath: pack.manifestPath,
      shardDir: pack.shardDir,
      packType: "oald",
      shardSubdir: "dict",
    });
    assert.deepEqual(result.files, ["t.json"]);
  } finally {
    fs.rmSync(pack.root, { recursive: true, force: true });
  }
});

test("release gate rejects a manifest for the wrong pack type", () => {
  const pack = createOaldPack({ packType: "roots" });
  try {
    assert.throws(() => validateSourcePack({
      manifestPath: pack.manifestPath,
      shardDir: pack.shardDir,
      packType: "oald",
      shardSubdir: "dict",
    }), /packType is invalid/);
  } finally {
    fs.rmSync(pack.root, { recursive: true, force: true });
  }
});

test("release gate rejects a manifest whose declared shard is missing", () => {
  const pack = createOaldPack();
  fs.rmSync(path.join(pack.shardDir, "t.json"));
  try {
    assert.throws(() => validateSourcePack({
      manifestPath: pack.manifestPath,
      shardDir: pack.shardDir,
      packType: "oald",
      shardSubdir: "dict",
    }), /shard is missing: t\.json/);
  } finally {
    fs.rmSync(pack.root, { recursive: true, force: true });
  }
});
