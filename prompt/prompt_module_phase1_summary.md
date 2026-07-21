# prompt 模块优化 — 第一阶段完成

## 完成内容

### 新建目录结构
```
prompt/
├── __init__.py          — 统一出口，暴露 generate() 等核心 API
├── core.py              — 核心编排：串联 config→preset→knowledge→builder→LLM→parse
├── config.py            — 配置管理：provider 发现、API key 解析（单来源，去重旧版 3 份重复代码）
├── preset.py            — 预设管理：CRUD、分组、排序、复制、导入导出、自动迁移旧数据
├── knowledge.py         — 知识库管理：关键词检索（片段而非全量）、用户自定义条目增删查
├── builder.py           — 模板引擎：变量替换、LoRA 保护规则始终注入、支持自定义模板
├── templates/
│   ├── default.md       — 默认 Anima 标签生成模板（替代旧版 f-string）
│   ├── json.md          — JSON 输出模板
│   └── custom/          — 用户自定义模板目录
├── presets/
│   ├── index.json       — 预设索引（分组 + 排序顺序 + 选中预设）
│   └── *.json           — 单个预设文件（旧数据自动迁移）
└── static/              — 预留前端目录
```

### 改动范围
- **新增 6 个 Python 文件 + 2 个模板文件** — 完全重写 but 保持与旧功能等价
- **`main.py` 只改了 3 行 import + 路由逻辑**（feature flag `USE_NEW_PROMPT_MODULE = True`，切到 False 立即回退旧版）
- **`smart_tts.py` 和 `main.py` 中三处懒加载 `from smart_prompt import load_config` 未动**（`smart_prompt.py` 继续存在，新模块通过 `from prompt.core import load_config` 兼容签名）
- **旧 `smart_prompt.py` 未删除** — 双轨并行，稳定 1 周后清理

### 关键改进

| 旧版问题 | 新版 |
|---|---|
| `generate_smart_prompt()` 单函数 150+ 行 | 6 个子模块各司其职，每文件 ~100 行 |
| API key 读取逻辑重复 3 次 | `config.py` 唯一来源 |
| 全量知识库嵌入（~100KB） | 关键词检索取 top-30 段（~2-5KB） |
| 预设无分组/无排序/无导入导出 | index.json 索引 + 分组 + 排序 + 导入导出 + 复制 |
| system prompt 硬编码在 f-string 中 | 外部 Markdown 模板 + 变量注入 |
| 预设混在 `smart-prompt-config.json` 中 | 独立的 `presets/index.json` |

### 测试结果
- 模块导入: ✅
- 预设自动迁移（5 个旧预设）: ✅
- `load_config()` 配置解析: ✅
- 模板渲染: ✅
- 输出解析（tag + json 模式）: ✅
- 全链路生成（调了 Agnes API 返回结果）: ✅

### 遗留（下一阶段）
- 新增 API 路由（`/api/prompt-module/*`）注册到 main.py 并在前端切换
- 知识库管理 API 此前端入口
- 稳定后清理旧文件

## 第二阶段：前端整合（已完成）

- **三合一 JS 文件**：`prompt/static/prompt-module.js`（48KB）
  - 合并 `smart-prompt.js`（生成按钮）、`smart-prompt-manager.js`（预设管理浮层）、`smart-prompt-picker.js`（预设选择器浮动面板）
  - 提供统一 IIFE 命名空间 `PromptModule`，三个子模块：`Generator` / `PresetManager` / `PresetPicker`
  - `PromptModule.config({ apiPrefix: '/api/prompt-module' })` 支持一键切换后端路由
  - 可配置的 API 前缀：默认用旧 `/api/smart-prompt/`，切新后端只需一行
- **向后兼容**：所有全局函数（`spmOpen`、`spPickerOpen` 等）通过 `Object.defineProperty` 保留
  - 旧版 HTML 模板中的 `onclick="spmOpen()"` 无需修改
  - 旧版 CSS 依赖的 class 名全部保留
- **CSS 内联合并**：生成按钮 + 管理浮层 + 选择器的所有样式注入到一个 `<style>` 中
- **新增预设标签显示**：选择器列表中显示预设的 tags（如「迁移（旧版）」）
- **新增：`PresetPicker.refresh()`** — 管理浮层保存或关闭后自动刷新选择器状态
