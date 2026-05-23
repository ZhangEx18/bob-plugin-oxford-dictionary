import * as Bob from "@bob-plug/core";

type CryptoJsLike = {
  MD5(input: string): { toString(encoder?: unknown): string };
  enc: { Hex: unknown };
};

type NodeCryptoLike = {
  createHash(algorithm: string): {
    update(input: string): { digest(encoding: "hex"): string };
  };
};

type Provider = "youdao-dict" | "youdao-translate";

interface YoudaoWordEntry {
  ukphone?: string;
  usphone?: string;
  phone?: string;
  usspeech?: string;
  ukspeech?: string;
  trs?: Array<{
    pos?: string;
    tran?: string;
    tr?: Array<{
      l?: { i?: string | string[] };
    }>;
  }>;
  wfs?: Array<{
    wf?: {
      name?: string;
      value?: string;
    };
  }>;
  prototype?: string;
  exam_type?: string[];
}

interface YoudaoDictResponse {
  ec?: {
    exam_type?: string[];
    web_trans?: string[];
    word?: YoudaoWordEntry | YoudaoWordEntry[];
  };
  ce?: {
    word?: YoudaoWordEntry | YoudaoWordEntry[];
  };
  ee?: {
    word?: {
      phone?: string;
      trs?: Array<{
        pos?: string;
        tr?: Array<{
          tran?: string;
        }>;
      }>;
    };
  };
  blng_sents_part?: {
    sentence_pair?: Array<{
      sentence?: string;
      sentence_translation?: string;
    }>;
  };
  web_trans?: {
    "web-translation"?: Array<{
      key?: string;
      trans?: Array<{ value?: string }>;
    }>;
  };
  typos?: {
    typo?: Array<{
      word?: string;
      trans?: string;
    }>;
  };
}

interface YoudaoTranslationResponse {
  errorCode?: string;
  translation?: string[];
}

interface PreparedTranslationText {
  normalizedText: string;
  segments: string[];
}

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

let cryptoJsModule: CryptoJsLike | null | undefined;
let nodeCryptoModule: NodeCryptoLike | null | undefined;

/**
 * 将 Bob 的语言代码映射为有道 API 支持的语言代码。
 *
 * 有道 API 对部分中文变体使用不同的代码（如 zh-CHS 而非 zh-Hans），
 * 此函数负责统一转换；若传入未定义或不支持的代码，则返回 fallback。
 *
 * @param lang - Bob 插件传入的语言代码，例如 "zh-Hans"、"en"
 * @param fallback - 当 lang 无效时返回的默认值
 * @returns 有道 API 可接受的语言代码
 */
function toYoudaoLang(lang: string | undefined, fallback: string): string {
  if (!lang) return fallback;
  return youdaoLangMap[lang] || fallback;
}

/**
 * 判断输入文本是否为纯英文单词（仅含字母和连字符）。
 *
 * 用于区分"查词典"和"翻译句子"两种场景：
 * - 纯英文单词 → 走有道词典接口（更详细的释义、音标、词形变化）
 * - 其他文本（含空格、中文、数字等）→ 走有道翻译接口
 *
 * 正则 `/^[a-zA-Z-]+$/` 匹配仅由大小写字母和连字符组成的非空字符串。
 *
 * @param text - 用户输入的原始文本
 * @returns true 表示应使用词典接口查询
 */
function isWordQuery(text: string): boolean {
  return /^[a-zA-Z-]+$/.test(text.trim());
}

/**
 * 统一释义字段的类型：有道 API 偶尔会将释义拆成字符串数组，
 * 需要拼接成完整句子后再展示给用户。
 *
 * @param value - 可能为字符串、字符串数组或 undefined 的释义
 * @returns 拼接后的单一字符串；若为空则返回 "
 */
function normalizeMeaning(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    // 数组元素直接拼接，不插入额外空格（API 返回的数组通常已按语义分片）
    return value.join("");
  }
  return value || "";
}

/**
 * 清理音标字符串两侧的方括号和斜杠。
 *
 * 有道返回的音标格式不统一，可能带有 `/.../` 或 `[...]` 包裹；
 * 去除这些包裹符号后，可直接用于 Bob 的 phonetics 字段展示。
 *
 * @param value - 原始音标字符串，可能包含包裹符号
 * @returns 去除包裹后的纯音标文本
 */
function normalizePhoneticValue(value: string | undefined): string {
  if (!value) return "";
  // 先 trim 再去掉首尾的 [ / ] 字符，支持混合包裹如 "[/əˈplʌs/]"
  return value.trim().replace(/^[\[/]+/, "").replace(/[\]/]+$/, "");
}

/**
 * 从可能为数组或单对象的词条中提取第一个词条。
 *
 * 有道 API 的 `word` 字段在不同查询结果中类型不一致：
 * - 单义词返回单个对象
 * - 多义词或同形异义词返回数组
 * 统一取数组首元素，保证后续处理始终拿到单一词条。
 *
 * @param value - API 返回的 word 字段，可能是对象或数组
 * @returns 第一个词条对象；若为空则返回 null
 */
function firstWordEntry(value: YoudaoWordEntry | YoudaoWordEntry[] | undefined): YoudaoWordEntry | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

/**
 * 将英文半角标点批量转换为中文全角标点。
 *
 * 处理规则：
 * - 英文撇号 ' → 中文右单引号 ’（保留单词内部缩写如 it's → it’s）
 * - 英文双引号 " → 中文右双引号 "
 * - 其余常见标点（,.?!;:"()）全部转为对应全角形式
 *
 * 用于翻译结果展示时，让中文段落更符合中文排版习惯。
 *
 * @param text - 待转换的原始文本
 * @returns 全角标点替换后的文本
 */
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

/**
 * 对翻译后的中文文本进行标点与空格规范化。
 *
 * 处理流程：
 * 1. 先调用 normalizePunctuationForChinese 将半角标点转为全角
 * 2. 去除全角标点前的多余空格（中文排版中标号前不应有空格）
 * 3. 去除左括号后的多余空格
 * 4. 将连续多个空格压缩为单个空格
 * 5. 去除首尾空白
 *
 * @param text - 翻译接口返回的原始中文文本
 * @returns 规范化后的中文文本
 */
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

/**
 * 针对 OCR 识别结果进行文本清理与断行修复。
 *
 * OCR 引擎（尤其是扫描 PDF 或图片）常产生以下问题：
 * - 换行符混用 \r\n 与 \n
 * - 单词在行尾被连字符截断，如 "long-\nsentence"
 * - 行尾换行导致句子被错误断开，如 "word.\nNext"
 * - 产生大量空行和多余空格
 * - 标点与单词之间出现不应有的空格
 *
 * 处理流程：
 * 1. 统一换行符为 \n
 * 2. 修复连字符断词：将 "word-\nword" 合并为 "wordword"
 * 3. 修复普通断行：将 "word\nword" 替换为空格，保持句子连贯
 * 4. 去除空行，将多行合并为单一连续文本
 * 5. 去除标点前的多余空格、括号后的多余空格
 * 6. 压缩连续空格
 *
 * @param text - OCR 原始识别文本
 * @returns 修复后的连续文本，适合交给翻译引擎处理
 */
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

/**
 * 将长文本按句子边界切分为多个片段，避免单次请求超过有道翻译接口长度限制。
 *
 * 切分策略：
 * - 若文本长度不超过 maxLength（默认 900 字符），直接返回单一片段
 * - 否则在 maxLength 范围内寻找最后一个句子边界（中英文句号、问号、感叹号、分号或换行符）
 * - 若找不到合法边界，则硬截断在 maxLength 处
 * - 递归处理剩余文本，直到全部切分完毕
 *
 * 选择 900 作为默认值是因为有道翻译接口对单条文本有长度限制，
 * 留有一定余量避免 URL 编码后超出上限。
 *
 * @param text - 经过 OCR 规范化后的完整文本
 * @param maxLength - 单个片段的最大字符数，默认 900
 * @returns 切分后的文本片段数组
 */
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

/**
 * 为翻译请求准备文本：先进行 OCR 规范化，再按长度切分为多个片段。
 *
 * 这是翻译流程的前置处理管道，包含两步：
 * 1. OCR 规范化（normalizeOcrText）：修复断行、连字符截断、多余空格等问题
 * 2. 分段切分（splitTranslationSegments）：将长文本拆成不超过接口限制的片段
 *
 * @param text - 用户输入的原始文本（可能来自 OCR 识别结果）
 * @returns 包含规范化文本和切分片段的对象
 */
function prepareTranslationText(text: string): PreparedTranslationText {
  // 先尽量还原 OCR 断行和分页带来的碎片，再交给有道翻译。
  const normalizedText = normalizeOcrText(text);
  return {
    normalizedText,
    segments: splitTranslationSegments(normalizedText),
  };
}

/**
 * 构建一个空的词典结果结构，用于翻译接口（非查词典场景）。
 *
 * 翻译接口只返回译文，没有音标、词性、词形变化等词典信息，
 * 但 Bob 插件要求 toDict 字段必须存在，因此返回一个空结构占位。
 *
 * 注意：Bob 的 AddtionObject 拼写为 "addtions"（历史遗留），
 * 需同时提供 additions 和 addtions 两个字段以兼容不同版本。
 *
 * @param word - 原始查询词
 * @returns 空的词典对象结构
 */
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

/**
 * 运行时动态 require，绕过 bundler 静态分析。
 *
 * crypto-js 和 node:crypto 是运行时可选依赖，不在 package.json 中声明，
 * 使用 Function 构造函数可避免 esbuild 等工具在构建时尝试解析它们。
 *
 * 这是 Node.js 环境下的运行时依赖加载技巧，在 Bob 插件真机环境（基于 Node.js）
 * 和测试环境（基于 Node.js）中均可使用；浏览器环境不会执行此代码路径。
 *
 * @param id - Node.js 模块标识符，如 "crypto-js" 或 "node:crypto"
 * @returns 加载的模块对象
 */
function runtimeRequire(id: string): unknown {
  return (Function("return require")() as (id: string) => unknown)(id);
}

/**
 * 计算字符串的 MD5 哈希值，支持 crypto-js 和 node:crypto 双后端回退。
 *
 * 策略说明：
 * - Bob 插件真机环境基于 Node.js，通常已安装 crypto-js（Bob 内置）
 * - 测试环境可能未安装 crypto-js，此时回退到 node:crypto（Node.js 内置）
 * - 若两者均不可用，抛出错误提示用户安装依赖
 *
 * 模块加载采用懒加载（首次调用时才尝试 require），并通过 runtimeRequire
 * 绕过 bundler 静态分析，避免构建时因模块缺失而报错。
 *
 * @param input - 待计算 MD5 的原始字符串
 * @returns 32 位小写十六进制 MD5 哈希值
 * @throws Error 当 crypto-js 和 node:crypto 均不可用时
 */
function md5(input: string): string {
  // 首次调用时尝试加载两个可选依赖；使用 undefined 作为未初始化标记，null 表示加载失败
  if (cryptoJsModule === undefined || nodeCryptoModule === undefined) {
    try {
      cryptoJsModule = runtimeRequire("crypto-js") as CryptoJsLike;
    } catch {
      cryptoJsModule = null;
    }

    try {
      nodeCryptoModule = runtimeRequire("node:crypto") as NodeCryptoLike;
    } catch {
      nodeCryptoModule = null;
    }
  }

  if (cryptoJsModule) {
    return cryptoJsModule.MD5(input).toString(cryptoJsModule.enc.Hex);
  }
  if (nodeCryptoModule) {
    return nodeCryptoModule.createHash("md5").update(input).digest("hex");
  }
  throw new Error("No MD5 implementation available");
}

/**
 * 规范化 HTTP 响应数据：将字符串 JSON 解析为对象，对象直接透传，其他类型返回 null。
 *
 * 为什么需要此函数：
 * - Bob 真机环境中 $http.request 通常直接返回解析后的 JSON 对象
 * - 测试桥接环境可能返回字符串或包装对象，需要统一处理
 * - 防御性处理：若响应为纯字符串（如 JSON 字符串），尝试解析；若解析失败则返回 null
 *
 * @param data - $http.request 返回的原始数据，可能是字符串、对象或 null
 * @returns 解析后的对象；若无法解析则返回 null
 */
function normalizeResponseData(data: unknown): unknown | null {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data === "object") {
    return data;
  }
  return null;
}

/**
 * 通过 Bob 的 $http.request 发送 HTTP 请求，并将回调式 API 包装为 Promise。
 *
 * 为什么需要包装：
 * - Bob 的 $http.request 使用回调风格（handler 函数），而现代代码更习惯 async/await
 * - 此函数将回调结果统一转换为 Promise，便于上层使用 async/await 处理
 *
 * 数据解析逻辑：
 * - Bob 真机环境通常直接返回 JSON 对象
 * - 测试桥接环境可能返回字符串或仅带 toString 方法的包装对象
 * - 通过检查对象键数量和 toString 方法，区分真实对象与包装对象
 * - 最终统一调用 normalizeResponseData 进行规范化处理
 *
 * @param options - HTTP 请求配置，包含 method、url、header、body
 * @returns Promise，resolve 为解析后的 JSON 对象或 null；不会 reject，出错时 resolve null
 */
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
        const data = resp.data as unknown;
        const objectKeys = typeof data === "object" && data !== null ? Object.keys(data as Record<string, unknown>) : [];
        const looksLikeStringWrapper = objectKeys.length === 1 && objectKeys[0] === "toString";
        const rawData = typeof data === "string"
          ? data
          : (typeof data === "object" && data !== null && !looksLikeStringWrapper)
              ? data
              : (typeof (data as { toString?: () => string })?.toString === "function"
                  ? (data as { toString: () => string }).toString()
                  : data);
        resolve(normalizeResponseData(rawData));
      },
    });
  });
}

/**
 * 构建有道词典接口的 POST 请求体，包含签名验证字段。
 *
 * 签名生成逻辑（逆向自有道网页版）：
 * 1. 计算 time = (word + keyfrom).length % 10，作为时间戳简写
 * 2. 计算 payload = word + keyfrom，再取 MD5 得 payloadHash
 * 3. 计算 sign = MD5(client + word + time + secret + payloadHash)
 *    其中 client、keyfrom、secret 为固定常量（逆向自网页版请求）
 *
 * 为什么需要签名：
 * - 有道词典接口对查词使用带签名的 POST；仅用简单 GET 在 Bob 真机里可能返回空结果
 * - 签名用于验证请求来源合法性，防止未授权调用
 *
 * @param word - 要查询的英文单词
 * @returns 包含查询词和签名信息的表单字段
 */
function buildYoudaoDictionaryBody(word: string): Record<string, string> {
  // 有道词典接口对查词使用带签名的 POST；仅用简单 GET 在 Bob 真机里可能返回空结果。
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

/**
 * 从有道词典响应中提取第一个有效的词条。
 *
 * 有道 API 的响应结构根据查询方向不同而变化：
 * - 英译中（ec）：词条在 data.ec.word 中
 * - 中译英（ce）：词条在 data.ce.word 中
 * 优先尝试 ec，若不存在则回退到 ce。
 *
 * @param data - 有道词典 API 的原始响应
 * @returns 第一个词条对象；若两个方向均无词条则返回 null
 */
function extractYoudaoWord(data: YoudaoDictResponse): YoudaoWordEntry | null {
  return firstWordEntry(data.ec?.word) || firstWordEntry(data.ce?.word) || null;
}

/**
 * 将释义按词性归类，存入 Map 中并自动去重。
 *
 * 处理逻辑：
 * - 去除释义首尾空白，空释义直接丢弃
 * - 去除词性首尾空白，若词性为空则默认使用 "释义"
 * - 同一词性下已存在的释义不再重复添加（保持顺序不变）
 * - 使用不可变更新：每次 set 都创建新数组，符合项目不可变原则
 *
 * @param partMap - 词性到释义列表的映射（会被修改，但内部数组不可变更新）
 * @param pos - 词性标签，如 "n.", "v.", "adj."
 * @param meaning - 释义文本
 */
function pushPart(partMap: Map<string, string[]>, pos: string, meaning: string) {
  const normalizedMeaning = meaning.trim();
  if (!normalizedMeaning) return;
  const normalizedPos = pos.trim() || "释义";
  const existing = partMap.get(normalizedPos) || [];
  if (!existing.includes(normalizedMeaning)) {
    partMap.set(normalizedPos, [...existing, normalizedMeaning]);
  }
}

/**
 * 将有道词典 API 的原始响应转换为 Bob 插件标准结果格式。
 *
 * 这是核心转换函数，负责从有道复杂的嵌套响应中提取并重组以下信息：
 * - 词性释义（parts）
 * - 音标（phonetics）
 * - 词形变化（exchanges）
 *
 * 数据提取策略（按优先级）：
 * 1. 优先从 ec（英译中）或 ce（中译英）的 word 字段提取完整词条
 * 2. 若主词条无释义，回退到 ee（英英释义）作为兜底
 * 3. 若所有来源均无释义，返回 null（表示查词失败）
 *
 * @param word - 用户查询的原始单词
 * @param data - 有道词典 API 的完整响应
 * @returns Bob 标准结果对象；若无法提取有效释义则返回 null
 */
function convertDictToResult(word: string, data: YoudaoDictResponse): Bob.TranslateResult | null {
  // === 步骤 1: 提取主词条 ===
  const entry = extractYoudaoWord(data);
  const partMap = new Map<string, string[]>();

  // === 步骤 2: 提取词性释义（优先 ec/ce 英汉释义） ===
  // entry.trs 结构：每个 tr 包含 pos（词性）、tran（直接释义）、tr（嵌套释义列表）
  if (entry?.trs) {
    for (const tr of entry.trs) {
      const pos = tr.pos || "";
      // 直接释义字段
      if (tr.tran) {
        pushPart(partMap, pos, tr.tran);
      }
      // 嵌套释义列表（item.l.i 可能为字符串或数组）
      for (const item of tr.tr || []) {
        pushPart(partMap, pos, normalizeMeaning(item.l?.i));
      }
    }
  }

  // === 步骤 3: 回退到英英释义（ee） ===
  // 当英汉释义为空时，尝试从英英释义中提取
  if (partMap.size === 0 && data.ee?.word?.trs) {
    for (const tr of data.ee.word.trs) {
      for (const item of tr.tr || []) {
        pushPart(partMap, tr.pos || "", item.tran || "");
      }
    }
  }

  // 若所有来源均无释义，判定为查词失败
  if (partMap.size === 0) {
    return null;
  }

  // === 步骤 4: 提取音标 ===
  // 优先级：ukphone > usphone > phone（通用）> usspeech/ukspeech（语音链接兜底）
  const phonetics: Bob.PhoneticObject[] = [];
  const ukphone = normalizePhoneticValue(entry?.ukphone);
  const usphone = normalizePhoneticValue(entry?.usphone);
  if (ukphone) {
    phonetics.push({ type: "uk", value: ukphone });
  }
  if (usphone) {
    phonetics.push({ type: "us", value: usphone });
  }
  // 若英式和美式均无，尝试通用音标（通常来自英英释义）
  if (phonetics.length === 0) {
    const phone = normalizePhoneticValue(entry?.phone || data.ee?.word?.phone);
    if (phone) {
      phonetics.push({ type: "uk", value: phone });
    }
  }
  // 最后兜底：使用语音链接字段（虽然值是 URL，但总比没有强）
  if (phonetics.length === 0 && entry?.usspeech) {
    phonetics.push({ type: "us", value: entry.usspeech });
  }
  if (phonetics.length === 0 && entry?.ukspeech) {
    phonetics.push({ type: "uk", value: entry.ukspeech });
  }

  // === 步骤 5: 组装词性释义列表 ===
  const parts: Bob.PartObject[] = [...partMap.entries()].map(([part, means]) => ({
    part,
    means,
  }));

  // === 步骤 6: 提取词形变化 ===
  // wfs 包含时态、复数、比较级等变形信息
  const exchanges: Bob.ExchangeObject[] = [];
  for (const wf of entry?.wfs || []) {
    const name = wf.wf?.name?.trim();
    const value = wf.wf?.value?.trim();
    if (name && value) {
      exchanges.push({ name, words: [value] });
    }
  }
  // prototype 字段记录动词原形
  if (entry?.prototype) {
    exchanges.push({ name: "原形", words: [entry.prototype] });
  }

  // === 步骤 7: 组装最终结果 ===
  // 有道补词默认只保留 OALD 风格最接近的核心区块，避免额外标签/段落显得太"有道"。
  const additions: Bob.AddtionObject[] = [];

  return {
    from: "en",
    to: "zh-Hans",
    fromParagraphs: [word],
    toParagraphs: [],
    toDict: {
      word,
      phonetics,
      parts,
      exchanges,
      additions,
      addtions: additions,
    },
    raw: {
      provider: "youdao-dict" as Provider,
      source: data,
    },
  };
}

/**
 * 将有道翻译 API 的响应转换为 Bob 插件标准结果格式。
 *
 * 翻译接口与词典接口的区别：
 * - 翻译接口只返回译文段落，没有音标、词性、词形变化等词典信息
 * - 因此 toDict 使用 buildEmptyDict 生成空结构占位
 * - 译文若为中文，需经过 normalizeChineseTranslationText 进行标点规范化
 *
 * @param text - 用户输入的原始文本
 * @param from - 源语言代码
 * @param to - 目标语言代码
 * @param translations - 翻译接口返回的译文数组
 * @param normalizedText - 经过 OCR 规范化后的文本
 * @returns Bob 标准结果对象；若译文为空则返回 null
 */
function convertTranslationToResult(
  text: string,
  from: string,
  to: string,
  translations: string[],
  normalizedText: string,
): Bob.TranslateResult | null {
  if (translations.length === 0) {
    return null;
  }

  // 目标语言为简体中文时，对译文进行中文标点规范化
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
      provider: "youdao-translate" as Provider,
      normalizedText,
    },
  };
}

/**
 * 查询有道词典接口，获取单词的详细释义、音标和词形变化。
 *
 * 完整流程：
 * 1. 构建带签名的 POST 请求体（buildYoudaoDictionaryBody）
 * 2. 发送请求并解析 JSON 响应（requestJson）
 * 3. 将原始响应转换为 Bob 标准格式（convertDictToResult）
 *
 * 此接口适用于纯英文单词查询（由 isWordQuery 判断），返回结果包含：
 * - 词性释义（parts）
 * - 英/美式音标（phonetics）
 * - 词形变化（exchanges，如时态、复数等）
 *
 * @param word - 要查询的英文单词
 * @returns Bob 标准结果对象；若查询失败或响应无效则返回 null
 */
async function queryYoudaoDictionary(word: string): Promise<Bob.TranslateResult | null> {
  const data = await requestJson({
    method: "POST",
    url: YOUDAO_DICT_URL,
    header: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
    },
    body: buildYoudaoDictionaryBody(word),
  }) as YoudaoDictResponse | null;

  if (!data) return null;
  return convertDictToResult(word, data);
}

/**
 * 查询有道翻译接口，对长文本进行分段翻译。
 *
 * 完整流程：
 * 1. 文本预处理（prepareTranslationText）：OCR 规范化 + 按长度切分
 * 2. 逐段发送翻译请求：每个片段独立调用有道翻译 API
 * 3. 收集所有译文并组装为 Bob 标准格式
 *
 * 分段翻译的必要性：
 * - 有道翻译接口对单条文本有长度限制（约 1000 字符）
 * - OCR 识别的长段落可能远超此限制，需切分后逐段翻译
 * - 切分点优先选择句子边界，保证语义连贯性
 *
 * 错误处理策略：
 * - 任一片段翻译失败即整体返回 null（避免返回不完整的译文）
 * - 不抛出异常，统一返回 null 表示翻译失败
 *
 * @param text - 用户输入的原始文本（可能来自 OCR 识别结果）
 * @param from - 源语言代码
 * @param to - 目标语言代码
 * @returns Bob 标准结果对象；若任一请求失败则返回 null
 */
async function queryYoudaoTranslation(
  text: string,
  from: string,
  to: string,
): Promise<Bob.TranslateResult | null> {
  // 步骤 1: 预处理文本（OCR 修复 + 分段）
  const prepared = prepareTranslationText(text);
  const translations: string[] = [];

  // 步骤 2: 逐段翻译
  for (const segment of prepared.segments) {
    const data = await requestJson({
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
    if (!data || data.errorCode !== "0" || !data.translation || data.translation.length === 0) {
      return null;
    }
    translations.push(...data.translation);
  }

  // 步骤 3: 组装结果
  return convertTranslationToResult(text, from, to, translations, prepared.normalizedText);
}

/**
 * 获取有道支持的语言代码列表副本。
 *
 * 返回数组的副本而非原始数组，防止外部修改影响内部常量。
 *
 * @returns 有道 API 支持的所有语言代码数组
 */
function getYoudaoLanguages(): string[] {
  // 使用展开运算符创建浅拷贝，保护内部常量不被外部修改
  return [...YOUDAO_LANGUAGES];
}

export {
  getYoudaoLanguages,
  isWordQuery,
  queryYoudaoDictionary,
  queryYoudaoTranslation,
};
