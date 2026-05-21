import { ShardCache } from "./types";

const shardCache: Map<string, ShardCache> = new Map();

export function loadShard(char: string): ShardCache | null {
  if (shardCache.has(char)) {
    return shardCache.get(char)!;
  }

  try {
    const data = $file.read(`dict/${char}.json`);
    if (!data) return null;

    const json = data.toUTF8();
    if (!json) return null;

    const shard = JSON.parse(json) as ShardCache;
    shardCache.set(char, shard);
    return shard;
  } catch {
    return null;
  }
}

export function getShardForWord(word: string): ShardCache | null {
  const lower = word.toLowerCase();
  return loadShard(lower[0] || "_");
}
