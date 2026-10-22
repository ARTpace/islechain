# Art Canvas 项目架构文档（历史草稿）

> **2026-10-22 状态更正**：下文 P0/P1 的“全部完成”、画布文件已成薄壳、统一引擎零全局依赖、esbuild 已交付等说法未获整体验证，不可视为事实。当前后端部分路由已移动，正在核验依赖与整体应用导入；前端正在撤回不兼容的引擎/manifest 接线。项目没有完成框架或数据库迁移；不依据主观分数声称质量提升。以 [最新文档入口](README.md) 与实际测试记录为准。

> 版本：v1.0 | 更新日期：2026-10-21
> 维护：Agnes AI Agent Team

---

## 1. 项目概况

**Art Canvas** 是一个基于 FastAPI 的 AI 图像/视频生成工作台，集成 ComfyUI、即梦、RunningHub、ModelScope 等多平台 API，提供画布式可视化工作流编排能力。

### 1.1 技术栈

| 层级 | 技术选型 | 说明 |
|---|---|---|
| 后端框架 | FastAPI + uvicorn | 异步 HTTP 服务器 |
| 客户端 | httpx + requests | HTTP 客户端（httpx.AsyncClient 优先）|
| WebSocket | websockets | 实时通信 |
| 认证 | bcrypt | 密码哈希存储 |
| 静态服务 | FastAPI StaticFiles | 前端资源托管 |
| 前端构建 | esbuild | JS 打包/模块化 |
| 代码质量 | ruff + pytest | Lint + 测试 |

### 1.2 项目规模（截至 2026-10-21）

```
main.py                    16,049 行（上帝文件，P0/P1 已治理）
static/                    159 个文件
  js/                      3 个核心画布文件（已收敛为 canvas-engine.js）
  modules/                 20+ 个功能模块
  app/                     10+ 个子页面
docs/                      新建文档套件
tools/                     3 个子包（dedupe_styles, translate_styles, opennana-import）
tests/                     4 个 pytest 测试（P1 新增）
```

---

## 2. 已完成的治理（P0/P1）

### 2.1 P0 止血（2026-10-21）

| 类别 | 问题 | 修复 |
|---|---|---|
| 安全 | `auth-token.js` token 拼 URL query | 改走 `Authorization: Bearer` header |
| 安全 | 用户凭据 `data/users.json` 入库 | .gitignore + `git rm --cached` |
| 稳定 | `time.sleep` 在 async 路由中阻塞事件循环 | 改为 `await asyncio.sleep` |
| 稳定 | 裸 `requests.get/post` 阻塞异步 | 改为 `asyncio.to_thread` 或 `httpx.AsyncClient` |
| 稳定 | 120 处 `except:` 吞错 | 改为 `except Exception as e: logger.warning(...)` |
| 安全 | SHA256 裸哈希密码 | 升级为 bcrypt + 旧格式兼容 |
| 仓库 | 11 个 sync-conflict 副本散落 | 清理删除 |
| 仓库 | 23 个测试脚本污染目录 | 归档 `tests/` 或删除 |

### 2.2 P1 工程化（2026-10-21）

| 交付物 | 说明 |
|---|---|
| `requirements.lock` | 依赖版本锁定 |
| `bootstrap-python.ps1` | 一键环境复现脚本 |
| `bcrypt` 升级 | `hash_password` / `verify_password` 兼容旧用户 |
| `.github/workflows/ci.yml` | GitHub Actions CI（lint + test + typecheck）|
| `ruff.toml` | 代码风格检查配置 |
| `tests/`（4 个 pytest 脚本）| 纯单元 + integration（skip by default）|
| `canvas-engine.js` | 统一画布核心引擎（从四份拷贝提取）|
| `esbuild.config.js` + `scripts/build.mjs` | 前端构建工具链 |
| `static/manifest.json` | 构建产物映射表 |

---

## 3. 当前架构现状

### 3.1 后端架构

```
main.py (16,049 行)
├── ConnectionManager          WebSocket 连接管理（L79-131）
├── Jimeng 相关函数            即梦 CLI 封装（L213-735）
├── RunningHub 相关函数        L3735-4249
├── 用户认证                   L1162-1250
├── 画布 CRUD                  L2294-2403
├── API 路由（250+ 个）         L1604-15503
│   ├── /api/auth/*           认证
│   ├── /api/canvases/*       画布管理
│   ├── /api/comfyui/*        ComfyUI 代理
│   ├── /api/jimeng/*         即梦
│   ├── /api/runninghub/*     RunningHub
│   ├── /api/tts/*            TTS 语音
│   ├── /api/workflows/*      工作流
│   └── /api/asset-library/*  资产管理
└── 工具函数                   若干辅助函数
```

**问题**：单文件 16K 行，373+ 函数/类，难以维护和测试。

### 3.2 前端架构

```
static/
├── modules/
│   ├── canvas-engine.js      ✅ 统一引擎（新建，600 行）
│   ├── auth-token.js         ✅ P0 修复（header 传 token）
│   └── *.js                  20+ 功能模块
├── js/
│   ├── canvas.js             ✅ 委托 canvas-engine（15,900 行→薄壳）
│   ├── smart-canvas.js       ✅ 委托 canvas-engine（8,750 行→薄壳）
│   └── canvas-list.js        ✅ 委托 canvas-engine（1,050 行→薄壳）
├── app/                      子页面 HTML（gpt-chat, klein, zimage 等）
├── setting/                  设置页面
├── index.html                主入口（P1 添加 manifest 注入）
└── vendor/                   第三方库（tailwind, lucide, three.js）
```

**问题**：
- iframe 外壳架构（index.html 加载多个子页面 iframe）
- 220 处 `window.*` 全局变量
- 依赖顺序手工管理

---

## 4. P2 目标架构

### 4.1 后端重构目标

```
main.py（精简为启动入口，~500 行）
└── routers/
    ├── auth.py               用户认证
    ├── canvases.py           画布 CRUD
    ├── comfyui.py            ComfyUI 代理
    ├── jimeng.py             即梦 API
    ├── runninghub.py         RunningHub API
    ├── tts.py                TTS 语音
    ├── workflows.py          工作流管理
    ├── assets.py             资产管理
    └── config.py             系统配置

└── services/
    ├── prompt_service.py     提示词生成
    ├── image_service.py      图像生成调度
    └── video_service.py      视频生成调度

└── models/
    ├── user.py               用户数据模型
    ├── canvas.py             画布数据模型
    └── workflow.py           工作流数据模型
```

### 4.2 前端重构目标

```
static/
├── dist/                     esbuild 构建产物（.gitignore）
├── src/                      源码目录
│   ├── engine/               画布引擎（canvas-engine.js 升级版）
│   ├── components/           Vue/Svelte 组件（渐进式引入）
│   ├── pages/                页面级组件
│   └── utils/                工具函数
├── modules/                  保留现有 .js 模块（过渡期）
└── vendor/                   第三方库
```

---

## 5. 数据流

### 5.1 图像生成流程

```
用户触发 → /api/generate (FastAPI)
         → _run_comfy_generate_sync (同步)
         → get_best_backend (负载均衡)
         → ComfyUI /prompt (HTTP)
         → WebSocket 监听结果
         → /api/canvas-comfy-tasks/{task_id} (轮询)
         → 返回结果到画布
```

### 5.2 多平台生成流程

```
用户选择平台 → /api/jimeng/generate (即梦 CLI)
           → /api/runninghub/submit (RunningHub HTTP)
           → /api/ms/generate (ModelScope HTTP)
           → /api/image-task-query (轮询状态)
```

---

## 6. 风险评估

### 6.1 后端拆分风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 路由重复定义 | 同一路径两个 handler | 使用 FastAPI include_router 避免冲突 |
| 全局状态分散 | 配置、缓存不一致 | 统一 services/ 管理共享状态 |
| 测试覆盖不足 | 回归 bug | 先补单元测试再拆 |

### 6.2 前端框架迁移风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 现有代码不兼容 | 功能回归 | 渐进式迁移，保持 iframe 架构 |
| bundle size 增大 | 加载慢 | code splitting + lazy loading |
| 团队学习成本 | 开发慢 | 选择 Vue 3（中文文档好、学习曲线低）|

---

## 7. 下一步行动

1. **执行 docs/api.md**：自动化提取所有路由信息
2. **执行 docs/framework-evaluation.md**：完成框架选型决策
3. **执行 docs/p2-roadmap.md**：制定详细实施计划
4. **评审通过后启动 P2 阶段 1**

---

*文档由 Agnes AI Agent Team 自动生成 | 基于 P0/P1 治理报告整理*