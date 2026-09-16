const fs = require("fs");
const path = require("path");
const { resolveDictDir, resolveManifestPath, resolveEcdictDir } = require("../scripts/artifact_paths");

const SAFE_SHARD_CHAR = /^[a-z0-9]$/;

function getDictDir() {
  return resolveDictDir();
}

function getManifestPath() {
  return resolveManifestPath();
}

function readShardKeyLength() {
  try {
    const manifest = JSON.parse(fs.readFileSync(getManifestPath(), "utf8"));
    const declared = manifest.layout?.shardKeyLength;
    if (typeof declared === "number" && declared > 0) {
      return { length: Math.floor(declared), declared: true };
    }
  } catch {
    // fall through to the legacy layout
  }
  return { length: 1, declared: false };
}

// Mirrors data-loader.ts so tests locate the same files the runtime would.
function encodeShardChar(char) {
  if (SAFE_SHARD_CHAR.test(char)) return char;
  return `~${char.codePointAt(0).toString(16).toUpperCase().padStart(6, "0")}`;
}

function shardKeyForWord(word) {
  const normalized = String(word).normalize("NFC").toLowerCase();
  const { length, declared } = readShardKeyLength();
  if (!declared) {
    const firstChar = normalized[0] || "_";
    return firstChar === "ς" ? "σ" : firstChar;
  }

  const chars = Array.from(normalized);
  let key = "";
  for (let index = 0; index < length; index += 1) {
    const char = chars[index] || "_";
    key += encodeShardChar(char === "ς" ? "σ" : char);
  }
  return key;
}

/** Exact shard file for a shard key. */
function getShardPath(shardKey) {
  return path.join(getDictDir(), `${shardKey}.json`);
}

/**
 * Every shard file whose key belongs to `letter`'s group.
 *
 * A one-character shard used to hold every word starting with that letter; now
 * a letter spans many shard files, so tests that need "the d shard" must merge
 * them.
 */
function getShardPathsForLetter(letter) {
  const prefix = encodeShardChar((letter || "_").normalize("NFC").toLowerCase());
  const dir = getDictDir();
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name.startsWith(prefix))
    .map((name) => path.join(dir, name))
    .sort();
}

/** Raw entries of the single shard file that holds `word`. */
function loadWordShard(word) {
  return JSON.parse(fs.readFileSync(getShardPath(shardKeyForWord(word)), "utf8"));
}

/** Merged entries for every shard belonging to `letter`. */
function loadLetterShard(letter) {
  const merged = {};
  for (const shardPath of getShardPathsForLetter(letter)) {
    Object.assign(merged, JSON.parse(fs.readFileSync(shardPath, "utf8")));
  }
  return merged;
}

function getEcdictDir() {
  return resolveEcdictDir();
}

function getEcdictShardPath(char) {
  return path.join(getEcdictDir(), `${char}.json`);
}

module.exports = {
  getDictDir,
  getManifestPath,
  getShardPath,
  getShardPathsForLetter,
  loadLetterShard,
  loadWordShard,
  shardKeyForWord,
  getEcdictDir,
  getEcdictShardPath,
};
