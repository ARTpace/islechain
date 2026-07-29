# 文生提示词 ComfyUI 通道 — 调研结论与方案（2026-07-28）

## 用户原始需求
> 文生图（zimage）的 AI 提示词目前只能走 API 方式（/api/prompt-module/generate），
> 希望新增 ComfyUI 工作流方式，可参考 promptgen.html 的图像反推做法（用 ComfyUI 工作流替代 API 调用）。

## 调研结果：当前 ComfyUI 上"文→LLM"路线状态

### ❌ llama.cpp 系列节点都跑不起来
| 节点 | 节点 ID | 失败原因 |
|---|---|---|
| `llama_cpp_model_loader` | 13 | 用户引用的 `Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf` 文件**不存在** |
| `llama_cpp_instruct_adv` | 3 | 缺 `present_penalty` 字段（实际叫 `presence_penalty`） |
| `GJJ_LlamaAssistant` | 100 | 报 `Failed to load model from file: Qwen3.5-9B-Q4_0.gguf`，llama_cpp 内部加载失败 |

**根因**：用户的 `promptgen.html` / `图像反推.json` 工作流里硬编码了 `Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf`（约 8GB），但 ComfyUI/models/LLM 下实际只有：
- `Qwen3.5-9B-Q4_0.gguf` (5.01GB)
- `Qwen3.5-9B-mmproj-BF16.gguf` (0.86GB)

**这些工作流当前在任何 ComfyUI 上都跑不通**（用户应知道这件事）。

### ✅ 找到能跑通的方案：Superprompt 节点
- 节点位置：`ComfyUI-KJNodes/nodes/image_nodes.py`（KJNodes 节点包）
- 模型：`Gustavosta/MagicPrompt-Stable-Diffusion`（308MB safetensors）
- 模型路径：`H:\AI-Tools\ComfyUI_TE\ComfyUI\custom_nodes\ComfyUI-KJNodes\models\superprompt-v1\`
- 节点接口：
  - inputs: `instruction_prompt` (STRING multiline), `prompt` (STRING multiline, forceInput), `max_new_tokens` (INT 1-4096)
  - output: STRING

### ✅ 已写好并测试通过

**文件**：
- `workflows/提示词/文生提示词.json` (842B)
- `workflows/提示词/文生提示词.config.json` (1315B)

**测试结果**（prompt_id=46bf1e69...）：
- 输入：用户文字 `一只橘色的小猫在花园里追蝴蝶`
- 输出："a vibrant and intricate Stable Diffusion scene unfolds...high-quality, high-quality, and high-quality"
- ✅ status=success，ShowText 节点拿到扩写结果
- 耗时：94 秒（首次加载模型），后续几秒

**当前 instruction_prompt 模板**（已在文件中）：
```
You are a Stable Diffusion prompt engineer.
Expand the user input into comma-separated English tags.
Format: masterpiece, best quality, highly detailed, sharp focus,
<subject tags>, <action tags>, <scene tags>, <lighting tags>,
<camera tags>, <art style tags>.
Output ONLY the tags, no explanations, no markdown, no quotes.
```

## 决策点：用户需要选择

| 方案 | 优势 | 劣势 |
|---|---|---|
| **A. 直接用 Superprompt 节点**（当前默认） | ✅ 现在就能用，纯本地 308MB，SD tag 风格专用模型 | 模型固定，无法选更好的 LLM |
| B. 等用户先下载 Uncensored gguf 后用 llama_cpp | 通用 LLM，可自定义 system prompt | 模型 8GB，需先下载并改配置 |
| C. 用 PromptExpand 节点（Ollama 或智谱 API） | 用户可在 6 种云端模型 + Ollama 中选 | 需要 Ollama 跑通 或 智谱 API Key |
| D. 用 WujiLLMPromptExpander（纯云端） | 一行配置 | 必须有云端 API Key |

## 推荐方案 A（已经做完）

Superprompt 节点是 **Stable Diffusion 专用微调**的小模型（Gustavosta/MagicPrompt-Stable-Diffusion 在 1.5 模型上专门训练过），输出的 tag 风格比通用 LLM 更贴 SD 用法。代价是只能"扩写"不能"翻译"，但配合 instruction_prompt 已经能输出英文 tag。

## 后续步骤（用户决定方案后再做）

1. 如果选 A：
   - 给 prompt-module.js 加 `engine: 'comfyui_workflow'` 选项
   - 给 zimage 的前端 UI 加"使用 ComfyUI 工作流扩写"复选框
   - 后端在 `/api/prompt-module/generate` 增加 `engine` 字段路由：
     - engine=='comfyui_workflow' → 调 `/api/comfyui/prompt` 走 `workflows/提示词/文生提示词.json`
   - 工作流注册：当前 art-canvas 后端已有 BUILTIN_WORKFLOWS 自动扫描机制，新文件会被自动收录

2. 如果选 B：
   - 用户先下载 `Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf`
   - 同时修 llama_cpp_vllm 节点的加载问题（可能需要检查 llama.cpp 编译版本）

3. 如果选 C/D：
   - 用户配置 API Key 或 Ollama
   - 工作流改动量差不多

## 已创建文件清单
- `workflows/提示词/文生提示词.json` (842B, 2 个节点: Superprompt + ShowText)
- `workflows/提示词/文生提示词.config.json` (1315B, 3 个字段: user_prompt, instruction, max_tokens)
- 临时调试脚本（在 `C:\Users\zhengyuliang\AppData\Local\Temp\` 下，无需保留）