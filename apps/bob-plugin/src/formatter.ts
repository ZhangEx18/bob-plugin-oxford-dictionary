import * as Bob from "@bob-plug/core";
import { DictEntry, TranslationDetail, TranslationDetailPart } from "./types";
import { getOriginSources } from "./relations";

/** 显示分隔符（不间断空格） */
export const DISPLAY_SEPARATOR = "\u00A0";

/**
 * Regex for parsing translation lines that contain POS (part-of-speech) tags.
 *
 * Matches lines like:
 *   "n. 名词"
 *   "adj. / adv. 形容词/副词"
 *   "phr.v. 短语动词"
 *
 * Capture groups:
 *   Group 1 — the POS tag section (e.g. "n.", "adj. / adv.")
 *   Group 2 — the translation text (e.g. "名词", "形容词/副词")
 *
 * The POS section allows multiple tags separated by "/", each tag ending
 * with a period. Pre-compiled to avoid recompilation on every call.
 */
const TRANSLATION_LINE_REGEX = /^((?:[a-zA-Z0-9+]+\.\s*(?:\/\s*)?)+)\s*(.+)$/;

/** 将翻译文本按行解析为词性-释义对 */
export function parseParts(translation: string): Bob.PartObject[] {
  const parts: Bob.PartObject[] = [];

  for (const line of translation.split("\n")) {
    const match = line.match(TRANSLATION_LINE_REGEX);
    if (!match) continue;

    parts.push({
      part: match[1].trim(),
      means: [match[2]],
    });
  }

  return parts;
}

/**
 * Creates a visual separator part for the UI.
 *
 * Used to visually separate translations from different sources
 * (e.g. the entry's own translation vs. grouped origin-source translations)
 * with a non-breaking space so the layout does not collapse.
 *
 * @returns a PartObject containing only separator characters
 */
export function partSeparator(): Bob.PartObject {
  return { part: DISPLAY_SEPARATOR, means: [DISPLAY_SEPARATOR] };
}

/**
 * Checks whether any part in the array has visible (non-empty) content.
 *
 * A part is considered visible if either its `part` field (the POS label)
 * or at least one of its `means` entries contains non-whitespace text.
 *
 * @param parts - array of PartObjects to check
 * @returns true if at least one part has visible content
 */
export function hasVisibleParts(parts: Bob.PartObject[]): boolean {
  return parts.some((part) => (
    part.part.trim() !== ""
    || part.means.some((mean) => mean.trim() !== "")
  ));
}

/**
 * Extracts internal POS scope keys from a display POS label.
 *
 * Display labels like "adj. / adv." or "n." contain abbreviated POS tags
 * followed by periods. This function extracts the raw tags ("adj", "adv",
 * "n") and deduplicates them, returning the internal scope representation
 * used for filtering and matching.
 *
 * @param partLabel - display POS label, e.g. "adj. / adv."
 * @returns array of unique POS scope strings, e.g. ["adj", "adv"]
 */
export function extractPosScopesFromPart(partLabel: string): string[] {
  const matches = partLabel.toLowerCase().match(/[a-z0-9+]+(?=\.)/g);
  return matches ? [...new Set(matches)] : [];
}

/** 从词条中提取结构化释义（优先使用 translation_parts，回退到 translation 文本解析） */
export function parsePartsFromEntry(entry: DictEntry): Bob.PartObject[] {
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

/** 获取详细释义（优先使用 translation_detail_parts，回退到 parsePartsFromEntry） */
export function getTranslationDetailParts(entry: DictEntry): TranslationDetailPart[] {
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
    details: part.means.map((text: string) => ({ text })),
  }));
}

/** 合并相同词性的释义，去重 */
export function mergeParts(parts: Bob.PartObject[]): Bob.PartObject[] {
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

/**
 * Decides whether to keep a specific translation detail from an origin source.
 *
 * Filtering rules:
 * - Always keep if `sourceLabel` is not "复数" (plural)
 * - Always keep if the current entry is a `standalone` entry
 * - Discard if the detail's `countability` is "uncountable" — showing
 *   plural translations for uncountable nouns is misleading
 * - Otherwise keep
 *
 * This prevents nonsensical translations like showing "apples" (plural)
 * translations for an uncountable sense of "apple".
 *
 * @param detail - translation detail to evaluate
 * @param sourceLabel - origin source label (e.g. "复数", "过去式")
 * @param entryKind - kind of the current entry (standalone / inflection)
 * @returns true if the detail should be included in output
 */
export function shouldKeepSourceDetail(detail: TranslationDetail, sourceLabel: string, entryKind?: DictEntry["entry_kind"]): boolean {
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

/** 格式化来源标签（如 "word 的复数"） */
export function formatSourceLabel(sourceWord: string, sourceLabel: string): string {
  if (sourceLabel === "复数") {
    return `${sourceWord} 的复数`;
  }

  return `${sourceWord} 的 ${sourceLabel}`;
}

/**
 * 构建分组来源释义。
 * 对于多义词（如 "go" 既是动词又是名词），将不同来源的释义按词性分组展示。
 * 例如：查询 "went" 时，会显示 "go 的过去式" 和 "go 的动词释义"。
 */
export function buildGroupedSourceParts(
  entry: DictEntry,
  sourceEntries: Map<string, DictEntry>,
): Bob.PartObject[] {
  const result: Bob.PartObject[] = [];
  const sources = getOriginSources(entry);
  const sourceLabels = new Set(sources.map((source) => formatSourceLabel(source.word, source.label)));

  if (entry.entry_kind === "standalone") {
    const baseParts = getTranslationDetailParts(entry);

    for (const part of baseParts) {
      const texts = part.details
        .map((detail) => detail.text)
        .filter((text) => !!text);
      if (texts.length === 0) {
        continue;
      }

      result.push({
        part: part.pos,
        means: texts,
      });
    }
  }

  /**
   * POS priority for sorting origin sources.
   *
   * Order: noun (n) > verb (v) > adjective (adj) > adverb (adv).
   *
   * Rationale: nouns and verbs are the most semantically central POS
   * categories; showing noun/verb origins first helps users quickly
   * identify the core meaning of an inflected form. Adjectives and
   * adverbs are secondary derivations and are placed later.
   *
   * Unrecognized POS scopes receive a default priority of 99 (last).
   */
  const posPriority: Record<string, number> = { n: 1, v: 2, adj: 3, adv: 4 };
  const sortedSources = [...sources].sort((a, b) => {
    const aP = posPriority[a.posScope[0]] || 99;
    const bP = posPriority[b.posScope[0]] || 99;
    return aP - bP;
  });

  for (const source of sortedSources) {
    const sourceEntry = sourceEntries.get(source.word.toLowerCase());
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
