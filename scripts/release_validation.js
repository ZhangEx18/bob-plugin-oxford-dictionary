const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

const OALD_QUALITY_FIELDS = [
  "danglingNavigableTargets",
  "syntheticRelationCount",
  "wordFamilyMissingCount",
  "verbFormMissingCount",
];

function validateCoreManifest(manifest, packType, shardSubdir) {
  invariant(manifest && typeof manifest === "object", `${packType} manifest must be an object`);
  invariant(typeof manifest.schemaVersion === "string" && manifest.schemaVersion, `${packType} schemaVersion is required`);
  invariant(typeof manifest.dataVersion === "string" && manifest.dataVersion, `${packType} dataVersion is required`);
  invariant(manifest.packType === packType, `${packType} packType is invalid`);
  invariant(!Number.isNaN(Date.parse(manifest.generatedAt)), `${packType} generatedAt is invalid`);
  invariant(Number.isInteger(manifest.entryCount) && manifest.entryCount > 0, `${packType} entryCount must be positive`);
  invariant(Number.isInteger(manifest.shardCount) && manifest.shardCount > 0, `${packType} shardCount must be positive`);
  invariant(manifest.layout?.shardSubdir === shardSubdir, `${packType} shardSubdir must be ${shardSubdir}`);
  invariant(manifest.layout?.shardExtension === ".json", `${packType} shardExtension must be .json`);
  invariant(Array.isArray(manifest.files) && manifest.files.length > 0, `${packType} files are required`);
  invariant(manifest.files.length === manifest.shardCount, `${packType} files must match shardCount`);
}

function validateManifestFiles(manifest, packType) {
  const names = new Set();
  for (const declaration of manifest.files) {
    invariant(declaration && typeof declaration.name === "string", `${packType} file name is required`);
    invariant(path.basename(declaration.name) === declaration.name, `${packType} file name must not contain a path`);
    invariant(declaration.name.endsWith(".json"), `${packType} file must be JSON: ${declaration.name}`);
    invariant(!names.has(declaration.name), `${packType} file is duplicated: ${declaration.name}`);
    names.add(declaration.name);
  }
  return [...names];
}

function validateOaldQuality(manifest) {
  invariant(typeof manifest.pipelineVersion === "string" && manifest.pipelineVersion, "oald pipelineVersion is required");
  invariant(manifest.counts && typeof manifest.counts === "object", "oald counts are required");
  for (const field of OALD_QUALITY_FIELDS) {
    invariant(Number.isInteger(manifest[field]) && manifest[field] >= 0, `oald ${field} must be non-negative`);
  }
  invariant(manifest.danglingNavigableTargets === 0, "oald danglingNavigableTargets must be 0");
}

function validateManifest(manifest, packType, shardSubdir) {
  validateCoreManifest(manifest, packType, shardSubdir);
  const files = validateManifestFiles(manifest, packType);
  if (packType === "oald") validateOaldQuality(manifest);
  return files;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function validateShardBytes(declaration, shardBytes, label) {
  if (declaration.size !== undefined) {
    invariant(declaration.size === shardBytes.length, `${label} size is invalid`);
  }
  if (declaration.sha256 !== undefined) {
    invariant(declaration.sha256 === sha256(shardBytes), `${label} sha256 is invalid`);
  }
}

function validateSourcePack({ manifestPath, shardDir, packType, shardSubdir }) {
  invariant(fs.existsSync(manifestPath), `${packType} manifest is missing: ${manifestPath}`);
  invariant(fs.existsSync(shardDir), `${packType} shard directory is missing: ${shardDir}`);

  const expectedShardDir = path.resolve(path.dirname(manifestPath), shardSubdir);
  invariant(path.resolve(shardDir) === expectedShardDir, `${packType} manifest and shard directory do not belong to the same pack`);

  const manifest = parseJson(fs.readFileSync(manifestPath, "utf8"), `${packType} manifest`);
  const files = validateManifest(manifest, packType, shardSubdir);
  for (const file of files) {
    const shardPath = path.join(shardDir, file);
    invariant(fs.existsSync(shardPath), `${packType} shard is missing: ${file}`);
    const declaration = manifest.files.find((item) => item.name === file);
    validateShardBytes(declaration, fs.readFileSync(shardPath), `${packType} shard ${file}`);
  }
  return { manifest, files };
}

function readZipJson(zip, entryName) {
  const entry = zip.getEntry(entryName);
  invariant(entry, `release entry is missing: ${entryName}`);
  return parseJson(entry.getData().toString("utf8"), entryName);
}

function validateZipPack(zip, rootDir, packType, shardSubdir) {
  const manifest = readZipJson(zip, `${rootDir}/manifest.json`);
  const files = validateManifest(manifest, packType, shardSubdir);
  for (const file of files) {
    const entry = zip.getEntry(`${rootDir}/${shardSubdir}/${file}`);
    invariant(entry, `release ${packType} shard is missing: ${file}`);
    const declaration = manifest.files.find((item) => item.name === file);
    validateShardBytes(declaration, entry.getData(), `release ${packType} shard ${file}`);
  }
  return manifest;
}

function hasTrackDown(entry) {
  return Array.isArray(entry?.phrasal_verbs)
    && entry.phrasal_verbs.some((item) => item?.name === "track down");
}

function verifyReleaseArtifact(artifactPath, expectedVersion) {
  const expectedName = `bob-plugin-oald-dictionary${expectedVersion}.bobplugin`;
  invariant(path.basename(artifactPath) === expectedName, `release filename must be ${expectedName}`);
  invariant(fs.existsSync(artifactPath), `release artifact is missing: ${artifactPath}`);

  const zip = new AdmZip(artifactPath);
  const info = readZipJson(zip, "info.json");
  invariant(info.version === expectedVersion, `info.json version must be ${expectedVersion}`);
  invariant(zip.getEntry("main.js"), "release main.js is missing");
  invariant(zip.getEntry("icon.png"), "release icon.png is missing");

  validateZipPack(zip, "packs/oald/2024.09", "oald", "dict");
  validateZipPack(zip, "packs/roots/latest", "roots", "words");
  if (zip.getEntry("packs/roots-csv/latest/manifest.json")) {
    validateZipPack(zip, "packs/roots-csv/latest", "roots", "words");
  }

  const trackShard = readZipJson(zip, "packs/oald/2024.09/dict/t.json");
  invariant(hasTrackDown(trackShard.track), "standalone track must contain track down");
  for (const word of ["tracks", "tracked", "tracking"]) {
    invariant(trackShard[word] && typeof trackShard[word] === "object", `${word} entry is missing`);
    invariant(!hasTrackDown(trackShard[word]), `${word} must not contain track down`);
  }
}

module.exports = {
  validateManifest,
  validateSourcePack,
  verifyReleaseArtifact,
};
