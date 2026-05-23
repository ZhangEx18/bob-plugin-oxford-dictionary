import { DictEntry, ShardCache } from "./types";

/**
 * Shard cache: stores loaded dictionary shards by first character.
 * Each shard is a map of word -> DictEntry for words starting with that character.
 * Shards are loaded from `dict/{char}.json` files on demand.
 */
const shardCache: Map<string, ShardCache> = new Map();

/**
 * Global entry cache pool: ensures the same word always resolves to the same
 * DictEntry instance. This is critical for WeakMap-based caches in relations.ts
 * to actually hit across repeated lookups.
 *
 * Design note: DictEntry objects are treated as immutable after loading.
 * Relations.ts relies on object identity for its WeakMap caches.
 *
 * A soft cap prevents unbounded growth in long-running sessions.
 * Once the cap is reached, newly loaded shards skip the global pool
 * but remain reachable via shardCache.
 */
const MAX_ENTRY_CACHE_SIZE = 60000;
const entryCache: Map<string, DictEntry> = new Map();

export function getCachedEntry(word: string): DictEntry | undefined {
  return entryCache.get(word.toLowerCase());
}

/**
 * Checks whether a queryable dictionary entry exists for the given surface form.
 * This is used to suppress broken jump links when upstream relation data points to
 * synthetic forms that were never emitted into packaged shards.
 */
export function hasCachedOrShardEntry(word: string): boolean {
  const lower = word.toLowerCase();
  if (entryCache.has(lower)) {
    return true;
  }

  const shard = getShardForWord(lower);
  return !!shard?.[lower];
}

export function loadShard(char: string): ShardCache | null {
  if (shardCache.has(char)) {
    return shardCache.get(char)!;
  }

  try {
    const data = $file.read(`dict/${char}.json`);
    if (!data) {
      return null;
    }

    const json = data.toUTF8();
    if (!json) {
      return null;
    }

    const shard = JSON.parse(json) as ShardCache;

    for (const [word, entry] of Object.entries(shard)) {
      const lower = word.toLowerCase();
      if (entryCache.has(lower)) {
        console.warn(`[data-loader] Duplicate entry for "${word}" across shards`);
      } else if (entryCache.size < MAX_ENTRY_CACHE_SIZE) {
        entryCache.set(lower, entry);
      }
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
  return loadShard(lower[0] || "_");
}
