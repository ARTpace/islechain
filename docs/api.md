# Art Canvas API 静态索引草稿

> **2026-10-22 更正**：本清单由早期 grep 结果整理，不是完整自动生成接口合同；可能遗漏路由、重复注册项、路径转换器及参数/返回模型，旧行号已随迁移失效。请勿按猜测补全参数或视此为 OpenAPI。迁移验收以 Git 基线路由 AST 清单与当前 main.py、routers/ 实际注册结果对比为准；应用可安全导入后再导出 OpenAPI 核验。

> 自动生成 | 2026-10-21
> 来源：main.py 所有 @app.* 装饰器

---

## 目录

- [认证](#认证)
- [画布管理](#画布管理)
- [ComfyUI 代理](#comfyui-代理)
- [图像生成](#图像生成)
- [视频生成](#视频生成)
- [TTS 语音](#tts-语音)
- [工作流](#工作流)
- [资产管理](#资产管理)
- [系统配置](#系统配置)

---

## 认证

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/auth/register` | 用户注册 | L5287 |
| POST | `/api/auth/login` | 用户登录 | L5306 |
| GET | `/api/auth/me` | 获取当前用户 | L5322 |
| POST | `/api/auth/logout` | 登出 | L5331 |
| GET | `/api/auth/admin/users` | 管理员：用户列表 | L5346 |
| POST | `/api/auth/admin/reset-password` | 重置密码 | L5359 |
| POST | `/api/auth/admin/delete-user` | 删除用户 | L5375 |

---

## 画布管理

### 基础 CRUD

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/canvases` | 画布列表 | L6069 |
| POST | `/api/canvases` | 创建画布 | L6088 |
| GET | `/api/canvases/{canvas_id}` | 画布详情 | L6096 |
| PUT | `/api/canvases/{canvas_id}` | 更新画布 | L6102 |
| DELETE | `/api/canvases/{canvas_id}` | 删除画布 | L6116 |
| GET | `/api/canvases/trash` | 回收站列表 | L6079 |
| POST | `/api/canvases/{canvas_id}/restore` | 恢复画布 | L6462 |
| DELETE | `/api/canvases/{canvas_id}/purge` | 彻底删除 | L6471 |

### 画布元数据

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/canvases/{canvas_id}/meta` | 获取元数据 | L6619 |
| POST | `/api/canvases/{canvas_id}/meta` | 更新元数据 | L6624 |
| POST | `/api/canvases/{canvas_id}/touch` | 更新时间戳 | L6641 |
| GET | `/api/canvases/{canvas_id}/files` | 文件列表 | L6480 |
| POST | `/api/canvases/{canvas_id}/asset-folder` | 创建资产文件夹 | L6506 |
| GET | `/api/canvases/{canvas_id}/assets` | 资产列表 | L6517 |
| POST | `/api/canvases/{canvas_id}/assets/upload` | 上传资产 | L6561 |
| POST | `/api/canvases/{canvas_id}/assets/copy-from-canvas` | 跨画布复制资产 | L6585 |
| POST | `/api/canvases/{canvas_id}/logs/delete` | 删除日志 | L6374 |
| POST | `/api/canvases/{canvas_id}/assets/delete` | 删除资产 | L6677 |

### 智能画布

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/smart-canvas/minimax-export` | MiniMax 导出 | L3648 |
| GET | `/api/smart-canvas/prompt-templates` | 提示词模板 | L14690 |
| POST | `/api/smart-canvas/group-export` | 分组导出 | L14700 |
| POST | `/api/canvas-workflows/export` | 导出工作流 | L15252 |
| POST | `/api/canvas-workflows/export-to-library` | 导出到资产库 | L15262 |
| POST | `/api/canvas-workflows/import` | 导入工作流 | L15278 |

---

## ComfyUI 代理

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/comfyui/instances` | 实例列表 | L10603 |
| PUT | `/api/comfyui/base-path` | 设置基础路径 | L10608 |
| PUT | `/api/comfyui/instances` | 更新实例 | L10622 |
| POST | `/api/comfyui/start` | 启动 ComfyUI | L10672 |
| POST | `/api/comfyui/stop` | 停止 ComfyUI | L10773 |
| GET | `/api/comfyui/process-status` | 进程状态 | L10829 |
| GET | `/api/comfyui/log-tail` | 日志 tail | L10851 |
| POST | `/api/comfyui/log-clear` | 清空日志 | L10884 |
| GET | `/api/comfyui/object_info` | 节点信息 | L10904 |
| GET | `/api/comfyui/object_info/{node_type}` | 特定节点信息 | L10905 |
| GET | `/api/comfyui/loras` | LoRA 列表 | L10928 |
| GET | `/api/comfyui/history/{prompt_id}` | 生成历史 | L11328 |
| GET | `/api/comfyui/queue` | 队列状态 | L11342 |
| POST | `/api/comfyui/prompt` | 提交 prompt | L11356 |
| GET | `/api/comfyui/view` | 查看图片 | L11373 |
| GET | `/api/comfyui/open-folder` | 打开文件夹 | L11454 |
| POST | `/api/comfyui/upload/image` | 上传图片 | L11607 |
| WebSocket | `/api/comfyui/ws` | WebSocket 连接 | L11629 |
| GET | `/api/comfyui/system_stats` | 系统统计 | L11593 |

---

## 图像生成

### 即梦 (Jimeng)

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/jimeng/status` | 登录状态 | L10317 |
| GET | `/api/jimeng/credit` | 余额查询 | L10346 |
| POST | `/api/jimeng/logout` | 登出 | L10351 |
| POST | `/api/jimeng/login/start` | 开始登录 | L10356 |
| GET | `/api/jimeng/login/status` | 登录状态轮询 | L10403 |
| POST | `/api/jimeng/help` | 帮助 | L10425 |
| POST | `/api/jimeng/query-media` | 查询媒体 | L10516 |

### RunningHub

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/runninghub/app-info` | 应用信息 | L14935 |
| POST | `/api/runninghub/submit` | 提交任务 | L14958 |
| POST | `/api/runninghub/workflow-submit` | 工作流提交 | L14989 |
| GET | `/api/runninghub/workflow-info` | 工作流信息 | L15025 |
| GET | `/api/runninghub/workflows` | 工作流列表 | L15057 |
| GET | `/api/runninghub/workflows/{workflow_id}` | 工作流详情 | L15086 |
| POST | `/api/runninghub/workflows/fetch` | 获取工作流 | L15100 |
| PUT | `/api/runninghub/workflows/{workflow_id}` | 更新工作流 | L15132 |
| DELETE | `/api/runninghub/workflows/{workflow_id}` | 删除工作流 | L15158 |
| GET | `/api/runninghub/query` | 任务查询 | L15173 |
| POST | `/api/runninghub/upload-asset` | 上传资产 | L15209 |

### ModelScope

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/ms/generate` | 模型生成 | L9222 |

### 通用图像生成

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/generate` | 旧版生成接口 | L9125 |
| POST | `/api/generate` | 生成接口 | L9896 |
| POST | `/api/generate/cancel` | 取消生成 | L9901 |
| POST | `/api/online-image` | 在线图片生成 | L5717 |
| POST | `/api/canvas-video` | 画布视频生成 | L5924 |
| POST | `/api/image-task-query` | 图片任务查询 | L5935 |
| POST | `/api/canvas-image-tasks` | 画布图片任务 | L5986 |
| GET | `/api/canvas-image-tasks/{task_id}` | 任务详情 | L6004 |
| POST | `/api/ai/import-local-image` | 导入本地图片 | L14923 |
| POST | `/api/ideogram4/generate-json` | Ideogram 生成 | L15384 |

---

## 视频生成

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/online-video` | 在线视频生成 | L5772 |
| POST | `/api/cloud-video/upload` | 云视频上传 | L14916 |

---

## TTS 语音

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/tts/voices` | 语音列表 | L12308 |
| GET | `/api/animadex/characters` | 角色列表 | L12319 |
| POST | `/api/tts/to-podcast` | 生成播客 | L12528 |
| POST | `/api/tts/fetch-url` | 获取音频 URL | L12675 |
| POST | `/api/tts/to-solo-podcast` | 单人播客 | L12790 |
| GET | `/api/tts/genres` | 风格列表 | L12881 |
| POST | `/api/tts/to-genre` | 风格生成 | L12888 |
| POST | `/api/tts/voices` | 创建语音 | L12994 |
| POST | `/api/tts/voices/import` | 批量导入 | L13035 |
| POST | `/api/tts/voices/import-single` | 单条导入 | L13118 |
| GET | `/api/tts/voices/file/{filename}` | 语音文件 | L13166 |
| DELETE | `/api/tts/voices/{voice_name}` | 删除语音 | L13193 |
| PUT | `/api/tts/voices/{voice_name}/meta` | 更新元数据 | L13211 |
| POST | `/api/tts/asr` | 语音识别 | L13293 |
| GET | `/api/tts/presets` | 预设列表 | L13357 |
| GET | `/api/tts/modes` | 模式列表 | L13378 |
| POST | `/api/tts/generate` | 语音生成 | L13412 |
| POST | `/api/smart-tts` | 智能 TTS | L8657 |

---

## 工作流

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/workflows/builtin` | 内置工作流 | L11733 |
| GET | `/api/workflows` | 工作流列表 | L11773 |
| GET | `/api/workflows/{name}` | 工作流详情 | L11816 |
| POST | `/api/workflows` | 创建工作流 | L11847 |
| PUT | `/api/workflows/{name}/config` | 更新配置 | L11884 |
| DELETE | `/api/workflows/{name}` | 删除工作流 | L11907 |
| POST | `/api/workflows/{name}/run` | 运行工作流 | L11931 |
| GET | `/api/comfyui/llama-models` | LLM 模型列表 | L7977 |
| POST | `/api/smart-prompt` | 智能提示词 | L8170 |
| GET | `/api/smart-prompt/presets` | 预设列表 | L8096 |
| POST | `/api/smart-prompt/presets` | 创建预设 | L8100 |
| PUT | `/api/smart-prompt/presets/{preset_id}` | 更新预设 | L8119 |
| DELETE | `/api/smart-prompt/presets/{preset_id}` | 删除预设 | L8125 |
| GET | `/api/smart-prompt/selected-preset` | 选中预设 | L8135 |
| POST | `/api/smart-prompt/selected-preset` | 设置选中预设 | L8146 |
| GET | `/api/smart-prompt/config` | 配置 | L7934 |
| POST | `/api/smart-prompt/config` | 更新配置 | L7953 |
| POST | `/api/smart-prompt/test` | 测试 | L7997 |
| POST | `/api/random-plan/ai-generate` | AI 生成方案 | L8592 |

---

## 资产管理

### 本地资产

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/local-assets/upload` | 上传 | L13684 |
| POST | `/api/local-assets/import-urls` | URL 导入 | L13711 |
| GET | `/api/local-assets` | 列表 | L13779 |
| POST | `/api/local-assets/folders` | 创建文件夹 | L13784 |
| POST | `/api/local-assets/delete` | 删除 | L13848 |
| POST | `/api/local-assets/move` | 移动 | L13874 |
| POST | `/api/local-assets/caption` | 添加标签 | L13917 |
| POST | `/api/local-assets/classify` | 分类 | L13949 |

### 资产库

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/asset-library` | 库列表 | L14069 |
| POST | `/api/asset-library/libraries` | 创建库 | L14073 |
| DELETE | `/api/asset-library/libraries/{library_id}` | 删除库 | L14094 |
| POST | `/api/asset-library/categories` | 创建分类 | L14108 |
| DELETE | `/api/asset-library/categories/{category_id}` | 删除分类 | L14137 |
| POST | `/api/asset-library/items` | 创建项目 | L14157 |
| POST | `/api/asset-library/items/batch` | 批量创建 | L14178 |
| POST | `/api/asset-library/items/classify` | 分类项目 | L14213 |
| DELETE | `/api/asset-library/items/{item_id}` | 删除项目 | L14246 |
| POST | `/api/asset-library/items/delete` | 批量删除 | L14265 |
| POST | `/api/asset-library/items/move` | 移动项目 | L14290 |
| POST | `/api/asset-library/items/crop` | 裁剪项目 | L14322 |

### 画布资产

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/canvas-assets` | 画布资产列表 | L13993 |
| POST | `/api/canvas-assets/check` | 检查资产 | L13997 |
| POST | `/api/canvas-assets/download` | 下载资产 | L14010 |

### 用户资产

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/user/assets/save-from-url` | 从 URL 保存 | L6699 |
| POST | `/api/user/assets/delete` | 删除资产 | L6774 |
| GET | `/api/user/assets` | 资产列表 | L6813 |
| POST | `/api/user/assets/dedup` | 去重 | L6927 |

---

## 提示词与预设

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/prompt-libraries` | 提示词库列表 | L14363 |
| POST | `/api/prompt-libraries` | 创建提示词库 | L14367 |
| DELETE | `/api/prompt-libraries/{library_id}` | 删除提示词库 | L14393 |
| POST | `/api/prompt-libraries/items` | 创建条目 | L14408 |
| DELETE | `/api/prompt-libraries/items/{item_id}` | 删除条目 | L14453 |
| POST | `/api/prompt-libraries/items/delete` | 批量删除 | L14470 |
| POST | `/api/prompt-libraries/categories` | 创建分类 | L14490 |
| DELETE | `/api/prompt-libraries/categories/{category_id}` | 删除分类 | L14523 |
| GET | `/api/prompt-presets` | 预设列表 | L7824 |
| POST | `/api/prompt-presets` | 创建预设 | L7829 |
| GET | `/api/style-presets` | 风格预设 | L7835 |
| POST | `/api/style-presets` | 创建风格预设 | L7840 |
| POST | `/api/import/fooocus-styles` | 导入 Fooocus 风格 | L7847 |
| GET | `/api/all-presets` | 全部预设 | L7879 |
| GET | `/api/preset-i18n` | 预设 i18n | L7794 |
| GET | `/api/style-i18n` | 风格 i18n | L7801 |
| GET | `/api/preset-bidir` | 双向预设 | L7812 |
| GET | `/api/reload-presets` | 重载预设 | L7818 |

---

## 随机源

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/random/sources` | 源列表 | L15456 |
| GET | `/api/random/categories/{source_id}` | 分类列表 | L15464 |
| GET | `/api/random/{source_id}` | 随机结果 | L15473 |
| POST | `/api/random/all` | 全量随机 | L15495 |
| POST | `/api/random/apply-plan` | 应用方案 | L15503 |

---

## 系统配置

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/config` | 配置 | L5564 |
| GET | `/api/config/token` | Token 配置 | L5676 |
| POST | `/api/config/update` | 更新配置 | L5690 |
| GET | `/api/providers` | 提供商列表 | L10037 |
| PUT | `/api/providers` | 更新提供商 | L10042 |
| POST | `/api/providers/test-connection` | 测试连接 | L10092 |
| POST | `/api/providers/probe-async` | 异步探测 | L10166 |
| POST | `/api/providers/fetch-models` | 获取模型 | L10295 |
| GET | `/api/providers/{provider_id}/fetch-models` | 获取特定提供商模型 | L10306 |
| GET | `/api/models` | 模型列表 | L5593 |
| GET | `/api/providers/models` | 提供商模型 | L5630 |
| GET | `/api/cache/info` | 缓存信息 | L14884 |
| POST | `/api/cache/clear` | 清空缓存 | L14898 |

---

## 历史记录

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/history/save` | 保存历史 | L7159 |
| GET | `/api/history` | 历史列表 | L7238 |
| POST | `/api/history/delete` | 删除历史 | L7315 |
| POST | `/api/history/delete-image` | 删除图片历史 | L7410 |
| GET | `/api/queue_status` | 队列状态 | L7307 |
| POST | `/api/gallery/purge-orphans` | 清理孤儿 | L7467 |
| GET | `/api/gallery/scan-new` | 扫描新图 | L7547 |

---

## 对话与 LLM

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| POST | `/api/chat` | 聊天 | L6976 |
| POST | `/api/chat/stream` | 流式聊天 | L7055 |
| GET | `/api/conversations` | 对话列表 | L6044 |
| POST | `/api/conversations` | 创建对话 | L6049 |
| GET | `/api/conversations/{conversation_id}` | 对话详情 | L6054 |
| DELETE | `/api/conversations/{conversation_id}` | 删除对话 | L6059 |
| POST | `/api/canvas-llm` | 画布 LLM | L6014 |

---

## 其他

| 方法 | 路径 | 说明 | 行号 |
|---|---|---|---|
| GET | `/api/_dbug` | 调试端点 | L10960 |
| GET | `/api/thumbnails/{filename}` | 缩略图 | L7884 |
| GET | `/api/loras/scan` | LoRA 扫描 | L10988 |
| GET | `/api/loras/preview` | LoRA 预览 | L11068 |
| GET | `/api/lora-manager/loras` | LoRA 管理列表 | L11114 |
| POST | `/api/lora-manager/fetch-all-civitai` | 获取 CivitAI LoRA | L11195 |
| GET | `/api/lora-manager/tags-stats` | 标签统计 | L11210 |
| GET | `/api/lora-manager/preview` | 预览 | L11245 |
| GET | `/api/lora-manager/proxy-preview` | 代理预览 | L11267 |
| GET | `/api/lora-manager/metadata` | 元数据 | L11296 |
| GET | `/api/lora-manager/trigger-words` | Trigger Words | L11312 |
| GET | `/output/{path}` | 输出文件 | L1604 |
| GET | `/assets/{path}` | 资产文件 | L1658 |
| GET | `/api/download-output` | 下载输出 | L5411 |
| GET | `/api/open-output-folder` | 打开文件夹 | L5434 |
| GET | `/api/delete-output-file` | 删除文件 | L5452 |
| GET | `/api/scan-output` | 扫描输出 | L5469 |
| POST | `/api/upload` | 上传 | L5493 |
| POST | `/api/ai/upload` | AI 上传 | L5521 |
| GET | `/api/view` | 查看图片 | L5397 |
| GET | `/api/proxy-download-to-output` | 代理下载 | L11475 |
| GET | `/api/comfyui/save-to-output` | 保存到输出 | L11532 |
| POST | `/api/poster/generate` | 海报生成 | L12109 |
| GET | `/api/poster/layouts` | 布局列表 | L12099 |
| GET | `/api/poster/styles` | 风格列表 | L12104 |
| GET | `/api/media-preview` | 媒体预览 | L14828 |
| GET | `/assets/uploads/{path}` | 上传文件 | L14649 |
| GET | `/assets/library/{path}` | 库文件 | L14668 |
| POST | `/api/angle/poll_status` | 角度轮询 | L8952 |
| POST | `/api/angle/generate` | 角度生成 | L9025 |
| GET | `/api/shared-folders` | 共享文件夹 | L14544 |
| POST | `/api/shared-folders` | 创建共享文件夹 | L14560 |
| DELETE | `/api/shared-folders/{folder_id}` | 删除共享文件夹 | L14581 |
| GET | `/api/shared-folders/{folder_id}/tree` | 树结构 | L14592 |
| GET | `/api/shared-folders/{folder_id}/file` | 文件 | L14603 |
| POST | `/api/shared-folders/import` | 导入共享 | L14617 |
| WebSocket | `/ws/stats` | 统计 WebSocket | L176 |

---

## 统计

- **总路由数**：250+
- **GET**：~100
- **POST**：~140
- **PUT**：~5
- **DELETE**：~10
- **WebSocket**：2

---

*文档由 Agnes AI Agent Team 自动生成 | 基于 main.py grep 结果整理*