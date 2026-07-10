import * as Bob from "@bob-plug/core";
import { getCachedEntry, getShardForWord } from "./data-loader";
import {
  buildGroupedSourceParts,
  extractPosScopesFromPart,
  hasVisibleParts,
  parseParts,
  parsePartsFromEntry,
  partSeparator,
} from "./formatter";
import { buildMorphologyExchanges } from "./morphology";
import { getOriginSources, getWordFamily, shouldExpandOriginSources } from "./relations";
import { DictEntry, EntryView, WordFamilyItem } from "./types";

function buildPhonetics(entry: DictEntry): Bob.PhoneticObject[] {
  const phonetics: Bob.PhoneticObject[] = [];
  if (entry.phonetic) phonetics.push({ type: "uk", value: entry.phonetic });
  if (entry.phonetic_us) phonetics.push({ type: "us", value: entry.phonetic_us });
  return phonetics;
}

function collectSourceEntries(entry: DictEntry): Map<string, DictEntry> {
  const sourceEntries = new Map<string, DictEntry>();
  for (const source of getOriginSources(entry)) {
    const sourceKey = source.word.toLowerCase();
    const sourceEntry = getShardForWord(source.word)?.[sourceKey]
      || getCachedEntry(source.word);
    if (sourceEntry) sourceEntries.set(sourceKey, sourceEntry);
  }
  return sourceEntries;
}

function buildParts(view: EntryView): Bob.PartObject[] {
  const entryParts = parsePartsFromEntry(view.entry);
  if (shouldExpandOriginSources(view.entry)) {
    return buildGroupedSourceParts(view.entry, collectSourceEntries(view.entry));
  }
  if (!view.isFallbackDisplay) return entryParts;

  const allowedPos = new Set(
    getOriginSources(view.exactEntry).flatMap((source) => source.posScope),
  );
  if (allowedPos.size === 0) return entryParts;
  return entryParts.filter((part) => (
    extractPosScopesFromPart(part.part).some((scope) => allowedPos.has(scope))
  ));
}

function uniqueExchanges(view: EntryView): Bob.ExchangeObject[] {
  const seen = new Set<string>();
  return buildMorphologyExchanges(view).filter((exchange) => {
    const key = `${exchange.name}:${exchange.words.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendPhrasalVerbs(view: EntryView, parts: Bob.PartObject[]): void {
  const phrases = view.entry.phrasal_verbs || [];
  if (view.isFallbackDisplay || view.entry.entry_kind !== "standalone" || phrases.length === 0) {
    return;
  }
  if (hasVisibleParts(parts)) parts.push(partSeparator());

  for (const phrase of phrases) {
    const phraseParts = parseParts(phrase.translation);
    parts.push({
      part: phrase.name,
      means: phraseParts.length > 0
        ? phraseParts.flatMap((part) => part.means.map(
            (meaning) => `${part.part === "phrv." ? "v." : part.part} ${meaning}`,
          ))
        : [phrase.translation],
    });
  }
}

function buildRelatedWords(
  wordFamily: WordFamilyItem[],
): Bob.RelatedWordPartObject[] | undefined {
  if (wordFamily.length === 0) return undefined;
  return [{
    words: wordFamily.map((family) => ({
      word: family.word,
      means: family.pos ? [family.pos] : [],
    })),
  }];
}

export function buildOaldResult(view: EntryView): Bob.TranslateResult {
  const parts = buildParts(view);
  appendPhrasalVerbs(view, parts);
  const wordFamily = getWordFamily(view.entry);
  const additions: Bob.AddtionObject[] = [];

  return {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [view.queryWord],
    toParagraphs: [],
    toDict: {
      word: view.queryWord,
      phonetics: buildPhonetics(view.entry),
      parts,
      exchanges: uniqueExchanges(view),
      relatedWordParts: buildRelatedWords(wordFamily),
      additions,
      addtions: additions,
    },
    raw: {
      provider: "oald",
      queryWord: view.queryWord,
      displayWord: view.displayWord,
      entry: view.entry,
      wordFamily,
    },
  };
}
