<p align="center">
<a href="https://github.com/ZhangEx18/bob-plugin-oxford-dictionary/releases"><img src="https://img.shields.io/github/downloads/ZhangEx18/bob-plugin-oxford-dictionary/total.svg" alt="release downloads"></a>
</p>

# bob-plugin-oald-dictionary

Bob 牛津高阶英汉双解词典插件（OALD 10th Edition）。

> 当前公开仓库仅包含插件代码、构建脚本、测试与发布成品，不包含 OALD 原始词典资源与本地生成的离线词典数据。

## 核心亮点

1. **离线查询**牛津高阶英汉双解词典（OALD 第10版）
2. **双音标支持**：英式 / 美式音标同时展示
3. **词形导航**：动词变形、名词复数、形容词比较级/最高级一键跳转
4. **同源关联**：支持同源词（suppletive forms）与派生词关系展示
5. **多义词分组**：多义词按词性分组，支持同源释义展开
6. **短语动词**：自动展示相关短语动词
7. **文本清理**：自动去除旧式标记与括号干扰
8. **有道 fallback**：OALD 未收录的单词自动 fallback 到有道词典
9. **多语言翻译**：支持 27 种语言的句子/长文本翻译

## 仓库结构

- `src/`：Bob 插件入口与运行时逻辑
- `scripts/`：词典转换脚本
- `tests/`：词形关系回归测试
- `static/`：图标等静态资源
- `release/`：已打包好的 `.bobplugin` 文件
- `build.js`：构建与打包脚本

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
npm test
node build.js --release
```

## 版本历史

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
