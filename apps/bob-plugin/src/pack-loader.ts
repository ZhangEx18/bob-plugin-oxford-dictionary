import { DataPackManifest } from "./types";

type PackType = DataPackManifest["packType"];

interface PackLocator {
  rootDir: string;
  manifestPath: string;
}

interface ResolvedPack {
  manifest: DataPackManifest;
  rootDir: string;
  shardSubdir: string;
  shardExtension: string;
  shardKeyLength: number;
}

const PACK_LOCATORS: Record<PackType, PackLocator[]> = {
  oald: [
    { rootDir: "packs/oald/2024.09", manifestPath: "packs/oald/2024.09/manifest.json" },
  ],
  ecdict: [
    { rootDir: "packs/ecdict/latest", manifestPath: "packs/ecdict/latest/manifest.json" },
  ],
};

const manifestCache = new Map<PackType, ResolvedPack | null>();

function readJson(path: string): unknown | null {
  try {
    const data = $file.read(path);
    if (!data) return null;
    const json = data.toUTF8();
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isManifest(value: unknown, packType: PackType): value is DataPackManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return (
    typeof manifest.schemaVersion === "string"
    && typeof manifest.dataVersion === "string"
    && typeof manifest.entryCount === "number"
    && typeof manifest.shardCount === "number"
    && manifest.packType === packType
  );
}

export function resolvePack(packType: PackType): ResolvedPack | null {
  if (manifestCache.has(packType)) {
    return manifestCache.get(packType)!;
  }

  for (const locator of PACK_LOCATORS[packType]) {
    const manifestData = readJson(locator.manifestPath);
    if (!isManifest(manifestData, packType)) {
      continue;
    }

    const shardSubdir = manifestData.layout?.shardSubdir || "dict";
    const shardExtension = manifestData.layout?.shardExtension || ".json";
    const declaredKeyLength = manifestData.layout?.shardKeyLength;
    const shardKeyLength = typeof declaredKeyLength === "number" && declaredKeyLength > 0
      ? Math.floor(declaredKeyLength)
      : 1;
    const resolved = {
      manifest: manifestData,
      rootDir: locator.rootDir,
      shardSubdir,
      shardExtension,
      shardKeyLength,
    };
    manifestCache.set(packType, resolved);
    return resolved;
  }

  manifestCache.set(packType, null);
  return null;
}

/** Whether the pack declares a shard key length instead of the legacy raw key. */
export function hasDeclaredShardKeyLength(packType: PackType): boolean {
  return typeof resolvePack(packType)?.manifest.layout?.shardKeyLength === "number";
}

export function getShardKeyLength(packType: PackType): number {
  return resolvePack(packType)?.shardKeyLength ?? 1;
}

export function loadPackShard<T>(packType: PackType, shardKey: string): T | null {
  const resolved = resolvePack(packType);
  if (!resolved) return null;

  const filename = `${shardKey}${resolved.shardExtension}`;
  const relativePath = `${resolved.rootDir}/${resolved.shardSubdir}/${filename}`;
  const modern = readJson(relativePath);
  return modern ? (modern as T) : null;
}
