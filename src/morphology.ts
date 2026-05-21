import * as Bob from "@bob-plug/core";
import { DictEntry, EntryView, MorphologyItem } from "./types";
import { getCrossReferences, getOriginSources, shouldExpandOriginSources } from "./relations";

export const morphologyLabelOrder = ["原形", "复数", "第三人称单数", "现在分词", "过去式", "过去分词", "比较级", "最高级"];

const EXTRA_PLURALS: Record<string, string[]> = {
  score: ["scores"],
};

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

export function normalizeMorphologyWord(word: string): string {
  return word.toLowerCase();
}

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

// Safety net: Python preprocessing already migrates comparatives from s-slot,
// but ~239 edge cases still require runtime correction. This is idempotent.
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

  for (const [key, words] of exchangeValues.entries()) {
    const label = key === "3"
      ? "第三人称单数"
      : key === "p"
        ? "过去式"
        : key === "d"
          ? "过去分词"
          : key === "i"
            ? "现在分词"
            : key === "s"
              ? "复数"
              : key === "c"
                ? "比较级"
                : key === "sup"
                  ? "最高级"
                  : "";
    if (!label) continue;
    for (const word of words) {
      if (shouldSkip && shouldSkip(label, word)) continue;
      addMorphologyItem(label, word);
    }
  }
}

// Runtime presentation logic: filters British spellings in favor of
// American equivalents. Kept in TypeScript because it's a presentation
// concern, not a data concern.
export function pickPrimaryMorphologyWord(words: string[]) {
  const normalizedWords = new Set(words.map(normalizeMorphologyWord));
  const hiddenWords = new Set<string>();

  for (const [secondary, primary] of preferredPairs) {
    if (!normalizedWords.has(secondary) || !normalizedWords.has(primary)) continue;
    hiddenWords.add(secondary);
  }

  return words.filter((word) => !hiddenWords.has(normalizeMorphologyWord(word)));
}

export function buildMorphologyExchanges(view: EntryView): Bob.ExchangeObject[] {
  if (view.isFallbackDisplay) {
    return view.backRelation
      ? [{ name: view.backRelation.label, words: [view.backRelation.word] }]
      : [];
  }

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

  const hasOriginRelations = getOriginSources(view.entry).length > 0;
  for (const relation of view.childRelations) {
    if (hasOriginRelations && relation.word.toLowerCase() === view.queryWord) {
      continue;
    }
    addMorphologyItem(relation.label, relation.word);
  }

  addExchangeMorphologyFromRawEntry(view.entry, addMorphologyItem, (label, word) => {
    const normalizedWord = word.toLowerCase();
    if (hasOriginRelations && normalizedWord === view.queryWord) return true;
    if (view.backRelation && normalizedWord === view.backRelation.word.toLowerCase()) return true;
    return false;
  });

  const originSources = getOriginSources(view.entry);
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
