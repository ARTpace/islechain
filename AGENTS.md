# 提示词维护已迁移

- 网站提示词采集、下载、分类、翻译、去重、资产发布及对应 Skill，统一在独立仓库 [Art-prompt-library](https://github.com/ARTpace/Art-prompt-library) 维护。
- 本机仓库位于 `../Art-prompt-library/`；处理上述任务时先读取该仓库 `AGENTS.md`，使用其中的采集／分类 Skill，不在主工具复制第二份脚本或分类字典。
- 本项目保留提示词展示、搜索筛选、用户编辑、包安装／更新和卸载等运行功能。主工具使用接口见 `docs/style-repository.md`，迁移说明见 `docs/prompt-maintenance.md`。

- 标签也从独立仓库的 `libraries/tags/` 按类安装与卸载；禁止恢复读取工程内旧 presets、YAML、提示词库基线或 Fooocus 海报风格。
