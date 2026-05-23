import * as Bob from "@bob-plug/core";
import { DictEntry, EntryView, MorphologyItem } from "./types";
import { EXTRA_PLURALS, getCrossReferences, getOriginSources, shouldExpandOriginSources } from "./relations";

export const morphologyLabelOrder = ["原形", "复数", "过去式", "过去分词", "现在分词", "第三人称单数", "比较级", "最高级"];

/**
 * Maps OALD verb form type codes to Chinese morphology labels.
 * Used when processing `DictEntry.verb_forms` to convert raw form types
 * into display-ready labels.
 */
const verbFormLabelByType: Record<string, string> = {
  thirdps: "第三人称单数",
  past: "过去式",
  pastpart: "过去分词",
  ptpp: "过去分词",
  prespart: "现在分词",
};

/**
 * Normalizes verb form words by stripping parenthetical annotations.
 *
 * OALD sometimes prefixes verb forms with parenthetical notes like
 * "(especially British) travelled" or "（美）traveled". These prefixes
 * are display metadata, not part of the actual word form, so they are
 * removed to keep comparisons and navigation clean.
 *
 * @param word - raw verb form word, potentially with parenthetical prefix
 * @returns cleaned word without prefix
 */
function normalizeVerbFormWord(word: string): string {
  return word
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^（[^）]*）\s*/, "")
    .trim();
}

/**
 * Preferred spelling pairs for British vs. American English.
 *
 * When both forms of a pair appear in morphology data (e.g. "travelled"
 * and "traveled"), the first element (British -lled) is hidden from UI
 * and the second (American -led) is shown as the primary form. This
 * reduces visual clutter while preserving the full data set.
 *
 * @see pickPrimaryMorphologyWord
 */
const preferredPairs: Array<[string, string]> = [
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["cancelled", "canceled"],
  ["cancelling", "canceling"],
  ["levelled", "leveled"],
  ["levelling", "leveling"],
  ["signalled", "signaled"],
  ["signalling", "signaling"],
  ["labelled", "labeled"],
  ["labelling", "labeling"],
  ["fuelled", "fueled"],
  ["fuelling", "fueling"],
  ["totalled", "totaled"],
  ["totalling", "totaling"],
  ["kidnapped", "kidnaped"],
  ["kidnapping", "kidnaping"],
  ["worshipped", "worshiped"],
  ["worshipping", "worshiping"],
];

/** 标准化词形变化词为小写形式
 * 用于去重和比较时的统一格式
 */
export function normalizeMorphologyWord(word: string): string {
  return word.toLowerCase();
}

/** 解析 Bob 插件的 exchange 字符串为键值对 Map
 * 格式："key1:value1/key2:value2/..."，如 "s:apples/p:appled"
 * 用于将原始 exchange 数据转换为可处理的结构化格式
 */
export function parseExchangeValues(exchange: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  if (!exchange) {
    return values;
  }

  for (const item of exchange.split("/")) {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = item.slice(0, separatorIndex);
    const value = item.slice(separatorIndex + 1).trim();
    if (!value) continue;
    const existingValues = values.get(key) || [];
    if (!existingValues.includes(value)) {
      values.set(key, [...existingValues, value]);
    }
  }

  return values;
}

/**
 * Moves comparative and superlative forms from the "s" (plural) slot
 * to their dedicated "c" (comparative) and "sup" (superlative) slots.
 *
 * Background: Python preprocessing already handles most of this migration,
 * but ~239 edge cases still leak through due to ambiguous form detection
 * (e.g., "better" could be a plural noun or comparative adjective).
 *
 * This function is idempotent - running it multiple times is safe.
 *
 * @param exchangeValues - parsed exchange values from DictEntry.exchange
 * @param entry - the dictionary entry (needed for POS filtering)
 * @returns corrected exchange values with comparatives in right slots
 */
export function moveSurfaceComparativesIntoExchangeSlots(
  exchangeValues: Map<string, string[]>,
  entry: DictEntry,
): Map<string, string[]> {
  const sForms = exchangeValues.get("s") || [];
  if (sForms.length === 0) {
    return exchangeValues;
  }

  const hasComparativePos = entry.pos.includes("adj:") || entry.pos.includes("adv:");
  if (!hasComparativePos) {
    return exchangeValues;
  }

  const comparativeForms: string[] = [];
  const superlativeForms: string[] = [];
  const remainingSForms: string[] = [];

  for (const form of sForms) {
    const lowerForm = form.toLowerCase();
    if (lowerForm.endsWith("est")) {
      superlativeForms.push(form);
      continue;
    }
    if (lowerForm.endsWith("er")) {
      comparativeForms.push(form);
      continue;
    }
    remainingSForms.push(form);
  }

  if (comparativeForms.length === 0 && superlativeForms.length === 0) {
    return exchangeValues;
  }

  const nextValues = new Map(exchangeValues);
  if (remainingSForms.length > 0) {
    nextValues.set("s", remainingSForms);
  } else {
    nextValues.delete("s");
  }

  if (comparativeForms.length > 0) {
    nextValues.set("c", [...(nextValues.get("c") || []), ...comparativeForms.filter((form) => !(nextValues.get("c") || []).includes(form))]);
  }

  if (superlativeForms.length > 0) {
    nextValues.set("sup", [...(nextValues.get("sup") || []), ...superlativeForms.filter((form) => !(nextValues.get("sup") || []).includes(form))]);
  }

  return nextValues;
}

/**
 * Adds verb form morphology items from a `DictEntry`.
 *
 * Iterates over `entry.verb_forms`, normalizes each form word, maps the
 * form type to a Chinese label via `verbFormLabelByType`, and feeds the
 * result into `addMorphologyItem`. Only processes standalone entries.
 *
 * Verb forms from OALD's structured table are considered authoritative and
 * take precedence over exchange-string parsing for standard verbs.
 *
 * @param entry - dictionary entry to extract verb forms from
 * @param addMorphologyItem - callback to register each (label, word) pair
 * @param shouldSkip - optional filter to skip specific (label, word) pairs
 */
export function addVerbFormMorphologyFromEntry(
  entry: DictEntry,
  addMorphologyItem: (label: string, word: string) => void,
  shouldSkip?: (label: string, word: string) => boolean,
) {
  if (entry.entry_kind !== "standalone") {
    return;
  }

  for (const form of entry.verb_forms || []) {
    const label = (form.form && verbFormLabelByType[form.form]) || "";
    const normalizedWord = form.word ? normalizeVerbFormWord(form.word) : "";
    if (!label || !normalizedWord) continue;
    if (shouldSkip && shouldSkip(label, normalizedWord)) continue;
    addMorphologyItem(label, normalizedWord);
  }
}

/**
 * Adds morphology items from the raw `exchange` string of a `DictEntry`.
 *
 * Processing pipeline:
 * 1. Parse the exchange string into a key-value map via `parseExchangeValues`
 * 2. Move surface comparatives/superlatives from the "s" slot to "c"/"sup"
 *    via `moveSurfaceComparativesIntoExchangeSlots`
 * 3. Supplement plural forms from `EXTRA_PLURALS` when the entry only
 *    references itself in the "s" slot
 * 4. Map exchange keys (e.g. "p", "d", "s") to Chinese labels and emit
 *    each (label, word) pair through `addMorphologyItem`
 *
 * This is a fallback source: `addVerbFormMorphologyFromEntry` is preferred
 * for verbs, but exchange parsing covers non-verb morphology (plurals,
 * comparatives, superlatives) and entries without structured verb_forms.
 *
 * @param entry - dictionary entry to extract exchange morphology from
 * @param addMorphologyItem - callback to register each (label, word) pair
 * @param shouldSkip - optional filter to skip specific (label, word) pairs
 */
export function addExchangeMorphologyFromRawEntry(
  entry: DictEntry,
  addMorphologyItem: (label: string, word: string) => void,
  shouldSkip?: (label: string, word: string) => boolean,
) {
  const exchangeValues = moveSurfaceComparativesIntoExchangeSlots(parseExchangeValues(entry.exchange), entry);

  const sWords = exchangeValues.get("s") || [];
  if (sWords.length === 1 && sWords[0].toLowerCase() === entry.word.toLowerCase()) {
    const extras = EXTRA_PLURALS[entry.word.toLowerCase()];
    if (extras) {
      const nextWords = [...sWords];
      for (const w of extras) {
        if (!nextWords.includes(w)) {
          nextWords.push(w);
        }
      }
      exchangeValues.set("s", nextWords);
    }
  }

  const exchangeKeyToLabel: Record<string, string> = {
    "3": "第三人称单数",
    p: "过去式",
    d: "过去分词",
    i: "现在分词",
    s: "复数",
    c: "比较级",
    sup: "最高级",
  };

  for (const [key, words] of exchangeValues.entries()) {
    const label = exchangeKeyToLabel[key];
    if (!label) continue;
    for (const word of words) {
      if (shouldSkip && shouldSkip(label, word)) continue;
      addMorphologyItem(label, word);
    }
  }
}

/**
 * Selects the primary spelling from a list of morphology word variants.
 *
 * When both British (-lled) and American (-led) spellings of the same
 * word appear in the data (e.g. "travelled" vs "traveled"), this
 * function hides the British variant and keeps the American one.
 *
 * The decision is driven by `preferredPairs`, which lists British forms
 * first and American forms second. If both members of a pair are present,
 * the first (British) is filtered out.
 *
 * This is pure presentation logic — the underlying data is not modified.
 *
 * @param words - array of morphology word variants
 * @returns filtered array with British duplicates hidden
 */
export function pickPrimaryMorphologyWord(words: string[]) {
  const normalizedWords = new Set(words.map(normalizeMorphologyWord));
  const hiddenWords = new Set<string>();

  for (const [secondary, primary] of preferredPairs) {
    if (!normalizedWords.has(secondary) || !normalizedWords.has(primary)) continue;
    hiddenWords.add(secondary);
  }

  return words.filter((word) => !hiddenWords.has(normalizeMorphologyWord(word)));
}

/**
 * Builds the morphology exchange data for Bob plugin display.
 *
 * Integrates three data sources and outputs them in a fixed label order:
 * 1. Back relation (link to the root/lemma form)
 * 2. Child relations (inflections from relation edges, e.g. plurals, tenses)
 * 3. Raw morphology from `verb_forms` and `exchange` strings
 *
 * Deduplication is performed across all sources using a normalized key
 * (`label:normalizedWord`) so the same form appearing in multiple sources
 * is only shown once.
 *
 * In fallback display mode (`view.isFallbackDisplay`), only the back
 * relation is returned to keep the UI minimal.
 *
 * @param view - the entry view containing the entry, relations, and query word
 * @returns array of Bob exchange objects ready for plugin rendering
 */
export function buildMorphologyExchanges(view: EntryView): Bob.ExchangeObject[] {
  if (view.isFallbackDisplay) {
    return view.backRelation
      ? [{ name: view.backRelation.label, words: [view.backRelation.word] }]
      : [];
  }

  // 将多个来源的词形变化统一汇总到 morphologyByLabel，再按固定中文标签顺序输出，
  // 这样可以避免不同数据源（relations / verb_forms / exchange）互相打乱展示顺序。
  const morphologyByLabel = new Map<string, MorphologyItem[]>();
  const seenMorphologyKeys = new Set<string>();

  const addMorphologyItem = (label: string, word: string) => {
    const key = `${label}:${normalizeMorphologyWord(word)}`;
    if (seenMorphologyKeys.has(key)) return;
    seenMorphologyKeys.add(key);
    const items = morphologyByLabel.get(label) || [];
    morphologyByLabel.set(label, [...items, { label, word }]);
  };

  if (view.backRelation) {
    addMorphologyItem(view.backRelation.label, view.backRelation.word);
  }

  const originSources = getOriginSources(view.entry);
  const hasOriginRelations = originSources.length > 0;
  for (const relation of view.childRelations) {
    // Skip invalid relations with missing word or label
    if (!relation.word || !relation.label) continue;
    if (hasOriginRelations && relation.word.toLowerCase() === view.queryWord) {
      continue;
    }
    addMorphologyItem(relation.label, relation.word);
  }

  const shouldSkipRawMorphology = (label: string, word: string) => {
    const normalizedWord = word.toLowerCase();
    if (hasOriginRelations && normalizedWord === view.queryWord) return true;
    if (view.backRelation && normalizedWord === view.backRelation.word.toLowerCase()) return true;
    return false;
  };

  // OALD's verb forms table is the authoritative source for standard verb forms.
  // Keep exchange parsing as a fallback for entries without verb_forms and for
  // non-verb morphology such as plurals/comparatives.
  addVerbFormMorphologyFromEntry(view.entry, addMorphologyItem, shouldSkipRawMorphology);
  addExchangeMorphologyFromRawEntry(view.entry, addMorphologyItem, shouldSkipRawMorphology);

  if (shouldExpandOriginSources(view.entry)) {
    for (const source of originSources) {
      addMorphologyItem("原形", source.word);
    }
  }

  const isInflection = view.entry.entry_kind === "inflection";
  const exchanges = morphologyLabelOrder.flatMap((label) => {
    const items = morphologyByLabel.get(label) || [];
    if (items.length === 0) return [];

    const words = pickPrimaryMorphologyWord(items.map((item) => item.word));
    if (words.length === 0) return [];

    if (isInflection && words.every((word) => word.toLowerCase() === view.queryWord)) {
      return [];
    }

    return [{ name: label, words }];
  });

  for (const ref of getCrossReferences(view.entry) || []) {
    exchanges.push({ name: "原形", words: [ref.word] });
  }

  return exchanges;
}
