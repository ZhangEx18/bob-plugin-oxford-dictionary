import * as Bob from "@bob-plug/core";
import { DictEntry, EntryView, WordRelation, ShardCache } from "./types";
import { getShardForWord, getCachedEntry } from "./data-loader";
import { getBackRelation, getChildRelations, getOriginSources, shouldExpandOriginSources } from "./relations";
import { buildMorphologyExchanges } from "./morphology";
import { parsePartsFromEntry, buildGroupedSourceParts } from "./formatter";

function resolveDisplayEntry(
  exactEntry: DictEntry,
  shard: ShardCache,
): { displayEntry: DictEntry; isFallbackDisplay: boolean } {
  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;
  const shouldUseExactEntry = shouldExpandOriginSources(exactEntry);
  const displayEntry = shouldUseExactEntry
    ? exactEntry
    : (getCachedEntry(displayWord) || shard[displayWord.toLowerCase()] || exactEntry);
  return {
    displayEntry,
    isFallbackDisplay: displayEntry !== exactEntry,
  };
}

function resolveChildRelations(
  exactEntry: DictEntry,
  displayEntry: DictEntry,
  isFallbackDisplay: boolean,
): WordRelation[] {
  if (isFallbackDisplay) {
    return [];
  }
  return getChildRelations(exactEntry)
    .concat(getChildRelations(displayEntry))
    .filter((relation, index, relations) => {
      return (
        relations.findIndex(
          (item) => item.word === relation.word && item.label === relation.label,
        ) === index
      );
    });
}

function buildEntryView(queryWord: string): EntryView | null {
  const lower = queryWord.toLowerCase();
  const shard = getShardForWord(lower);
  if (!shard) return null;

  const exactEntry = shard[lower] || null;
  if (!exactEntry) return null;

  const { displayEntry, isFallbackDisplay } = resolveDisplayEntry(exactEntry, shard);
  const backRelation = getBackRelation(exactEntry);
  const childRelations = resolveChildRelations(exactEntry, displayEntry, isFallbackDisplay);

  return {
    queryWord: lower,
    displayWord: exactEntry.display_word || exactEntry.linked_word || exactEntry.word,
    entry: displayEntry,
    exactEntry,
    isFallbackDisplay,
    backRelation,
    childRelations,
  };
}

function translate(query: Bob.TranslateQuery, completion: Bob.Completion) {
  if (query.detectFrom !== "en" || !query.text) {
    completion({
      error: { type: "unsupportLanguage", message: "", addtion: "" },
    });
    return;
  }

  const word = query.text.trim();
  if (/\s/.test(word) && !/-/.test(word)) {
    completion({ error: { type: "notFound", message: "", addtion: "" } });
    return;
  }

  const view = buildEntryView(word);
  if (!view) {
    completion({ error: { type: "notFound", message: "", addtion: "" } });
    return;
  }

  const phonetics: Bob.PhoneticObject[] = [];
  if (view.entry.phonetic) {
    phonetics.push({ type: "uk", value: view.entry.phonetic });
  }
  if (view.entry.phonetic_us) {
    phonetics.push({ type: "us", value: view.entry.phonetic_us });
  }

  let parts = parsePartsFromEntry(view.entry);

  if (shouldExpandOriginSources(view.entry)) {
    const sources = getOriginSources(view.entry);
    const sourceEntries = new Map<string, DictEntry>();
    for (const source of sources) {
      const shard = getShardForWord(source.word);
      const entry = shard?.[source.word.toLowerCase()] || getCachedEntry(source.word);
      if (entry) sourceEntries.set(source.word.toLowerCase(), entry);
    }
    parts = buildGroupedSourceParts(view.entry, sourceEntries);
  } else if (view.isFallbackDisplay) {
    const originSources = getOriginSources(view.exactEntry);
    const allowedPos = new Set(originSources.flatMap((s) => s.posScope).map((p) => `${p}.`));
    if (allowedPos.size > 0) {
      parts = parts.filter((p) => allowedPos.has(p.part));
    }
  }

  const exchanges = buildMorphologyExchanges(view).filter((exchange, index, items) => {
    return items.findIndex((item) => item.name === exchange.name && JSON.stringify(item.words) === JSON.stringify(exchange.words)) === index;
  });

  const additions: Bob.AddtionObject[] = [];

  if (!view.isFallbackDisplay && view.entry.phrasal_verbs && view.entry.phrasal_verbs.length > 0) {
    for (const pv of view.entry.phrasal_verbs) {
      additions.push({ name: pv.name, value: pv.translation });
    }
  }

  const result: Bob.TranslateResult = {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [view.queryWord],
    toParagraphs: [],
    toDict: {
      word: view.queryWord,
      phonetics,
      parts,
      exchanges,
      addtions: additions,
    },
    raw: {
      queryWord: view.queryWord,
      displayWord: view.displayWord,
      entry: view.entry,
    },
  };

  completion({ result });
}

function supportLanguages() {
  return ["en", "zh-Hans"];
}

export { translate, supportLanguages };
