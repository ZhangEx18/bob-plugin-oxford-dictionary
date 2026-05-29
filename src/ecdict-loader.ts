import { EcdictShardCache } from "./types";

// - null  = not yet probed (first query triggers a check)
// - true  = data directory found, shard loading enabled
// - false = data directory missing; all future lookups skip ECDICT
let ecdictAvailable: boolean | null = null;

function isEcdictAvailable(): boolean {
  if (ecdictAvailable !== null) return ecdictAvailable;

  try {
    const probe = $file.read("ecdict/a.json");
    ecdictAvailable = probe != null;
  } catch {
    ecdictAvailable = false;
  }

  if (!ecdictAvailable) {
    console.log("[ecdict-loader] ECDICT data not found — skipping offline fallback");
  }
  return ecdictAvailable;
}

const shardCache: Map<string, EcdictShardCache> = new Map();

export function loadEcdictShard(char: string): EcdictShardCache | null {
  if (!isEcdictAvailable()) return null;

  if (shardCache.has(char)) {
    return shardCache.get(char)!;
  }

  try {
    const data = $file.read(`ecdict/${char}.json`);
    if (!data) return null;

    const json = data.toUTF8();
    if (!json) return null;

    const shard = JSON.parse(json) as EcdictShardCache;
    shardCache.set(char, shard);
    return shard;
  } catch {
    return null;
  }
}

export function queryEcdictEntry(word: string): import("./types").EcdictEntry | null {
  if (!isEcdictAvailable()) return null;

  const lower = word.toLowerCase();
  const char = lower[0] || "_";
  const shard = loadEcdictShard(char);
  if (!shard) return null;
  return shard[lower] || null;
}