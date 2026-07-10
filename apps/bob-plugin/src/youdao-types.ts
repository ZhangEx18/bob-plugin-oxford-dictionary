export type YoudaoProvider = "youdao-dict" | "youdao-translate";

export interface YoudaoWordEntry {
  ukphone?: string;
  usphone?: string;
  phone?: string;
  usspeech?: string;
  ukspeech?: string;
  trs?: Array<{
    pos?: string;
    tran?: string;
    tr?: Array<{ l?: { i?: string | string[] } }>;
  }>;
  wfs?: Array<{ wf?: { name?: string; value?: string } }>;
  prototype?: string;
  exam_type?: string[];
}

export interface YoudaoDictResponse {
  ec?: {
    exam_type?: string[];
    web_trans?: string[];
    word?: YoudaoWordEntry | YoudaoWordEntry[];
  };
  ce?: { word?: YoudaoWordEntry | YoudaoWordEntry[] };
  ee?: {
    word?: {
      phone?: string;
      trs?: Array<{ pos?: string; tr?: Array<{ tran?: string }> }>;
    };
  };
  blng_sents_part?: {
    sentence_pair?: Array<{ sentence?: string; sentence_translation?: string }>;
  };
  web_trans?: {
    "web-translation"?: Array<{
      key?: string;
      trans?: Array<{ value?: string }>;
    }>;
  };
  typos?: { typo?: Array<{ word?: string; trans?: string }> };
}

export interface YoudaoTranslationResponse {
  errorCode?: string;
  translation?: string[];
}

export interface PreparedTranslationText {
  normalizedText: string;
  segments: string[];
}

export interface TranslationResultInput {
  text: string;
  from: string;
  to: string;
  translations: string[];
  normalizedText: string;
}
