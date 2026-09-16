import { getShardForWord } from "./data-loader";
import { getBackRelation, getChildRelations, resolveTargetWord, shouldExpandOriginSources } from "./relations";
import { DictEntry, EntryView, WordRelation } from "./types";

function resolveDisplayEntry(
  exactEntry: DictEntry,
): { displayEntry: DictEntry; isFallbackDisplay: boolean } {
  const displayWord = resolveTargetWord(exactEntry);
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

/**
 * Whether the entry carries its own definition text.
 *
 * Alias entries are pure redirects, so an alias whose target could not be
 * loaded has no payload of its own.
 */
function hasOwnContent(entry: DictEntry): boolean {
  if (typeof entry.translation === "string" && entry.translation.trim() !== "") return true;
  return Array.isArray(entry.translation_parts) && entry.translation_parts.length > 0;
}

export function buildEntryView(queryWord: string): EntryView | null {
  const normalizedWord = queryWord.toLowerCase();
  const shard = getShardForWord(normalizedWord);
  const exactEntry = shard?.[normalizedWord];
  if (!shard || !exactEntry) return null;

  const { displayEntry, isFallbackDisplay } = resolveDisplayEntry(exactEntry);
  // Being empty is only a miss when nothing else can supply the text. Entries
  // that expand into their origin sources render from those sources instead:
  // inflections like "traveled" carry no content of their own yet display
  // travel's 过去式 / 过去分词 blocks. Reporting a miss for those would send a
  // query that used to resolve straight through to the network.
  if (!shouldExpandOriginSources(exactEntry) && !hasOwnContent(displayEntry)) return null;
  return {
    queryWord: normalizedWord,
    displayWord: resolveTargetWord(exactEntry),
    entry: displayEntry,
    exactEntry,
    isFallbackDisplay,
    backRelation: getBackRelation(exactEntry),
    childRelations: resolveChildRelations(exactEntry, displayEntry, isFallbackDisplay),
  };
}
