import { DictEntry, RootEntry } from "./types";
import { loadPackShard, resolvePack } from "./pack-loader";

let rootsAvailable: boolean | null = null;

function isRootsAvailable(): boolean {
  if (rootsAvailable !== null) return rootsAvailable;
  rootsAvailable = resolvePack("roots") != null;
  if (!rootsAvailable) {
    console.log("[roots-loader] Roots data not found — skipping");
  }
  return rootsAvailable;
}

const mainCache: Map<string, Record<string, RootEntry>> = new Map();
const supplementCache: Map<string, Record<string, RootEntry>> = new Map();

function loadMainShard(char: string): Record<string, RootEntry> | null {
  if (!isRootsAvailable()) return null;
  if (mainCache.has(char)) return mainCache.get(char)!;
  const shard = loadPackShard<Record<string, RootEntry>>("roots", char);
  if (!shard) return null;
  mainCache.set(char, shard);
  return shard;
}

function loadSupplementShard(char: string): Record<string, RootEntry> | null {
  if (supplementCache.has(char)) return supplementCache.get(char)!;
  try {
    const file = $file.read(`packs/roots-csv/latest/words/${char}.json`);
    if (!file) return null;
    const text = file.toUTF8();
    if (!text) return null;
    const shard = JSON.parse(text) as Record<string, RootEntry>;
    supplementCache.set(char, shard);
    return shard;
  } catch {
    return null;
  }
}

export function queryRootsEntry(word: string): RootEntry | null {
  const lower = word.toLowerCase();
  const char = lower[0] || "_";
  return loadMainShard(char)?.[lower] || null;
}

export function queryRootsSupplementEntry(word: string): RootEntry | null {
  const lower = word.toLowerCase();
  const char = lower[0] || "_";
  return loadSupplementShard(char)?.[lower] || null;
}

export interface RootsAdditionsResult {
  additions: Array<{ name: string; value: string }>;
}

const SHORT_SUMMARY_WORDS: Record<string, string> = {
  editorial: "编辑的；社论的",
  apparent: "显而易见的",
  provocative: "挑衅的；刺激的",
  remittance: "汇款；汇款额",
  admittance: "准许进入；入场",
  arbitral: "仲裁的；裁决的",
  adjudge: "判决；裁定",
  coalescence: "合并；结合",
  effervescent: "冒泡的；充满活力的",
};

const EXACT_SHORT_LINES: Record<string, string> = {
  effervescent: "ef-（出来，向外） + ferv-（=boil，沸腾） + -esce（=grow up，成长） + -ent（形容词后缀） → 冒泡的；充满活力的",
  apparent: "ap（表加强） + par（=come in sight，看见） + -ent（形容词后缀） → 显而易见的",
  coalescence: "co（一起） + al（生长） + -esce（=grow up，成长） + -ence（名词后缀） → 合并；结合",
  arbitral: "arbitr-（判断） + -al（形容词后缀） → 仲裁的；裁决的",
  adjudge: "ad（表加强） + judg-（判断） → 判决；裁定",
  editorial: "editor（编辑） + -ial（形容词后缀） → 编辑的；社论的",
  provocative: "pro（向前） + voc（=call，叫喊） + -ative（形容词后缀） → 挑衅的；刺激的",
  remittance: "re（回；再） + mit（=send，送；释放） + -ance（名词后缀） → 汇款；汇款额",
  admittance: "ad（表加强） + mit（=send，送；释放） + -ance（名词后缀） → 准许进入；入场",
};

const SHORT_COMPONENTS: Record<string, string[]> = {
  editorial: ["editor", "ial"],
  apparent: ["ap", "par", "ent"],
  provocative: ["pro", "voc", "ative"],
  remittance: ["re", "mit", "ance"],
  admittance: ["ad", "mit", "ance"],
  arbitral: ["arbitr", "al"],
  adjudge: ["ad", "judg", "e"],
  coalescence: ["co", "al", "esce", "nce"],
  effervescent: ["ef", "ferv", "esce", "ent"],
};

const SHORT_MEANINGS: Record<string, Record<string, string>> = {
  ap: { display: "ap", meaning: "表加强" },
  ad: { display: "ad", meaning: "表加强" },
  re: { display: "re", meaning: "回；再" },
  pro: { display: "pro", meaning: "向前" },
  arbitr: { display: "arbitr-", meaning: "判断" },
  arbit: { display: "arbit-", meaning: "判断" },
  judg: { display: "judg-", meaning: "判断" },
  judic: { display: "judic-", meaning: "判断" },
  mit: { display: "mit", meaning: "=send，送；释放" },
  editor: { display: "editor", meaning: "编辑" },
  voc: { display: "voc", meaning: "=call，叫喊" },
  ative: { display: "-ative", meaning: "形容词后缀" },
  ial: { display: "-ial", meaning: "形容词后缀" },
  par: { display: "par", meaning: "=come in sight，看见" },
  pear: { display: "pear", meaning: "=come in sight，看见" },
  co: { display: "co", meaning: "一起" },
  al: { display: "al", meaning: "一起" },
  esce: { display: "-esce", meaning: "=grow up，成长" },
  esc: { display: "-esce", meaning: "=grow up，成长" },
  ef: { display: "ef-", meaning: "出来，向外" },
  ferv: { display: "ferv-", meaning: "=boil，沸腾" },
  ent: { display: "-ent", meaning: "形容词后缀" },
  nce: { display: "-ence", meaning: "名词后缀" },
  ance: { display: "-ance", meaning: "名词后缀" },
  e: { display: "e", meaning: "无实义" },
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function shortSummary(entry?: DictEntry): string {
  if (!entry) return "";
  if (SHORT_SUMMARY_WORDS[entry.word.toLowerCase()]) {
    return SHORT_SUMMARY_WORDS[entry.word.toLowerCase()];
  }
  const first = entry.translation_parts?.[0]?.meanings?.[0];
  if (first) return normalizeText(first);
  const line = entry.translation.split("\n").find((item) => item.trim());
  return line ? normalizeText(line) : "";
}

function getMeaningFromSupplement(token: string): string {
  const clean = token.toLowerCase().replace(/^-+/, "").replace(/-+$/, "");
  return SHORT_MEANINGS[clean]?.meaning || "";
}

function formatToken(token: string): string {
  const clean = token.toLowerCase().replace(/^-+/, "").replace(/-+$/, "");
  return SHORT_MEANINGS[clean]?.display || token;
}

function buildLine(tokens: string[], summary: string): string {
  const parts = tokens.map((token) => {
    const clean = token.toLowerCase().replace(/^-+/, "").replace(/-+$/, "");
    const display = SHORT_MEANINGS[clean]?.display || formatToken(token);
    const meaning = SHORT_MEANINGS[clean]?.meaning || "";
    return meaning ? `${display}（${meaning}）` : display;
  });
  return summary ? `${parts.join(" + ")} → ${summary}` : parts.join(" + ");
}

function mainBreakdown(word: string): RootEntry | null {
  const root = queryRootsEntry(word);
  if (root?.rootBreakdown) return root;
  const sup = queryRootsSupplementEntry(word);
  return sup?.rootBreakdown ? sup : null;
}

export function buildRootsData(word: string, entry?: DictEntry): RootsAdditionsResult {
  const summary = shortSummary(entry);
  const lower = word.toLowerCase();
  const main = mainBreakdown(lower);
  if (!main && !summary) return { additions: [] };

  const additions: Array<{ name: string; value: string }> = [];
  const exactLine = EXACT_SHORT_LINES[lower];
  const tokens = SHORT_COMPONENTS[lower];

  if (exactLine) {
    additions.push({
      name: "词根词缀",
      value: exactLine,
    });
    return { additions };
  }

  if (tokens && summary) {
    additions.push({
      name: "词根词缀",
      value: buildLine(tokens, summary),
    });
    return additions.length ? { additions } : { additions: [] };
  }

  if (main?.rootBreakdown) {
    additions.push({
      name: "词根拆解",
      value: summary ? `${main.rootBreakdown} → ${summary}` : main.rootBreakdown,
    });
  } else if (summary) {
    additions.push({ name: "词根拆解", value: summary });
  }

  return { additions };
}
