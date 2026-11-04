# 提示词维护仓库

网站采集、下载、数据整理、分类标准与 Skill 已统一迁至：

- 远端：<https://github.com/ARTpace/Art-prompt-library>
- 本机：`H:/AI-Tools/Art-prompt-library`

主工具只保留提示词库的展示、搜索、用户编辑以及平台包安装／更新／卸载；采集不再在工具运行目录执行。旧的 `/api/import/fooocus-styles` 入口返回迁移说明，改为在独立仓库采集并发布，再通过风格包管理安装。

新仓库的 `AGENTS.md` 是维护入口；分类 Skill 位于 `.agents/skills/classify-style-packs/`，网站采集 Skill 位于 `.agents/skills/collect-web-prompts/`。分类标准只在新仓库 `docs/style-pack-taxonomy-v1.md` 与 `docs/style-pack-spec-v1.md` 维护。

迁移后的本地原始数据、下载缓存、分类批次及历史中间结果保存在新仓库 `data/` 和 `artifacts/`，不默认提交 Git。发布数据使用 `packs/` 和 `catalog.json`。已安装到系统用户目录的包和用户增量层不移动。

旧 `artifacts/ccprompt/` 因 Windows 日志锁保留为静止备份；实际下载已从新仓库 `artifacts/ccprompt/` 断点恢复，不要从旧位置启动第二个下载。

画师、角色的采集、拆包及源数据也已迁至 `../../Art-prompt-library/`，详见该仓库 `docs/artist-character-maintenance.md`。本工具保留运行与构建资产副本，不再维护采集脚本。

标签数据已迁入 Art-prompt-library 的 `libraries/tags/`，按原 14 类作为 GitHub 可选包发布。主工具仅消费已安装包；旧标签 JSON/YAML、旧风格快照、旧内置提示词库和海报风格不再读取。清理原件在独立仓库 `artifacts/backups/retired-prompt-data-20261101/` 归档。

风格提示词可在主大类下关联多个子类，关联保存在 `classification.subcategories`。筛选按关联匹配，全部与大类总数按条目计数，子类数允许重叠；单条正文和 ID 不复制。
