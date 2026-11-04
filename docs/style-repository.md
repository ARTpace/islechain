# 独立风格资产仓库

风格包管理支持一个公开 GitHub 仓库来源，与本地导入、随包可选 ZIP 并存。入口：「资产库 → 提示词库 → 风格包管理 → 添加仓库」。

当前仓库：`https://github.com/ARTpace/Art-prompt-library`，本地检出目录 `H:/AI-Tools/Art-prompt-library`。

支持仓库首页（默认 main）、`/tree/<分支>/<目录>`、GitHub 的 catalog.json 文件地址、raw.githubusercontent.com 的 catalog.json 原始地址。其他默认分支或带 `/` 的分支名建议直接填写原始清单地址。暂不支持私有仓库认证、其他 Git 托管服务或 Git clone 同步。

## 仓库格式

```text
catalog.json
packs/<packId>/pack.json
packs/<packId>/<category>.json
scripts/build_catalog.py
```

仓库使用普通 Git 跟踪 JSON，不要求 ZIP。清单示例（sha256 必须是真实摘要）：

```json
{
  "schema": 1,
  "packs": [{
    "packId": "example-styles",
    "name": "示例风格",
    "version": "1.0.0",
    "entryCount": 100,
    "path": "packs/example-styles",
    "sha256": {"pack.json": "64位小写SHA256", "photography.json": "64位小写SHA256"}
  }]
}
```

包内仍使用既有 schema 1 的 categories → subcategories → presets 结构。仓库按 ChatGPT、Nano Banana、PromptImageAtlas、腾讯元宝、其它来源拆成 5 个独立平台包。更新对应包时递增它的版本并重建清单；同版本的文件摘要变化也会提示更新，不把仓库旧版本提示为升级。

## 行为与数据位置

- 添加/更换仓库：先下载并校验清单，成功后保存；失败保留原来源。
- 打开界面自动检查仓库，15 分钟内复用清单；「检查更新」强制更新清单，不自动安装或覆盖数据。网络失败保留上次清单并提示失败。
- 安装：逐文件下载、核对摘要和实际条目数，临时组装成 ZIP 复用既有导入器，安装后临时文件自动清理。
- 仓库版本较新或同版本文件摘要不同时提供「更新此包」，显示本地与仓库版本，覆盖前确认，只替换对应包，保留其他包和用户增量层。
- 平台包清单中的 `replaces: ["art-canvas-core"]` 用于检测旧整库包；检测到混装风险时阻止安装，并提示先导出备份、卸载旧整库包。
- 断开来源只移除仓库配置，不卸载已安装包。卸载沿用现有风格包管理。
- 配置及清单缓存：`<用户数据目录>/data/style-repository.json`；包仍在 `<用户数据目录>/style-packs/`。
- 仓库图片地址按原样保留，不自动上传项目本地缩略图，也不保证远程图片永久有效。

仓库数据与代码仓库分开提交；当前分类仍有待整理项，安装不等于人工审核通过。
