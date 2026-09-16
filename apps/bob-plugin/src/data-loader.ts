import { ShardCache } from "./types";
import { hasDeclaredShardKeyLength, getShardKeyLength, loadPackShard } from "./pack-loader";

/**
 * Shard cache: stores loaded dictionary shards by first character.
 * Each shard is a map of word -> DictEntry for words starting with that character.
 * Shards are loaded from `dict/{char}.json` files on demand.
 *
 * This is the single source of entry objects. `relations.ts` caches per-entry
 * parse results in WeakMaps keyed by object identity, so a word must always
 * resolve to the same instance; keeping one cache (rather than a shard cache
 * plus a separate entry pool) is what makes that guarantee hold. A second pool
 * with its own eviction policy could hold a stale instance for a word whose
 * shard had since been reloaded, which made `displayEntry !== exactEntry`
 * comparisons misfire.
 */
const shardCache: Map<string, ShardCache> = new Map();

/**
 * Checks whether a queryable dictionary entry exists for the given surface form.
 * This is used to suppress broken jump links when upstream relation data points to
 * synthetic forms that were never emitted into packaged shards.
 */
export function hasDictionaryEntry(word: string): boolean {
  const lower = word.toLowerCase();
  return !!getShardForWord(lower)?.[lower];
}

export function loadShard(shardKey: string): ShardCache | null {
  if (shardCache.has(shardKey)) {
    return shardCache.get(shardKey)!;
  }

  try {
    const shard = loadPackShard<ShardCache>("oald", shardKey);
    if (!shard) {
      return null;
    }

    shardCache.set(shardKey, shard);
    return shard;
  } catch (error) {
    console.error(
      `[data-loader] Failed to load shard "${shardKey}":`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Legacy packs (no `shardKeyLength` in the manifest) name each shard after the
 * raw first character of its words.
 */
function legacyShardKey(word: string): string {
  const firstChar = word[0] || "_";
  // APFS case folding treats final sigma and sigma filenames as equivalent.
  return firstChar === "ς" ? "σ" : firstChar;
}

/**
 * Encodes one character for use in a shard filename.
 *
 * Only `[a-z0-9]` survives verbatim; every other character becomes `~` plus its
 * code point as six uppercase hex digits. Six is a fixed width (Unicode tops
 * out at U+10FFFF), which keeps the encoding unambiguous, and `~` itself is
 * encoded so it can never appear literally. `~` is unreserved in URLs and legal
 * in every filesystem, unlike `%` which path layers may percent-decode.
 *
 * This matters for two-character keys, which can reach characters like the `/`
 * in `s/` that a path cannot hold, or spellings that APFS folds together.
 *
 * `shard_writer.py` implements the same rule; the two must stay in lockstep.
 */
function encodeShardChar(char: string): string {
  if (/^[a-z0-9]$/.test(char)) return char;
  return `~${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(6, "0")}`;
}

function declaredShardKey(word: string): string {
  // NFC first so that a word typed in a decomposed form still lands on the
  // same shard as its precomposed spelling.
  // Array.from iterates code points, matching Python's string indexing; plain
  // indexing would split astral characters into surrogate halves.
  const chars = Array.from(word.normalize("NFC"));
  const length = getShardKeyLength("oald");
  let key = "";
  for (let index = 0; index < length; index += 1) {
    const char = chars[index] || "_";
    key += encodeShardChar(char === "ς" ? "σ" : char);
  }
  return key;
}

/**
 * The shard key a word resolves to under the active pack's layout.
 *
 * Exported so the pack invariant can assert that every stored entry's key
 * derives back to the file it lives in; a writer/reader mismatch would make
 * entries silently unreachable.
 */
export function shardKeyForWord(word: string): string {
  const lower = word.toLowerCase();
  return hasDeclaredShardKeyLength("oald")
    ? declaredShardKey(lower)
    : legacyShardKey(lower);
}

export function getShardForWord(word: string): ShardCache | null {
  return loadShard(shardKeyForWord(word));
}
