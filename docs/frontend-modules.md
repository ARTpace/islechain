# Art Canvas 前端模块说明（待验证草稿）

> **2026-10-22 更正**：下文“统一引擎完成”“消费文件已成薄壳”“零 window 依赖”“代码行数将减少”等不是验收结果。前期抽取误改了页面状态、加载方式与删除语义，现正恢复既有实现；引擎草稿保留但不作为运行依赖。manifest 构建接入也未交付。请以实际 HTML 脚本引用与 [最新执行规则](README.md) 为准，不据此开始 Vue/SPA 迁移。

> 更新日期：2026-10-21
> 维护：Agnes AI Agent Team

---

## 1. 目录结构

```
static/
├── dist/                       # esbuild 构建产物（.gitignore）
├── manifest.json               # 构建产物映射表（P1 新增）
├── modules/
│   ├── canvas-engine.js        # ✅ 统一画布引擎（新建，600 行）
│   ├── auth-token.js           # ✅ P0 修复：token 走 header
│   ├── settings.js             # 设置模块
│   ├── minimap-nav.js          # 缩略图导航
│   ├── logs-panel.js           # 日志面板
│   ├── audio-node.js           # 音频节点
│   ├── image-node.js           # 图像节点
│   ├── llm-node.js             # LLM 节点
│   ├── video-node.js           # 视频节点
│   ├── loop-node.js            # 循环节点
│   ├── msgen-node.js           # ModelScope 生成节点
│   ├── upload-video-node.js    # 视频上传节点
│   ├── ps-send.js              # Photoshop 发送
│   ├── comfyui-*.js            # ComfyUI 相关节点（8 个）
│   └── gallery/                # 图库模块
├── js/
│   ├── canvas.js               # ✅ 主画布（委托 canvas-engine）
│   ├── smart-canvas.js         # ✅ 智能画布（委托 canvas-engine）
│   └── canvas-list.js          # ✅ 画布列表（委托 canvas-engine）
├── app/                        # 子页面 HTML（约 15 个）
│   ├── zimage.html
│   ├── klein.html
│   ├── angle.html
│   ├── cgstyle.html
│   ├── 2dstyle.html
│   ├── rmbg.html
│   ├── tts.html
│   ├── litevideo.html
│   └── ...
├── setting/                    # 设置页面
│   ├── api-settings.html
│   ├── comfyui-settings.html
│   ├── wildcard-settings.html
│   └── canvas-1.html           # 参考实现
├── css/
│   └── cyberpunk-unified.css   # 主题样式
├── vendor/                     # 第三方库
│   ├── js/
│   │   ├── lucide.min.js       # 图标库
│   │   ├── three.min.js        # 3D 引擎
│   │   └── OrbitControls.js    # 轨道控制器
│   └── css/
│       └── fonts.css
├── index.html                  # 主入口（P1 添加 manifest 注入）
├── login.html                  # 登录页
├── i18n.js                     # 国际化
└── image-preview.js            # 图片预览
```

---

## 2. 核心模块职责

### 2.1 canvas-engine.js（统一画布引擎）

**位置**：`static/modules/canvas-engine.js`

**职责**：提供画布核心数学和渲染逻辑，被四个画布页面委托调用。

**导出接口**：

```javascript
// 视口数学
screenToWorld(clientX, clientY, rect, viewport) → {x, y}
applyViewport(worldEl, viewport, onRenderMinimap)
canvasWheelZoomFactor(event, pageSize) → factor
zoomAtMouse(event, viewport, boardEl, applyViewportFn)

// 节点渲染
defaultNodeSize(type) → {w, h}
estimatedNodeRect(node, nodesEl) → {x, y, w, h}
createBaseNodeEl(node, selected, opts) → HTMLElement
renderNodeHead(node, opts) → string

// 连线渲染
portPoint(nodeId, kind, nodes, nodesEl, screenToWorldFn, boardEl, viewport)
canResolvePort(nodeId, nodes) → boolean
createLinkPath(x1, y1, x2, y2, cls) → SVGPathElement
renderLinks(connections, nodes, nodesEl, linksEl, linkControlsEl, boardEl, viewport, screenToWorldFn, opts)

// 删除操作
deleteNode(id, nodes, connections, selected, callbacks)
clearNodeContentBeforeDelete(id, nodes, callbacks) → boolean
deleteNodeFromButton(id, nodes, connections, selected, callbacks)
deleteConnection(id, connections, callbacks)

// CanvasEngine 类
class CanvasEngine {
  constructor(deps)
  screenToWorld(clientX, clientY)
  applyViewport()
  zoomAtMouse(event)
  createNodeEl(node, opts)
  renderNodeHead(node, opts)
  portPoint(nodeId, kind)
  renderLinks(opts)
  deleteNode(id)
  deleteNodeFromButton(id, clearFn)
  deleteConnection(id, e)
}
```

**依赖**：无（纯数学和 DOM 操作，零 window 全局依赖）

---

### 2.2 canvas.js（主画布）

**位置**：`static/js/canvas.js`

**规模**：原 15,901 行 → 委托后预计 8,000 行

**职责**：经典画布页面的业务逻辑（节点创建、右键菜单、历史记录、生成调度等）

**委托给 canvas-engine**：
- `screenToWorld` → 委托桩
- `applyViewport` → 委托桩
- `defaultNodeSize` → 委托桩
- `estimatedNodeRect` → 委托桩
- `portPoint` → 委托桩
- `canResolvePort` → 委托桩
- `createLinkPath` → 委托桩
- `renderLinks` → 委托桩
- `deleteNode` → 委托桩
- `deleteNodeFromButton` → 委托桩
- `deleteConnection` → 委托桩

**保留的业务逻辑**：
- 节点面板、右键菜单、历史记录
- 生成调度（即梦、RunningHub、ComfyUI）
- 图片编辑、视频编辑
- 节点类型特定渲染（LLM、Loop、MiniMax 等）

---

### 2.3 smart-canvas.js（智能画布）

**位置**：`static/js/smart-canvas.js`

**规模**：原 19,163 行 → 委托后预计 10,000 行

**职责**：智能画布特有逻辑（组节点、历史记录组、AI 辅助编辑等）

**委托给 canvas-engine**：
- `screenToWorld` → 委托桩
- `applyViewport` → 委托桩（含 backdrop-filter 优化）
- `viewportCenter` → 委托桩

**保留的业务逻辑**：
- 智能组节点管理
- 历史节点追踪
- AI 辅助编辑界面
- 工作流分组导出

---

### 2.4 canvas-list.js（画布列表）

**位置**：`static/js/canvas-list.js`

**规模**：1,051 行

**职责**：项目画布列表页（看板视图、拖拽排序、剪切/粘贴、导出 ZIP）

**委托给 canvas-engine**：
- `screenToWorld` → 委托桩
- `applyViewport` → 委托桩（含背景网格样式）

**保留的业务逻辑**：
- 项目列表管理
- 卡片拖拽排序
- 画布导出/导入
- 回收站管理

---

### 2.5 auth-token.js（鉴权）

**位置**：`static/modules/auth-token.js`

**P0 修复内容**：
- 加 `typeof url === 'string'` 守卫
- token 改走 `Authorization: Bearer` header
- 不再拼 URL query

---

## 3. 事件通信机制

### 3.1 postMessage（父子页面通信）

```javascript
// 父页面（index.html）→ iframe 子页面
iframe.contentWindow.postMessage({ type: 'studio-theme', theme }, '*');
iframe.contentWindow.postMessage({ type: 'auth-token', token }, '*');
iframe.contentWindow.postMessage({ type: 'studio-lang', lang }, '*');

// iframe 子页面 → 父页面
parent.postMessage({ type: 'some-event', data }, '*');
```

**用途**：主题同步、鉴权同步、语言切换

### 3.2 BroadcastChannel（同页面多 tab 通信）

```javascript
const apiChannel = new BroadcastChannel('studio-api');
apiChannel.onmessage = (e) => {
  if (e.data?.type === 'providers-changed') loadConfig();
  if (e.data?.type === 'add-image-to-canvas') addImageFromExternal(e.data);
};
apiChannel.postMessage({ type: 'providers-changed' });
```

**用途**：API 设置变更广播、跨画布复制请求

---

## 4. 已知问题

### 4.1 window 全局污染

- **数量**：220+ 处 `window.xxx = ...`
- **影响**：加载顺序即正确性，无法静态分析
- **缓解**：canvas-engine.js 已零 window 依赖

### 4.2 iframe 架构局限

- **问题**：每个 iframe 是独立 JS 世界，需手动同步主题/鉴权/语言
- **影响**：代码重复、同步负担
- **缓解**：P2 可考虑改为 SPA 或 postMessage 总线

### 4.3 依赖顺序手工管理

- **问题**：20+ 个 `<script src>` 标签顺序必须正确
- **影响**：新增模块需手动调整顺序
- **缓解**：P1 已引入 esbuild + manifest，但仍需过渡期

---

## 5. P2 前端重构方向

### 5.1 渐进式迁移（推荐）

```
阶段 1：试点
  → 用 Vue 3 重写 setting/api-settings.html
  → 验证与 canvas-engine.js 的兼容性

阶段 2：核心页面
  → 迁移 canvas.html / smart-canvas.html
  → 保留 iframe 外壳，Vue 组件作为子模块

阶段 3：全局推广
  → 剩余页面逐步迁移
  → 移除旧 vanilla JS 代码
```

### 5.2 框架选型

**推荐**：Vue 3 + Composition API

**理由**：
- 中文文档友好
- 渐进式框架，兼容现有代码
- canvas-engine.js 可直接复用
- 团队学习成本低

**备选**：Svelte（bundle 最小、迁移最简）

---

## 6. 开发规范

### 6.1 新功能开发

1. 数学/渲染逻辑放 `canvas-engine.js`
2. 页面业务逻辑放对应 `js/*.js`
3. 避免直接操作 `window.*`
4. 使用 `escapeHtml` / `escapeAttr` 防 XSS

### 6.2 版本管理

- 文件版本号格式：`YYYYMMDDNNN`（如 `20261021001`）
- 修改后递增序号
- 见 `CLAUDE.md`

---

*文档由 Agnes AI Agent Team 维护*