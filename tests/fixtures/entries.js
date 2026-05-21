/**
 * Test fixtures for pure function unit tests.
 * These are synthetic DictEntry objects representing common entry patterns.
 */

/** @returns {import('../../src/types').DictEntry} */
function makeEntry(overrides) {
  return {
    word: "",
    phonetic: "",
    phonetic_us: "",
    translation: "",
    pos: "",
    exchange: "",
    ...overrides,
  };
}

module.exports = {
  makeEntry,

  // Standalone verb with full exchange timeline
  standaloneGo: makeEntry({
    word: "go",
    exchange: "p:went/d:gone/i:going/s:goes/3:goes",
    pos: "v:",
    entry_kind: "standalone",
    translation: "v. 去; 走\nn. 尝试",
    relations: [
      { type: "inflection", target: "goes", label: "第三人称单数", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["v"] },
      { type: "inflection", target: "went", label: "过去式", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["v"] },
      { type: "inflection", target: "gone", label: "过去分词", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["v"] },
      { type: "inflection", target: "going", label: "现在分词", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["v"] },
    ],
  }),

  // Inflection entry with origin back-link
  inflectionWent: makeEntry({
    word: "went",
    exchange: "",
    pos: "",
    entry_kind: "inflection",
    translation: "",
    relations: [
      { type: "origin", target: "go", label: "过去式", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", primary: true, pos_scope: ["v"] },
    ],
  }),

  // Inflection entry with surface comparatives in s-slot (edge case)
  inflectionHappier: makeEntry({
    word: "happier",
    exchange: "s:happy/c:happier/sup:happiest",
    pos: "adj:",
    entry_kind: "inflection",
    translation: "adj. 更快乐的",
    relations: [
      { type: "origin", target: "happy", label: "比较级", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", primary: true, pos_scope: ["adj"] },
    ],
  }),

  // Entry with British/American spelling variants in exchange
  entryWithBritishSpelling: makeEntry({
    word: "travel",
    exchange: "p:travelled/traveled/i:travelling/traveling",
    pos: "v:",
    entry_kind: "standalone",
    translation: "v. 旅行",
  }),

  // Entry with translation_parts
  entryWithTranslationParts: makeEntry({
    word: "run",
    exchange: "p:ran/d:run/i:running/s:runs/3:runs",
    pos: "v:\nn:",
    entry_kind: "standalone",
    translation: "v. 跑\nn. 跑步",
    translation_parts: [
      { pos: "v.", meanings: ["跑", "运行"] },
      { pos: "n.", meanings: ["跑步"] },
    ],
  }),

  // Entry with translation_detail_parts
  entryWithDetailParts: makeEntry({
    word: "test",
    exchange: "s:tests/3:tests",
    pos: "n:\nv:",
    entry_kind: "standalone",
    translation: "n. 测试\nv. 测试",
    translation_detail_parts: [
      {
        pos: "n.",
        details: [
          { text: "测试", countability: "countable" },
          { text: "检验", countability: "countable" },
        ],
      },
      {
        pos: "v.",
        details: [{ text: "测试" }, { text: "考验" }],
      },
    ],
  }),

  // Standalone entry with xref origin (homograph pattern)
  standaloneFound: makeEntry({
    word: "found",
    exchange: "p:found/d:found/i:finding/s:finds/3:finds",
    pos: "v:",
    entry_kind: "standalone",
    translation: "v. 建立; 发现",
    relations: [
      { type: "xref", target: "find", label: "过去式", direction: "outgoing", navigable: true, display: "exchange", source: "protected", pos_scope: ["v"] },
    ],
  }),

  // Alias entry
  aliasAline: makeEntry({
    word: "a-line",
    linked_word: "A-line",
    entry_kind: "alias",
    translation: "",
  }),

  // Entry with empty exchange
  entryNoExchange: makeEntry({
    word: "hello",
    exchange: "",
    pos: "int:",
    entry_kind: "standalone",
    translation: "int. 你好",
  }),

  // Entry with only s-slot containing comparative forms (239-edge-case pattern)
  edgeCaseComparativeInS: makeEntry({
    word: "bigger",
    exchange: "s:big/c:bigger/sup:biggest",
    pos: "adj:",
    entry_kind: "inflection",
    translation: "adj. 更大的",
    relations: [
      { type: "origin", target: "big", label: "比较级", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", primary: true, pos_scope: ["adj"] },
    ],
  }),

  // Multiple-origin entry (leaves pattern)
  multiOriginLeaves: makeEntry({
    word: "leaves",
    exchange: "",
    pos: "n:\nv:",
    entry_kind: "standalone",
    translation: "n. 树叶; 假期\nv. 离开",
    relations: [
      { type: "origin", target: "leaf", label: "复数", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["n"] },
      { type: "origin", target: "leave", label: "第三人称单数", direction: "outgoing", navigable: true, display: "exchange", source: "exchange", pos_scope: ["v"] },
    ],
  }),
};
