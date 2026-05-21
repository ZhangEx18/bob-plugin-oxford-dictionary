import * as Bob from "@bob-plug/core";

export { Bob };

export interface PhrasalVerb {
  name: string;
  translation: string;
}

export interface TranslationPart {
  pos: string;
  meanings: string[];
}

export interface TranslationDetail {
  text: string;
  countability?: "countable" | "uncountable" | "both";
}

export interface TranslationDetailPart {
  pos: string;
  details: TranslationDetail[];
}

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
  relations?: RelationEdge[];
}

export interface ShardCache {
  [word: string]: DictEntry;
}

export interface WordRelation {
  word: string;
  label: string;
}

export interface InflectionSource {
  word: string;
  label: string;
}

export interface RelationEdge {
  type: "inflection" | "origin" | "xref" | "lexical_origin" | "defective" | "variant" | "self_loop";
  target: string;
  label: string;
  direction: "outgoing" | "incoming";
  pos_scope?: string[];
  navigable: boolean;
  primary?: boolean;
  display: "exchange" | "reference" | "hidden";
  source: "exchange" | "protected" | "derived" | "manual";
}

export interface EntryView {
  queryWord: string;
  displayWord: string;
  entry: DictEntry;
  exactEntry: DictEntry;
  isFallbackDisplay: boolean;
  backRelation: WordRelation | null;
  childRelations: WordRelation[];
}

export interface MorphologyItem {
  label: string;
  word: string;
}

export interface OriginSource {
  word: string;
  label: string;
  posScope: string[];
}
