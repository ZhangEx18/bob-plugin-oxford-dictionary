# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

这是 Bob 的牛津高阶英汉双解词典插件。公开仓库只包含插件代码、构建脚本、测试和发布产物，不包含 OALD 原始词典资源，也不保证离线词典数据已存在。

核心运行时是”英文单词优先查离线 OALD，缺词再试 ECDICT，最后回退到有道词典/翻译；非英文或长文本直接走有道翻译”。

词根词缀数据由 `scripts/build_roots_data.py` 从多个数据源生成并打包，但 8.4.2 不在 Bob 查询结果中展示 roots 区块。

## 常用命令

```bash
npm install
npm run lint
npm run test:fast
npm test
node --test tests/translate-runtime.test.js
node --test tests/invariants.test.js
npm run build
npm run dev
npm run build:release
npm run build:dict
npm run build:roots
npm run build:ecdict
python3 -m venv .venv
./.venv/bin/pip install -r env/requirements-oald.txt
```

补充说明：
- `npm run lint` 只是 `tsc --noEmit`。
- `npm run build` 是一次性构建；`npm run dev` 才会持续监听。
- `npm run build:release` 会严格校验 OALD/roots manifest 与 shards，再把成品写到 `release/` 并复核包内版本和 `track down` 行为。
- `npm run build:dict` 默认读取私有的 `data/sources/oald/private/OALD 2024.09/oaldpe.mdx`，也可用 `OALD_MDX_PATH` 覆盖。
- `npm run build:roots` 调用 `scripts/build_roots_data.py` 生成词根词缀数据。
- 完整运行时测试需要可读 OALD 数据包；兼容期也可读取旧 `.cache` 或 `dict/`。

## 架构概览

### 运行时入口

- `apps/bob-plugin/src/index.ts` 导出 `translate` 和 `supportLanguages`，是 Bob 宿主的唯一入口。
- `translate` 的路由很明确：
  - 英文单词：`OALD -> ECDICT -> Youdao 词典 -> Youdao 翻译`
  - 非英文、短语、长文本：直接走有道翻译
- `supportLanguages()` 直接返回有道支持的语言列表，不是手写死的单一语言对。

### OALD 数据层

- `apps/bob-plugin/src/pack-loader.ts` 先校验 manifest，再按首字母加载 OALD、ECDICT 和 roots shards。
- `DictEntry` 加载后按不可变对象使用，`apps/bob-plugin/src/relations.ts` 里的多个 `WeakMap` 缓存依赖对象身份一致性，所以同一个词必须尽量复用同一实例。
- `apps/bob-plugin/src/relations.ts` 负责 origin / inflection / xref / word family 的关系解析，并过滤掉无法在运行时导航到的目标。
- `apps/bob-plugin/src/morphology.ts` 合并 `verb_forms`、`exchange` 字符串和关系边，输出 Bob 需要的词形变化区块。
- `apps/bob-plugin/src/formatter.ts` 负责把结构化释义和来源词条整理成 Bob 的 `parts`、`relatedWordParts` 和细分展示格式。
- `apps/bob-plugin/src/roots-loader.ts` 保留数据加载能力但当前没有 UI 消费方；`ecdict-loader.ts` 是可选外部补词层。

### 查询结果组装

- `apps/bob-plugin/src/entry-view.ts` 解析展示词条，`oald-result.ts` 组装 OALD 结果，`translate.ts` 负责 fallback 路由；入口文件只组合并导出。
- 对多义词，`relations.ts` 和 `formatter.ts` 会配合把来源按词义分组，而不是简单拼接。
- 对词形变化，`morphology.ts` 会优先展示更可靠的结构化词形数据，再用原始 `exchange` 字符串补齐。

### 有道回退

- `apps/bob-plugin/src/youdao.ts` 保留语言映射、文本预处理和 HTTP 传输；`youdao-result.ts` 负责词典响应格式化，`md5.ts` 负责签名哈希。
- 单词查询优先走有道词典接口，翻译场景走有道翻译接口。
- 这一层和离线 OALD / ECDICT 是分开的，结果格式一致但来源不同。

### 构建与产物

- `apps/bob-plugin/build.js` 先执行 `tsc --noEmit`，再用 `esbuild` 打包入口到 `dist/main.js`。
- 普通构建允许迁移期路径回退；发布构建必须使用有效 OALD/roots pack，并在写包后复核文件名、`info.json.version`、shards 和核心行为。
- `ECDICT` 数据不打进插件包，用户需要单独放到插件数据目录，运行时才会启用这层回退。

### Python 数据流水线

- `scripts/build_oald_data.py` 是 OALD 离线数据生成入口。
- `scripts/build_roots_data.py` 负责词根词缀数据生成，从多个数据源合并。
- `scripts/build_ecdict_data.py` 负责 ECDICT 数据生成。
- `scripts/parse_eudic.py` 负责从 eudic 词典文件提取词根词缀数据。
- `scripts/oald_pipeline/legacy_impl.py` 是 advisory deprecation 的薄适配器；正式流水线不再依赖它。
- Python 依赖和私有词典资源不在仓库里时，不要假设这些构建命令能直接跑通。

## 词根词缀数据源

`scripts/build_roots_data.py` 合并两个本地私有来源：

- `data/sources/roots/raw/cigen/`：已解析的 eudic 分片 JSON
- `data/sources/roots/raw/morphemes/chunks/`：openetymology morphemes JSON

可以分别用 `--eudic` 和 `--morphemes` 覆盖输入，用 `--output` 覆盖输出。默认输出是 `.cache/oald-build/output/packs/roots/latest/words/`，manifest 位于上一级目录。缺少输入时脚本不会删除已有 roots pack。

## 测试

- 测试使用 Node.js 内置 `node:test`。
- 重点测试通常在 `tests/schema-contract.test.js`、`tests/invariants.test.js`、`tests/translate-runtime.test.js` 和 `tests/pure-functions.test.js`。
- 如果要验证某个回归，优先跑最小相关测试文件，而不是整套测试。

## 环境变量

- `OALD_MDX_PATH`：覆盖默认的 `oaldpe.mdx` 路径。
- `OALD_BUILD_ROOT`：覆盖构建根目录，默认 `.cache/oald-build`。
- `OALD_OUTPUT_ROOT`：覆盖构建产物目录。
- `OALD_DICT_DIR` / `OALD_MANIFEST_PATH` / `OALD_ROOTS_DIR`：显式覆盖打包时的数据包路径。
- `CGEL_CORPUS_PATH`：可选 CGEL 不规则动词语料路径；未设置或文件不存在时相关测试会明确跳过。
