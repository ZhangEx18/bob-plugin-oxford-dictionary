import * as Bob from "@bob-plug/core";
import { DictEntry, EntryView, WordRelation, ShardCache } from "./types";
import { getShardForWord, getCachedEntry } from "./data-loader";
import { getBackRelation, getChildRelations, getCrossReferences, getOriginSources, getWordFamily, shouldExpandOriginSources } from "./relations";
import { buildMorphologyExchanges } from "./morphology";
import { parseParts, parsePartsFromEntry, buildGroupedSourceParts, extractPosScopesFromPart, hasVisibleParts, partSeparator } from "./formatter";
import { isWordQuery, queryYoudaoDictionary, queryYoudaoTranslation, getYoudaoLanguages } from "./youdao";
import { queryEcdictEntry } from "./ecdict-loader";
import { buildEcdictResult } from "./ecdict";

/**
 * Resolves the display entry for a queried word.
 *
 * When a user queries an inflection (e.g. "went") or alias, the exactEntry
 * only contains minimal metadata (no definitions). This function finds the
 * canonical (standalone) entry that actually holds the definitions to display.
 *
 * Resolution chain (fallback order):
 * 1. If shouldExpandOriginSources returns true (polysemous word with multiple
 *    origins, e.g. "go" as both verb and noun), use exactEntry directly —
 *    its definitions will be grouped by origin in buildOaldResult.
 * 2. Otherwise, look up the display_word / linked_word / word in order:
 *    a. getCachedEntry(displayWord) — checks the global entry cache first
 *    b. shard[displayWord.toLowerCase()] — falls back to the same shard
 *    c. exactEntry — final fallback to avoid returning null
 *
 * @param exactEntry - The DictEntry for the exact queried word (may be inflection/alias)
 * @param shard - The shard dictionary containing all entries in the same shard
 * @returns displayEntry - The entry whose definitions should be shown
 * @returns isFallbackDisplay - True if displayEntry !== exactEntry (meaning we redirected)
 */
function resolveDisplayEntry(
  exactEntry: DictEntry,
  shard: ShardCache,
): { displayEntry: DictEntry; isFallbackDisplay: boolean } {
  // Determine which word's definitions should be displayed.
  // display_word is set by preprocessing for inflections that should show
  // a different headword (e.g. querying "geese" shows "goose").
  const displayWord = exactEntry.display_word || exactEntry.linked_word || exactEntry.word;

  // For polysemous entries with multiple origin sources, we keep the exactEntry
  // and let buildOaldResult expand the grouped source parts instead.
  const shouldUseExactEntry = shouldExpandOriginSources(exactEntry);

  // Fallback chain: cache -> shard -> self. Each step handles a different case:
  // - getCachedEntry: hits when the target word was already loaded in a previous query
  // - shard lookup: hits when target word is in the same shard (most common)
  // - exactEntry: safety net for words with no resolvable canonical form
  const displayEntry = shouldUseExactEntry
    ? exactEntry
    : (getCachedEntry(displayWord) || shard[displayWord.toLowerCase()] || exactEntry);

  return {
    displayEntry,
    isFallbackDisplay: displayEntry !== exactEntry,
  };
}

/**
 * Merges child relations (inflections) from both exactEntry and displayEntry.
 *
 * When isFallbackDisplay is true (the queried word is an inflection/alias),
 * we return an empty array to avoid showing the canonical word's inflections
 * on the inflection's own page — that would be confusing (e.g. showing "goes"
 * on the "went" page).
 *
 * Deduplication strategy: combine child relations from both entries, then
 * filter by (word + label) uniqueness. This handles cases where the exactEntry
 * and displayEntry share some inflection edges (e.g. both list the same plural
 * form) — we only want to show each once.
 *
 * Note: XREF (cross-reference) relations are handled separately by
 * getCrossReferences in morphology.ts, not here.
 *
 * @param exactEntry - The DictEntry for the exact queried word
 * @param displayEntry - The resolved canonical entry (may be same as exactEntry)
 * @param isFallbackDisplay - True if we're showing a canonical entry for an inflection/alias
 * @returns Array of unique child WordRelations to display
 */
function resolveChildRelations(
  exactEntry: DictEntry,
  displayEntry: DictEntry,
  isFallbackDisplay: boolean,
): WordRelation[] {
  // When showing a canonical entry for an inflection, suppress child relations.
  // The canonical page (e.g. "go") will show its own inflections when queried directly.
  if (isFallbackDisplay) {
    return [];
  }

  // Merge inflections from both entries and deduplicate by (word, label) pair.
  // This is O(n^2) but n is typically very small (< 10 inflections per word).
  return getChildRelations(exactEntry)
    .concat(getChildRelations(displayEntry))
    .filter((relation, index, relations) => {
      return (
        relations.findIndex(
          (item) => item.word === relation.word && item.label === relation.label,
        ) === index
      );
    });
}

/**
 * Builds the complete entry view for a queried word.
 *
 * This is the core data assembly function that orchestrates:
 * 1. Shard lookup — find the JSON shard containing the word
 * 2. Exact entry retrieval — get the DictEntry for the queried word
 * 3. Display entry resolution — redirect inflections/aliases to canonical forms
 * 4. Relation collection — gather back-relations and child inflections
 *
 * The returned EntryView contains everything needed to render a dictionary
 * result, separating the "what was queried" (exactEntry) from "what to show"
 * (entry/displayEntry).
 *
 * @param queryWord - The raw word string from user input
 * @returns EntryView with all resolved data, or null if word not found in any shard
 */
function buildEntryView(queryWord: string): EntryView | null {
  // Normalize to lowercase for consistent shard key matching.
  const lower = queryWord.toLowerCase();

  // Look up the shard that contains this word. Shards are loaded on-demand
  // and cached by data-loader.ts.
  const shard = getShardForWord(lower);
  if (!shard) return null;

  // Get the exact entry for the queried word. If the word exists in the
  // dictionary, it must be in its shard (shard keys are lowercase words).
  const exactEntry = shard[lower] || null;
  if (!exactEntry) return null;

  // Resolve which entry's definitions to display (handles inflection/alias redirection).
  const { displayEntry, isFallbackDisplay } = resolveDisplayEntry(exactEntry, shard);

  // Get the back-relation (link to canonical form) for inflections/aliases.
  const backRelation = getBackRelation(exactEntry);

  // Collect child inflection relations, with deduplication and fallback-aware filtering.
  const childRelations = resolveChildRelations(exactEntry, displayEntry, isFallbackDisplay);

  return {
    queryWord: lower,
    displayWord: exactEntry.display_word || exactEntry.linked_word || exactEntry.word,
    entry: displayEntry,
    exactEntry,
    isFallbackDisplay,
    backRelation,
    childRelations,
  };
}

/**
 * Main translation entry point for the Bob plugin.
 *
 * This is the top-level routing function that decides how to handle each query.
 * It implements a two-route strategy:
 *
 * Route 1 — English word query (single token, hyphenated allowed):
 *   Step 1: Try OALD offline dictionary first (fast, structured, no network)
 *   Step 2: If OALD miss, try ECDICT offline dictionary (broad coverage, no network)
 *   Step 3: If ECDICT also miss, fallback to Youdao dictionary API (online, structured)
 *   Step 4: If Youdao dict also miss, fallback to Youdao translation API (general translation)
 *   Step 5: If all fail, return notFound error
 *
 * Route 2 — Multi-word phrase or non-English query:
 *   Directly call Youdao translation API for general text translation.
 *
 * The Promise chain in Route 1 is designed to cascade through fallbacks:
 *   queryYoudaoDictionary() -> then() [if hit, complete; if miss, chain to translation]
 *   -> then() [handle translation result or notFound]
 *   -> catch() [network errors]
 *
 * @param query - Bob TranslateQuery containing text, source/target language info
 * @param completion - Bob Completion callback to return result or error
 * @sideEffects Calls completion() exactly once per invocation (Bob contract)
 */
function translate(query: Bob.TranslateQuery, completion: Bob.Completion) {
  // Guard against null/undefined query and non-string text.
  // Bob may pass malformed queries in edge cases (e.g. OCR failures).
  if (!query || typeof query.text !== "string") {
    completion({
      error: { type: "unsupportLanguage", message: "Invalid query", addtion: "" },
    });
    return;
  }

  const text = query.text.trim();
  if (!text) {
    completion({
      error: { type: "unsupportLanguage", message: "Empty query", addtion: "" },
    });
    return;
  }

  // Determine target language (default to zh-Hans if not specified).
  const targetLang = query.detectTo || "zh-Hans";
  const sourceLang = query.detectFrom || "auto";

  // Route 1: English word query -> OALD first, then Youdao fallback chain.
  // isWordQuery checks for single tokens with only letters and hyphens.
  if ((sourceLang === "en" || sourceLang === "auto") && isWordQuery(text)) {
    const view = buildEntryView(text);
    if (view) {
      // OALD hit — build structured result from offline dictionary data.
      const result = buildOaldResult(view);
      completion({ result });
      return;
    }

    // OALD miss — try ECDICT offline fallback before hitting the network.
    // ECDICT only participates in English single-word queries (already gated by isWordQuery).
    const ecdictEntry = queryEcdictEntry(text);
    if (ecdictEntry) {
      // ECDICT hit — return offline dictionary result and skip Youdao entirely.
      const result = buildEcdictResult(ecdictEntry, text);
      completion({ result });
      return;
    }

    // ECDICT miss — start the Youdao fallback chain.
    // This branch is kept isolated from OALD rendering so that missing words
    // can evolve independently without perturbing the offline dictionary path.
    queryYoudaoDictionary(text)
      // Step 1: Try Youdao dictionary API (structured dictionary data).
      .then((youdaoResult) => {
        if (youdaoResult) {
          // Youdao dict hit — return structured result and end the chain.
          completion({ result: youdaoResult });
          return null; // Signal to next then() that we're done.
        }
        // Youdao dict miss — chain to general translation API.
        return queryYoudaoTranslation(text, sourceLang, targetLang);
      })
      // Step 2: Handle the translation result (or skip if already completed).
      .then((transResult) => {
        if (transResult === null) return; // Already handled in previous then().
        if (transResult) {
          completion({ result: transResult });
        } else {
          // All fallbacks exhausted — word not found anywhere.
          completion({ error: { type: "notFound", message: "", addtion: "" } });
        }
      })
      // Step 3: Catch network errors from either API call.
      .catch((err) => {
        completion({
          error: { type: "network", message: String(err), addtion: "" },
        });
      });
    return;
  }

  // Route 2: Multi-word phrase or non-English -> Youdao translation directly.
  queryYoudaoTranslation(text, sourceLang, targetLang)
    .then((transResult) => {
      if (transResult) {
        completion({ result: transResult });
      } else {
        completion({ error: { type: "notFound", message: "Translation failed", addtion: "" } });
      }
    })
    .catch((err) => {
      completion({
        error: { type: "network", message: String(err), addtion: "" },
      });
    });
}

/**
 * Assembles the final Bob TranslateResult from an OALD EntryView.
 *
 * This function transforms the internal EntryView representation into the
 * Bob plugin's expected result format, handling four major components:
 *
 * 1. Phonetics — extracts UK and US IPA from the display entry
 * 2. Parts (definitions) — handles three modes:
 *    a. Origin expansion: for polysemous words, group definitions by source word
 *    b. Fallback display: filter definitions to only show POS-matching senses
 *    c. Normal: use the entry's definitions directly
 * 3. Exchanges — morphology (plural, past tense, etc.) via buildMorphologyExchanges
 * 4. Phrasal verbs — appended after definitions, before exchanges
 *
 * @param view - The EntryView containing all resolved dictionary data
 * @returns Bob.TranslateResult ready for the completion callback
 */
function buildOaldResult(view: EntryView): Bob.TranslateResult {
  // Build phonetics array: UK first, then US if available.
  const phonetics: Bob.PhoneticObject[] = [];
  if (view.entry.phonetic) {
    phonetics.push({ type: "uk", value: view.entry.phonetic });
  }
  if (view.entry.phonetic_us) {
    phonetics.push({ type: "us", value: view.entry.phonetic_us });
  }

  // Start with the entry's own definitions.
  let parts = parsePartsFromEntry(view.entry);

  if (shouldExpandOriginSources(view.entry)) {
    // Mode A: Polysemous word (e.g. "go" as verb and noun).
    // Collect source entries and build grouped parts showing each origin's definitions.
    const sources = getOriginSources(view.entry);
    const sourceEntries = new Map<string, DictEntry>();
    for (const source of sources) {
      const shard = getShardForWord(source.word);
      const entry = shard?.[source.word.toLowerCase()] || getCachedEntry(source.word);
      if (entry) sourceEntries.set(source.word.toLowerCase(), entry);
    }
    parts = buildGroupedSourceParts(view.entry, sourceEntries);
  } else if (view.isFallbackDisplay) {
    // Mode B: Fallback display (inflection/alias showing canonical definitions).
    // Filter the canonical entry's definitions to only include POS tags that
    // match the inflection's type (e.g. "went" only shows verb senses of "go").
    const originSources = getOriginSources(view.exactEntry);
    const allowedPos = new Set(originSources.flatMap((s) => s.posScope));
    if (allowedPos.size > 0) {
      parts = parts.filter((part) => (
        extractPosScopesFromPart(part.part).some((scope) => allowedPos.has(scope))
      ));
    }
  }

  // Build morphology exchanges (plural, past tense, etc.) with O(n) deduplication.
  const exchanges = buildMorphologyExchanges(view);
  const wordFamily = getWordFamily(view.entry);

  const seenExchanges = new Set<string>();
  const uniqueExchanges = exchanges.filter((exchange) => {
    const key = `${exchange.name}:${exchange.words.join(",")}`;
    if (seenExchanges.has(key)) return false;
    seenExchanges.add(key);
    return true;
  });

  // Build additions array for phrasal verbs (e.g. "give up", "take off").
  const additions: Bob.AddtionObject[] = [];
  if (!view.isFallbackDisplay && view.entry.phrasal_verbs && view.entry.phrasal_verbs.length > 0) {
    // OALD phrasal verbs are inserted after main definitions but before morphology,
    // preserving the original dictionary reading order.
    if (hasVisibleParts(parts)) {
      // Mutation is intentional here: parts is a local array that we own,
      // and pushing a separator is the most direct way to add visual spacing
      // before phrasal verbs in the Bob UI.
      parts.push(partSeparator());
    }
    for (const pv of view.entry.phrasal_verbs) {
      const phraseParts = parseParts(pv.translation);
      parts.push({
        part: pv.name,
        means: phraseParts.length > 0
          ? phraseParts.flatMap((part) => part.means.map((mean) => `${part.part === "phrv." ? "v." : part.part} ${mean}`))
          : [pv.translation],
      });
    }
  }

  // Build related word parts from word family data (e.g. "happy", "happily", "happiness").
  const relatedWordParts: Bob.RelatedWordPartObject[] | undefined = wordFamily.length > 0
    ? [
        {
          words: wordFamily.map((family) => ({
            word: family.word,
            means: family.pos ? [family.pos] : [],
          })),
        },
      ]
    : undefined;

  return {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [view.queryWord],
    toParagraphs: [],
    toDict: {
      word: view.queryWord,
      phonetics,
      parts,
      exchanges: uniqueExchanges,
      relatedWordParts,
      additions,
      addtions: additions,
    },
    raw: {
      provider: "oald",
      queryWord: view.queryWord,
      displayWord: view.displayWord,
      entry: view.entry,
      wordFamily,
    },
  };
}

/**
 * Returns the list of language pairs supported by this plugin.
 *
 * While the plugin can translate from many languages via Youdao's translation
 * API (see getYoudaoLanguages in youdao.ts), the primary value proposition is
 * English-to-Chinese dictionary lookup powered by the offline OALD data.
 *
 * Bob plugin architecture requires supportLanguages() to declare what the
 * plugin can handle. Returning ["en2zh-Hans"] signals that:
 * 1. The plugin's core feature is English -> Simplified Chinese
 * 2. Other language pairs are handled via Youdao fallback (translation mode)
 *
 * The "en2zh-Hans" format is Bob's convention: "sourceLang2targetLang".
 *
 * @returns Array of supported language pair strings in Bob format
 */
function supportLanguages() {
  return getYoudaoLanguages();
}

export { translate, supportLanguages };

// Test-only bridge so invariants can validate the same filtered navigation
// contract that runtime users actually see, without duplicating relation logic.
export const __relationsForTests = {
  getChildRelations,
  getCrossReferences,
  getOriginSources,
};
