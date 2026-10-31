# LTX Director 集成方案

> **TL;DR**：art-canvas 的前端节点层和 workflow 文件已补齐到位，要让 `LTX Director` 真正跑起来，还差一步 —— **在 ComfyUI 侧安装对应的自定义节点**。

---

## 一、现状

| 端 | 状态 | 文件 |
|---|------|------|
| 前端节点（Timeline Editor） | ✅ 已就位 | `static/js/ltx-director-timeline.js`（与 Infinite 100% 一致，4111 行）|
| 节点注册 / 工具栏按钮 | ✅ 已接线 | `canvas.js` + `canvas.html` + `smart-canvas.html` |
| Workflow 文件（API 格式） | ✅ 已迁移 | `workflows/LTXDirectorv2-API.json` (9.5 KB) |
| Workflow 配置描述 | ✅ 已迁移 | `workflows/LTXDirectorv2-API.config.json` (3.2 KB) |
| 后端路由 | ✅ 自动支持 | `main.py` 中 `WORKFLOW_DIR` 根扫描自动收录 |
| ComfyUI 自定义节点 | ❌ **缺失** | 需用户在本机 ComfyUI 装：WhatDreamsCost/WhatDreamsCost-ComfyUI |
| 模型权重 | ❌ **缺失** | LTX-2.3 + Gemma3 12B + LTX-2.3 VAE 等 |

> 工作流 ID 节点依赖：节点 `46` (LTXDirector)、`93:77` (CheckpointLoaderSimple)、`93:78`–`93:84` (Sampler 系列)、`94:*` (BasicScheduler/RandomNoise) 等共 **33 个节点**，24 个 class_type，其中 **9 个 class_type 来自上游 WhatDreamsCost 仓库**（`LTXDirector`, `LTXDirectorGuide`, `LTXVConcatAVLatent`, `LTXVSeparateAVLatent`, `LTXVConditioning`, `LTXVAudioVAEDecode`, `LTXVEmptyLatentVideo` 等）。

---

## 二、为什么要依赖上游仓库

LTXDirector 不是 ComfyUI 的内置节点，而是 **ComfyUI 自定义节点**（Python 实现的 `nodes.py`）。具体来源：

- **仓库**：https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI
- **提交数**：~151 commits（活跃维护中，2026-07 仍在更新）
- **作者**：WhatDreamsCost
- **说明**（仓库 README）："LTX Director and a variety of other custom ComfyUI nodes and workflows"

> 这是社区节点，必须本机 ComfyUI 安装 `git clone` 才能让 `LTXDirector` 这个 class_type 被注册。

---

## 三、完整安装步骤

### 3.1 ComfyUI 自定义节点安装

```bash
# 1. 进入 ComfyUI 自定义节点目录
cd ComfyUI/custom_nodes

# 2. 克隆 LTX Director 仓库（这是缺失的关键依赖）
git clone https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI.git

# 3. 进入仓库存放目录
cd WhatDreamsCost-ComfyUI

# 4. 安装依赖
pip install -r requirements.txt

# 5. 重启 ComfyUI
# （在 ComfyUI 主目录重启 python main.py）
```

> 安装后 ComfyUI 重启日志里应能看到 `[LTX Director]` 节点注册成功的标识。如果有 `ModuleNotFoundError` 说明依赖没装齐。

### 3.2 模型权重下载

LTXDirectorv2-API 工作流使用 24 个 class_type，关键模型清单（来自 `LTXDirectorv2-API.json` 和同类 LTX23 工作流）：

| 模型文件 | 大小 | 用途 | 下载来源 |
|---|---|---|---|
| `ltx-2.3-22b-distilled-1.1-int8-ConvRot.safetensors` | 22B int8 | UNET | HuggingFace: Lightricks/LTX-Video |
| `gemma_3_12B_it_fp8_e4m3fn.safetensors` | 12B fp8 | 双 CLIP | HuggingFace: google/gemma-3-12b-it |
| `ltx-2.3-22b-dev_embeddings_connectors.safetensors` | - | LTX clip connector | HuggingFace: Lightricks/LTX-Video |
| `ltx-2.3-22b-dev_video_vae.safetensors` | - | 视频 VAE | 同上 |
| `ltx-2.3-22b-dev_audio_vae.safetensors` | - | 音频 VAE | 同上 |

放置目录（按 ComfyUI 习惯）：
- `ComfyUI/models/unet/` — UNET 模型
- `ComfyUI/models/clip/` — Gemma3 + LTX connectors
- `ComfyUI/models/vae/` — 视频 VAE + 音频 VAE

### 3.3 工作流文件（已完成）

```
workflows/LTXDirectorv2-API.json         ✅ 已存在
workflows/LTXDirectorv2-API.config.json  ✅ 已存在
```

> 这两个文件是从 Infinite-Canvas 原样搬来的，未修改任何字节。

---

## 四、验证步骤

### 4.1 后端层验证（无需 ComfyUI 启动）

```bash
# 启动 art-canvas 后端
cd H:\AI-Tools\art-canvas
python main.py
```

打开浏览器 / 用 curl 测试：

```bash
# 1. 工作流是否被自动列入 builtin 列表
curl http://127.0.0.1:PORT/api/workflows/builtin | python -m json.tool
# 应该看到 "name": "LTXDirectorv2-API.json" 和 "title": "LTX Director v2 (API)"

# 2. 单独取工作流 JSON
curl http://127.0.0.1:PORT/api/workflows/LTXDirectorv2-API.json

# 3. 单独取配置
curl http://127.0.0.1:PORT/api/workflows/LTXDirectorv2-API.json/config
# 应返回 10 个 fields（含 timeline_data / global_prompt / duration 等）
```

### 4.2 前端层验证

1. 启动 art-canvas，登录账号
2. 创建画布（建议用 **智能画布 / Smart Canvas**，因为节点挂在 `smart-canvas.html`）
3. 点工具栏的 **"LTX Director"** 按钮（图标 🎬 film）
4. 应该弹出 LTX Director 节点，时间轴编辑器可见
5. 拖拽几个关键帧、设置 segment
6. （此时如果 ComfyUI 没装，会报节点缺失）

### 4.3 端到端验证

1. ComfyUI 已启动 + WhatDreamsCost 节点已装
2. art-canvas 已启动
3. 画布里添加 LTX Director 节点
4. 上传 1-2 张参考图（用节点输入图槽）
5. 设置总时长、帧率、点击执行
6. ComfyUI 队列里应能看到对应 prompt_id
7. 等待出结果 → 画布节点会显示视频预览

---

## 五、节点能力对照

LTX Director 节点提供的能力（对比单段视频节点 `video-node.js`）：

| 维度 | video-node (单段) | ltxDirector (导演台) |
|---|---|---|
| 视频段数 | 1 段 | 多段拼镜（按时间轴分段） |
| 音频轨道 | 跟随单段视频自带音轨 | 可独立配 audioSegments 列表 |
| 镜头强度 (guide_strength) | 不支持 | 每段独立控制 |
| 段时长控制 | 总时长一次性给 | `segment_lengths` 按段给 |
| 总时长 | `duration_seconds` | 实际由各段长度求和 |
| 关键帧提示词覆盖 | 整段单一 prompt | 全局 prompt + 各段 local_prompts |
| 适用场景 | 单段图生视频 | 多镜头短视频 / 带背景乐的短视频 |

> Infinite 的项目偏向"短视频拼镜"，单段 LTX-2.3 节点 `video-node.js` 处理的是单段工作流（`workflows/LT23-图生视频.json`），而 LTX Director 是 multi-segment 高级工作流。

---

## 六、故障排查清单

| 现象 | 可能原因 | 解决方法 |
|---|---|---|
| `BT / 一个 ❓` 节点无法执行 | WhatDreamsCost 自定义节点未装 | 装 GitHub 仓库 + `pip install -r requirements.txt` |
| `ModuleNotFoundError: No module named 'xxx'` | dependencies 没装全 | 检查仓库根 requirements.txt 逐项装 |
| 节点不显示 LTX Director 注册日志 | ComfyUI 没重启 | 重启 ComfyUI |
| `Can't find model 'ltx-2.3-22b-distilled'` | UNET 模型缺失 | 按 §3.2 下载模型到 `models/unet/` |
| `Can't find vae 'ltx-2.3-22b-dev_video_vae'` | 视频 VAE 缺失 | 放到 `models/vae/` |
| 执行时报 `LTXVConcatAVLatent` 缺失 | 同上，所有 LTXV* 节点都来自 WhatDreamsCost | 装仓库 |
| 工作流文件读取报 404 | `workflows/` 目录未刷新 | 重启 art-canvas（启动时 `BUILTIN_WORKFLOWS` 集合只构建一次）|
| 节点运行成功但画布不显示产物 | `keepGeneratedMedia` 没把视频放回画布 | 这是 art canvas.js 的特性，参见 `ltx-director-timeline.js` 的产出抓取流程 |

---

## 七、工作流参数（config.json 字段一览）

来自 `LTXDirectorv2-API.config.json`：

| ID | 节点 | 输入 | 类型 | 说明 |
|----|------|------|------|------|
| `f_global_prompt` | 46 | `global_prompt` | textarea | 全局提示词（每段都会叠加）|
| `f_timeline_data` | 46 | `timeline_data` | textarea | 时间轴数据 JSON（含 segments / audioSegments）|
| `f_duration_frames` | 46 | `duration_frames` | number | 总帧数（1-10000）|
| `f_duration_seconds` | 46 | `duration_seconds` | number | 总秒数（0.1-1000）|
| `f_frame_rate` | 46 | `frame_rate` | number | 帧率（1-240）|
| `f_custom_width` | 46 | `custom_width` | number | 宽度（0=自动）|
| `f_custom_height` | 46 | `custom_height` | number | 高度（0=自动）|
| `f_use_custom_audio` | 46 | `use_custom_audio` | boolean | 是否使用独立音频段 |
| `f_noise_seed` | 94:28 | `noise_seed` | number | 随机种子 |
| `f_4t0z0g8` | 46 | `resize_method` | dropdown | "maintain aspect ratio" / "stretch to fit" |

> **注意**：`timeline_data` 是 **核心数据结构**，前端 `ltx-director-timeline.js` 会序列化出形如 `{"segments":[{...}], "audioSegments":[{...}]}` 的 JSON 送入。
> 前端 UI 默认会把这两个字段从节点本体 widget 中隐藏（`HIDDEN_WIDGET_NAMES` 包含 `timeline_data`、`local_prompts`、`segment_lengths`、`guide_strength`、`audio_data`、`use_custom_audio`），改由 Timeline Editor 接管。

---

## 八、文件清单（本次迁移涉及的）

| 文件 | 操作 | 来源 |
|---|---|---|
| `workflows/LTXDirectorv2-API.json` | 复制（9.5 KB） | Infinite-Canvas 同名 |
| `workflows/LTXDirectorv2-API.config.json` | 复制（3.2 KB） | Infinite-Canvas 同名 |
| `static/js/ltx-director-timeline.js` | 此前已有（146.5 KB） | 与 Infinite 字节级一致 |
| `static/js/canvas.js` | 此前已有（694 KB） | 与 Infinite 高度相似（仅 1KB 差异） |
| `static/canvas.html` | 此前已修（引入 `<script src=".../ltx-director-timeline.js?v=20260726">`） | Infinite 同步迁移 |
| `static/smart-canvas.html` | 此前已修（同上） | Infinite 同步迁移 |
| `CONTEXT.md` | **待更新**（节点类型列表加 `ltxDirector`） | 待办 |
| `README.md` | **待更新**（工作流章节加 LTXDirectorv2） | 待办 |

---

## 九、变更记录

- 2026-07-27：完成 workflow 文件迁移（`LTXDirectorv2-API.json` + `.config.json`），写本文档。
- 待补：CONTEXT.md 节点类型枚举更新（`+ltxDirector`，共 14 种），README.md 工作流章节补 LTXDirector 条目。
