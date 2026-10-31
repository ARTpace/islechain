# CODEMAP — 功能到文件的索引

> 改代码前先在这里定位，不要全仓 grep。新增或移动文件时**必须同步更新本文件**。

## 依赖方向（只允许向下）

```
main.py / routers/                                    API 层
        ↓
style_packs / character_packs / artist_packs / content_packs    业务包
        ↓
core/                                                 公共底座
        ↓
标准库 / 第三方库
```

`core/` 只放「被两层以上引用、且不含业务概念」的模块，绝不反向 import 业务包。
判断新模块该放哪：只在单个业务里用 → 放该业务包；被多处共用且通用 → 放 `core/`。

## 根目录文件

| 文件 | 职责 |
|---|---|
| `main.py` | FastAPI 主入口：应用装配、认证中间件、生成/对话/画布/资产等核心路由（近万行，拆分中） |
| `CODEMAP.md` | 本文件，功能索引 |
| `CONTEXT.md` | 领域术语与文件存储约定 |
| `CLAUDE.md` | AI 协作规则 |
| `README.md` | 项目说明与快速开始 |
| `启动.bat` | Windows 双击启动（唯一保留在根目录的脚本） |
| `api_providers.json` | API 提供商配置（含自定义中转，属个人数据，打包时排除） |
| `requirements.txt` / `requirements.lock` | 依赖清单 |
| `ruff.toml` | 代码风格配置 |
| `esbuild.config.js` | 前端打包配置 |
| `pack-exclude.txt` | 打包排除规则 |

脚本类文件在 `scripts/launcher/`：`start.bat`、`安装依赖.bat`、`python-env.bat`、`start_all.bat`、`bootstrap-python.ps1`。

## 公共底座 `core/`

| 模块 | 职责 |
|---|---|
| `user_paths.py` | 用户数据目录（`%APPDATA%\art-canvas`）与项目内路径的唯一来源 |
| `media_paths.py` | 媒体落盘路径推导，层级为 `owner/type/feature/date`；类型自动登记 |
| `media_migration.py` | 旧版媒体目录结构迁移 |
| `preset_manager.py` | 提示词预设库读写，基线 + 用户覆盖层双层 |
| `feature_access.py` | 功能开关与访客模式降级判定 |
| `smart_prompt.py` | 提示词增强（LLM 改写），API 平台配置 |
| `wildcard_engine.py` | 通配符（wildcards）展开与导入 |
| `random_source.py` | 随机数据源：角色/画师/预设，统一走内容包 |
| `generation_data.py` | 生成记录与统计 |
| `genre_registry.py` | TTS 音色/体裁注册表 |
| `smart_tts.py` | 语音合成（LLM 直调） |
| `image_cutout.py` | 图像抠图 |
| `lan_sharing.py` | 局域网共享与访问控制 |

## 业务包

| 包 | 职责 | 关键文件 |
|---|---|---|
| `content_packs/` | 内容包通用层：清单校验、zip 安全导入导出、扫描、官方目录。**不持路径常量**，路径由调用方传入 | `manifest.py` `packer.py` `scanner.py` `catalog.py` |
| `style_packs/` | 风格包：分类文件读写、用户覆盖层（overlay）、官方包安装 | `store.py` `paths.py` `catalog.py` |
| `character_packs/` | 角色包：索引层 + 详情分片双轨（首屏只读索引） | `store.py` `schema.py` `paths.py` |
| `artist_packs/` | 画师包：单索引层 + 缩略图代理落盘缓存 | `store.py` `schema.py` `thumbs.py` |

## API 路由 `routers/`

| 域 | 文件 |
|---|---|
| 认证与用户 | `auth.py` `user_assets.py` |
| 在线生成 | `online_gen.py` `ms_generate.py` `modelscope.py` `runninghub.py` `ideogram4.py` `jimeng.py` |
| ComfyUI | `comfyui.py` `canvas_comfy.py` `workflows.py` `workflows_legacy.py` `interrogate.py` |
| 无限画布 | `canvases.py` `canvas_tasks.py` `canvas_workflows.py` `smart_canvas.py` |
| 对话 | `chat.py` |
| 资产与媒体 | `assets.py` `asset_library.py` `media_ops.py` `gallery.py` `output_ops.py` `output_zip.py` `shared_folders.py` `proxy_download.py` |
| 内容包 | `characters.py` `artists.py` `content_pack_routes.py`（路由工厂，三种包共用 5 个同构端点） |
| 提示词 | `presets.py` `prompt_libraries.py` `prompt_dict.py` `wildcards.py` `smart_prompt.py` `random_sources.py` `translate.py` |
| 训练与 LoRA | `training.py` `lora_manager.py` `lora_scan.py` |
| 其它 | `config.py` `history.py` `tts.py` `poster.py` `angle.py` `generation_dashboard.py` `cli_tools.py` `restart.py` `static_files.py` `animadex.py` |

## 前端 `static/`

### 页面

| 页面 | 文件 |
|---|---|
| 主控制台 | `index.html` |
| 登录 | `login.html` + 背景引擎 `js/login-bg.js`（极光，预设注册表，颜色跟随主题调色板） |
| 在线生图 | `online.html` |
| 智能对话 | `gpt-chat.html` |
| 无限画布 | `canvas.html`、`canvas-list.html`、`smart-canvas.html` |
| 资产库 | `asset-manager.html` |

独立 ComfyUI 应用在 `static/app/`：`zimage.html`（生图）、`klein.html`（编辑）、`angle.html`（3D 视角）、`cgstyle.html`、`2dstyle.html`、`rmbg.html`（抠图）、`yichuwuti.html`（移除物体）、`gaoqingxiufu.html`（高清修复）、`kuotu.html`（扩图）、`promptgen.html`（反推）、`textmatting.html`（文字抠图）、`watermark-removal.html`、`poster.html`、`tts.html`、`litevideo.html`、`training.html`、`generation-dashboard.html`、`chat-gen.html`、`studio-chat.html`。

### 关键模块 `static/modules/`

| 功能 | 文件 |
|---|---|
| 画布引擎与节点 | `canvas-engine.js` `canvas-all.js` `image-node.js` `output-node.js` `llm-node.js` `loop-node.js` `ps-node.js` `generator-node.js` `msgen-node.js` `video-node.js` `audio-node.js` `upload-video-node.js` |
| ComfyUI 各应用逻辑 | `comfyui-registry.js` `comfyui-klein.js` `comfyui-2dstyle.js` `comfyui-cgstyle.js` `comfyui-rmbg.js` `comfyui-kuotu.js` `comfyui-yichuwuti.js` `comfyui-gaoqingxiufu.js` `comfyui-promptgen.js` `comfyui-qwen-edit.js` `comfyui-watermark-removal.js` `comfyui-sdmatte.js` `comfyui-style-transfer.js` `comfyui-jiandanbeijing.js` `comfyui-utils.js` |
| 内容包管理 | `content-pack-manager.js`（角色包+画师包，配置驱动）、`style-pack-manager.js`（风格包） |
| 资产库 | `asset-library.js` `gallery-assets.js` |
| 提示词 | `preset-panel.js` `preset-types.js` `prompt-tags.js` `prompt-history.js` `random-prompt.js` `smart-prompt.js` `prompt-translate-ui.js` |
| 生成控制 | `generation-controls.js` `generation-options-panel.js` `generation-menu-position.js` `model-features.js` `model-visibility.js` |
| 对话 | `chat-assistant.js` `chat-composer.js` `chat-parameters.js` `chat-tasks.js` |
| 其它 | `auth-token.js` `settings.js` `minimap-nav.js` `image-viewer.js` `image-editor.js` `lora-manager.js` `ref-image-manager.js` `training.js` `logs-panel.js` |

## 工具脚本 `tools/`

| 用途 | 文件 |
|---|---|
| 风格包 | `style_pack_split.py`（拆种子包+平台包）、`style_pack_migrate.py`、`merge-pia-into-style-presets.py` |
| 角色包 | `character_pack_split.py`（拆种子/热门/长尾）、`update_character_data.py`（从 animadex 抓全量） |
| 画师包 | `artist_pack_fetch.py`（抓 anima release）、`artist_pack_split.py`（拆种子/活跃/新锐） |
| 资源导入 | `import_resources.py`（把离线 zip 导回项目根） |
| 素材导入 | `fooocus_importer.py`、`import_yuanbao_styles.py` |
| 运行期支撑 | `performance_timing.py`、`api_compat.py`、`webai_gateway.py`、`training_bridge.py`（被 main 顶层依赖，不可移走） |
| 运维 | `install_cutout_models.py`、`codex_image.py`、`fey_no_bg_worker.py` |

## 测试 `tests/`

目录结构镜像源码：`core/media_paths.py` ↔ `tests/test_media_paths.py`。
运行：`PYTHONPATH=. python -m unittest discover -s tests -p "test_*.py"`，或单独 `python tests/test_xxx.py`。

## 新增代码时的落点判断

1. 只服务一个页面/业务 → 放该业务的路由与模块，不要进 `core/`。
2. 被多个业务共用、且不含业务概念 → `core/`。
3. 内容型数据（预设、角色、画师、缩略图）→ 走包体系，不进 git。
4. 一次性探查脚本 → `scratch/<日期>_<主题>/`，用完即弃，禁止被 `src` 引用。
5. 新增文件后，同步更新本文件的对应表格。
