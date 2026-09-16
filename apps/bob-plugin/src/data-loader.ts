import { ShardCache } from "./types";
import { loadPackShard } from "./pack-loader";

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

export function loadShard(char: string): ShardCache | null {
  if (shardCache.has(char)) {
    return shardCache.get(char)!;
  }

  try {
    const shard = loadPackShard<ShardCache>("oald", char);
    if (!shard) {
      return null;
    }

    shardCache.set(char, shard);
    return shard;
  } catch (error) {
    console.error(
      `[data-loader] Failed to load shard "${char}":`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function getShardForWord(word: string): ShardCache | null {
  const lower = word.toLowerCase();
  const firstChar = lower[0] || "_";
  // APFS case folding treats final sigma and sigma filenames as equivalent.
  return loadShard(firstChar === "ς" ? "σ" : firstChar);
}
