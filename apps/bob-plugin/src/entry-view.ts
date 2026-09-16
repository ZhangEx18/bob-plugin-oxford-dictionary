import { getShardForWord } from "./data-loader";
import { getBackRelation, getChildRelations, shouldExpandOriginSources } from "./relations";
import { DictEntry, EntryView, WordRelation } from "./types";

function resolveDisplayEntry(
  exactEntry: DictEntry,
): { displayEntry: DictEntry; isFallbackDisplay: boolean } {
  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;
  // Resolve through getShardForWord so the target's shard is loaded on demand.
  // Reading it out of a global pool instead made the outcome depend on which
  // shards happened to be loaded already: the same query returned the alias's
  // copied content in one session and the resolved target in another.
  const displayEntry = shouldExpandOriginSources(exactEntry)
    ? exactEntry
    : (getShardForWord(displayWord)?.[displayWord.toLowerCase()] || exactEntry);

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

  const { displayEntry, isFallbackDisplay } = resolveDisplayEntry(exactEntry);
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
