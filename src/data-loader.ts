import { DictEntry, ShardCache } from "./types";

const shardCache: Map<string, ShardCache> = new Map();

// Global entry cache pool: ensures the same word always resolves to the same
// DictEntry instance. This is critical for WeakMap-based caches in relations.ts
// to actually hit across repeated lookups.
const entryCache: Map<string, DictEntry> = new Map();

export function getCachedEntry(word: string): DictEntry | undefined {
  return entryCache.get(word.toLowerCase());
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
      } else {
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
