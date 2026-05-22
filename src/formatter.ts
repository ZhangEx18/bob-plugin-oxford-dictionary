import * as Bob from "@bob-plug/core";
import { DictEntry, TranslationDetail, TranslationDetailPart } from "./types";
import { getOriginSources } from "./relations";

export function parseParts(translation: string): Bob.PartObject[] {
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

export function formatSourceLabel(sourceWord: string, sourceLabel: string): string {
  if (sourceLabel === "复数") {
    return `${sourceWord} 的复数`;
  }

  return `${sourceWord} 的 ${sourceLabel}`;
}

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
