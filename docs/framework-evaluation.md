# Art Canvas 框架选型评估（候选草案，未决策）

> **2026-10-22 勘误**：下文框架体积、学习难度、迁移周期没有在同功能、同版本和同构建条件下测量，不可直接比较。React 和 Vue 均有中文文档，框架本身不决定 iframe 集成难度；原生 JS 也可实现可测试组件。现阶段优先修复并稳定既有代码，不因文档中的推荐自动引入 Vue、Pinia 或全面重写。正式选型需小范围等价试点与真实测试后另行确认。

> 日期：2026-10-21
> 决策者：Lead + 团队

---

## 1. 评估背景

当前前端技术栈：
- **语言**：原生 JavaScript（无 TypeScript）
- **架构**：iframe 外壳 + 多个子页面
- **模块化**：无构建工具，裸 `<script src>` 标签
- **状态管理**：`window.*` 全局变量（220+ 处）
- **包数量**：159 个静态文件

P1 已完成：
- `canvas-engine.js` 统一核心引擎（导出 ES module）
- esbuild 构建工具链搭建
- manifest.json 自动注入

P2 目标：
- 评估是否引入前端框架
- 若引入，选择哪个框架
- 评估迁移成本和风险

---

## 2. 候选框架对比

| 维度 | Vue 3 | React | Svelte | SolidJS |
|---|---|---|---|---|
| **学习曲线** | ⭐⭐⭐ 低 | ⭐⭐ 中 | ⭐⭐⭐⭐ 极低 | ⭐⭐ 中 |
| **Bundle Size** | ~33KB (gzip) | ~42KB (gzip) | ~1.6KB (核心) | ~11KB (gzip) |
| **TypeScript** | 优秀 | 优秀 | 良好 | 优秀 |
| **中文文档** | ✅ 优秀 | ❌ 英文为主 | ✅ 有 | ❌ 英文 |
| **与 vanilla JS 兼容** | ✅ 渐进式 | ⚠️ 需重构 | ✅ 最平滑 | ⚠️ 需重构 |
| **生态成熟度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **SSR/SEO** | Nuxt 3 | Next.js | SvelteKit | Not SolidStart |
| **团队协作成本** | 低 | 中 | 低 | 中 |

---

## 3. 迁移成本分析

### 3.1 现状复杂度

```
static/
├── js/canvas.js          15,901 行 → 已委托 canvas-engine（预计降至 8,000 行）
├── js/smart-canvas.js    19,163 行 → 已委托 canvas-engine（预计降至 10,000 行）
├── js/canvas-list.js     1,051 行  → 已委托 canvas-engine
├── modules/canvas-all.js 4,675 行  → 已委托 canvas-engine
└── modules/*.js          20+ 文件  → 各 500-2000 行
```

**总代码量估算**：约 40,000+ 行 JS

### 3.2 迁移策略对比

| 策略 | Vue 3 | React | Svelte |
|---|---|---|---|
| **渐进式（推荐）** | 单页面逐步替换 | 风险高 | 最平滑 |
| **保留 iframe** | ✅ 可直接集成 | ⚠️ 复杂 | ✅ 最自然 |
| **canvas-engine 复用** | ✅ 无需改动 | ⚠️ 需包装 | ✅ 无需改动 |
| **预计迁移周期** | 3-4 个月 | 4-6 个月 | 2-3 个月 |

---

## 4. 推荐方案

### 首选：Vue 3 + Composition API

**理由**：
1. **中文文档友好**：团队使用中文，学习成本低
2. **渐进式框架**：可在现有代码基础上逐步引入，无需一次性重写
3. **与 canvas-engine 兼容**：引擎是纯 JS，可直接在 Vue 组件中使用
4. **生态完善**：Pinia（状态）、Vue Router（路由）、Vitest（测试）

**实施路径**：
```
阶段 1：试点（2 周）
  → 用 Vue 3 重写一个子页面（如 settings.html）
  → 验证与现有 canvas-engine 的兼容性

阶段 2：核心页面迁移（4-6 周）
  → 迁移 canvas.html / smart-canvas.html
  → 保留 iframe 架构，Vue 组件作为子模块

阶段 3：全局推广（4-6 周）
  → 剩余页面逐步迁移
  → 移除旧 vanilla JS 代码
```

### 备选：Svelte

**适用场景**：
- 追求最小 bundle size
- 团队愿意接受较新的框架
- 迁移周期更短

**缺点**：
- 中文文档较少
- 生态不如 Vue 3
- 招聘困难（市场 Vue/React 人才更多）

---

## 5. 不建议的方案

### React

**原因**：
- 迁移成本最高（hooks 模式与现有 imperative 代码差异大）
- 学习曲线陡峭（对 vanilla JS 开发者）
- 与 iframe 架构集成复杂

### 纯 vanilla JS + ES module

**优点**：
- 无需引入新框架
- 迁移成本最低

**缺点**：
- 长期维护成本高（无响应式、无组件化）
- 团队扩展性差

---

## 6. 决策建议

| 场景 | 推荐 |
|---|---|
| **快速见效、低风险** | 继续 vanilla JS + esbuild（不做框架迁移）|
| **平衡投入产出** | ✅ **Vue 3 渐进式迁移** |
| **极致性能、小 bundle** | Svelte |
| **已有 React 经验** | React |

---

## 7. 下一步

1. 团队评审本评估文档
2. 确定框架选型（建议 Vue 3）
3. 启动 docs/p2-roadmap.md 制定详细计划
4. P2 阶段 1：Vue 3 试点页面

---

*评估由 Agnes AI Agent Team 完成*