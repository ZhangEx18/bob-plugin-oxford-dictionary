declare module "@bob-plug/core" {
  export interface TranslateQuery {
    detectFrom: string;
    text: string;
  }

  export interface Completion {
    (payload: { result: TranslateResult } | { error: { type: string; message: string; addtion: string } }): void;
  }

  export interface TranslateResult {
    from: string;
    to: string;
    fromParagraphs: string[];
    toParagraphs: string[];
    toDict: DictObject;
    raw?: Record<string, unknown>;
  }

  export interface DictObject {
    word: string;
    phonetics: PhoneticObject[];
    parts: PartObject[];
    exchanges: ExchangeObject[];
    addtions: AddtionObject[];
  }

  export interface PhoneticObject {
    type: string;
    value: string;
  }

  export interface PartObject {
    part: string;
    means: string[];
  }

  export interface ExchangeObject {
    name: string;
    words: string[];
  }

  export interface AddtionObject {
    name: string;
    value: string;
  }
}

declare const $file: {
  read(path: string): { toUTF8(): string } | null;
};
