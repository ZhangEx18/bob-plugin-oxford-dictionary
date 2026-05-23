/**
 * Bob 插件核心类型声明文件
 * 定义了 Bob 翻译插件需要实现的接口和数据结构
 */
declare module "@bob-plug/core" {
  /** 翻译查询请求 */
  export interface TranslateQuery {
    detectFrom: string;
    detectTo?: string;
    text: string;
  }

  /** 翻译完成回调函数 */
  export interface Completion {
    (payload: { result: TranslateResult } | { error: { type: string; message: string; addtion: string } }): void;
  }

  /** 翻译结果 */
  export interface TranslateResult {
    from: string;
    to: string;
    fromParagraphs: string[];
    toParagraphs: string[];
    toDict: DictObject;
    raw?: Record<string, unknown>;
  }

  /** 词典对象 - 包含单词、音标、释义、词形变化等 */
  export interface DictObject {
    word: string;
    phonetics: PhoneticObject[];
    parts: PartObject[];
    exchanges: ExchangeObject[];
    relatedWordParts?: RelatedWordPartObject[];
    additions?: AddtionObject[];
    /** @deprecated Use `additions` instead. Kept for backward compatibility. */
    addtions?: AddtionObject[];
    /** @deprecated Type declaration is incorrect; use `relatedWordParts` for word-family display. */
    wordFamily?: ExchangeObject[];
  }

  /** 音标对象 */
  export interface PhoneticObject {
    type: string;
    value: string;
  }

  /** 词性释义块 */
  export interface PartObject {
    part: string;
    means: string[];
  }

  /** 词形变化项 */
  export interface ExchangeObject {
    name: string;
    words: string[];
  }

  /** 相关词分组 */
  export interface RelatedWordPartObject {
    part?: string;
    words: RelatedWordObject[];
  }

  /** 相关词 */
  export interface RelatedWordObject {
    word: string;
    means?: string[];
  }

  /** 附加信息项 */
  export interface AddtionObject {
    name: string;
    value: string;
  }
}

/** Bob 插件文件系统 API */
declare const $file: {
  read(path: string): { toUTF8(): string } | null;
};

/** Bob 插件 HTTP 请求 API */
declare const $http: {
  request(options: {
    method: string;
    url: string;
    header?: Record<string, string>;
    body?: Record<string, string>;
    handler: (resp: {
      data: { toString(): string };
      error?: { code?: string; localizedDescription?: string };
      response?: { statusCode?: number };
    }) => void;
  }): void;
};
