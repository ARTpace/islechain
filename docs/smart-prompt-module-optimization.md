# AI 提示词生成模块 — 功能优化方案

> 项目：art-canvas | 模块：smart_prompt（智能提示词生成）
> 日期：2026-07-21 | 状态：方案设计

---

## 一、现状分析

### 1.1 涉及文件清单

| 层次 | 文件 | 职责 |
|---|---|---|
| 核心逻辑 | `smart_prompt.py` | LLM 调用、system prompt 构建、输出解析、配置加载（一锅端） |
| 后端路由 | `main.py` (#6291~6455) | 7 个 API 路由，分散在 300+ 行中 |
| 预设存储 | `data/smart-prompt-presets/*.json` | 每个预设一个独立文件，无索引 |
| 配置文件 | `data/smart-prompt-config.json` | 混用：存 `provider_id` + `preset_id` |
| 知识库 | `data/anima-knowledge.txt` | 十万行级超大单文件，无管理接口 |
| 前端 A | `static/modules/smart-prompt.js` | 容器组件，生成按钮 |
| 前端 B | `static/app/smart-prompt-manager.js/.css` | 预设管理浮层 |
| 前端 C | `static/modules/smart-prompt-picker.js/.css` | 预设选择器 |

### 1.2 核心痛点

**① 功能耦合过重**
`generate_smart_prompt()` 单函数承担：配置加载 → provider 发现 → API key 回退读取 → 知识库加载 → 模板构建 → LLM 调用 → 两套输出格式解析（tag/json）。改任何环节都要通读全函数。

**② 配置信息散落三处**
- provider 定义在 `api_providers.json`
- 选中记录在 `smart-prompt-config.json`
- API key 读取逻辑散落在环境变量、`API/.env`、`api_providers.json` 三个路径
- 当前选中预设也一起塞在 `smart-prompt-config.json`，加剧耦合

**③ 预设管理原始**
- 无分组/标签/排序——平铺列表，预设一多就难找
- 无导入导出——换环境要手动逐条创建
- 无复制功能——想基于某个预设微调只能重新创建
- 每改一次预设直接写文件，无校验无备份

**④ 知识库不可维护**
`anima-knowledge.txt` 是十万行级超长文本，删词条、增词条、查词条全要靠直接编辑文本文件。system prompt 构建时整段嵌入，极度浪费 token。

**⑤ 前端三文件各自为战**
API 路径硬编码、样式重复、功能分散。预设管理器 + 选择器 + 生成按钮三者没有统一的配置入口。

**⑥ System Prompt 硬编码**
`build_system_prompt()` 里大量 f-string 拼接，修改输出格式/规则要改 Python 代码。用户想自定义 system prompt 时虽有 `system_prompt` 字段支持但缺乏对模板本身的管理能力。

---

## 二、优化目标

1. **解耦** — 核心逻辑拆为职责单一的多文件模块，内外隔离
2. **预设管理升级** — 分组、导入导出、复制、搜索
3. **知识库可管理** — 提供增删查 API，优化 token 使用
4. **模板化** — system prompt 改为外部模板文件，支持用户自定义模板
5. **配置统一** — provider、API key、预设选中状态集中管理
6. **前端整合** — 统一出口、主题继承、可配置 API 路径
7. **向后兼容** — 现有 API 路由不动，旧预设数据自动迁移

---

## 三、架构设计

### 3.1 目录结构

```
prompt/                              # 新模块根目录
├── __init__.py                      # 统一出口，暴露 generate() 等核心 API
├── core.py                          # 核心生成流程编排
├── config.py                        # 配置管理（provider 发现、API key 解析）
├── preset.py                        # 预设管理（CRUD、分组、导入导出、复制）
├── knowledge.py                     # 知识库管理（增删查、片段截取）
├── builder.py                       # System Prompt 模板引擎
├── templates/                       # 模板目录
│   ├── default.md                   # 默认 Anima 标签模板（替代原 f-string）
│   ├── json.md                      # JSON 输出模板
│   └── custom/                      # 用户自定义模板目录
├── presets/                         # 预设数据存储
│   ├── index.json                   # 预设索引（分组/排序/元信息）
│   └── *.json                       # 每个预设一个文件（保持与旧格式兼容）
├── static/
│   └── prompt-module.js             # 前端整合版（三合一 + 新功能）
│   └── prompt-module.css            # 统一样式
└── MIGRATION.md                     # 迁移指南（从旧版迁移）
```

### 3.2 模块职责边界

```
┌─────────────────────────────────────────────────────────────────┐
│                        main.py (API 路由层)                      │
│  /api/smart-prompt/*          → 薄路由，调用 prompt 模块         │
│  /api/prompt-module/*         → 新功能路由（分组/导入导出等）    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                     prompt 模块（统一出口）                       │
│  prompt.generate()         ← 外部唯一入口                       │
│  prompt.list_presets()                                         │
│  prompt.export_presets()                                       │
│  prompt.import_presets()                                       │
│  prompt.search_knowledge()                                     │
└──────┬──────────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼
   core.py   config.py  preset.py  knowledge.py builder.py
   (编排)    (配置)     (预设)     (知识库)   (模板引擎)
```

### 3.3 数据流

```
用户输入
    │
    ▼
core.generate(user_input, preset_id=None)
    │
    ├── config.resolve()         # 确定 provider、model、API key
    ├── preset.get(preset_id)    # 加载预设配置（quality/negative/temperature 等）
    ├── knowledge.search()       # 根据输入语义检索相关知识片段（而非全量嵌入）
    ├── builder.render(          # 渲染 system prompt 模板
    │       template='default',
    │       knowledge=...,
    │       quality_tags=...,
    │       negative_default=...,
    │       custom_rules=...
    │   )
    ├── call_llm()               # 调用 LLM
    └── parse_output()           # 解析输出 (tag / json / raw)
        │
        ▼
    {success, prompt, negative, raw}
```

---

## 四、分模块设计

### 4.1 `core.py` — 核心编排

- `generate(user_input, preset_id=None, config_override=None) → dict`
- 职责：串联 config → preset → knowledge → builder → LLM → parse
- 不直接接触 API key、不读配置文件、不拼 system prompt 字符串
- 所有子模块通过参数注入，便于单测

### 4.2 `config.py` — 配置管理

- `resolve(preset_provider_id=None) → Config`
- 统一 provider 发现逻辑（去重当前 `smart_prompt.py` 中两套回退+`generate_smart_prompt()` 中的重复代码）
- 统一 API key 读取（环境变量 → `.env` 文件 → `api_providers.json`，只跑一次）
- 返回 `Config` 对象：`base_url`、`api_key`（遮蔽）、`model`、`temperature`、`max_tokens`
- 不再修改 `smart-prompt-config.json` 结构

### 4.3 `preset.py` — 预设管理

- CRUD：`create()` / `get()` / `update()` / `delete()`
- 分组：`tags: ["写实", "二次元", "平面设计"]`
- 排序：`sort_order: int`
- 复制：`duplicate(preset_id, new_name)`
- 导入/导出：
  - `export(filter_tags=None) → JSON` 导出全部或按分组导出
  - `import(json_data, mode='merge|replace')` 导入
- 存储结构（向后兼容旧格式）：

```json
{
  "id": "preset-xxx",
  "name": "Anima 标准生成",
  "description": "默认的 Anima 标签生成预设",
  "tags": ["二次元", "标准"],
  "sort_order": 0,
  "provider_id": "agnes::agnes-1.5-flash",
  "output_format": "tag",
  "temperature": 0.3,
  "max_tokens": 1024,
  "quality_tags": "masterpiece, best quality, ultra detailed, highres",
  "negative_default": "worst quality, low quality, ...",
  "system_prompt": "",
  "is_default": true,
  "created_at": "2026-07-20",
  "updated_at": "2026-07-21"
}
```

- `index.json` 维护分组和列表顺序，不塞在 `smart-prompt-config.json` 里

### 4.4 `knowledge.py` — 知识库管理

- 当前 `anima-knowledge.txt` 格式不重构，**新数据追加到 `data/user-knowledge.json`**（双向兼容）
- API：
  - `search(query, limit=20)` — 按关键词检索知识库片段
  - `add_entry(term, tags, context)` — 新增词条到用户知识库
  - `remove_entry(entry_id)` — 删除用户知识库词条
  - `list_entries(page, size)` — 分页浏览知识库
- core 调用 `search()` 时只取 top-N 片段嵌入 system prompt，而非全量嵌入
- 大幅降低 token 消耗的同时提升相关度

### 4.5 `builder.py` — 模板引擎

- 模板文件使用 Markdown + Jinja2 风格变量（不引入 Jinja2 依赖，自制轻量渲染）
- 变量注入：`{{knowledge}}`、`{{quality_tags}}`、`{{negative}}`、`{{custom_rules}}`、`{{lora_protection}}`
- 用户可以在前端直接创建自定义模板，保存到 `templates/custom/`
- `default.md` 模板文件示例：

```markdown
# Role: Anima Prompt Engineer

{{custom_rules}}

## 输出规则

1. 只输出标签，不要输出解释
2. 英文标签，逗号+空格分隔
3. 标签顺序：质量词在前，然后是角色特征、服装、姿势、场景、光影、构图，**LoRA 触发词放最后**
4. 不要重复相同的标签

## 质量词（必须包含）
- `{{quality_tags}}`

## 负向提示词（单独一行，以 [NEG] 开头）
- `{{negative}}`

## LoRA 触发词保护
{{lora_protection}}

## 参考知识库
{{knowledge}}
```

### 4.6 前端整合

- 三个文件合并为 `prompt-module.js`
- 配置化 API 路径：`PromptModule.config({ apiPrefix: '/api/prompt-module' })`
- 提供三个独立组件（可单独挂载也可联合使用）：
  - `PromptModule.Generator(container, opts)` — 生成按钮（替换 `smart-prompt.js`）
  - `PromptModule.PresetManager(container, opts)` — 预设管理浮层（替换 `smart-prompt-manager.js`）
  - `PromptModule.PresetPicker(container, opts)` — 预设选择器（替换 `smart-prompt-picker.js`）
- UI 增强：分组折叠、搜索过滤、标签显示、拖拽排序

### 4.7 后端新 API

| 方法 | 路由 | 说明 |
|---|---|---|
| POST | `/api/prompt-module/generate` | 生成提示词（统一入口） |
| GET | `/api/prompt-module/presets` | 预设列表（含分组信息） |
| POST | `/api/prompt-module/presets` | 新建预设 |
| PUT | `/api/prompt-module/presets/{id}` | 更新预设 |
| DELETE | `/api/prompt-module/presets/{id}` | 删除预设 |
| POST | `/api/prompt-module/presets/{id}/duplicate` | 复制预设 |
| GET | `/api/prompt-module/presets/export` | 导出预设（?tags=写实,二次元） |
| POST | `/api/prompt-module/presets/import` | 导入预设 |
| PUT | `/api/prompt-module/presets/reorder` | 批量更新排序 |
| GET | `/api/prompt-module/knowledge/search?q=xxx` | 搜索知识库 |
| POST | `/api/prompt-module/knowledge/add` | 新增知识条目 |
| DELETE | `/api/prompt-module/knowledge/{id}` | 删除知识条目 |
| GET | `/api/prompt-module/config` | 获取模块配置 |
| POST | `/api/prompt-module/config` | 保存模块配置（如默认预设） |

---

## 五、迁移计划

### 5.1 迁移原则

1. **旧文件保持不动**，新模块并行运行
2. **数据自动迁移**：首次启动时检测旧 `data/smart-prompt-presets/` 目录，自动导入到新 `index.json` 格式
3. **API 双轨制**：旧路由继续可用，新功能只用新路由
4. **验证周期后清理**：新模块稳定运行 1 周后删除旧代码

### 5.2 分步实施

| 阶段 | 内容 | 影响 |
|---|---|---|
| **1. 数据层** | 搭建 `prompt/` 目录结构 + `preset.py` + `knowledge.py` + 数据迁移逻辑 | 无前端变化 |
| **2. 配置层** | `config.py` 统一 provider/API key 解析，替换 `smart_prompt.py` 中的重复代码 | 内部替换，对外透明 |
| **3. 模板层** | `builder.py` + 模板文件，替换 `build_system_prompt()` | 输出验证一致后切换 |
| **4. 核心编排** | `core.py` 串联各模块，新 API 路由注册 | 核心功能可用 |
| **5. 前端整合** | `prompt-module.js` 三合一，分组/搜索/排序 UI | 用户可见的优化 |
| **6. 清理** | 删除旧文件，更新 `CLAUDE.md` 文档 | 无功能变化 |

### 5.3 回滚方案

核心逻辑替换阶段采用 feature flag 控制：

```python
# main.py
USE_NEW_PROMPT_MODULE = os.getenv('USE_NEW_PROMPT_MODULE', '1') == '1'

if USE_NEW_PROMPT_MODULE:
    from prompt import generate as generate_prompt
else:
    from smart_prompt import generate_smart_prompt as generate_prompt
```

---

## 六、预期收益

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 单次生成 system prompt 大小 | 全量知识库（~100KB） | 检索片段（~2-5KB） |
| 预设查找速度 | O(n) 遍历目录 | O(1) 索引查询 |
| 预设数量上限支撑 | ~50（无分组） | ~500（分组筛选） |
| 新增 provider | 改代码+读 API 文档 | 前端直接配置 |
| 迁移环境 | 手动逐条重建预设 | 一键导入导出 |
| 模块可测试性 | 函数耦合难以单测 | 子模块独立可测 |

---

## 七、附录

### A. 旧预设格式 → 新格式迁移脚本逻辑

```python
def migrate_old_presets():
    """首次运行时自动执行"""
    old_dir = Path("data/smart-prompt-presets")
    if not old_dir.exists():
        return

    new_dir = Path("prompt/presets")
    index = {"groups": [], "presets": []}

    for f in sorted(old_dir.glob("*.json")):
        preset = json.loads(f.read_text())
        # 补充新字段
        preset.setdefault("tags", ["迁移"])
        preset.setdefault("sort_order", len(index["presets"]))
        preset.setdefault("updated_at", preset.get("created_at", ""))
        # 写入新目录
        (new_dir / f.name).write_text(json.dumps(preset, indent=2))
        index["presets"].append(preset["id"])

    (new_dir / "index.json").write_text(json.dumps(index, indent=2))
    print(f"已迁移 {len(index['presets'])} 个预设到新格式")
```

### B. 保留的旧 API 兼容说明

| 旧路由 | 状态 | 备注 |
|---|---|---|
| `GET /api/smart-prompt/config` | 保留，转发至新 config | 前端兼容 |
| `POST /api/smart-prompt/config` | 保留，转发至新 config | 前端兼容 |
| `GET /api/smart-prompt/presets` | 保留，从新 preset 模块读取 | 前端兼容 |
| `POST /api/smart-prompt/presets` | 保留，转发至新 preset | 前端兼容 |
| `POST /api/smart-prompt` | 保留，转发至 core.generate() | 前端兼容 |
| `GET /api/smart-prompt/selected-preset` | 保留，从新 index.json 读取 | 前端兼容 |
