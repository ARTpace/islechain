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
| 登录 | `login.html`（结构）+ `css/login.css`（样式）+ `js/login.js`（交互）+ `js/login-bg.js`（极光背景，预设注册表，颜色跟随主题调色板） |
| 在线生图 | `online.html` |
| 智能对话 | `gpt-chat.html` |
| 无限画布 | `canvas.html`、`canvas-list.html`、`smart-canvas.html` |
| 资产库 | `asset-manager.html` |

独立 ComfyUI 应用在 `static/app/`：`zimage.html`（生图）、`klein.html`（编辑）、`angle.html`（3D 视角）、`cgstyle.html`、`2dstyle.html`、`rmbg.html`（抠图）、`yichuwuti.html`（移除物体）、`gaoqingxiufu.html`（高清修复）、`kuotu.html`（扩图）、`promptgen.html`（反推）、`textmatting.html`（文字抠图）、`watermark-removal.html`、`poster.html`、`tts.html`、`litevideo.html`、`training.html`、`generation-dashboard.html`、`chat-gen.html`、`studio-chat.html`。

### 主题与外观 `static/js/`

| 功能 | 文件 |
|---|---|
| 默认主题（**全站唯一配置点**，`window.STUDIO_DEFAULT_THEME`，改这一行即可换默认深/浅） | `theme-default.js` |
| 完整主题引擎：`StudioTheme`（明暗）/ `StudioLook`（5 套调色板、强调色、扫描线）/ `StudioScale` | `theme.js` |
| 登录页极光背景 | `login-bg.js` |

> 新增或改造页面时，`<script src="/static/js/theme-default.js">` 必须排在**任何读取主题的脚本之前**，
> 读取默认值统一写成 `localStorage.getItem('studio_theme') || (window.STUDIO_DEFAULT_THEME || 'dark')`。
> 老页面若在内联脚本里直接写死 `'light'`，换默认主题时会被漏掉 —— 这正是本次收敛掉的问题。

### 关键模块 `static/modules/`

| 功能 | 文件 |
|---|---|
| 画布引擎与节点 | `canvas-engine.js` `canvas-all.js` `image-node.js` `output-node.js` `llm-node.js` `loop-node.js` `ps-node.js` `generator-node.js` `msgen-node.js` `video-node.js` `audio-node.js` `upload-video-node.js` |
| ComfyUI 各应用逻辑 | `comfyui-registry.js` `comfyui-klein.js` `comfyui-2dstyle.js` `comfyui-cgstyle.js` `comfyui-rmbg.js` `comfyui-kuotu.js` `comfyui-yichuwuti.js` `comfyui-gaoqingxiufu.js` `comfyui-promptgen.js` `comfyui-qwen-edit.js` `comfyui-watermark-removal.js` `comfyui-sdmatte.js` `comfyui-style-transfer.js` `comfyui-jiandanbeijing.js` `comfyui-utils.js` |
| 内容包管理 | `content-pack-manager.js`（角色包+画师包，配置驱动）、`style-pack-manager.js`（风格包） |
| 资产库 | `asset-library.js` `gallery-assets.js` |
| 提示词 | `preset-panel.js` `preset-types.js` `prompt-tags.js` `prompt-history.js` `random-prompt.js` `smart-prompt.js` `prompt-translate-ui.js`、`prompt-picker.js`（提示词库浮层：风格/角色/画师/预设四 tab 合一，API 为 `window.PromptPicker`，样式暂在 `app/zimage.html`） |
| 生成控制 | `generation-controls.js` `generation-options-panel.js` `generation-menu-position.js` `model-features.js` `model-visibility.js`、`model-picker.js`（模型选择菜单：档位归并 + 跨宿主渲染，样式 `css/model-picker.css`） |
| 工具页共享运行时 | `comfy-tool-runtime.js`（服务器地址解析 / apiFetch / ComfyUI WebSocket / 任务提交与结果轮询，API 为 `window.ComfyTool.create()`）、`comfy-progress.js`（进度条与状态灯绘制，API 为 `window.ComfyProgress`）。已接入 `app/2dstyle.html` `app/cgstyle.html`；**新工具页不要再抄模板**，见下方约定 |
| 对话 | `chat-assistant.js` `chat-composer.js` `chat-parameters.js` `chat-tasks.js` |
| 画布 AI 对话 | `js/canvas-agent.js`（侧栏面板、流式事件、方案采用）、`js/canvas-agent-state.js`（会话持久化）、`js/canvas-agent-markdown.js`（先转义再渲染的 Markdown）、`css/canvas-agent.css`（Gemini 式对话界面） |
| 节点包与插件台账 | `js/canvas-comfy-builds.js`（候选测试 / 安装 / 真实测试记录，渲染在「工作流与节点包」弹窗的 `#nodePackageRecords`；`prepare`/`configure` 供对话方案采用构建） |
| 贴图重绘应用 | `static/app/texture-repaint.html`：侧栏应用之一。投影与 UV 烘焙用 `static/js/texture-repaint-engine.js`（源在 `ai-3d-texture-repaint-studio/src/embed/artCanvas.ts`，改完需重新 esbuild）。重建命令（在源码仓库目录执行）：`npx esbuild src/embed/artCanvas.ts --bundle --format=iife --global-name=TextureRepaint --platform=browser --target=es2020 --outfile="H:/AI-Tools/islechain/static/js/texture-repaint-engine.js"`，产物为 IIFE 全局 `TextureRepaint.default`。3D 预览复用 `GET /api/model3d/viewer`（同一份 `templates/model3d/viewer.html`）。生图走 `ComfyTool`；内置 SD1.5 图生图/局部重绘模板由 engine 的 `inpaintWorkflow` / `img2imgWorkflow` 提供 |
| 3D 模型导入与预览 | `js/game-model-import.js`（打包产物，源在 `tools/model3d/importer.mjs`）：GLB/glTF/FBX/OBJ/STL/PLY → 自包含 GLB，含 FBX 文件头与版本预检、中文诊断；`modules/external-asset-drop.js` 的 `openModel3dViewer`（资产库 3D 预览，非 glb 先转再预览） |
| 3D 节点：模型 vs 资产 | **拖入模型直接建 `gameModelAsset`（模型资产）**，不再有「本地模型 → 纳入资产」的中间态：`__assetDropCreateModelNode` 直接转调 `GameModel3D.dropModels`，画布没有游戏项目时会自动建一个、已有则复用。`gameModelAsset` 存 `modelAssetId`，可连线到 `gameDevelop` / `gameModel3d` / `gameAnimate3d`，进运行时资源。**`model3d` 只保留两个用途**：① PBR 材质球预览节点（无 `url`，由材质节点「生成材质球预览」创建，见下一行）；② 老画布里的本地模型节点（有 `url`），仍可点「纳入资产」（`promoteModel3dToAsset` → `GameModel3D.adoptLocal`）**原地升级**成 `gameModelAsset`，节点 id、位置、连线全部保留 |
| AI 建模产物落地 | `blenderGen`（AI 建模）跑完后分两种：**改造模式**（连了模型资产当基准）→ `js/canvas.js` 的 `blenderOverwriteAsset` 直接覆盖原资产（`revision+1`），**不建任何节点**；**新建模式** → 后端 `routers/dcc_bridge.py` 的 `collect_into_canvas` 先把产物建成画布上的 `model3d` 节点，前端 `blenderModelAsset` **复用这个节点**、调 `GameModel3D.adoptLocal` 原地升级成 `gameModelAsset`，再补一条 `blenderGen → 资产` 的连线。不要再调 `dropModels` 新建节点，否则画布上会同时出现「3D 模型」和「模型资产」 |
| AI 建模减面（目标面数 + 作业手册） | 节点 `static/nodes/blender-gen/index.js` 的两个控件「目标面数」「作业手册」→ `POST /api/dcc/build-model` 的 `targetTris` / `skillId` → `core/blender_modeller.py` 的 `_target_block` 把面数写成硬约束（改造模式下等同减面：要求按 `ratio = 目标 / 当前` 用 DECIMATE 修改器 apply，并打印 before/after），`_skill_text` 取 `packs/blender-skills/<skillId>/SKILL.md`。产物落地后 `core/glb_stats.py` 直接读 GLB 的 accessor 统计**真实三角面数**并写回 `job.tris`，节点状态行显示「面数 / 目标 / 偏差」，不再只信 AI 的自述。**人设**（`core/game_role_presets.py` 的 `optimizer` 减面拓扑师）管取舍方向，**手册**（`packs/blender-skills/optimizer/SKILL.md` 的减面配方）管手法，两者可自由组合；手册清单由 `GET /api/game-projects/blender-skills`（`core/blender_skills.py` 扫目录）给出，新增手册只要建 `packs/blender-skills/<id>/SKILL.md` |
| 色卡低模建模 | 人设 `palette-lowpoly` + 同名 `packs/blender-skills/palette-lowpoly/SKILL.md`（4×12 色卡贴图、单材质、UV 收点）；`core/blender_modeller.py` 命中该 preset 时改用 `PALETTE_BRIEF`、跳过 `SHAPE_BRIEF`，`_record_uv` 豁免 UV 展开覆盖率判定（写 `uvMode=palette`） |
| PBR 材质球预览 | `js/canvas-material-preview.js`：从连入 **`gameModelAsset`（模型资产）或旧版 `model3d`** 的节点自动取贴图——`materialPbr` 用 `materialJob.result.maps` 的通道，普通图片节点按文件名识别（basecolor/normal/roughness/metallic/ao）；`sources()` 同时给出 `maps`、`repeat`、`geometry`。**材质直连模型资产即可预览，不再需要中间节点**：`canvas-materials.js` 的 `canConnect` 放行 `materialPbr → gameModelAsset`，`ballPreview`（「生成材质球预览」按钮）已连到 3D 节点时只把该节点的 `materialPreview` 切到 `sphere`，不新建节点。**预设与平铺全部长在原来的 3D 预览器里面**（`templates/model3d/viewer.html`），父页不另做面板、也不换渲染路径：`game-model3d.js` 的 `nodeBody` 只负责挑 iframe 的地址——有模型/任务时 `preview/<assetId>` 或 `jobs/<jobId>/preview`，**只有材质没有模型时走新增的 `GET /model3d/material-preview`**（同一份 viewer、空模型版），然后把贴图按 Blob 经 `postMessage` 送进去（沙箱 iframe 拿不到登录态，取图由父页负责）。预览器内部用 `MeshStandardMaterial` + `SphereGeometry/BoxGeometry/PlaneGeometry` 自造球/方/平板（`buildMaterialPreset`），与模型互斥显隐；**左下角浮层 `.viewer-material`** 提供「模型/球/方/平板」分段键 + 平铺滑条（`input[type=range]`，0.5–4 半档），不挡右上角通道/帮助/全屏三键，左键旋转、通道预览、双击重置视角全部复用原有 `GameOrbitControls` 与通道渲染。**换预设或拖平铺都不重建 iframe**：`viewState()` 的 `key` 只含「看哪份内容」（`previewKey` 或 `material:<贴图哈希>`），预设与平铺走 `postMessage` 的 `geometry`/`repeat`；预览器改完再把选择用 `material-control` 报回节点（父页只存不重绘，避免多推一次把视角重置）。**推送时机**：预览器在模型/空场景就绪后统一发 `model-ready`，父页收到时先清掉该 iframe 的推送签名再发一次——否则新 iframe 首帧那次 `postMessage` 会落在子页监听挂上之前被丢掉。`apply-material` 只替换 `map/normalMap/roughnessMap/metalnessMap/aoMap` 贴图槽并设 `texture.repeat`，不动几何与 UV；上一轮贴图在新贴图落地后按「还有没有网格引用」决定 `dispose`，拖滑条不会堆显存。另外 `preview_response` 的内联注入改用 `re.sub` 的 callable 形式：`three-runtime.js` 是压缩产物，里面有 `$&`（minified 变量名 `$` 紧跟 `&&`），字符串式 `str.replace` 会把它当成「整段匹配」展开，直接把脚本改坏 |
| 其它 | `auth-token.js` `settings.js` `minimap-nav.js` `image-viewer.js` `image-editor.js` `lora-manager.js` `ref-image-manager.js` `training.js` `logs-panel.js` |

> **工具页（2dstyle / cgstyle / kuotu / rmbg / yichuwuti / gaoqingxiufu / promptgen / textmatting / watermark-removal）约定**
>
> 这几页原本是同一份模板复制出来的，`apiFetch` / `buildWsUrl` / `generateUUID` / `loadConfig` /
> `checkServerConnection` / 进度条四件套 / 提交并等待结果各写一遍（`buildWsUrl` 曾 10 份字面相同）。
> 现在统一走 `comfy-tool-runtime.js` + `comfy-progress.js`：
>
> ```js
> const tool = ComfyTool.create({ keepAlive: true });   // keepAlive：常驻 WS 收进度
> const CLIENT_ID = tool.clientId;
> await tool.loadConfig();                               // 本地模式会回后端取真实地址
> tool.submit(workflow, { onProgress: updateRealProgress })  // → { imageUrl, promptId }
> ```
>
> 三条硬约定：
> 1. **完成判定必须靠 history 轮询**（`submit` 已内置），不要只等 WebSocket 的 `executing: null`——
>    WS 消息丢一次就永久挂起。
> 2. **提交后必须检查 `node_errors`**：模型文件被删时 ComfyUI 可能返回 200 且只跑部分节点，
>    不检查就会一直轮询到超时（`submit` 已内置）。
> 3. 进度条 DOM 契约固定为 `progressInline / progressFill / progressPercent / progressStatus`，
>    状态灯为 `statusText / dotColor`；换页面不要换 id。

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
| 3D 模型导入 | `model3d/importer.mjs`（打包成 `static/js/game-model-import.js`，用 `npm run build:importer`；改完必须重新打包）、`model3d/fbx-ascii.mjs`（ASCII 文本 FBX 解析：顶点/三角化/法线/材质/变换）、`model3d/test-ascii.mjs`（回归断言：`node test-ascii.mjs <file.fbx>`） |

## 测试 `tests/`

目录结构镜像源码：`core/media_paths.py` ↔ `tests/test_media_paths.py`。
运行：`PYTHONPATH=. python -m unittest discover -s tests -p "test_*.py"`，或单独 `python tests/test_xxx.py`。

## 新增代码时的落点判断

1. 只服务一个页面/业务 → 放该业务的路由与模块，不要进 `core/`。
2. 被多个业务共用、且不含业务概念 → `core/`。
3. 内容型数据（预设、角色、画师、缩略图）→ 走包体系，不进 git。
4. 一次性探查脚本 → `scratch/<日期>_<主题>/`，用完即弃，禁止被 `src` 引用。
5. 新增文件后，同步更新本文件的对应表格。
