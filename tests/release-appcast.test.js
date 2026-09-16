const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const INFO_PATH = path.join(ROOT_DIR, "apps/bob-plugin/info.json");
const PLUGIN_PACKAGE_PATH = path.join(ROOT_DIR, "apps/bob-plugin/package.json");
const APPCAST_PATH = path.join(ROOT_DIR, "appcast.json");

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const info = readJson(INFO_PATH);
const pluginPackage = readJson(PLUGIN_PACKAGE_PATH);
const appcast = readJson(APPCAST_PATH);

test("info.json version matches package.json version", () => {
  assert.equal(info.version, pluginPackage.version);
  assert.match(info.version, STABLE_VERSION);
});

test("info.json declares the appcast URL Bob needs for update detection", () => {
  assert.ok(info.identifier, "info.json must declare an identifier");
  assert.ok(info.appcast, "info.json must declare an appcast URL");
  assert.match(info.appcast, /^https:\/\/raw\.githubusercontent\.com\/.+\/appcast\.json$/);
});

test("appcast identifier matches info.json identifier", () => {
  assert.equal(appcast.identifier, info.identifier);
});

test("appcast versions are unique and ordered newest first", () => {
  const versions = appcast.versions.map((entry) => entry.version);
  assert.ok(versions.length > 0, "appcast must declare at least one version");
  assert.equal(new Set(versions).size, versions.length, "appcast versions must be unique");
  for (const version of versions) {
    assert.match(version, STABLE_VERSION);
  }

  const sorted = [...versions].sort((left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  });
  assert.deepEqual(versions, sorted);
});

test("every appcast entry is installable by Bob", () => {
  for (const entry of appcast.versions) {
    assert.match(entry.sha256, SHA256, `${entry.version} sha256`);
    assert.ok(entry.desc, `${entry.version} desc is required`);
    assert.equal(entry.minBobVersion, info.minBobVersion, `${entry.version} minBobVersion`);
    assert.match(
      entry.url,
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v\d+\.\d+\.\d+\/.+\.bobplugin$/,
      `${entry.version} url`,
    );
    assert.ok(
      entry.url.endsWith(`bob-plugin-oald-dictionary${entry.version}.bobplugin`),
      `${entry.version} url must point at the versioned artifact`,
    );
  }
});

test("appcast advertises a version at least as new as the source version", () => {
  const compare = (left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  };
  const latest = appcast.versions[0].version;
  assert.ok(
    compare(latest, info.version) >= 0,
    `latest appcast version ${latest} must not be older than source version ${info.version}`,
  );
});
