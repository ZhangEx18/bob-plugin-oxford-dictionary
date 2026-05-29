# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

Bob 牛津高阶英汉双解词典插件（OALD 10th Edition），运行在 [Bob](https://bobtranslate.com/) 翻译软件中。采用"离线 OALD + ECDICT 补词 + 有道在线 fallback"三层查词策略。

## 常用命令

```bash
npm install                  # 安装依赖
npm test                     # 运行全部测试（node --test tests/*.test.js）
npm run lint                 # TypeScript 类型检查（tsc --noEmit）
npm run build                # 构建 + 打包 .bobplugin（含类型检查）
npm run build:dict           # 构建 OALD 离线词典数据（需要 Python + oaldpe.mdx）
```

单个测试文件：
```bash
node --test tests/schema-contract.test.js
```

Python 数据流水线需要虚拟环境：
```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements-oald.txt
```

## 架构概览

### 运行时（TypeScript，`src/`）

插件入口 `src/index.ts` 导出 `translate` 和 `supportLanguages`，由 Bob 宿主调用。

**查词路由（`translate` 函数）：**
1. 英文单词查询 → OALD 离线词典 → ECDICT 离线补词 → 有道词典 API → 有道翻译 API
2. 多词/非英文 → 直接走有道翻译 API

**核心数据流：**
- `data-loader.ts`：按首字母分片加载 `dict/{char}.json`，维护两级缓存（shardCache + entryCache）
- `relations.ts`：从 `DictEntry.relations` 边数组解析 origin/inflection/xref 关系，使用 WeakMap 缓存
- `morphology.ts`：构建词形变化展示（复数、过去式等）
- `formatter.ts`：解析 translation_parts 为 Bob UI 格式的 parts 数组
- `types.ts`：所有共享类型定义（DictEntry、RelationEdge、EntryView 等）

**关键设计约束：**
- `DictEntry` 对象加载后视为不可变，`relations.ts` 的 WeakMap 缓存依赖对象引用相等性（`data-loader.ts` 的 entryCache 保证同一单词返回同一实例）
- 词典数据按首字母分片（`a.json` ~ `z.json` + `_.json`），运行时按需加载
- `entry_kind` 字段区分 standalone（有完整释义）、alias（重定向）、inflection（词形变化）

### 数据流水线（Python，`scripts/`）

四阶段流水线：`extract → normalize → relate → emit`

- 入口：`scripts/build_oald_data.py`，支持 `--stage` 分阶段执行
- 模块：`scripts/oald_pipeline/` 下按阶段拆分（extract_core.py、normalize.py、relate.py、emit.py）
- 状态存储：SQLite（`.cache/oald-build/build_state.sqlite`）
- 产物：`.cache/oald-build/output/dict/` 下的分片 JSON + manifest.json
- 兼容层：`legacy_impl.py` 承载尚未拆散的旧逻辑

### 构建与打包（`build.js`）

`node build.js` 执行：TypeScript 类型检查 → esbuild 打包 `src/index.ts` → 压缩为 `.bobplugin` ZIP（含 main.js、icon、dict 分片、manifest）。

## 测试

测试使用 Node.js 内置 test runner（`node:test`），不依赖 Jest/Mocha。

关键测试文件：
- `tests/schema-contract.test.js` — 验证所有词典条目符合 DictEntry schema
- `tests/invariants.test.js` — 验证关系图不变量（origin/inflection 一致性）
- `tests/translate-runtime.test.js` — 运行时翻译行为回归
- `tests/pure-functions.test.js` — 纯函数单元测试

测试需要词典数据存在（`dict/` 或 `.cache/oald-build/output/dict/`）。

## 环境变量

- `OALD_MDX_PATH` — 覆盖默认的 oaldpe.mdx 路径
- `OALD_BUILD_ROOT` — 覆盖构建根目录（默认 `.cache/oald-build`）
- `OALD_OUTPUT_ROOT` — 覆盖构建产物目录
