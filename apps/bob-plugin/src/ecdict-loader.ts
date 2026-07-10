import { EcdictShardCache } from "./types";
import { loadPackShard, resolvePack } from "./pack-loader";

// - null  = not yet probed (first query triggers a check)
// - true  = data directory found, shard loading enabled
// - false = data directory missing; all future lookups skip ECDICT
let ecdictAvailable: boolean | null = null;

function isEcdictAvailable(): boolean {
  if (ecdictAvailable !== null) return ecdictAvailable;

  ecdictAvailable = resolvePack("ecdict") != null;

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

  const shard = loadPackShard<EcdictShardCache>("ecdict", char);
  if (!shard) return null;
  shardCache.set(char, shard);
  return shard;
}

export function queryEcdictEntry(word: string): import("./types").EcdictEntry | null {
  if (!isEcdictAvailable()) return null;

  const lower = word.toLowerCase();
  const char = lower[0] || "_";
  const shard = loadEcdictShard(char);
  if (!shard) return null;
  return shard[lower] || null;
}
