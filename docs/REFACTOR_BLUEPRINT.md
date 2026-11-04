# art-canvas 后端模块化重构蓝图（PRP）

> **文档版本**：v1.0
> **创建日期**：2026-06-24
> **适用范围**：`H:\AI-Tools\art-canvas\main.py`（现状 12,344 行 / 484 KB / 484 函数 / 70 类 / 212 路由）
> **目标读者**：项目维护者（个人 / 团队）
> **核心主张**：将单体 `main.py` 拆分为按业务域组织的 FastAPI Router 模块，让 1 万行代码重新可被单人维护与协作。

---

## 0. 为什么要做这件事（Why）

### 0.1 现状诊断

| 指标 | main.py 现状 | 健康阈值 | 评价 |
|------|------------|----------|------|
| 文件大小 | 484 KB | < 100 KB | 🔴 严重超标 |
| 行数 | 12,344 | < 3,000 | 🔴 严重超标 |
| 顶层函数 | 484 | < 100 | 🔴 严重超标 |
| 路由数 | 212 | < 50 / 文件 | 🔴 严重超标 |
| 平均函数长度 | 25 行 | < 30 行 | 🟡 接近阈值 |
| 最长函数 | `generate` 252 行 | < 80 行 | 🔴 不可读 |

### 0.2 真实痛点

- **定位慢**：找一个端点要在 1 万行里 `Ctrl+F`，IDE 索引卡顿。
- **合并冲突**：多人改同一文件几乎必冲突，git 协作成本指数级上升。
- **无法复用**：业务函数与 FastAPI 路由耦合，无法在脚本里独立调用。
- **测试困难**：没有清晰的边界，单测只能端到端跑，启动慢、调试难。
- **AI 协作难**：上下文窗口会被一整个文件填满，模型无法聚焦。

### 0.3 项目已具备的条件

- `CLAUDE.md` 已确立"模块化开发、避免单文件过大"原则（用户规则第 6 条）。
- 已存在 `smart_tts.py` / `smart_prompt.py` / `preset_manager.py` 等先行模块，证明项目认可"按域拆分"。
- `static/setting/main-1.py` 是**单文件参考实现**（3,552 行 / 50 路由），但项目发展到 12,344 行时已超出单文件参考的承载能力，需要**进一步拆分**而非简单照搬。
- `CONTEXT.md` 已沉淀核心领域模型（画布 / 资产 / 输出 / 用户），是拆分边界的最佳依据。

### 0.4 不做什么（Out of Scope）

- ❌ 不重写业务逻辑（保持行为一致是底线）。
- ❌ 不升级 FastAPI / Pydantic 大版本（避免一次性引入两类风险）。
- ❌ 不重构前端 HTML / JS。
- ❌ 不迁移数据库（项目用 JSON 文件存储，保持原样）。
- ❌ 不引入新依赖。

---

## 1. 目标与成功标准（What & Success Criteria）

### 1.1 北极星指标

| 指标 | 当前 | 目标 | 验证方式 |
|------|------|------|----------|
| `main.py` 行数 | 12,344 | < 500 | `wc -l main.py` |
| 最大单文件行数 | 12,344 | < 800 | 循环 `wc -l` |
| 单文件路由数 | 212 | < 30 | AST 统计 |
| 单函数最大行数 | 252 | < 100 | AST 统计 |
| 模块导入层级 | 0（无模块） | 3 层（api / services / core） | `find . -name "*.py" \| tree` |
| 启动时间 | ~3s | 变化 < 10% | `time python main.py` |
| 端到端测试通过率 | 100% | 100%（零回归） | 手动跑核心 6 流程 |

### 1.2 验证清单（每阶段必须全部通过才能合并）

```
[ ] 启动后端服务成功（uvicorn 不报错）
[ ] / 页面 200
[ ] /api/auth/me 返回 401（未登录）或 200（已登录）
[ ] 6 个核心流程跑通：
    1. 用户注册 → 登录 → 拿 token
    2. 创建画布 → 节点保存 → 加载
    3. TTS 合成 → 下载音频
    4. ComfyUI 工作流提交 → 轮询 → 拿图
    5. 资产库上传 → 列出 → 删除
    6. 历史记录保存 → 列出 → 删除
[ ] 所有 import 不出现循环依赖（python -c "import main" 0 退出）
[ ] main.py 行数 < 500
[ ] GetDiagnostics 无新增 warning
```

---

## 2. 目标架构（Target Architecture）

### 2.1 三层目录结构

```
art-canvas/
├── main.py                    # 仅做"装配"：app 创建 + middleware + include_router + 启动
├── core/                      # 基础设施层（无业务依赖）
│   ├── __init__.py
│   ├── config.py              # 路径常量、环境变量、加载顺序
│   ├── auth.py                # auth 路由 + 依赖注入（get_current_user）
│   ├── ws.py                  # ConnectionManager（WebSocket 广播）
│   ├── files.py               # safe_user_id / sanitize_folder_name 等路径工具
│   ├── history.py             # save_to_history / get_history 等历史工具
│   ├── http_client.py         # 共享 httpx.AsyncClient（避免每次新建连接）
│   └── logging_setup.py       # QuietAccessLogFilter 等
│
├── schemas/                   # Pydantic 数据模型（与业务解耦）
│   ├── __init__.py
│   ├── auth.py                # AuthRegisterRequest / AuthLoginRequest / ...
│   ├── canvas.py              # CanvasCreateRequest / CanvasSaveRequest / ...
│   ├── comfyui.py             # ComfyUIInstancesUpdateRequest / ...
│   ├── tts.py                 # SmartTTSRequest / ...
│   ├── generation.py          # GenerateRequest / MsGenerateRequest / CloudGenRequest / ...
│   ├── asset.py               # AssetLibraryRequest / LocalAssetRequest / ...
│   └── misc.py                # 其余 30+ 薄模型
│
├── api/                       # 路由层（薄：参数解析 + 调 service + 响应）
│   ├── __init__.py
│   ├── router.py              # APIRouter 聚合器，main.py 一次性 include
│   ├── auth.py                # /api/auth/* (7 路由)
│   ├── canvas.py              # /api/canvases/* (14)
│   ├── comfyui.py             # /api/comfyui/* (14)
│   ├── tts.py                 # /api/tts/* + /api/smart-tts (12)
│   ├── jimeng.py              # /api/jimeng/* (7)
│   ├── runninghub.py          # /api/runninghub/* (11)
│   ├── smart_prompt.py        # /api/smart-prompt/* (9)
│   ├── asset_library.py       # /api/asset-library/* (15)
│   ├── local_assets.py        # /api/local-assets/* (11)
│   ├── providers.py           # /api/providers/* (6)
│   ├── workflows.py           # /api/workflows/* (6)
│   ├── lora.py                # /api/lora-manager/* + /api/loras/* (9)
│   ├── history.py             # /api/history/* (4)
│   ├── chat.py                # /api/chat/* + /api/conversations/* (6)
│   ├── translate.py           # /api/translate/* (4)
│   ├── prompt.py              # /api/prompt-libraries/* + /api/prompt-* (15)
│   ├── shared_folders.py      # /api/shared-folders/* (6)
│   ├── config.py              # /api/config/* (3)
│   ├── canvas_assets.py       # /api/canvas-assets/* (3)
│   ├── canvas_workflows.py    # /api/canvas-workflows/* (3)
│   ├── canvas_image_tasks.py  # /api/canvas-image-tasks/* (2)
│   ├── canvas_llm.py          # /api/canvas-llm/* (1)
│   ├── user.py                # /api/user/* + /api/auth/me (2)
│   ├── gallery.py             # /api/gallery/* (2)
│   ├── angle.py               # /api/angle/* (2)
│   └── misc.py                # /api/cache /api/queue_status /api/thumbnails 等单路由
│
└── services/                  # 业务层（无 FastAPI 依赖，可独立 import / 单测）
    ├── __init__.py
    ├── generation/
    │   ├── __init__.py
    │   ├── base.py            # 通用生成基类（参数拼装、限流、重试）
    │   ├── jimeng.py          # generate_jimeng_video / 即梦相关
    │   ├── cloud.py           # generate_cloud / poll_angle_cloud / ms_generate
    │   ├── ai_image.py        # generate_ai_image
    │   ├── angle.py           # generate_angle_cloud
    │   └── workflow.py        # run_workflow / sync_runninghub_workflow_to_provider
    │
    ├── tts/
    │   ├── __init__.py
    │   ├── engine.py          # _tts_generate_inner
    │   ├── voice_lib.py       # voiceLibrary CRUD / 导入导出 / podcast
    │   └── asr.py             # tts_asr
    │
    ├── assets/
    │   ├── __init__.py
    │   ├── library.py         # 资产库业务
    │   ├── local.py           # 本地资产扫描 / 分类 / 字幕
    │   ├── thumbnails.py      # 缩略图生成
    │   └── output.py          # download / open / delete output
    │
    ├── comfyui/
    │   ├── __init__.py
    │   ├── client.py          # 提交 / 轮询 / proxy_view
    │   └── instances.py       # 实例管理
    │
    ├── canvas/
    │   ├── __init__.py
    │   ├── crud.py            # 创建 / 读取 / 更新 / 删除 / 还原 / 清理
    │   ├── io.py              # 导入导出 / 资产下载
    │   └── llm.py             # canvas-llm / canvas-image-tasks
    │
    ├── comfyui_proxy.py → services/comfyui/client.py
    ├── lora.py                # LoRA 扫描 / 上传 / 测试
    ├── smart_canvas.py        # canvas_workflows / smart_canvas
    └── smart_prompt/          # 已有 smart_prompt.py，迁入
```

### 2.2 分层职责矩阵

| 层 | 职责 | 不应包含 | 单测难度 |
|----|------|----------|----------|
| `core/` | 通用工具、配置、跨域基础设施 | 任何业务逻辑 | 易（纯函数） |
| `schemas/` | 数据形状定义 | 业务逻辑、IO | 易（Pydantic 验证） |
| `services/` | 业务逻辑、第三方 API 调用 | FastAPI 依赖 | 中（需要 mock 外部） |
| `api/` | 路由、参数解析、响应封装 | 业务实现细节 | 中（需 mock service） |
| `main.py` | app 装配、中间件、启动 | 任何业务 | 无（只验证启动） |

### 2.3 依赖方向（绝不允许反向）

```
api/  ──→  services/  ──→  core/
  │            │              │
  └──→  schemas/  ←───────────┘
```

- `core/` 不 import `api/` 或 `services/`。
- `services/` 不 import `api/`，但可 import `core/` 和 `schemas/`。
- `api/` 可 import 任何层。
- `schemas/` 是叶子，只 import 第三方（Pydantic）。

---

## 3. 拆分映射表（What Goes Where）

> 源数据来自 AST 扫描 `main.py` 的实际函数 / 类 / 路由位置。

### 3.1 Pydantic 模型（70 个）→ `schemas/`

| 当前行号 | 模型名 | 目标文件 |
|----------|--------|----------|
| L1503 | `GenerateRequest` | `schemas/generation.py` |
| L1517 | `WorkflowField` | `schemas/generation.py` |
| L1529 | `WorkflowConfig` | `schemas/generation.py` |
| L1533 | `WorkflowRunRequest` | `schemas/generation.py` |
| L1538 | `DeleteHistoryRequest` | `schemas/history.py` |
| L1541 | `TokenRequest` | `schemas/auth.py` |
| L1544 | `CloudGenRequest` | `schemas/generation.py` |
| L1552 | `CloudPollRequest` | `schemas/generation.py` |
| L1557 | `AIReference` | `schemas/generation.py` |
| L1561 | `OnlineImageRequest` | `schemas/generation.py` |
| L1570 | `ChatRequest` | `schemas/chat.py` |
| L1582 | `MsGenerateRequest` | `schemas/generation.py` |
| L1591 | `CanvasLLMRequest` | `schemas/canvas.py` |
| L1599 | `ConversationCreateRequest` | `schemas/chat.py` |
| L1602 | `CanvasCreateRequest` | `schemas/canvas.py` |
| L1607 | `CanvasSaveRequest` | `schemas/canvas.py` |
| L1614 | `ConfigUpdateRequest` | `schemas/config.py` |
| L1619 | `AuthRegisterRequest` | `schemas/auth.py` |
| L1623 | `AuthLoginRequest` | `schemas/auth.py` |
| L1627 | `AdminResetPasswordRequest` | `schemas/auth.py` |
| L1632 | `AdminDeleteUserRequest` | `schemas/auth.py` |
| L1638 | `CanvasAssetCheckRequest` | `schemas/canvas.py` |
| L1641 | `CanvasAssetDownloadRequest` | `schemas/canvas.py` |
| L1646 | `LocalAssetCaptionRequest` | `schemas/asset.py` |
| L1653 | `LocalAssetCaptionSaveRequest` | `schemas/asset.py` |
| L1657 | `LocalAssetClassifyRequest` | `schemas/asset.py` |
| L1664 | `LocalAssetUrlImportItem` | `schemas/asset.py` |
| L1670 | `LocalAssetUrlImportRequest` | `schemas/asset.py` |
| L1679 | `LocalAssetFolderRequest` | `schemas/asset.py` |
| L1684 | `LocalAssetRenameRequest` | `schemas/asset.py` |
| L1688 | `AssetLibraryCategoryRequest` | `schemas/asset.py` |
| L1693 | `AssetLibraryRequest` | `schemas/asset.py` |
| L1696 | `AssetLibraryAddRequest` | `schemas/asset.py` |
| L1702 | `AssetLibraryBatchAddRequest` | `schemas/asset.py` |
| L1707 | `SharedFolderRegister` | `schemas/asset.py` |
| L1711 | `SharedFolderImport` | `schemas/asset.py` |
| L1717 | `AssetLibraryRenameRequest` | `schemas/asset.py` |
| L1721 | `AssetLibraryBatchDeleteRequest` | `schemas/asset.py` |
| L1725 | `AssetLibraryBatchMoveRequest` | `schemas/asset.py` |
| L1731 | `AssetLibraryBatchCropRequest` | `schemas/asset.py` |
| L1738 | `AssetAvatarRegisterRequest` | `schemas/asset.py` |
| L1744 | `AssetLibraryClassifyRequest` | `schemas/asset.py` |
| L1752 | `PromptLibraryRequest` | `schemas/prompt.py` |
| L1755 | `PromptLibraryItemRequest` | `schemas/prompt.py` |
| L1764 | `PromptLibraryBatchDeleteRequest` | `schemas/prompt.py` |
| L1767 | `PromptLibraryCategoryRequest` | `schemas/prompt.py` |
| L5146 | `UserAssetSaveRequest` | `schemas/asset.py` |
| L5250 | `DownloadZipRequest` | `schemas/misc.py` |
| L5458 | `SaveHistoryRequest` | `schemas/history.py` |
| L5665 | `DeleteImageRequest` | `schemas/misc.py` |
| L6159 | `SmartPromptRequest` | `schemas/smart_prompt.py` |
| L6321 | `SmartTTSRequest` | `schemas/tts.py` |
| L7219 | `SmartCanvasGroupExportItem` | `schemas/canvas.py` |
| L7225 | `SmartCanvasGroupExportRequest` | `schemas/canvas.py` |
| L7232 | `CloudVideoUploadRequest` | `schemas/generation.py` |
| L7236 | `LocalImageImportRequest` | `schemas/asset.py` |
| L7240 | `RunningHubSubmitRequest` | `schemas/runninghub.py` |
| L7246 | `RunningHubWorkflowSubmitRequest` | `schemas/runninghub.py` |
| L7252 | `RunningHubUploadAssetRequest` | `schemas/runninghub.py` |
| L7256 | `RunningHubWorkflowConfigField` | `schemas/runninghub.py` |
| L7275 | `RunningHubWorkflowConfig` | `schemas/runninghub.py` |
| L7284 | `CanvasWorkflowExportRequest` | `schemas/canvas.py` |
| L7295 | `JimengHelpRequest` | `schemas/jimeng.py` |
| L7298 | `JimengQueryMediaRequest` | `schemas/jimeng.py` |
| L7302 | `ApiProviderPayload` | `schemas/providers.py` |
| L7314 | `TestConnectionPayload` | `schemas/providers.py` |
| L7256 | （重复） | 同上 |
| L7790 | `ComfyUIInstancesUpdateRequest` | `schemas/comfyui.py` |

> **规则**：每文件不超过 12 个模型，文件超过即按业务再切。

### 3.2 核心类（少量非数据类）→ `core/` 或 `services/`

| 行号 | 类 | 目标 |
|------|------|------|
| L38 | `ConnectionManager`（57 行） | `core/ws.py` |
| L467 | `JimengPendingError` | `services/generation/jimeng.py` |
| L1392 | `NoCacheStaticFiles` | `core/static_files.py` |

### 3.3 路由（212 个）→ `api/` 22 个文件

| 路由前缀 | 数量 | 目标文件 |
|----------|------|----------|
| `/api/auth/*` | 7 | `api/auth.py` |
| `/api/canvases/*` | 14 | `api/canvas.py` |
| `/api/comfyui/*` | 14 | `api/comfyui.py` |
| `/api/tts/*` + `/api/smart-tts` | 12 | `api/tts.py` |
| `/api/jimeng/*` | 7 | `api/jimeng.py` |
| `/api/runninghub/*` | 11 | `api/runninghub.py` |
| `/api/smart-prompt/*` | 9 | `api/smart_prompt.py` |
| `/api/asset-library/*` | 15 | `api/asset_library.py` |
| `/api/local-assets/*` | 11 | `api/local_assets.py` |
| `/api/providers/*` | 6 | `api/providers.py` |
| `/api/workflows/*` | 6 | `api/workflows.py` |
| `/api/lora-manager/*` + `/api/loras/*` | 9 | `api/lora.py` |
| `/api/history/*` | 4 | `api/history.py` |
| `/api/chat/*` + `/api/conversations/*` | 6 | `api/chat.py` |
| `/api/translate/*` | 4 | `api/translate.py` |
| `/api/prompt-libraries/*` + 旁支 | 15 | `api/prompt.py` |
| `/api/shared-folders/*` | 6 | `api/shared_folders.py` |
| `/api/config/*` | 3 | `api/config.py` |
| `/api/canvas-assets/*` | 3 | `api/canvas_assets.py` |
| `/api/canvas-workflows/*` | 3 | `api/canvas_workflows.py` |
| `/api/canvas-image-tasks/*` | 2 | `api/canvas_image_tasks.py` |
| `/api/canvas-llm/*` | 1 | `api/canvas_llm.py` |
| `/api/user/*` | 2 | `api/user.py` |
| `/api/gallery/*` | 2 | `api/gallery.py` |
| `/api/angle/*` | 2 | `api/angle.py` |
| 单路由（`/api/cache` 等） | ~12 | `api/misc.py` |
| `/`, `/api/view`, `/api/upload`, `/generate`, `/output/*`, `/assets/*`, `/ws/*` | 7 | `main.py`（保留顶层装配） |

### 3.4 业务函数（核心 30 个）→ `services/`

| 行号 | 函数 | 行数 | 目标 |
|------|------|------|------|
| L839 | `generate_jimeng_video` | 114 | `services/generation/jimeng.py` |
| L2332 | `generate_ai_image` | 92 | `services/generation/ai_image.py` |
| L3326 | `sync_runninghub_workflow_to_provider` | 59 | `services/generation/workflow.py` |
| L5291 | `chat` | 77 | `services/chat/llm.py` |
| L5370 | `chat_stream` | 85 | `services/chat/stream.py` |
| L5525 | `get_history_api` | 67 | `services/history/query.py` |
| L5602 | `delete_history` | 61 | `services/history/delete.py` |
| L5725 | `purge_orphan_records` | 77 | `services/assets/local.py` |
| L5805 | `scan_new_images` | 233 | `services/assets/local.py` |
| L6409 | `translate_with_ai` | 55 | `services/translate/ai.py` |
| L6584 | `poll_angle_cloud` | 71 | `services/generation/angle.py` |
| L6657 | `generate_angle_cloud` | 95 | `services/generation/angle.py` |
| L6756 | `generate_cloud` | 93 | `services/generation/cloud.py` |
| L6853 | `ms_generate` | 105 | `services/generation/cloud.py` |
| L6962 | `generate` | 252 | `services/generation/base.py`（拆 4 步） |
| L7375 | `test_provider_connection` | 69 | `services/providers/test.py` |
| L7446 | `probe_async_endpoint` | 56 | `services/providers/probe.py` |
| L7503 | `fetch_models_from_upstream` | 67 | `services/providers/models.py` |
| L7919 | `scan_lora_folder` | 72 | `services/lora.py` |
| L8229 | `proxy_comfyui_view` | 72 | `services/comfyui/client.py` |
| L8382 | `save_comfyui_to_output` | 78 | `services/comfyui/client.py` |
| L8699 | `run_workflow` | 62 | `services/generation/workflow.py` |
| L8908 | `convert_to_podcast` | 87 | `services/tts/podcast.py` |
| L9039 | `import_tts_voices` | 80 | `services/tts/voice_lib.py` |
| L9249 | `tts_asr` | 61 | `services/tts/asr.py` |
| L9380 | `_tts_generate_inner` | 214 | `services/tts/engine.py` |
| L9628 | `import_local_assets_from_urls` | 66 | `services/assets/local.py` |
| L9927 | `download_canvas_assets` | 55 | `services/canvas/io.py` |
| L11195 | `import_canvas_workflow` | 64 | `services/canvas/io.py` |

> **`generate` (252 行) 拆分方案**：
> - 提取参数归一化 → `services/generation/base.py::normalize_params`
> - 提取限流 / 重试 → `services/generation/base.py::run_with_retry`
> - 提取主分发逻辑（按 model 分流）→ `services/generation/base.py::dispatch`
> - 路由层只调用 `dispatch(req) -> Response`

---

## 4. 实施计划（How — 分阶段执行）

### 4.1 总览：6 个阶段

| 阶段 | 主题 | main.py 目标 | 风险 | 工期 |
|------|------|--------------|------|------|
| P0 | 准备：建骨架 | 12,344 | 无 | 0.5d |
| P1 | 拆分 Pydantic | 11,500 | 低 | 0.5d |
| P2 | 拆分 `core/` 通用工具 | 10,500 | 低 | 1d |
| P3 | 拆分 1 个最小路由（auth） | 10,000 | 中 | 1d |
| P4 | 批量迁移其他 21 个路由 | 3,000 | 中 | 4d |
| P5 | 拆分 `services/` 业务层 | 1,500 | 中 | 3d |
| P6 | 拆分 `generate` 等巨型函数 | < 500 | 高 | 2d |

**总工期**：约 12 个工作日（按每天 4 小时有效改动时间）。

### 4.2 P0 — 建骨架（0.5d）

**目标**：建空目录 + `__init__.py`，不删一行 `main.py` 代码。

**步骤**：
1. 创建 `core/`, `schemas/`, `api/`, `services/` 及子目录。
2. 每个目录放空 `__init__.py`。
3. `main.py` 顶部加注释：
   ```python
   # ============================================================
   # 重构中：业务代码正在迁移至 core/ schemas/ services/ api/
   # 当前文件仅保留装配与未迁移部分，预计 12 个工作日完成
   # 进度看板见 docs/REFACTOR_BLUEPRINT.md
   # ============================================================
   ```
4. 跑 `python -c "import main"` 确认无破坏。

**验证**：`GetDiagnostics` 无新增 + 启动成功 + 6 核心流程通过。

### 4.3 P1 — 拆分 Pydantic 模型（0.5d）

**规则**：纯文本搬运，不改任何类名 / 字段 / 校验。

**步骤**：
1. 按 3.1 表格，70 个类复制到对应 `schemas/*.py`。
2. 复杂依赖（嵌套类型）从同文件就近复制 `from typing import ...`。
3. `main.py` 改为 `from schemas.generation import GenerateRequest, ...`。
4. 每次改 1 个文件（10 个类一批），跑 `python -c "import main"`。

**验证**：API 启动 + 任一端点 swagger 正常显示 Request 模型。

### 4.4 P2 — 拆分 `core/`（1d）

**搬运清单**：
- `ConnectionManager` (L38-95) → `core/ws.py`
- `QuietAccessLogFilter`（如有）→ `core/logging_setup.py`
- `safe_user_id`, `sanitize_folder_name`, `save_to_history`, `get_user_input_dir` 等工具函数 → `core/files.py` / `core/history.py`
- 全局路径常量 → `core/config.py`
- 共享 `httpx.AsyncClient`（如有）→ `core/http_client.py`

**步骤**：
1. 用 `git grep -n "def safe_user_id"` 找所有相关函数。
2. 复制到 `core/`，加中文 docstring 说明参数 / 返回。
3. `main.py` 改 import。
4. 跑 `python -c "import main"`。

**验证**：6 核心流程 + 文件路径 / 历史记录功能正常。

### 4.5 P3 — 拆分第一个路由（auth，1d）

> 这是**最关键的样板**。先做完 1 个，确立模式后批量复制。

**目标**：把 `auth` 相关 7 个路由 + 工具函数搬到 `api/auth.py` + `core/auth.py`。

**步骤**：
1. **看样板**：`static/setting/main-1.py`（参考实现）的 `auth` 部分。
2. **建立模板**：
   ```python
   # api/auth.py
   from fastapi import APIRouter, Depends, HTTPException
   from schemas.auth import AuthRegisterRequest, AuthLoginRequest
   from core.auth import get_current_user, require_admin

   router = APIRouter(prefix="/api/auth", tags=["auth"])

   @router.post("/register")
   async def register(req: AuthRegisterRequest):
       # 业务实现（从 main.py 搬）
       ...
       return {"ok": True}

   @router.post("/login")
   async def login(req: AuthLoginRequest):
       ...

   # ... 其余 5 个路由
   ```
3. **在 `main.py` 接入**：
   ```python
   from api.auth import router as auth_router
   app.include_router(auth_router)
   ```
4. **删除** `main.py` 中已迁移的路由装饰器和函数体。
5. **测试**：注册 → 登录 → 拿 token → 调 `/api/auth/me`。

**风险点**：
- 全局变量（如 `tokens` 字典、`users.json` 路径）→ 改用 `core/auth.py` 模块级单例。
- 装饰器顺序（如 `@router.post` + 鉴权）→ 用 FastAPI `Depends()`。

### 4.6 P4 — 批量迁移其他 21 个路由（4d）

**每日目标**：5-6 个路由文件，每天完成一类业务。

**执行节奏**（按依赖关系排序）：

| Day | 模块 | 路由数 | 备注 |
|-----|------|--------|------|
| 1 | `chat` + `history` | 6+4 | 复用 `core/auth` 鉴权 |
| 1 | `config` | 3 | 单文件易处理 |
| 2 | `providers` | 6 | 业务重，先用 router 壳，业务暂留 main |
| 2 | `workflows` | 6 | 同上 |
| 3 | `comfyui` | 14 | 拆 2 文件：routes + instances |
| 3 | `lora` | 9 | |
| 4 | `canvas` + `canvas_assets` + `canvas_workflows` + `canvas_image_tasks` + `canvas_llm` | 14+3+3+2+1 | 最大一块 |
| 4 | `jimeng` + `runninghub` | 7+11 | |
| 4 | `tts` + `smart_tts` | 12 | |
| 4 | `asset_library` + `local_assets` + `shared_folders` | 15+11+6 | |
| 4 | `prompt` + `smart_prompt` + `translate` | 15+9+4 | |
| 4 | `user` + `gallery` + `angle` + `misc` | 2+2+2+12 | 收尾 |

**每文件 SOP**：
1. 复制路由 + 函数到 `api/<name>.py`。
2. 函数体里用到的 `main.py` 全局变量 → 改 `from core.xxx import yyy`。
3. `main.py` 改为 `from api.<name> import router as <name>_router; app.include_router(<name>_router)`。
4. 删除 `main.py` 中已迁移部分。
5. 跑 `python -c "import main"`，启动服务，跑相关端点。

### 4.7 P5 — 拆分 `services/` 业务层（3d）

**原则**：业务函数与 FastAPI 解耦，可独立 `import` 和单测。

**步骤**（以 `generate` 为例）：
1. 创建 `services/generation/base.py`。
2. 把 `generate` 函数（252 行）从 `main.py` 剪切到 `base.py`。
3. 移除所有 `@app.post("/generate")` 装饰器，函数签名改为接收 `req: GenerateRequest`，返回 dict / Response 对象。
4. `api/generation.py`（新建）：
   ```python
   from fastapi import APIRouter
   from services.generation.base import generate as _generate
   from schemas.generation import GenerateRequest

   router = APIRouter()

   @router.post("/generate")
   async def generate_endpoint(req: GenerateRequest):
       return await _generate(req)
   ```

**优先级**（先拆小后拆大）：
1. Day 1：`chat` / `history` / `translate`（小、依赖少）
2. Day 2：`providers` / `workflows` / `lora`（中）
3. Day 3：`comfyui` / `tts` / `assets`（大）
4. Day 3 末尾：`canvas` / `jimeng` / `runninghub`（最重）

### 4.8 P6 — 拆分 `generate` 巨型函数（2d）

**问题**：`generate` (L6962-7214, 252 行) 包含：参数归一化、限流、3 种模式分发、错误处理、响应拼装。

**拆分方案**：
```python
# services/generation/base.py

async def normalize_params(req: GenerateRequest) -> dict:
    """参数归一化（约 50 行）"""
    ...

async def dispatch(req: GenerateRequest) -> dict:
    """按 model 类型分发到具体 provider（约 80 行）"""
    if req.mode == "jimeng":
        return await generate_jimeng(req)
    elif req.mode == "ms":
        return await ms_generate(req)
    # ...

async def run_with_retry(fn, max_retries=3):
    """通用重试装饰（约 20 行）"""
    ...

async def generate(req: GenerateRequest) -> dict:
    """主入口：编排（约 30 行）"""
    params = await normalize_params(req)
    result = await run_with_retry(lambda: dispatch(params))
    return result
```

**步骤**：
1. 先写 `normalize_params` 的单测，验证输入输出。
2. 抽出 `dispatch` 表格化（用 dict 映射），不引入 if-else 链。
3. 抽出 `run_with_retry`。
4. `generate` 缩短到 < 50 行。

---

## 5. 编码规范（Standards）

### 5.1 文件级

| 规则 | 阈值 |
|------|------|
| 单文件行数 | < 800 |
| 单文件函数数 | < 20 |
| 单文件类数 | < 12 |
| 单文件路由数 | < 30 |

超出即触发再拆分。

### 5.2 函数级

| 规则 | 阈值 |
|------|------|
| 函数行数 | < 80 |
| 圈复杂度（if/for/while 数） | < 10 |
| 参数数量 | < 7 |
| 嵌套层级 | < 4 |

### 5.3 命名

| 类型 | 风格 | 示例 |
|------|------|------|
| 文件名 | snake_case | `asset_library.py` |
| 类名 | PascalCase | `AssetLibraryRequest` |
| 函数名 | snake_case | `scan_new_images` |
| 常量 | UPPER_SNAKE | `MAX_RETRY_COUNT` |
| 私有函数 | `_` 前缀 | `_normalize_params` |

### 5.4 导入顺序（强制）

```python
# 1. 标准库
import json
import os
from pathlib import Path

# 2. 第三方
from fastapi import APIRouter, Depends
from pydantic import BaseModel

# 3. 项目内（按层）
from core.config import DATA_DIR
from core.auth import get_current_user
from schemas.canvas import CanvasCreateRequest
from services.canvas.crud import create_canvas
```

### 5.5 docstring（强制中文）

```python
async def scan_new_images(folder: str, user: str) -> list[dict]:
    """
    扫描指定文件夹的新图片。

    Args:
        folder: 画布资产文件夹绝对路径。
        user: 当前用户名（用于 user 隔离）。

    Returns:
        新增图片的元数据列表，每个元素包含 path / mtime / size。

    Raises:
        PermissionError: 文件夹无读取权限。
    """
```

### 5.6 错误处理

- 路由层用 `HTTPException(status_code=..., detail=...)`。
- 业务层用自定义异常（如 `JimengPendingError`）。
- 不在业务层捕获后又抛出原始 `Exception`（掩盖错误）。

### 5.7 注释规则（CLAUDE.md 第 3 节"手术式改变"）

- 不改"未触碰"代码的注释 / 格式。
- 改 A 时若连带需要改 B（删除未用 import），才动 B。
- 不主动清理无关代码（提一句即可，不动）。

---

## 6. 测试与验证（Verify）

### 6.1 自动化（项目当前无测试，要补最小集）

**最小单测模板**（`tests/test_smoke.py`）：
```python
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    r = client.get("/")
    assert r.status_code == 200

def test_auth_register_login_flow():
    # 注册
    r = client.post("/api/auth/register", json={
        "username": "test_user_xxx",
        "password": "Test123!@#"
    })
    assert r.status_code in (200, 400)  # 已存在也 OK
    # 登录
    r = client.post("/api/auth/login", json={
        "username": "test_user_xxx",
        "password": "Test123!@#"
    })
    assert r.status_code == 200
    assert "token" in r.json()

# ... 6 核心流程各 1 个
```

**目标**：≥ 10 个 smoke test，覆盖 6 核心流程。

### 6.2 手动验证脚本（每个阶段必跑）

```bash
# 启动
cd H:\AI-Tools\art-canvas
python main.py
# 或 uvicorn main:app --reload

# 健康检查
curl http://localhost:8000/
curl http://localhost:8000/api/auth/me  # 预期 401

# 6 核心流程（详见 1.2）
```

### 6.3 性能基线

| 指标 | 当前 | 拆分后 | 允许变化 |
|------|------|--------|----------|
| 启动时间 | 3.0s | 3.3s | < 10% |
| 内存占用 | X MB | X+5% MB | < 5% |
| 首次请求延迟 | Y ms | Y+50ms | < 20% |

（首次跑基线，后续每次 PR 比对）

---

## 7. 风险与回退（Risks & Rollback）

### 7.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 循环 import | 中 | 高 | P3 用 auth 验证模式；P4 强制 `python -c "import main"` |
| 行为回归 | 中 | 高 | 6 流程 smoke test + 手动验证清单 |
| 全局变量耦合 | 高 | 中 | P2 抽到 `core/` 模块级单例 |
| 启动时间增长 | 低 | 低 | lazy import 大型 SDK（torch / diffusers） |
| 团队协作冲突 | 低 | 中 | 每个 PR 只动一个 `api/` 文件 |
| AI 上下文超限 | 中 | 低 | 单文件 < 800 行后 AI 处理更准 |

### 7.2 回退方案

每阶段 PR 独立可回退：
- 拆分前：先 `git commit "before Px refactor"`，保证有锚点。
- 拆分中：每完成 1 个 `api/` 文件 = 1 个 PR。
- 拆分后：旧 `main.py` 通过 `git log` 一键回退。

### 7.3 不要做的事

- ❌ 不要在拆分过程中"顺手"修 bug（开新 issue）。
- ❌ 不要重命名变量 / 函数（保持与前端 URL 一致性）。
- ❌ 不要替换底层库（Pydantic v1 → v2 等）。
- ❌ 不要为了"完美"重写业务逻辑。

---

## 8. 协作约定（Workflow）

### 8.1 PR 模板

```markdown
## 重构阶段
- [ ] P0 骨架
- [ ] P1 Schemas
- [ ] P2 Core
- [ ] P3 Auth (样板)
- [ ] P4 路由批量
- [ ] P5 Services
- [ ] P6 巨型函数

## 改动范围
- 新增：core/, schemas/, api/, services/
- 修改：main.py（删除 -XXX 行 / 新增 +XX 行）
- 不修改：业务逻辑、路由路径、响应格式

## 验证
- [ ] `python -c "import main"` 0 退出
- [ ] uvicorn 启动成功
- [ ] 6 核心流程通过
- [ ] GetDiagnostics 无新增 warning
- [ ] smoke test 全绿

## 回退
- 单 PR 可通过 `git revert` 回退
```

### 8.2 命名约定（commit）

```
refactor(P0): 建 core/ schemas/ api/ services/ 骨架
refactor(P1): 拆分 70 个 Pydantic 模型到 schemas/
refactor(P2): 抽 ConnectionManager + 路径工具到 core/
refactor(P3): 迁移 auth 路由到 api/auth.py (样板)
refactor(P4): 迁移 chat + history 路由
...
```

### 8.3 与 AI 协作（CLAUDE.md 补充）

- 每次只让 AI 处理**一个 `api/` 文件**（上下文可控）。
- 给出本文件 + 该文件用到的 schema / service 路径。
- 明确指令："只搬路由和函数体，不改任何业务逻辑，不改函数签名，不改注释"。

---

## 9. 进度看板（Progress）

> 边做边更新。每个阶段完成后勾选并记录 main.py 实际行数。

| 阶段 | 状态 | main.py 行数 | 验证 | 备注 |
|------|------|--------------|------|------|
| P0 | ⬜ | 12,344 |  | 建骨架 |
| P1 | ⬜ | ~11,500 |  | 70 个 schema |
| P2 | ⬜ | ~10,500 |  | core 工具 |
| P3 | ⬜ | ~10,000 |  | auth 样板 |
| P4 | ⬜ | ~3,000 |  | 21 个路由 |
| P5 | ⬜ | ~1,500 |  | 业务层 |
| P6 | ⬜ | < 500 |  | 巨型函数 |

---

## 10. 附录

### 10.1 拆分前后对比

**Before**：
```
main.py (12,344 行)
├── imports (100 行)
├── 70 个 Pydantic 类
├── 484 个函数
├── 212 个路由
└── if __name__ == "__main__": ...
```

**After**：
```
main.py (480 行) — 仅装配
├── imports
├── app = FastAPI(...)
├── middleware
├── include_router(...)  × 22
└── if __name__ == "__main__": uvicorn.run(...)

core/        (10 文件,  ~1,200 行) — 通用工具
schemas/     (15 文件,  ~1,000 行) — 数据模型
services/    (12 文件,  ~5,000 行) — 业务逻辑
api/         (22 文件,  ~4,000 行) — 路由壳
```

### 10.2 关键文件路径速查

| 文件 | 路径 |
|------|------|
| 当前主入口 | `H:\AI-Tools\art-canvas\main.py` |
| 参考实现 | `H:\AI-Tools\art-canvas\static\setting\main-1.py` |
| 项目规范 | `H:\AI-Tools\art-canvas\CLAUDE.md` |
| 领域术语 | `H:\AI-Tools\art-canvas\CONTEXT.md` |
| 本文档 | `H:\AI-Tools\art-canvas\docs\REFACTOR_BLUEPRINT.md` |

### 10.3 引用

- FastAPI Router 最佳实践：https://fastapi.tiangolo.com/tutorial/bigger-applications/
- 项目编码原则：`CLAUDE.md` 第 1-4 节
- 项目术语表：`CONTEXT.md`

---

**维护说明**：每完成一个阶段，请更新第 9 节看板。所有"未在本表中的修改"应单独提 PR，不混入重构 PR。
