import * as Bob from "@bob-plug/core";
import { DictEntry, EntryView } from "./types";
import { getShardForWord } from "./data-loader";
import { getBackRelation, getChildRelations, getOriginSources, shouldExpandOriginSources } from "./relations";
import { buildMorphologyExchanges } from "./morphology";
import { parsePartsFromEntry, buildGroupedSourceParts } from "./formatter";

function buildEntryView(queryWord: string): EntryView | null {
  const lower = queryWord.toLowerCase();
  const shard = getShardForWord(lower);
  if (!shard) return null;

  const exactEntry = shard[lower] || null;
  if (!exactEntry) return null;

  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;
  const shouldUseExactEntry = shouldExpandOriginSources(exactEntry);
  const displayEntry = shouldUseExactEntry ? exactEntry : (shard[displayWord.toLowerCase()] || exactEntry);
  const isFallbackDisplay = displayEntry !== exactEntry;
  const backRelation = getBackRelation(exactEntry);
  const childRelations = isFallbackDisplay
    ? []
    : getChildRelations(exactEntry).concat(getChildRelations(displayEntry)).filter((relation, index, relations) => {
        return relations.findIndex((item) => item.word === relation.word && item.label === relation.label) === index;
      });

  return {
    queryWord: lower,
    displayWord,
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
    parts = buildGroupedSourceParts(view.entry);
  } else if (view.isFallbackDisplay) {
    const originSources = getOriginSources(view.exactEntry);
    const allowedPos = new Set(originSources.flatMap((s) => s.posScope).map((p) => `${p}.`));
    if (allowedPos.size > 0) {
      parts = parts.filter((p) => allowedPos.has(p.part));
    }
  }

  const exchanges = buildMorphologyExchanges(view).filter((exchange, index, items) => {
    return items.findIndex((item) => item.name === exchange.name && item.words.join("") === exchange.words.join("")) === index;
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
