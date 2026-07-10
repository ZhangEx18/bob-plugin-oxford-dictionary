<p align="center">
<a href="https://github.com/ZhangEx18/bob-plugin-oxford-dictionary/releases"><img src="https://img.shields.io/github/downloads/ZhangEx18/bob-plugin-oxford-dictionary/total.svg" alt="release downloads"></a>
</p>

# bob-plugin-oald-dictionary

Bob 牛津高阶英汉双解词典插件（OALD 10th Edition）。

> 当前仓库以**代码仓库**定位为主：包含插件代码、构建脚本、测试与发布成品，但不再把词库数据作为长期随仓库演进的真源。单词词库与词根词缀词库应独立为外部数据包管理。

## 核心亮点

1. **离线查询**牛津高阶英汉双解词典（OALD 第10版）
2. **双音标支持**：英式 / 美式音标同时展示
3. **词形导航**：动词变形、名词复数、形容词比较级/最高级一键跳转
4. **同源关联**：支持同源词（suppletive forms）与派生词关系展示
5. **多义词分组**：多义词按词性分组，支持同源释义展开
6. **短语动词**：自动展示相关短语动词
7. **文本清理**：自动去除旧式标记与括号干扰
8. **有道 fallback**：OALD 未收录的单词自动 fallback 到有道词典
9. **ECDICT 离线补词**（可选）：OALD 未收录的英文单词可离线补查 ECDICT 词典
10. **多语言翻译**：支持 27 种语言的句子/长文本翻译

## 仓库结构

- `apps/bob-plugin/`：Bob 插件应用层（运行时代码、静态资源、应用打包脚本）
- `scripts/`：正式构建脚本与数据流水线
- `scripts/archive/`：历史实验脚本与已退出主流程的工具
- `tests/`：运行时与数据流水线回归测试
- `data/sources/`：词库源文件约定位置（私有 OALD、ECDICT 原始数据、roots 原始来源）
- `data/build/`：构建中间态（推荐承载 SQLite 状态库）
- `data/packs/`：处理后的外部数据包目录
- `docs/`：维护文档与结构说明
- `env/`：环境依赖与环境模板
- `dist/`：当前工作区的临时构建产物（`main.js`、临时 `.bobplugin`）
- `release/`：历史版本与最终发布用 `.bobplugin` 文件

## 目录职责

当前项目按生命周期分层：

- `data/sources/`
  - 数据库源文件 / 原始词库
- `data/build/`
  - 构建中间态
- `data/packs/`
  - 处理后的可读外部数据包
- `apps/bob-plugin/`
  - 插件代码与应用级构建脚本
- `env/`
  - 环境依赖
- `docs/`
  - 维护文档
- `release/`
  - 最终插件归档
- `dist/`
  - 当前工作区临时构建产物

过渡层目录：

- `dict/`
  - 历史离线词典目录
  - 仅作为迁移期兼容层，不再视为正式真源

## 推荐的数据包布局

推荐把词库单独维护成外部数据包，目录约定如下：

```text
data/packs/
  oald/
    2024.09/
      manifest.json
      dict/
        a.json
        b.json
        ...
  ecdict/
    latest/
      manifest.json
      dict/
        a.json
        b.json
        ...
  roots/
    latest/
      manifest.json
      words/
        a.json
        b.json
        ...
```

说明：

- `oald/.../dict/`
  - 单词词库主包
- `ecdict/.../dict/`
  - 离线补词包
- `roots/.../words/`
  - 词根词缀按单词索引的数据包

数据包解析顺序固定为：显式环境变量、`data/packs/`、`.cache/oald-build/output/packs/`、旧 `.cache` 输出、旧 `dict/`。旧路径仅用于开发和迁移兼容，发布构建不会接受缺少有效 manifest 的旧数据。

## 如何安装

1. 安装 [Bob](https://bobtranslate.com/)
2. 打开本仓库右侧 [Releases](https://github.com/ZhangEx18/bob-plugin-oxford-dictionary/releases) 页面
3. 下载最新以 `.bobplugin` 结尾的文件
4. 双击安装

## 如何检测更新

在 Bob 设置页中打开插件列表，对本插件右键后选择"检测更新"。

## 本地开发

```bash
npm install
npm run lint
npm run test:fast
npm test
npm run build
npm run build:release
```

`npm run build` 是一次性开发构建并会正常退出；需要持续监听时使用 `npm run dev`。`npm run build:release` 只打包已存在且通过 schema、shard 和质量指标校验的 OALD/roots 数据包，不会隐式重建或复用未知旧数据。

## 数据构建与产物治理

从 `v5.6.x` 起，项目将离线词典数据视为**构建产物 / 外部数据包**，而不是日常源码的一部分。

- 优先外部数据包目录：`data/packs/oald/2024.09/dict`
- 构建工作目录：`data/build/oald/`（推荐形态）
- 当前默认构建输出：`.cache/oald-build/output/packs/oald/2024.09/`
- 构建清单：`manifest.json`
- 迁移期兼容：旧 `dict/` 目录仍可被识别，但不再作为推荐使用方式

### 单一构建入口

```bash
npm run build:dict
```

等价于：

```bash
python3 scripts/build_oald_data.py
```

### 当前流水线成熟度

当前数据流水线已经完成这些目标：

- `extract / normalize / relate / emit` 已正式拆成模块
- 阶段状态已迁移到 SQLite
- `normalize` 已支持分批流式入库
- `relate` 已拆出关系中间表（`relation_parents / relation_edges / blocked_forms`）
- 最终运行时仍只消费 `dict/*.json + manifest.json`

当前仍保留的过渡层：

- `scripts/oald_pipeline/legacy_impl.py`
  - 这是带 `DeprecationWarning` 的薄兼容适配器，不再是流程入口
  - 正式流水线不依赖它；旧调用方应迁移到分阶段模块
- `scripts/convert_oaldpe_to_json.py`
  - 这是兼容 shim，不再承载真实实现
- 旧 `dict/`
  - 仍保留兼容读取逻辑，但不再作为正式路径

推荐先建立虚拟环境并安装依赖：

```bash
python3 -m venv .venv
./.venv/bin/pip install -r env/requirements-oald.txt
```

### 私有 OALD 资源要求

默认读取：

```text
data/sources/oald/private/OALD 2024.09/oaldpe.mdx
```

也可以通过环境变量覆盖：

```bash
OALD_MDX_PATH=/absolute/path/to/oaldpe.mdx npm run build:dict
```

### 分阶段构建

构建脚本支持阶段化执行：

```bash
python3 scripts/build_oald_data.py --stage extract
python3 scripts/build_oald_data.py --stage normalize
python3 scripts/build_oald_data.py --stage relate
python3 scripts/build_oald_data.py --stage emit
```

阶段说明：

- `extract`：建立 MDX 词条索引与 link 解析结果
- `normalize`：提取并标准化词条本体数据
- `relate`：构建词形、xref、词族等关系数据
- `emit`：输出最终 shard 与 manifest

推荐完整构建命令：

```bash
./.venv/bin/python scripts/build_oald_data.py --stage all
```

完成后会自动输出构建摘要，包括：

- `entryCount`
- `counts`
- `shardCount`
- `danglingNavigableTargets`
- `pipelineVersion`

### 构建状态存储

从 `v6.x` 起，阶段状态不再以超大 JSON 中间文件为主，而是以 SQLite 状态库保存：

```text
.cache/oald-build/build_state.sqlite
```

当前主要表包括：

- `extract_lookup`
- `extract_links`
- `normalized_entries`
- `final_entries`
- `build_metrics`
- `meta`

这让构建状态可以回放、抽样查询，并为后续增量构建做准备。

## 词根词缀数据包

当前 roots 数据按 **A. 按单词索引** 方式组织。

推荐外部数据包目录：

```text
data/packs/roots/latest/
  manifest.json
  words/
    a.json
    b.json
    ...
```

运行时当前只依赖：

- `word -> RootEntry`

即：
- 查询一个单词
- 直接返回它的 `rootBreakdown` / `roots[]`

当前不要求额外维护：
- `root -> metadata`
- `root family -> related words`

8.4.2 仍会生成并打包 roots 数据，以保持数据包契约；Bob 查询结果暂不渲染 roots 区块。

如果后续要做点击词根、按词根反查单词，再考虑增加第二层 root 索引。

### 调试指定词

可以直接检查某个词在构建状态中的规范化结果和最终结果：

```bash
python3 scripts/build_oald_data.py --inspect decide
```

### 新维护者接手标准步骤

1. 放置合法的 `oaldpe.mdx`
2. 创建虚拟环境并安装依赖
3. 运行 `--stage all`
4. 检查构建摘要中的：
   - `danglingNavigableTargets == 0`
   - `entryCount` 与 `shardCount` 合理
5. 运行：
   - `npm run lint`
   - `node --test tests/schema-contract.test.js`
   - `node --test tests/invariants.test.js`
   - `node --test tests/translate-runtime.test.js`
6. 再执行发布打包

### 跨机器重建要求

- Python 3
- Python 依赖：`beautifulsoup4`、`readmdict`
- Node.js / npm（用于测试与打包）
- 本地可合法访问的 `oaldpe.mdx`

### manifest 内容

构建完成后会生成 `manifest.json`，至少包含：

- `dataVersion`
- `schemaVersion`
- `packType`
- `generatedAt`
- `entryCount`
- `shardCount`
- `layout`
- `files`
- `counts`
- `danglingNavigableTargets`
- `syntheticRelationCount`
- `wordFamilyMissingCount`
- `verbFormMissingCount`

发布打包时，构建脚本按统一路径顺序解析数据包，并要求 OALD 与 roots manifest 声明的所有 shards 都存在。OALD manifest 还必须包含流水线版本和质量指标，且 `danglingNavigableTargets` 必须为 0。

## ECDICT 离线补词（可选）

从 `v7.0.0` 起，插件支持 ECDICT 离线词典作为 OALD 未收录单词的本地补词层，无需联网即可查词。

### 查词优先级

1. **OALD hit** → 返回纯 OALD 结果（不混合 ECDICT）
2. **OALD miss + ECDICT 数据已安装** → 返回 ECDICT 结果
3. **OALD miss + ECDICT 数据未安装 / ECDICT miss** → 走有道在线 fallback

ECDICT 仅参与英文单词查询，不参与句子翻译，也不与 OALD 结果混合展示。

### 安装 ECDICT 数据

ECDICT 数据**不包含在 `.bobplugin` 安装包中**，需单独下载并放置到插件数据目录：

1. 从 [ECDICT Releases](https://github.com/skywind3000/ECDICT) 获取数据源并自行构建，或下载符合下述 pack 布局的制品
2. 确认目录同时包含 `manifest.json` 与 `dict/*.json`
3. 将整个 pack 放入插件目录的 `packs/ecdict/latest/`：

```bash
# macOS 默认路径
~/Library/Application Support/Bob/plugins/com.oald.dictionary/packs/ecdict/latest/
```

4. 重启 Bob 或重新查询即可生效；插件会先校验 `manifest.json`，再按需读取 `dict/` shards

### 自行构建 ECDICT 数据

```bash
# 从 SQLite（推荐，约 340 万词条）
python3 scripts/build_ecdict_data.py --db /path/to/stardict.db

# 或从 CSV（约 77 万词条）
python3 scripts/build_ecdict_data.py --csv /path/to/ecdict.csv

# 输出到自定义目录
python3 scripts/build_ecdict_data.py --db /path/to/stardict.db --output /custom/path/ecdict
```

默认构建产物位于 `.cache/oald-build/output/packs/ecdict/latest/`，包含 manifest 与按首字母分片的 `dict/` JSON 文件。

### 卸载 ECDICT 数据

删除插件目录下的 `packs/ecdict/latest/` 文件夹即可，插件会自动回退到纯 OALD + 有道模式。

## 版本历史

- **v8.4.2** — 收口 npm workspace、现代 pack 路径与严格发布门禁；拆分 TypeScript 入口和 Python 流水线，保持 Bob 查词行为不变；roots 继续打包但不在 UI 展示
- **v8.4.1** — 词根拆解细化：eudic 源数据粗粒度根自动用知识库二次分解；etymology_2 fallback 提取更深层词源树；英文+中文含义同时展示；修复打包路径与 pack-loader 对齐；去掉冗余"词根词缀"section
- **v7.0.0** — ECDICT 离线补词层（数据分离，可选独立下载）
- **v5.0.0** — OALD + Youdao fallback，支持多语言翻译
- **v4.0.1** — 性能优化与代码质量重构
- **v4.0.0** — 完整架构重构（P0-P5）
- **v3.2.5** — 同源词来源去重与同形异义词处理
- **v3.2.4** — 复数与词形变化显示修复
- **v3.2.0** — 文本清理：括号剥离与旧式标记处理

## 说明

由于原始 OALD 词典资源与离线生成数据未包含在公开仓库中，公开仓库默认不保证可直接重新生成完整离线词典数据；当前主要用于：

- 发布可安装插件
- 公开插件源码
- 维护构建脚本与测试

从 `v5.0.0` 起，插件采用“离线 OALD + 在线有道补充”模式：

- OALD 已收录单词：继续使用本地离线词典结果
- OALD 未收录单词：自动请求有道词典补充
- 句子、长文本、多语种翻译：自动请求有道翻译接口

因此，缺词补充与句子翻译场景需要网络可用；若有道接口变更或限流，这部分能力可能受影响。
