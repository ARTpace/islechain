# AI 建模节点（`blenderGen`）

让 AI 在 Blender 里现场建模，产物以 GLB 回传画布。连上模型资产时切换为「改造模式」——
在原件上改，产物原地覆盖该资产（`revision+1`），不新建卡片。

## 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt` | string | 建模需求 |
| `modelRef` | string | 渠道，格式 `provider\|model`，空表示默认渠道 |
| `presetId` | string | 建模人设，默认 `default`；决定加载哪套 skill |
| `targetAssetId` | string | 改造目标资产（由上游连线自动写入，断线清空） |
| `targetProjectId` | string | 目标资产所属项目 |
| `assetRevision` | number | 覆盖后的版本号，用于预览 URL 去缓存 |
| `jobId` | string | 当前 DCC 作业 id |
| `status` | string | `idle` / `building` / `produced` / `failed` |
| `statusText` | string | 状态文案（失败时显示原因） |
| `logs` | string[] | 作业日志，保留最近若干条 |
| `running` | boolean | 是否正在执行（禁用按钮） |
| `spinPaused` | boolean | 3D 预览是否暂停自动旋转 |

## 端口

- **输入**：图片（作为参考送到 `in/`）、模型资产（改造基准）
- **输出**：模型（GLB）

连线规则由 `game-model3d.js` 的 `canConnect` 与 `canvas.js` 的 `canInput` 共同决定。

## 依赖

```js
window.BlenderGenNode.init({ nodes, connections, canvas })   // 均为 getter 函数
```

用到的全局工具函数（由 canvas.js 提供）：`addNode`、`render`、`scheduleSave`、`uid`、
`escapeHtml`、`escapeAttr`、`defaultPoint`、`generatorSources`、`model3dViewerElement`、
`cascadeBtnHtml`。

外部模块：`window.GameModel3D`（资产写入）、`window.GamePipeline`（项目上下文）。

## 后端

| 端点 | 用途 |
|---|---|
| `POST /api/dcc/build-model` | 建作业并启动 AI（带 `presetId`） |
| `GET /api/dcc/jobs/{id}` | 轮询状态与日志 |
| `GET /api/dcc/jobs/{id}/products/{name}` | 取产物文件 |
| `POST /api/dcc/jobs/{id}/import` | 回收产物（新建卡片路径） |

## 人设与 skill

人设是**数据**，不在本目录：

| 内容 | 位置 |
|---|---|
| 人设 prompt | `core/game_role_presets.py`（`kinds` 含 `model` 的那几条） |
| 该人设的 skill | `packs/blender-skills/<preset-id>/SKILL.md` |
| 提示词拼接 | `core/blender_modeller.py` 的 `_skill_text()` |

**`presetId` 必须与 `packs/blender-skills/` 下的目录名一致**，否则会回落到 `default`。

现有：`default`（通用） / `hard-surface`（硬表面） / `stylized`（风格化矮模） / `realistic`（写实）。

## 注意

### 写实硬表面 PBR 基础手册

- 刷新页面后，选择「硬表面道具师」即可自动使用 PBR 手册，提供参考图及面数预算即可。人设与同名手册一一绑定，不再提供独立手册选择；旧节点保存的独立手册选择不再生效。
- 复用一键生成、灰模开关与检查点，补充截面/曲率分析、双视角对照、UV、必要的法线/AO 与程序纹理烘焙、GLB 回读检查；要求同时保存 `source.blend`。
- 此为 Blender 内执行的基础适配版：灰模阶段提供人工放行（画布异步等价物），不含上游完整四阶段审核、Substance、生图或固定诊断照明对照。烘焙与视觉检查由 AI 使用现有工具执行，未完成项应记录，不代表确定性质量保证；可编辑源保留在作业产物目录，画布仍导入 GLB。
- 来源、固定上游版本和 MIT 许可见 `packs/blender-skills/hard-surface/`。

- 改造模式下产物**不落地到画布资产目录**，直接覆盖目标资产，避免每次改造留一个 3MB 副本。
- 作业失败但 `out/` 里已有模型时，会走 `_salvage()` 抢救，节点显示「已出模型（对话中断）」并提供回收按钮。
- 预览元素按 `node.id` 缓存在 canvas.js 的 `model3dViewerCache`，URL 带 `?r=revision` 强制刷新。


## 简化建模流程

- 默认仍一键完成；勾选「先做灰模」只检查主要形状与比例，产物停在 `awaiting_approval`，**不自动导入资产卡片**。节点显示检查点预览、UV 有效去重覆盖与未解决差异，用户放行后由 `POST /api/dcc/jobs/{id}/approve-stage` 从 `checkpoints/01-blockout.glb` 续跑细化（同一 jobId、同一 work 目录，不重传参考、不丢 `source.blend`）。否决只停作业，不删检查点。
- 每次请求先明确简短规格，集中关键参数，灰模自检后再做细节。该约束由 AI 执行，不代表确定性的几何验收。
- AI 按要求把灰模/基线、结构、材质分别导出到作业 `checkpoints/`。中断且没有最终产物时，后端回收最新非空检查点并标记为未完成；能否恢复取决于 AI 是否已成功导出检查点。
- 检查点不进入产物列表、不自动增加资产卡片；放行前面板只做预览与差异展示，不提供版本管理面板。后端从最终 GLB 实测三角面与 UV 有效去重覆盖（256² 栅格、三角形重心光栅化去重），低于 80% 预设或超出面数 ±10% 时写入 `openDifferences`，不采信 AI 自述。
- `blockoutOnly` 随节点与作业保存；运行记录默认折叠。

- 建模策略按部件选择截面/网格编辑、曲线、控制笼和修改器；不再向每次请求注入木箱标杆脚本。非灰模任务必须替换占位形状，风格化不再默认锁定 1500 面和平面着色。这些是生成策略约束，实际造型质量仍需参考图与可视检查验证。
