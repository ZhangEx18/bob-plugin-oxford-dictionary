import { DictEntry, WordRelation, OriginSource, RelationEdge, WordFamilyItem } from "./types";
import { getShardForWord, hasCachedOrShardEntry } from "./data-loader";

/**
 * Maps inflection labels (in Chinese) to their applicable POS scopes.
 *
 * Used to determine which part-of-speech categories a given inflection
 * label belongs to. For example, "过去式" only applies to verbs ("v"),
 * while "比较级" applies to both adjectives and adverbs.
 *
 * This map drives `getOriginSources` xref filtering and POS-aware
 * deduplication in the relation pipeline.
 */
export const inflectionPosScopeByLabel: Record<string, string[]> = {
  "第三人称单数": ["v"],
  "过去式": ["v"],
  "过去分词": ["v"],
  "现在分词": ["v"],
  "复数": ["n"],
  "比较级": ["adj", "adv"],
  "最高级": ["adj", "adv"],
};

export const EXTRA_PLURALS: Record<string, string[]> = {
  score: ["scores"],
};

/**
 * WeakMap caches for relation parsing results.
 *
 * IMPORTANT: These caches rely on DictEntry object identity.
 * data-loader.ts maintains an entryCache that ensures the same word
 * always returns the same DictEntry instance. If that guarantee is broken
 * (e.g., by creating new DictEntry objects), these caches will silently
 * miss, causing performance degradation but not correctness issues.
 *
 * DictEntry objects are treated as immutable after loading from JSON,
 * so caching parse results is safe.
 */
const backRelationCache = new WeakMap<DictEntry, WordRelation | null>();
const childRelationsCache = new WeakMap<DictEntry, WordRelation[]>();
const crossReferencesCache = new WeakMap<DictEntry, WordRelation[]>();
const originSourcesCache = new WeakMap<DictEntry, OriginSource[]>();
const shouldExpandCache = new WeakMap<DictEntry, boolean>();
const wordFamilyCache = new WeakMap<DictEntry, WordFamilyItem[]>();

export type RelationTargetExists = (word: string) => boolean;

/** 将关系边转换为简化词关系（用于 UI 展示） */
function relationEdgeToWordRelation(edge: RelationEdge): WordRelation {
  return {
    word: edge.target,
    label: edge.label,
  };
}

/** 将关系边转换为返回关系（标签固定为"原形"） */
function relationEdgeToBackRelation(edge: RelationEdge): WordRelation {
  return {
    word: edge.target,
    label: "原形",
  };
}

/**
 * Gets the back-relation for an inflection entry pointing to its lemma.
 *
 * Inflection entries (e.g. "went", "apples") need a link back to their
 * root/lemma form ("go", "apple"). This function scans the entry's
 * `relations` for an outgoing `origin` edge:
 *
 * 1. Prefer the `primary` origin edge if one exists
 * 2. Fall back to the first outgoing origin edge
 * 3. Return `null` if no origin edge is found
 *
 * The result is cached per-entry via `backRelationCache`.
 *
 * @param entry - dictionary entry (typically an inflection entry)
 * @returns back-relation word relation or null
 */
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

/**
 * Gets child inflection relations for an entry.
 *
 * Filters the entry's `relations` for outgoing `inflection` edges that:
 * - are marked `display === "exchange"` (visible in the exchange/morphology UI)
 * - are `navigable` (the target exists and can be jumped to)
 * - have a target present in the packaged dictionary
 *
 * These represent the inflected forms of the current word that should be
 * shown as clickable links (e.g. plurals, past tense, participles).
 *
 * Results are cached per-entry via `childRelationsCache`.
 *
 * @param entry - dictionary entry to extract child relations from
 * @returns array of navigable child word relations
 */
export function getChildRelations(entry: DictEntry): WordRelation[] {
  if (childRelationsCache.has(entry)) {
    return childRelationsCache.get(entry)!;
  }

  const relationChildren = collectChildRelations(entry, hasCachedOrShardEntry);

  childRelationsCache.set(entry, relationChildren);
  return relationChildren;
}

export function collectChildRelations(
  entry: DictEntry,
  targetExists: RelationTargetExists,
): WordRelation[] {
  return (entry.relations || [])
    .filter((edge) => (
      edge.type === "inflection"
      && edge.direction === "outgoing"
      && edge.display === "exchange"
      && edge.navigable
      && targetExists(edge.target)
    ))
    .map(relationEdgeToWordRelation);
}

/** 获取当前词条的交叉引用关系（xref）
 * 用于展示相关词汇链接，如同义词、反义词等
 */
export function getCrossReferences(entry: DictEntry): WordRelation[] {
  if (crossReferencesCache.has(entry)) {
    return crossReferencesCache.get(entry)!;
  }

  const relationRefs = collectCrossReferences(entry, hasCachedOrShardEntry);

  crossReferencesCache.set(entry, relationRefs);
  return relationRefs;
}

export function collectCrossReferences(
  entry: DictEntry,
  targetExists: RelationTargetExists,
): WordRelation[] {
  return (entry.relations || [])
    .filter((edge) => (
      edge.type === "xref"
      && edge.direction === "outgoing"
      && edge.navigable
      && targetExists(edge.target)
    ))
    .map(relationEdgeToWordRelation);
}

/**
 * Gets extra origin sources from hard-coded supplemental data.
 *
 * Currently only handles plural forms defined in `EXTRA_PLURALS`.
 * When the queried word matches a known plural form (e.g. "scores" is
 * the plural of "score") and the entry does not already have a "复数"
 * origin label, this function synthesizes an origin source pointing
 * back to the base word.
 *
 * This bridges gaps in the JSON data where certain inflection relations
 * were not captured during preprocessing.
 *
 * @param entry - dictionary entry to check for extra origins
 * @returns array of synthesized origin sources
 */
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

/**
 * Generic origin-source collector: filters relation edges and converts them
 * to `OriginSource` objects.
 *
 * Called twice by `getOriginSources` — once for `origin` relations and once
 * for `xref` relations — with different filter functions.
 *
 * The POS scope is taken from `edge.pos_scope` if present; otherwise it
 * falls back to `inflectionPosScopeByLabel[edge.label]`.
 *
 * @param entry - dictionary entry to collect from
 * @param filterFn - predicate to select which relation edges to include
 * @returns array of origin sources derived from matching edges
 */
function mapOriginSources(
  entry: DictEntry,
  filterFn: (edge: RelationEdge) => boolean,
): OriginSource[] {
  return (entry.relations || [])
    .filter(filterFn)
    .map((edge) => ({
      word: edge.target,
      label: edge.label,
      posScope: edge.pos_scope || inflectionPosScopeByLabel[edge.label] || [],
    }));
}

/**
 * Gets all origin sources for an entry (links back to lemma/root forms).
 *
 * Merges three categories of sources:
 * 1. **Origin relations** — outgoing `origin` edges with resolvable targets
 * 2. **Xref relations with inflection labels** — outgoing `xref` edges whose
 *    label is a known inflection (e.g. "复数", "过去式")
 * 3. **Hard-coded extras** — supplemental data from `EXTRA_PLURALS`
 *
 * The combined list is deduplicated by `word:label` key so the same source
 * does not appear twice.
 *
 * Results are cached per-entry via `originSourcesCache`.
 *
 * @param entry - dictionary entry to collect origin sources from
 * @returns deduplicated array of origin sources
 */
export function getOriginSources(entry: DictEntry): OriginSource[] {
  if (originSourcesCache.has(entry)) {
    return originSourcesCache.get(entry)!;
  }

  const originSources = collectOriginSources(entry, hasCachedOrShardEntry);

  originSourcesCache.set(entry, originSources);
  return originSources;
}

export function collectOriginSources(
  entry: DictEntry,
  targetExists: RelationTargetExists,
): OriginSource[] {
  const relationSources = mapOriginSources(
    entry,
    (edge) => (
      edge.type === "origin"
      && edge.direction === "outgoing"
      && edge.navigable
      && targetExists(edge.target)
    ),
  );

  const xrefSources = mapOriginSources(
    entry,
    (edge) =>
      edge.type === "xref" &&
      edge.direction === "outgoing" &&
      edge.navigable &&
      targetExists(edge.target) &&
      !!inflectionPosScopeByLabel[edge.label],
  );

  const extraSources = getExtraOriginSources(entry);
  const allSources = [...relationSources, ...xrefSources, ...extraSources];

  const seen = new Set<string>();
  return allSources.filter((source) => {
    const key = `${source.word}:${source.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Determines whether the origin-sources section should be expanded in the UI.
 *
 * Expansion happens when either:
 * 1. There are multiple origin sources with **different** labels or POS scopes
 *    (e.g. both "复数 n." and "比较级 adj.")
 * 2. The entry is a `standalone` entry and has at least one xref origin source
 *    with an inflection label (indicating the word has inflected forms that
 *    are packaged as separate entries)
 *
 * This controls the initial expand/collapse state of the origin-sources
 * accordion in the plugin UI.
 *
 * Results are cached per-entry via `shouldExpandCache`.
 *
 * @param entry - dictionary entry to evaluate
 * @returns true if the origin-sources section should start expanded
 */
export function shouldExpandOriginSources(entry: DictEntry): boolean {
  if (shouldExpandCache.has(entry)) {
    return shouldExpandCache.get(entry)!;
  }

  const result = evaluateOriginExpansion(entry, hasCachedOrShardEntry);

  shouldExpandCache.set(entry, result);
  return result;
}

export function evaluateOriginExpansion(
  entry: DictEntry,
  targetExists: RelationTargetExists,
): boolean {
  const sources = collectOriginSources(entry, targetExists);
  if (sources.length === 0) return false;

  const originKeys = new Set(
    sources.map((source) => `${source.label}${source.posScope.join(",")}`),
  );
  if (originKeys.size > 1) return true;

  const hasXrefOrigin = (entry.relations || []).some((edge) => (
    edge.type === "xref"
    && edge.direction === "outgoing"
    && edge.navigable
    && targetExists(edge.target)
    && Boolean(inflectionPosScopeByLabel[edge.label])
  ));
  return entry.entry_kind === "standalone" && hasXrefOrigin;
}

/**
 * Normalizes word-family POS tags to a uniform format (n./v./adj./adv.).
 *
 * Handles case variations, abbreviations, and trailing periods so that
 * "Noun", "n", "n.", and "NOUN." all normalize to "n.".
 *
 * @param pos - raw POS tag from word-family data
 * @returns normalized POS tag
 */
function normalizeWordFamilyPos(pos: string): string {
  const normalized = pos.trim().toLowerCase().replace(/\.$/, "");
  const posMap: Record<string, string> = {
    noun: "n.",
    n: "n.",
    verb: "v.",
    v: "v.",
    adjective: "adj.",
    adj: "adj.",
    adverb: "adv.",
    adv: "adv.",
  };
  return posMap[normalized] || pos.trim();
}

/**
 * Gets the word-family (cognate words) for an entry.
 *
 * A word family groups together morphologically related words (e.g.
 * "happy", "happily", "unhappy", "happiness"). The function:
 *
 * 1. Prefers the entry's own `word_family` array if it exists and is non-empty
 * 2. Otherwise searches the entry's shard for another entry whose word family
 *    contains the current word (via `findWordFamilyContaining`)
 * 3. Filters out the current word itself from the returned list
 * 4. Normalizes POS tags via `normalizeWordFamilyPos`
 *
 * Results are cached per-entry via `wordFamilyCache`.
 *
 * @param entry - dictionary entry to get word family for
 * @returns array of word-family items excluding the current word
 */
export function getWordFamily(entry: DictEntry): WordFamilyItem[] {
  if (wordFamilyCache.has(entry)) {
    return wordFamilyCache.get(entry)!;
  }

  const ownWordFamily = entry.word_family && entry.word_family.length > 0
    ? entry.word_family
    : findWordFamilyContaining(entry.word);

  if (ownWordFamily && ownWordFamily.length > 0) {
    const result = ownWordFamily
      .filter((item) => item.word && item.word.toLowerCase() !== entry.word.toLowerCase())
      .map((item) => ({
        word: item.word,
        pos: normalizeWordFamilyPos(item.pos),
        relation: item.relation || "词族",
      }));
    wordFamilyCache.set(entry, result);
    return result;
  }

  wordFamilyCache.set(entry, []);
  return [];
}

/**
 * Searches the shard containing the target word for a word-family that
 * includes it.
 *
 * When an entry does not have its own `word_family` array, this function
 * iterates over every entry in the same shard looking for another entry
 * whose word-family list contains the target word. This is an O(n) scan
 * where n is the number of entries in the shard.
 *
 * @param word - target word to search for within word families
 * @returns the first matching word-family array, or empty if none found
 */
function findWordFamilyContaining(word: string): WordFamilyItem[] {
  const shard = getShardForWord(word);
  const lower = word.toLowerCase();
  if (!shard) return [];

  for (const entry of Object.values(shard)) {
    const family = entry.word_family || [];
    if (family.some((item) => item.word.toLowerCase() === lower)) {
      return family;
    }
  }

  return [];
}
