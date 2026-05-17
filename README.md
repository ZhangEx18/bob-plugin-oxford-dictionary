<p align="center">
<a href="https://github.com/ZhangEx18/bob-plugin-oald-dictionary/releases"><img src="https://img.shields.io/github/downloads/ZhangEx18/bob-plugin-oald-dictionary/total.svg" alt="release downloads"></a>
</p>

# bob-plugin-oald-dictionary
Bob 牛津高阶英汉双解词典插件。

> 当前公开仓库仅包含插件代码、构建脚本、测试与发布成品，不包含 OALD 原始词典资源与本地生成的离线词典数据。

## 核心亮点
1. 离线查询牛津高阶英汉双解词典
2. 支持英式 / 美式音标展示
3. 支持词形导航与回退关系
4. 提供可直接安装的 `.bobplugin` 发布文件

## 仓库结构
- `src/`：Bob 插件入口与运行时逻辑
- `scripts/`：词典转换脚本
- `tests/`：词形关系回归测试
- `static/`：图标等静态资源
- `release/`：已打包好的 `.bobplugin` 文件
- `build.js`：构建与打包脚本
- `appcast.json`：Bob 插件更新元数据

## 如何安装
1. 安装 Bob
2. 打开本仓库右侧 Releases 页面
3. 下载以 `.bobplugin` 结尾的文件
4. 双击安装

## 如何检测更新
在 Bob 设置页中打开插件列表，对本插件右键后选择“检测更新”。

## 本地开发
```bash
npm install
npm test
node build.js --release
```

## 说明
由于原始 OALD 词典资源与离线生成数据未包含在公开仓库中，公开仓库默认不保证可直接重新生成完整离线词典数据；当前主要用于：
- 发布可安装插件
- 公开插件源码
- 维护构建脚本与测试
