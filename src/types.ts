import * as Bob from "@bob-plug/core";

export { Bob };

/** Phrasal verb entry: e.g. { name: "give up", translation: "放弃" } */
export interface PhrasalVerb {
  name: string;
  translation: string;
}

/** One POS block within a translation: e.g. { pos: "n.", meanings: ["名词"] } */
export interface TranslationPart {
  pos: string;
  meanings: string[];
}

/** Detail line under a POS, with optional countability metadata */
export interface TranslationDetail {
  text: string;
  countability?: "countable" | "uncountable" | "both";
}

/** Grouped details for a single POS */
export interface TranslationDetailPart {
  pos: string;
  details: TranslationDetail[];
}

/**
 * Raw dictionary entry loaded from JSON shards.
 *
 * Fields:
 * - word: canonical headword
 * - phonetic / phonetic_us: IPA strings
 * - translation: fallback flat translation text
 * - pos: part-of-speech tag string (may contain multiple tags)
 * - exchange: encoded morphology string (e.g. "p:went/d:gone/i:going/s:goes")
 * - entry_kind: standalone (has its own defs), alias (redirect), inflection (form of another word)
 * - relations: graph edges linking to origins, inflections, cross-references
 */
export interface DictEntry {
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
  word_family?: WordFamilyItem[];
  verb_forms?: VerbFormItem[];
  relations?: RelationEdge[];
}

/** One shard file maps lowercase word -> DictEntry */
export interface ShardCache {
  [word: string]: DictEntry;
}

/** Simplified relation for UI display */
export interface WordRelation {
  word: string;
  label: string;
}

/**
 * Edge in the dictionary relation graph.
 *
 * Types:
 * - origin: points from inflection/alias to its canonical headword
 * - inflection: links a headword to its derived forms
 * - xref: cross-reference to related entries
 * - lexical_origin, defective, variant, self_loop: specialized relation kinds
 *
 * display controls whether the edge is shown in the UI (exchange vs reference vs hidden).
 */
export interface RelationEdge {
  type: "inflection" | "origin" | "xref" | "lexical_origin" | "defective" | "variant" | "self_loop";
  target: string;
  label: string;
  direction: "outgoing" | "incoming";
  pos_scope?: string[];
  navigable: boolean;
  primary?: boolean;
  display: "exchange" | "reference" | "hidden";
  source: "exchange" | "protected" | "derived" | "manual" | "word_family";
}

/** Aggregated view of a query result, combining exact entry, display entry, and relations */
export interface EntryView {
  queryWord: string;
  displayWord: string;
  entry: DictEntry;
  exactEntry: DictEntry;
  isFallbackDisplay: boolean;
  backRelation: WordRelation | null;
  childRelations: WordRelation[];
}

/** One morphology item: e.g. { label: "过去式", word: "went" } */
export interface MorphologyItem {
  label: string;
  word: string;
}

/** Source word for an alias/inflection entry, with POS scope */
export interface OriginSource {
  word: string;
  label: string;
  posScope: string[];
}

/** Member of a word family group */
export interface WordFamilyItem {
  word: string;
  pos: string;
  relation: string;
}

/** Detailed verb form entry (used for irregular verb tables) */
export interface VerbFormItem {
  label: string;
  word: string;
  form?: string;
  subject?: string;
  phonetic?: string;
}
