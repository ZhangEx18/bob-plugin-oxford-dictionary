import { getCachedEntry, getShardForWord } from "./data-loader";
import { getBackRelation, getChildRelations, shouldExpandOriginSources } from "./relations";
import { DictEntry, EntryView, ShardCache, WordRelation } from "./types";

function resolveDisplayEntry(
  exactEntry: DictEntry,
  shard: ShardCache,
): { displayEntry: DictEntry; isFallbackDisplay: boolean } {
  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;
  const displayEntry = shouldExpandOriginSources(exactEntry)
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
  // Inflection pages only link back to their canonical entry.
  if (isFallbackDisplay) return [];

  const seen = new Set<string>();
  return getChildRelations(exactEntry)
    .concat(getChildRelations(displayEntry))
    .filter((relation) => {
      const key = `${relation.word}:${relation.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildEntryView(queryWord: string): EntryView | null {
  const normalizedWord = queryWord.toLowerCase();
  const shard = getShardForWord(normalizedWord);
  const exactEntry = shard?.[normalizedWord];
  if (!shard || !exactEntry) return null;

  const { displayEntry, isFallbackDisplay } = resolveDisplayEntry(exactEntry, shard);
  return {
    queryWord: normalizedWord,
    displayWord: exactEntry.display_word || exactEntry.linked_word || exactEntry.word,
    entry: displayEntry,
    exactEntry,
    isFallbackDisplay,
    backRelation: getBackRelation(exactEntry),
    childRelations: resolveChildRelations(exactEntry, displayEntry, isFallbackDisplay),
  };
}
