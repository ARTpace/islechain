# ComfyUI "文→扩写提示词" 工作流 - 终极落地

> **结论**：用 `llama_cpp_instruct_adv` + **升级 llama-cpp-python 到 0.3.44** + **`mmproj=None` + `chat_handler=None`**（纯文本路径）—— **10 秒出 SD prompt**。

## TL;DR

✅ **落地工作流**：`workflows/提示词/文生提示词.json` + `.config.json`（已跑通）

✅ **核心动作 1**：升级 ComfyUI 的 `llama-cpp-python` 从 `0.3.22` → **`0.3.44+cu128`**（让 `Qwen35ChatHandler` 加载新 GGUF）

✅ **核心动作 2**：纯文本扩写**根本不需要 mmproj**！在节点里设 `mmproj="None"` + `chat_handler="None"`，跳过 mtmd 上下文加载

✅ **效果实测**：「一只橘色的小猫在花园里追蝴蝶」→ `masterpiece, best quality, highly detailed, sharp focus, a fluffy ginger kitten, ..., 8k resolution, adorable, playful atmosphere`

✅ **运行时长**：首次加载 ~3 秒 + 扩写 ~7 秒 = **总耗时 10 秒**

## 根因（最终版）

### 表层错误演变

| 版本 | 错误 | 真正原因 |
|---|---|---|
| ① `llama_cpp_instruct_adv` 旧版 (0.3.22) | `Required input is missing: present_penalty` | llama-cpp-python 0.3.22 太旧，不识别 `qwen35` GGUF → 节点加载阶段 schema 不全 |
| ② `GJJ_LlamaAssistant` | `Failed to load Qwen3.5-9B-Q4_0.gguf` | 同上，GGML 层不支持 qwen35 架构 |
| ③ `Superprompt` (KJNodes) | 跑通但输出质量差 | 308MB 蒸馏小模型 |
| ④ 升级到 0.3.44 + `chat_handler="Qwen3.5"` + `mmproj="Qwen3.5-9B-mmproj-BF16.gguf"` | 跑通 42 秒 ✅ 但前端切到 `qwen3-vl-4b-heretic-Q4_K_M.gguf` 后 → **mtmd context load failed** | mtmd 架构要求 mmproj 必须匹配 chat_handler 的模型家族 |

### 真正的根本结论

**文生提示词 = 纯文本推理**。任何 Qwen3.5/Qwen3-VL 等视觉语言 chat_handler 都需要对应的 mmproj 才能初始化 mtmd 上下文，**架构不匹配就 100% 失败**。

正确做法：**纯文任务 → `mmproj=None` + `chat_handler=None`**，让 llama-cpp-python 走纯文本补全路径。`llama_cpp_instruct_adv` 节点内部会用 prompt template 正确包装对话，纯文场景照样能输出标准 SD prompt。

## 修复步骤

### Step 1：升级 llama-cpp-python

**关键判断**：

- Python = **3.13.6**（`python_embeded\python.exe`）
- CUDA = **12.8**（`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8`）
- 驱动 = 610.62（RTX 5080，VRAM 16 GB）

→ 目标 wheel：`v0.3.44+cu128-cp313-cp313-win_amd64.whl`

[JamePeng 的 release 列表](https://github.com/JamePeng/llama-cpp-python/releases) 提供 `cu124 / cu126 / cu128 / cu130 / cu131` 全套，按 CUDA 选。

```powershell
# 卸旧装新
H:\AI-Tools\ComfyUI_TE\python_embeded\python.exe -m pip uninstall llama-cpp-python -y
H:\AI-Tools\ComfyUI_TE\python_embeded\python.exe -m pip install `
  "llama_cpp_python-0.3.44+cu128-cp313-cp313-win_amd64.whl" --no-deps
```

### Step 2：重启 ComfyUI

```powershell
Stop-Process -Id <原PID> -Force
Start-Process -FilePath 'H:\AI-Tools\ComfyUI_TE\python_embeded\python.exe' `
  -ArgumentList @('-s','H:\AI-Tools\ComfyUI_TE\ComfyUI\main.py','--windows-standalone-build','--fast','fp16_accumulation','--disable-xformers','--listen') `
  -RedirectStandardOutput "$env:TEMP\comfyui_restart.log" -WindowStyle Hidden
# 等 30+ 秒到端口 8188 LISTEN
```

### Step 3：验证

启动日志里看到：

```
load_backend: loaded CUDA backend from ...\llama_cpp\lib\ggml-cuda.dll
```

→ GPU 后端就位。`object_info/llama_cpp_model_loader` 的 `chat_handler` 列表应出现 `Qwen3.5 / Qwen3.5-Thinking / Qwen3.6 / Qwen3.6-Thinking` 等新 handler。

## 工作流文件 `文生提示词.json` 解析

**4 个节点（最后一个 ShowText 是展示用）**：

```
[100: llama_cpp_model_loader]
   model        = "Qwen3.5-9B-Q4_0.gguf"
   mmproj       = "None"                            ← 关键：纯文本，不要 mmproj
   chat_handler = "None"                            ← 关键：纯文本，不要 VL handler
   n_ctx        = 8192

[5: llama_cpp_parameters]
   temperature       = 0.8
   top_p             = 0.9
   presence_penalty  = 0.5                           ← 必填字段（即使 = 0.5 也要显式写）
   frequency_penalty = 0.0
   ... 其他采样参数

[3: llama_cpp_instruct_adv]                          ← 实际做扩写的节点
   preset_prompt  = "Prompt Style - Extreme Detailed"   ← 内置 SD tag 风格模板
   custom_prompt  = <用户输入>                          ← 前端注入
   system_prompt  = "你是文生图大模型的 prompt 撰写大师..."
   inference_mode = "one by one"                      ← 纯文本，不需要 images/video
   llama_model = [100, 0]
   parameters  = [5, 0]

[15: ShowText|pysssss]                                ← 展示输出
   text = [3, 0]
```

## ⚠️ 三个踩过的坑

### 坑 1：`present_penalty` 字段名

`llama_cpp_parameters` 节点的 `presence_penalty`（也写作 `present_penalty`）**必须填**（schema 校验为必填），即使你想设 0.0 也得显式写出。

### 坑 2：mmproj 架构必须匹配

如果用 `chat_handler="Qwen3.5"` 这种 VL handler，**mmproj 必须用同家族的**：

- `Qwen3.5-9B-Q4_0.gguf` ←→ `Qwen3.5-9B-mmproj-BF16.gguf`
- `qwen3-vl-4b-heretic-Q4_K_M.gguf` ←→ `qwen3-vl-4b-heretic-mmproj.gguf`（用户没下载）

**如果用户在前端切了模型但忘了切 mmproj** → mtmd context load failed（用户报的错就是这个）。

### 坑 3：纯文本扩写不需要 mmproj

`mmproj="None"` + `chat_handler="None"` → 走纯文本补全路径，**完全没有 mtmd 加载**。**这就是 v4 版本的精髓**——又稳又快。

## 实测样例

**用户输入**：「一只橘色的小猫在花园里追蝴蝶」

**v4 输出（10 秒完成）**：

```
masterpiece, best quality, highly detailed, sharp focus, a fluffy ginger 
kitten, chasing a colorful butterfly, vibrant garden scene, blooming 
flowers, green grass, dappled sunlight filtering through trees, soft warm 
lighting, shallow depth of field, bokeh effect, 85mm lens, f/1.8, 
photorealistic, 8k resolution, adorable, playful atmosphere
```

✅ SD tag 顺序正确（质量 → 主体 → 动作 → 场景 → 灯光 → 镜头参数）
✅ 关键词全覆盖（masterpiece, best quality, highly detailed 都触发）
✅ 额外奖励：自动加了镜头参数（85mm lens, f/1.8）
✅ 完全英文，无中文泄漏

## 配置面板 `.config.json`

前端暴露 5 个可调字段：

- `user_prompt`（textarea，必填）：用户原文
- `system_prompt`（textarea，高级）：可覆盖默认 system_prompt
- `preset`（select，高级）：扩写预设（8 种风格下拉）
- `temperature`（slider 0~2，默认 0.8）
- `max_tokens`（number 64~4096，默认 1024）

## 性能数据

| 指标 | 数值 |
|---|---|
| 首次模型加载 | ~3 秒 |
| 单次扩写耗时 | ~7 秒 |
| GPU 显存占用 | ~5 GB（Q4_0 + KV cache，无 mmproj）|
| 成功率 | 100%（1/1 测试）|

比 v3（带 mmproj）的 42 秒快 **4 倍**——因为跳过了 mmproj 加载 + mtmd 上下文初始化。

## 后续可扩展方向

1. **加图生提示词通道**：新建独立工作流 → `mmproj="Qwen3.5-9B-mmproj-BF16.gguf"` + `chat_handler="Qwen3.5"` + `inference_mode="images"` + `LoadImage` 喂图 → 自动反推 prompt
2. **多模型切换**：在 .config.json 暴露 chat_handler 选项，支持 Gemma3 / Qwen3.6 / GLM-4.6V 等
3. **Ollama 兜底**：用户已有 Ollama 在跑，可加独立工作流走 HTTP 调用
4. **批量反推**：循环节点对多张图依次扩写

## ⚠️ 不要做的事

- ❌ 不要在纯文任务里填 mmproj → 加 30 秒加载时间 + 架构匹配风险
- ❌ 不要用 cu131 wheel（用户 CUDA 是 12.8）
- ❌ 不要删除 `present_penalty` 字段（即使设 0.0 也要保留 key）
- ❌ 不要在前端默认 value 里塞太长的样例（会拖慢首屏）

## 文件清单

```
H:\AI-Tools\art-canvas\workflows\提示词\
  ├── 文生提示词.json         (2045B, 4 节点)
  ├── 文生提示词.config.json  (2137B, 5 字段)
  ├── README_文生提示词升级方案.md  (本文档)
  └── 图片反推 / 视频反推 / 图像反推等（已存在，未动）
```