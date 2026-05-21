import * as Bob from "@bob-plug/core";

interface PhrasalVerb {
  name: string;
  translation: string;
}

interface TranslationPart {
  pos: string;
  meanings: string[];
}

interface TranslationDetail {
  text: string;
  countability?: "countable" | "uncountable" | "both";
}

interface TranslationDetailPart {
  pos: string;
  details: TranslationDetail[];
}

interface DictEntry {
  word: string;
  phonetic: string;
  phonetic_us: string;
  translation: string;
  pos: string;
  exchange: string;
  translation_parts?: TranslationPart[];
  translation_detail_parts?: TranslationDetailPart[];
  phrasal_verbs?: PhrasalVerb[];
  linked_word?: string;
  entry_kind?: "standalone" | "alias" | "inflection";
  display_word?: string;
  parent_relation?: WordRelation | null;
  child_relations?: WordRelation[];
  cross_references?: WordRelation[];
  inflection_sources?: InflectionSource[];
  relations?: RelationEdge[];
}

interface ShardCache {
  [word: string]: DictEntry;
}

interface WordRelation {
  word: string;
  label: string;
}

interface InflectionSource {
  word: string;
  label: string;
}

interface RelationEdge {
  type: "inflection" | "origin" | "xref" | "lexical_origin" | "defective" | "variant" | "self_loop";
  target: string;
  label: string;
  direction: "outgoing" | "incoming";
  pos_scope?: string[];
  navigable: boolean;
  primary?: boolean;
  display: "exchange" | "reference" | "hidden";
  source: "exchange" | "protected" | "derived" | "manual";
}

interface EntryView {
  queryWord: string;
  displayWord: string;
  entry: DictEntry;
  exactEntry: DictEntry;
  isFallbackDisplay: boolean;
  backRelation: WordRelation | null;
  childRelations: WordRelation[];
}

interface MorphologyItem {
  label: string;
  word: string;
}

interface OriginSource {
  word: string;
  label: string;
  posScope: string[];
}

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

function getBackRelation(entry: DictEntry): WordRelation | null {
  const primaryOrigin = (entry.relations || []).find(
    (edge) => edge.type === "origin" && edge.direction === "outgoing" && edge.primary,
  );
  if (primaryOrigin) {
    return relationEdgeToBackRelation(primaryOrigin);
  }

  const fallbackOrigin = (entry.relations || []).find(
    (edge) => edge.type === "origin" && edge.direction === "outgoing",
  );
  if (fallbackOrigin) {
    return relationEdgeToBackRelation(fallbackOrigin);
  }

  return entry.parent_relation || null;
}

function getChildRelations(entry: DictEntry): WordRelation[] {
  const relationChildren = (entry.relations || [])
    .filter((edge) => edge.type === "inflection" && edge.direction === "outgoing" && edge.display === "exchange" && edge.navigable)
    .map(relationEdgeToWordRelation);

  if (relationChildren.length > 0) {
    return relationChildren;
  }

  return entry.child_relations || [];
}

function getCrossReferences(entry: DictEntry): WordRelation[] {
  const relationRefs = (entry.relations || [])
    .filter((edge) => edge.type === "xref" && edge.direction === "outgoing" && edge.navigable)
    .map(relationEdgeToWordRelation);

  if (relationRefs.length > 0) {
    return relationRefs;
  }

  return entry.cross_references || [];
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

function getOriginSources(entry: DictEntry): OriginSource[] {
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

  if (allSources.length > 0) {
    const seen = new Set<string>();
    return allSources.filter((source) => {
      const key = `${source.word}:${source.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return (entry.inflection_sources || []).map((source) => ({
    word: source.word,
    label: source.label,
    posScope: inflectionPosScopeByLabel[source.label] || [],
  }));
}

function shouldExpandOriginSources(entry: DictEntry): boolean {
  const sources = getOriginSources(entry);

  if (sources.length > 0) {
    const originKeys = new Set(
      sources.map((source) => `${source.label}${source.posScope.join(",")}`),
    );
    if (originKeys.size > 1) return true;
    // Only expand standalone entries that have xref origins (homograph protected forms like saw/see)
    const hasXrefOrigin = (entry.relations || []).some(
      (edge) =>
        edge.type === "xref" &&
        edge.direction === "outgoing" &&
        edge.navigable &&
        inflectionPosScopeByLabel[edge.label],
    );
    if (entry.entry_kind === "standalone" && hasXrefOrigin) return true;
    return false;
  }

  return !entry.parent_relation && (entry.inflection_sources || []).length > 1;
}

const shardCache: Map<string, ShardCache> = new Map();

const inflectionPosScopeByLabel: Record<string, string[]> = {
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

const morphologyLabelOrder = ["原形", "复数", "第三人称单数", "现在分词", "过去式", "过去分词", "比较级", "最高级"];

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

function parsePartsFromEntry(entry: DictEntry): Bob.PartObject[] {
  const translationParts = entry.translation_parts || [];
  if (translationParts.length > 0) {
    const parts = translationParts
      .filter((part) => part.pos && part.meanings && part.meanings.length > 0)
      .map((part) => ({
        part: part.pos,
        means: [...part.meanings],
      }));

    if (parts.length > 0) {
      return parts;
    }
  }

  return parseParts(entry.translation);
}

function getTranslationDetailParts(entry: DictEntry): TranslationDetailPart[] {
  const detailParts = entry.translation_detail_parts || [];
  const normalizedDetailParts = detailParts
    .filter((part) => part.pos && part.details && part.details.length > 0)
    .map((part) => ({
      pos: part.pos,
      details: part.details.filter((detail) => detail.text),
    }))
    .filter((part) => part.details.length > 0);

  if (normalizedDetailParts.length > 0) {
    return normalizedDetailParts;
  }

  return parsePartsFromEntry(entry).map((part) => ({
    pos: part.part,
    details: part.means.map((text) => ({ text })),
  }));
}

function mergeParts(parts: Bob.PartObject[]): Bob.PartObject[] {
  const merged = new Map<string, string[]>();

  for (const part of parts) {
    const existingMeans = merged.get(part.part) || [];
    const nextMeans = [...existingMeans];
    for (const mean of part.means) {
      if (!nextMeans.includes(mean)) {
        nextMeans.push(mean);
      }
    }
    merged.set(part.part, nextMeans);
  }

  return parts
    .map((part) => part.part)
    .filter((part, index, values) => values.indexOf(part) === index)
    .map((part) => ({
      part,
      means: merged.get(part) || [],
    }));
}

function shouldKeepSourceDetail(detail: TranslationDetail, sourceLabel: string, entryKind?: DictEntry["entry_kind"]): boolean {
  if (sourceLabel !== "复数") {
    return true;
  }

  if (entryKind === "standalone") {
    return true;
  }

  if (detail.countability === "uncountable") {
    return false;
  }

  return true;
}

function formatSourceLabel(sourceWord: string, sourceLabel: string): string {
  if (sourceLabel === "复数") {
    return `${sourceWord} 的复数`;
  }

  return `${sourceWord} 的 ${sourceLabel}`;
}

function buildGroupedSourceParts(entry: DictEntry): Bob.PartObject[] {
  const result: Bob.PartObject[] = [];
  const sources = getOriginSources(entry);
  const sourceLabels = new Set(sources.map((source) => formatSourceLabel(source.word, source.label)));

  if (entry.entry_kind === "standalone") {
    const baseParts = getTranslationDetailParts(entry);

    for (const part of baseParts) {
      const texts = part.details
        .map((detail) => detail.text)
        .filter((text) => text && !sourceLabels.has(text));
      if (texts.length === 0) {
        continue;
      }

      result.push({
        part: part.pos,
        means: texts,
      });
    }
  }

  const posPriority: Record<string, number> = { n: 1, v: 2, adj: 3, adv: 4 };
  const sortedSources = [...sources].sort((a, b) => {
    const aP = posPriority[a.posScope[0]] || 99;
    const bP = posPriority[b.posScope[0]] || 99;
    return aP - bP;
  });

  for (const source of sortedSources) {
    const sourceShard = getShardForWord(source.word);
    if (!sourceShard) continue;

    const sourceEntry = sourceShard[source.word.toLowerCase()];
    if (!sourceEntry) continue;

    const sourceParts = getTranslationDetailParts(sourceEntry);
    const texts: string[] = [];

    for (const sourcePart of sourceParts) {
      const posKey = sourcePart.pos.replace(".", "");
      if (source.posScope.length > 0 && !source.posScope.includes(posKey)) {
        continue;
      }

      const partTexts = sourcePart.details
        .filter((detail) => shouldKeepSourceDetail(detail, source.label, entry.entry_kind))
        .map((detail) => detail.text)
        .filter(Boolean);

      for (const text of partTexts) {
        if (!texts.includes(text)) {
          texts.push(text);
        }
      }
    }

    if (texts.length === 0) {
      continue;
    }

    result.push({
      part: `[${formatSourceLabel(source.word, source.label)}]`,
      means: texts,
    });
  }

  return result;
}


function normalizeMorphologyWord(word: string): string {
  return word.toLowerCase();
}

function parseExchangeValues(exchange: string): Map<string, string[]> {
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

function moveSurfaceComparativesIntoExchangeSlots(exchangeValues: Map<string, string[]>, entry: DictEntry): Map<string, string[]> {
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

function addExchangeMorphologyFromRawEntry(
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

function pickPrimaryMorphologyWord(words: string[]): string[] {
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
  const normalizedWords = new Set(words.map(normalizeMorphologyWord));
  const hiddenWords = new Set<string>();

  for (const [secondary, primary] of preferredPairs) {
    if (!normalizedWords.has(secondary) || !normalizedWords.has(primary)) continue;
    hiddenWords.add(secondary);
  }

  return words.filter((word) => !hiddenWords.has(normalizeMorphologyWord(word)));
}

function buildMorphologyExchanges(view: EntryView): Bob.ExchangeObject[] {
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
    return items.findIndex((item) => item.name === exchange.name && item.words.join(" ") === exchange.words.join(" ")) === index;
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
