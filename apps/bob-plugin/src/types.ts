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

/**
 * Lightweight entry from ECDICT offline dictionary (offline fallback layer).
 *
 * Only carries the fields needed for a compact dictionary result:
 * - word: headword (lowercase key in shard)
 * - phonetic: IPA pronunciation string
 * - translation: multi-line Chinese translation (may include POS prefixes)
 * - pos: part-of-speech tag string
 * - exchange: encoded morphology string (e.g. "p:went/d:gone/i:going/3:goes")
 *   Mapping: 0=lemma, p=past tense, d=past participle, i=present participle,
 *            3=3rd person singular, s=plural
 *
 * Fields NOT included from ECDICT (collins, oxford, tag, bnc, frq, detail, audio)
 * are trimmed to reduce shard size per the constraint: "优先裁剪字段而不是放弃离线补词层".
 */
export interface EcdictEntry {
  word: string;
  phonetic: string;
  translation: string;
  pos: string;
  exchange: string;
}

/** One shard file maps lowercase word → EcdictEntry */
export interface EcdictShardCache {
  [word: string]: EcdictEntry;
}

/** One root/affix in a RootEntry */
export interface RootInfo {
  root: string;
  meaning: string;
  relatedWords: string[];
}

/** Word root/affix data from preprocessing pipeline */
export interface RootEntry {
  etymology?: string;
  rootBreakdown?: string;
  roots?: RootInfo[];
}

/** Compact root display produced at runtime for the short inline format. */
export interface RootDisplayLine {
  text: string;
}

/** Manifest describing one externally managed data pack. */
export interface DataPackManifest {
  schemaVersion: string;
  dataVersion: string;
  packType: "oald" | "ecdict" | "roots";
  shardCount: number;
  entryCount: number;
  generatedAt?: string;
  files?: Array<{ name: string; sha256?: string; size?: number }>;
  layout?: {
    shardSubdir?: string;
    shardExtension?: string;
  };
}
