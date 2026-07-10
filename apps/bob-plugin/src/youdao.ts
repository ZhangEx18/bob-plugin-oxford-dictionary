import * as Bob from "@bob-plug/core";
import { md5 } from "./md5";
import { convertDictToResult } from "./youdao-result";
import {
  PreparedTranslationText,
  TranslationResultInput,
  YoudaoDictResponse,
  YoudaoProvider,
  YoudaoTranslationResponse,
} from "./youdao-types";

const YOUDAO_LANGUAGES = [
  "auto", "de", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru",
  "zh-Hans", "zh-Hant", "bg", "cs", "da", "el", "et", "fi", "hu", "lt", "lv",
  "ro", "sk", "sl", "sv",
];

const youdaoLangMap: Record<string, string> = {
  auto: "auto",
  de: "de",
  en: "en",
  es: "es",
  fr: "fr",
  it: "it",
  ja: "ja",
  ko: "ko",
  nl: "nl",
  pl: "pl",
  pt: "pt",
  ru: "ru",
  "zh-Hans": "zh-CHS",
  "zh-Hant": "zh-CHS",
  bg: "bg",
  cs: "cs",
  da: "da",
  el: "el",
  et: "et",
  fi: "fi",
  hu: "hu",
  lt: "lt",
  lv: "lv",
  ro: "ro",
  sk: "sk",
  sl: "sl",
  sv: "sv",
};

const YOUDAO_DICT_URL = "https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4";
const YOUDAO_TRANSLATE_URL = "https://aidemo.youdao.com/trans";
const YOUDAO_DICT_CLIENT = "web";
const YOUDAO_DICT_KEYFROM = "webdict";
const YOUDAO_DICT_SECRET = "Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu";

function toYoudaoLang(lang: string | undefined, fallback: string): string {
  if (!lang) return fallback;
  return youdaoLangMap[lang] || fallback;
}

function isWordQuery(text: string): boolean {
  return /^[a-zA-Z-]+$/.test(text.trim());
}

function normalizePunctuationForChinese(text: string): string {
  return text
    // 单词末尾或独立撇号转为中文右单引号；先处理带前导字母的情况，再处理剩余撇号
    .replace(/(\w)'/g, "$1’").replace(/'/g, "’")
    // 同理处理双引号
    .replace(/(\w)"/g, "$1\"\"").replace(/"/g, "\"\"")
    .replace(/!/g, "！")
    .replace(/\?/g, "？")
    .replace(/,/g, "，")
    .replace(/\./g, "。")
    .replace(/;/g, "；")
    .replace(/:/g, "：")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
}

function normalizeChineseTranslationText(text: string): string {
  return normalizePunctuationForChinese(text)
    // 全角标点前的空格属于排版错误，需去除
    .replace(/\s+([，。！？；：）])/g, "$1")
    // 左括号后不应有空格
    .replace(/([（])\s+/g, "$1")
    // 连续空格压缩为单个
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeOcrText(text: string): string {
  return text
    // 统一 Windows 风格换行符为 Unix 风格
    .replace(/\r\n/g, "\n")
    // OCR 常把单词在行尾用连字符拆分，如 "long-\nsentence"；去掉连字符并合并单词
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
    // 普通换行导致句子断开，如 "word.\nNext" 或 "word,\nnext"，应替换为空格
    .replace(/([A-Za-z,;:])\n([A-Za-z])/g, "$1 $2")
    // 连续换行压缩为单个，方便后续 split
    .replace(/\n+/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean) // 过滤掉纯空行
    .join(" ") // 将多行合并为以空格分隔的连续段落
    // 去除标点符号前的多余空格（英文排版中逗号前不应有空格）
    .replace(/\s+([,.;:!?])/g, "$1")
    // 去除左括号、左方括号、左引号后的多余空格
    .replace(/([(\["])\s+/g, "$1")
    // 将连续多个空格压缩为单个
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitTranslationSegments(text: string, maxLength = 900): string[] {
  if (text.length <= maxLength) return [text];

  const segments: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    const candidate = rest.slice(0, maxLength);
    // 在候选片段末尾寻找最后一个句子边界，优先保证语义完整性
    const splitAt = Math.max(
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf("? "),
      candidate.lastIndexOf("! "),
      candidate.lastIndexOf("; "),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("？"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("；"),
      candidate.lastIndexOf("\n"),
    );

    // 若找到边界则在该位置后切断（+1 把标点包含进前一段），否则硬截断
    const cut = splitAt > 0 ? splitAt + 1 : maxLength;
    segments.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) segments.push(rest);
  return segments;
}

function prepareTranslationText(text: string): PreparedTranslationText {
  // 先尽量还原 OCR 断行和分页带来的碎片，再交给有道翻译。
  const normalizedText = normalizeOcrText(text);
  return {
    normalizedText,
    segments: splitTranslationSegments(normalizedText),
  };
}

function buildEmptyDict(word: string): Bob.DictObject {
  const additions: Bob.AddtionObject[] = [];
  return {
    word,
    phonetics: [],
    parts: [],
    exchanges: [],
    additions,
    addtions: additions,
  };
}

function normalizeResponseData(responseBody: unknown): unknown | null {
  if (responseBody == null) return null;
  if (typeof responseBody === "string") {
    try {
      return JSON.parse(responseBody);
    } catch {
      return null;
    }
  }
  if (typeof responseBody === "object") {
    return responseBody;
  }
  return null;
}

function unwrapResponseBody(responseBody: unknown): unknown {
  if (typeof responseBody !== "object" || responseBody === null) return responseBody;
  const objectKeys = Object.keys(responseBody as Record<string, unknown>);
  if (objectKeys.length !== 1 || objectKeys[0] !== "toString") return responseBody;
  const toString = (responseBody as { toString?: () => string }).toString;
  return typeof toString === "function" ? toString.call(responseBody) : responseBody;
}

function requestJson(
  options: {
    method: string;
    url: string;
    header?: Record<string, string>;
    body?: Record<string, string>;
  },
): Promise<unknown | null> {
  return new Promise((resolve) => {
    $http.request({
      ...options,
      handler(resp) {
        // Bob 在 JSON 响应下通常会直接给对象；测试桥接里则可能是一个只带 toString 的包装对象。
        resolve(normalizeResponseData(unwrapResponseBody(resp.data as unknown)));
      },
    });
  });
}

function buildYoudaoDictionaryBody(word: string): Record<string, string> {
  // This field order and nested hash match the web dictionary request contract.
  const time = String((word + YOUDAO_DICT_KEYFROM).length % 10);
  const payload = word + YOUDAO_DICT_KEYFROM;
  const payloadHash = md5(payload);
  const sign = md5(`${YOUDAO_DICT_CLIENT}${word}${time}${YOUDAO_DICT_SECRET}${payloadHash}`);

  return {
    q: word,
    keyfrom: YOUDAO_DICT_KEYFROM,
    sign,
    client: YOUDAO_DICT_CLIENT,
    t: time,
  };
}

function convertTranslationToResult(input: TranslationResultInput): Bob.TranslateResult | null {
  const { text, from, to, translations, normalizedText } = input;
  if (translations.length === 0) {
    return null;
  }

  const toParagraphs = translations.map((item) => (
    to === "zh-Hans" ? normalizeChineseTranslationText(item) : item.trim()
  ));

  return {
    from,
    to,
    fromParagraphs: [normalizedText || text],
    toParagraphs,
    toDict: buildEmptyDict(text),
    raw: {
      provider: "youdao-translate" as YoudaoProvider,
      normalizedText,
    },
  };
}

async function queryYoudaoDictionary(word: string): Promise<Bob.TranslateResult | null> {
  const dictionaryResponse = await requestJson({
    method: "POST",
    url: YOUDAO_DICT_URL,
    header: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
    },
    body: buildYoudaoDictionaryBody(word),
  }) as YoudaoDictResponse | null;

  if (!dictionaryResponse) return null;
  return convertDictToResult(word, dictionaryResponse);
}

async function queryYoudaoTranslation(
  text: string,
  from: string,
  to: string,
): Promise<Bob.TranslateResult | null> {
  const prepared = prepareTranslationText(text);
  const translations: string[] = [];

  for (const segment of prepared.segments) {
    const translationResponse = await requestJson({
      method: "POST",
      url: YOUDAO_TRANSLATE_URL,
      header: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
      body: {
        q: segment,
        from: toYoudaoLang(from, "auto"),
        to: toYoudaoLang(to, "en"),
      },
    }) as YoudaoTranslationResponse | null;

    // 任一片段失败即整体失败，避免返回不完整译文
    if (
      !translationResponse
      || translationResponse.errorCode !== "0"
      || !translationResponse.translation
      || translationResponse.translation.length === 0
    ) {
      return null;
    }
    translations.push(...translationResponse.translation);
  }

  return convertTranslationToResult({
    text,
    from,
    to,
    translations,
    normalizedText: prepared.normalizedText,
  });
}

function getYoudaoLanguages(): string[] {
  return [...YOUDAO_LANGUAGES];
}

export {
  getYoudaoLanguages,
  isWordQuery,
  queryYoudaoDictionary,
  queryYoudaoTranslation,
};
