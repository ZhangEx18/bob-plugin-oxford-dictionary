import * as Bob from "@bob-plug/core";
import { YoudaoDictResponse, YoudaoWordEntry } from "./youdao-types";

function firstWordEntry(
  value: YoudaoWordEntry | YoudaoWordEntry[] | undefined,
): YoudaoWordEntry | null {
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function extractYoudaoWord(response: YoudaoDictResponse): YoudaoWordEntry | null {
  return firstWordEntry(response.ec?.word) || firstWordEntry(response.ce?.word);
}

function normalizeMeaning(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("") : (value || "");
}

function addMeaning(partMap: Map<string, string[]>, pos: string, meaning: string): void {
  const normalizedMeaning = meaning.trim();
  if (!normalizedMeaning) return;
  const normalizedPos = pos.trim() || "释义";
  const meanings = partMap.get(normalizedPos) || [];
  if (!meanings.includes(normalizedMeaning)) {
    partMap.set(normalizedPos, [...meanings, normalizedMeaning]);
  }
}

function buildPartMap(
  entry: YoudaoWordEntry | null,
  response: YoudaoDictResponse,
): Map<string, string[]> {
  const partMap = new Map<string, string[]>();
  for (const translation of entry?.trs || []) {
    if (translation.tran) addMeaning(partMap, translation.pos || "", translation.tran);
    for (const nested of translation.tr || []) {
      addMeaning(partMap, translation.pos || "", normalizeMeaning(nested.l?.i));
    }
  }
  if (partMap.size === 0) {
    for (const translation of response.ee?.word?.trs || []) {
      for (const nested of translation.tr || []) {
        addMeaning(partMap, translation.pos || "", nested.tran || "");
      }
    }
  }
  return partMap;
}

function normalizePhonetic(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^[\[/]+/, "").replace(/[\]/]+$/, "");
}

function buildPhonetics(
  entry: YoudaoWordEntry | null,
  response: YoudaoDictResponse,
): Bob.PhoneticObject[] {
  const phonetics: Bob.PhoneticObject[] = [];
  const ukPhone = normalizePhonetic(entry?.ukphone);
  const usPhone = normalizePhonetic(entry?.usphone);
  if (ukPhone) phonetics.push({ type: "uk", value: ukPhone });
  if (usPhone) phonetics.push({ type: "us", value: usPhone });
  if (phonetics.length === 0) {
    const phone = normalizePhonetic(entry?.phone || response.ee?.word?.phone);
    if (phone) phonetics.push({ type: "uk", value: phone });
  }
  if (phonetics.length === 0 && entry?.usspeech) {
    phonetics.push({ type: "us", value: entry.usspeech });
  }
  if (phonetics.length === 0 && entry?.ukspeech) {
    phonetics.push({ type: "uk", value: entry.ukspeech });
  }
  return phonetics;
}

function buildExchanges(entry: YoudaoWordEntry | null): Bob.ExchangeObject[] {
  const exchanges: Bob.ExchangeObject[] = [];
  for (const wordForm of entry?.wfs || []) {
    const name = wordForm.wf?.name?.trim();
    const value = wordForm.wf?.value?.trim();
    if (name && value) exchanges.push({ name, words: [value] });
  }
  if (entry?.prototype) exchanges.push({ name: "原形", words: [entry.prototype] });
  return exchanges;
}

export function convertDictToResult(
  word: string,
  response: YoudaoDictResponse,
): Bob.TranslateResult | null {
  const entry = extractYoudaoWord(response);
  const partMap = buildPartMap(entry, response);
  if (partMap.size === 0) return null;

  const additions: Bob.AddtionObject[] = [];
  return {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [word],
    toParagraphs: [],
    toDict: {
      word,
      phonetics: buildPhonetics(entry, response),
      parts: [...partMap.entries()].map(([part, means]) => ({ part, means })),
      exchanges: buildExchanges(entry),
      additions,
      addtions: additions,
    },
    raw: { provider: "youdao-dict", source: response },
  };
}
