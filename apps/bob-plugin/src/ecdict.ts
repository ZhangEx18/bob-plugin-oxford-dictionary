import * as Bob from "@bob-plug/core";
import { EcdictEntry } from "./types";
import { queryEcdictEntry } from "./ecdict-loader";

/**
 * Parses an ECDICT exchange string into Bob ExchangeObject array.
 *
 * ECDICT exchange format: "p:went/d:gone/i:going/3:goes/s:goes/0:go"
 * Key mapping:
 *   0 → lemma (原形)
 *   p → 过去式 (past tense)
 *   d → 过去分词 (past participle)
 *   i → 现在分词 (present participle)
 *   3 → 第三人称单数 (3rd person singular)
 *   s → 复数 (plural)
 *
 * Each pair is separated by '/', key and value by ':'.
 * Unknown numeric keys beyond the standard set are ignored.
 *
 * @param exchange - Raw ECDICT exchange string, e.g. "p:went/d:gone/i:going"
 * @returns Array of Bob ExchangeObject with Chinese labels
 */
export function parseEcdictExchange(exchange: string): Bob.ExchangeObject[] {
  if (!exchange) return [];

  /** ECDICT exchange key → Chinese label mapping */
  const EXCHANGE_LABELS: Record<string, string> = {
    "0": "原形",
    "p": "过去式",
    "d": "过去分词",
    "i": "现在分词",
    "3": "第三人称单数",
    "s": "复数",
  };

  const results: Bob.ExchangeObject[] = [];

  for (const segment of exchange.split("/")) {
    const colonIndex = segment.indexOf(":");
    if (colonIndex === -1) continue;

    const key = segment.substring(0, colonIndex);
    const value = segment.substring(colonIndex + 1);
    if (!value) continue;

    const label = EXCHANGE_LABELS[key];
    if (!label) continue; // Skip unknown keys

    results.push({ name: label, words: [value] });
  }

  return results;
}

/**
 * Builds a Bob TranslateResult from an ECDICT entry.
 *
 * ECDICT provides a simpler dictionary result than OALD — no relation graph,
 * no word family, no phrasal verbs. The output is intentionally minimal:
 *
 * - phonetics: single IPA entry (ECDICT has only one phonetic field)
 * - parts: parsed from the translation field using ECDICT's POS-prefixed format
 * - exchanges: morphology extracted from the ECDICT exchange string
 * - raw.provider: "ecdict" to identify the source for downstream inspection
 *
 * Key design decisions (per constraints):
 * - ECDICT results never mix with OALD display — completely independent format
 * - raw.provider is "ecdict" so callers can distinguish the data source
 * - No RelationEdge, no WordFamilyItem, no phrasal_verbs
 *
 * @param entry - The ECDICT entry to convert
 * @param queryWord - The original query word (lowercased)
 * @returns Bob.TranslateResult for display in Bob
 */
export function buildEcdictResult(entry: EcdictEntry, queryWord: string): Bob.TranslateResult {
  // --- Phonetics ---
  // ECDICT has a single phonetic field; surface it as UK IPA (standard).
  const phonetics: Bob.PhoneticObject[] = [];
  if (entry.phonetic) {
    // Strip wrapping brackets/slashes that ECDICT sometimes includes
    const cleaned = entry.phonetic.trim().replace(/^[\[/]+/, "").replace(/[\]/]+$/, "");
    if (cleaned) {
      phonetics.push({ type: "uk", value: cleaned });
    }
  }

  // --- Parts (definitions) ---
  // ECDICT translation format: each line is "pos. translation"
  // e.g. "n. 苹果\nv. 苹果公司"
  // If pos is empty, the whole translation is used with a generic label.
  const parts: Bob.PartObject[] = [];
  if (entry.translation) {
    for (const line of entry.translation.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to split into "pos." prefix and meaning
      const match = trimmed.match(/^((?:[a-zA-Z0-9+]+\.\s*(?:\/\s*)?)+)\s*(.+)$/);
      if (match) {
        parts.push({ part: match[1].trim(), means: [match[2]] });
      } else {
        // No POS prefix — use entire line as meaning with generic label
        parts.push({ part: "释义", means: [trimmed] });
      }
    }
  }

  // If translation is empty but pos has content, show POS with the word itself
  if (parts.length === 0 && entry.pos) {
    const posParts = entry.pos.trim().split(/\s+/).filter(Boolean);
    for (const pos of posParts) {
      parts.push({ part: `${pos}.`, means: [queryWord] });
    }
  }

  // --- Exchanges (morphology) ---
  const exchanges = parseEcdictExchange(entry.exchange);

  // --- Assemble result ---
  const additions: Bob.AddtionObject[] = [];

  return {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [queryWord],
    toParagraphs: [],
    toDict: {
      word: queryWord,
      phonetics,
      parts,
      exchanges,
      additions,
      addtions: additions,
    },
    raw: {
      provider: "ecdict",
      queryWord,
      entry,
    },
  };
}