import { DictEntry, WordRelation, OriginSource, RelationEdge } from "./types";
import { getShardForWord } from "./data-loader";

export const inflectionPosScopeByLabel: Record<string, string[]> = {
  "第三人称单数": ["v"],
  "过去式": ["v"],
  "过去分词": ["v"],
  "现在分词": ["v"],
  "复数": ["n"],
  "比较级": ["adj", "adv"],
  "最高级": ["adj", "adv"],
};

const EXTRA_PLURALS: Record<string, string[]> = {
  score: ["scores"],
};

// WeakMap caches for relation parsing results.
// DictEntry objects are immutable (loaded from JSON), so caching is safe.
const backRelationCache = new WeakMap<DictEntry, WordRelation | null>();
const childRelationsCache = new WeakMap<DictEntry, WordRelation[]>();
const crossReferencesCache = new WeakMap<DictEntry, WordRelation[]>();
const originSourcesCache = new WeakMap<DictEntry, OriginSource[]>();
const shouldExpandCache = new WeakMap<DictEntry, boolean>();

function relationEdgeToWordRelation(edge: RelationEdge): WordRelation {
  return {
    word: edge.target,
    label: edge.label,
  };
}

function relationEdgeToBackRelation(edge: RelationEdge): WordRelation {
  return {
    word: edge.target,
    label: "原形",
  };
}

export function getBackRelation(entry: DictEntry): WordRelation | null {
  if (backRelationCache.has(entry)) {
    return backRelationCache.get(entry)!;
  }

  const primaryOrigin = (entry.relations || []).find(
    (edge) => edge.type === "origin" && edge.direction === "outgoing" && edge.primary,
  );
  if (primaryOrigin) {
    const result = relationEdgeToBackRelation(primaryOrigin);
    backRelationCache.set(entry, result);
    return result;
  }

  const fallbackOrigin = (entry.relations || []).find(
    (edge) => edge.type === "origin" && edge.direction === "outgoing",
  );
  if (fallbackOrigin) {
    const result = relationEdgeToBackRelation(fallbackOrigin);
    backRelationCache.set(entry, result);
    return result;
  }

  backRelationCache.set(entry, null);
  return null;
}

export function getChildRelations(entry: DictEntry): WordRelation[] {
  if (childRelationsCache.has(entry)) {
    return childRelationsCache.get(entry)!;
  }

  const relationChildren = (entry.relations || [])
    .filter((edge) => edge.type === "inflection" && edge.direction === "outgoing" && edge.display === "exchange" && edge.navigable)
    .map(relationEdgeToWordRelation);

  childRelationsCache.set(entry, relationChildren);
  return relationChildren;
}

export function getCrossReferences(entry: DictEntry): WordRelation[] {
  if (crossReferencesCache.has(entry)) {
    return crossReferencesCache.get(entry)!;
  }

  const relationRefs = (entry.relations || [])
    .filter((edge) => edge.type === "xref" && edge.direction === "outgoing" && edge.navigable)
    .map(relationEdgeToWordRelation);

  crossReferencesCache.set(entry, relationRefs);
  return relationRefs;
}

function getExtraOriginSources(entry: DictEntry): OriginSource[] {
  const extra: OriginSource[] = [];
  const existingLabels = new Set(
    (entry.relations || [])
      .filter((edge) => edge.type === "origin" && edge.direction === "outgoing")
      .map((edge) => edge.label),
  );

  for (const [baseWord, pluralForms] of Object.entries(EXTRA_PLURALS)) {
    if (pluralForms.includes(entry.word.toLowerCase()) && !existingLabels.has("复数")) {
      extra.push({
        word: baseWord,
        label: "复数",
        posScope: ["n"],
      });
    }
  }

  return extra;
}

export function getOriginSources(entry: DictEntry): OriginSource[] {
  if (originSourcesCache.has(entry)) {
    return originSourcesCache.get(entry)!;
  }

  const relationSources = (entry.relations || [])
    .filter((edge) => edge.type === "origin" && edge.direction === "outgoing" && edge.navigable)
    .map((edge) => ({
      word: edge.target,
      label: edge.label,
      posScope: edge.pos_scope || inflectionPosScopeByLabel[edge.label] || [],
    }));

  const xrefSources = (entry.relations || [])
    .filter((edge) =>
      edge.type === "xref" &&
      edge.direction === "outgoing" &&
      edge.navigable &&
      inflectionPosScopeByLabel[edge.label]
    )
    .map((edge) => ({
      word: edge.target,
      label: edge.label,
      posScope: edge.pos_scope || inflectionPosScopeByLabel[edge.label] || [],
    }));

  const extraSources = getExtraOriginSources(entry);
  const allSources = [...relationSources, ...xrefSources, ...extraSources];

  let result: OriginSource[];
  if (allSources.length > 0) {
    const seen = new Set<string>();
    result = allSources.filter((source) => {
      const key = `${source.word}:${source.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    result = [];
  }

  originSourcesCache.set(entry, result);
  return result;
}

export function shouldExpandOriginSources(entry: DictEntry): boolean {
  if (shouldExpandCache.has(entry)) {
    return shouldExpandCache.get(entry)!;
  }

  const sources = getOriginSources(entry);

  let result = false;
  if (sources.length > 0) {
    const originKeys = new Set(
      sources.map((source) => `${source.label}${source.posScope.join(",")}`),
    );
    if (originKeys.size > 1) {
      result = true;
    } else {
      const hasXrefOrigin = (entry.relations || []).some(
        (edge) =>
          edge.type === "xref" &&
          edge.direction === "outgoing" &&
          edge.navigable &&
          inflectionPosScopeByLabel[edge.label],
      );
      if (entry.entry_kind === "standalone" && hasXrefOrigin) {
        result = true;
      }
    }
  }

  shouldExpandCache.set(entry, result);
  return result;
}
