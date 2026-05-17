import * as Bob from "@bob-plug/core";

interface PhrasalVerb {
  name: string;
  translation: string;
}

interface DictEntry {
  word: string;
  phonetic: string;
  phonetic_us: string;
  translation: string;
  pos: string;
  exchange: string;
  phrasal_verbs?: PhrasalVerb[];
  linked_word?: string;
  entry_kind?: "standalone" | "alias" | "inflection";
  display_word?: string;
  parent_relation?: WordRelation | null;
  child_relations?: WordRelation[];
}

interface ShardCache {
  [word: string]: DictEntry;
}

interface WordRelation {
  word: string;
  label: string;
}

interface EntryView {
  queryWord: string;
  displayWord: string;
  entry: DictEntry;
  isFallbackDisplay: boolean;
  backRelation: WordRelation | null;
  childRelations: WordRelation[];
}

const shardCache: Map<string, ShardCache> = new Map();

const exchangeLabelMap: Record<string, string> = {
  s: "复数",
  "3": "第三人称单数",
  p: "过去式",
  d: "过去分词",
  i: "现在分词",
};

function loadShard(char: string): ShardCache | null {
  if (shardCache.has(char)) {
    return shardCache.get(char)!;
  }

  try {
    const data = $file.read(`dict/${char}.json`);
    if (!data) return null;

    const json = data.toUTF8();
    if (!json) return null;

    const shard = JSON.parse(json) as ShardCache;
    shardCache.set(char, shard);
    return shard;
  } catch {
    return null;
  }
}

function parseExchangeValues(exchange: string): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  if (!exchange) return values;

  for (const item of exchange.split("/")) {
    const sep = item.indexOf(":");
    if (sep <= 0) continue;

    const key = item.slice(0, sep);
    const value = item.slice(sep + 1);
    if (!key || !value) continue;

    if (!values[key]) {
      values[key] = [];
    }
    if (!values[key].includes(value)) {
      values[key].push(value);
    }
  }

  return values;
}

function parseParts(translation: string): Bob.PartObject[] {
  const parts: Bob.PartObject[] = [];

  for (const line of translation.split("\n")) {
    const match = line.match(/^([a-z]+)\.\s*(.+)$/);
    if (!match) continue;

    parts.push({
      part: `${match[1]}.`,
      means: [match[2]],
    });
  }

  return parts;
}

function parseExchanges(exchange: string): Bob.ExchangeObject[] {
  const values = parseExchangeValues(exchange);
  const exchanges: Bob.ExchangeObject[] = [];
  const order = ["s", "3", "i", "p", "d"];

  for (const key of order) {
    const label = exchangeLabelMap[key];
    const words = values[key];
    if (!label || !words || words.length === 0) continue;

    exchanges.push({
      name: label,
      words,
    });
  }

  return exchanges;
}

function getShardForWord(word: string): ShardCache | null {
  const lower = word.toLowerCase();
  return loadShard(lower[0] || "_");
}

function buildEntryView(queryWord: string): EntryView | null {
  const lower = queryWord.toLowerCase();
  const shard = getShardForWord(lower);
  if (!shard) return null;

  const exactEntry = shard[lower] || null;
  if (!exactEntry) return null;

  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;
  const displayEntry = shard[displayWord.toLowerCase()] || exactEntry;
  const isFallbackDisplay = displayWord !== lower;
  const backRelation = exactEntry.parent_relation || null;
  const childRelations = isFallbackDisplay
    ? []
    : (exactEntry.child_relations || displayEntry.child_relations || []).filter((relation) => relation.word !== lower);

  return {
    queryWord: lower,
    displayWord,
    entry: displayEntry,
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

  const parts = parseParts(view.entry.translation);

  const exchanges = view.isFallbackDisplay ? [] : parseExchanges(view.entry.exchange);
  const seenExchangeKeys = new Set(exchanges.map((item) => `${item.name}:${item.words.join("|")}`));

  if (view.backRelation) {
    const key = `${view.backRelation.label}:${view.backRelation.word}`;
    if (!seenExchangeKeys.has(key)) {
      exchanges.push({
        name: view.backRelation.label,
        words: [view.backRelation.word],
      });
      seenExchangeKeys.add(key);
    }
  }

  for (const relation of view.childRelations) {
    const key = `${relation.label}:${relation.word}`;
    if (seenExchangeKeys.has(key)) continue;
    exchanges.push({
      name: relation.label,
      words: [relation.word],
    });
    seenExchangeKeys.add(key);
  }

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
