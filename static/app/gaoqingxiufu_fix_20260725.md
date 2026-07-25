# gaoqingxiufu.html 修复：收藏 + 对比预览持久化

## 2026-07-25 修复摘要

### 问题 1：收藏按钮点了没反应

**根因：** `favorites.js` 模块（`GalleryDisplay.Favorites`）未在页面中加载。收藏功能通过 `display.js` 配置 `favoritesEnabled: true` 触发初始化，但 `display.js` 的 `init()` 中会检查 `window.GalleryDisplay?.Favorites` 是否存在——由于未加载 `favorites.js`，`Favorites` 为 `undefined`，初始化被跳过。点击收藏按钮只更新了内存中的 `__galleryFavorites` Set，但缺少 `fav:changed` 事件的注册，UI 上星标无任何视觉反馈。

**修复：** 在 `<head>` 的 JS 加载序列中插入 `<script src="/static/modules/gallery/favorites.js?v=20260721">`，位于 `gallery-base.js` 之后、`display.js` 之前，确保 `GalleryDisplay.Favorites` 模块在 `display.js init()` 时已就绪。

### 问题 2：前后对比悬浮层关闭后无法再次打开

**根因：** 生成结果后弹出的 `showCompare(originalSrc, resultSrc)` 是一次性的——`originalSrc` 是 `blob:` URL（上传时通过 `URL.createObjectURL` 创建），`resultSrc` 是 `/output/...` 路径。对比例关闭后没有入口再打开。

**修复方案（3 个步骤）：**

1. **全局缓存对比对** — 新增 `compareCache = new Map()`，以 result URL 为 key 存储 `{ original, result }`，并挂到 `window.__compareCache` 供全局访问
2. **注入「对比原图」按钮** — 在 `getResult()` 中每次生成新图后，调用 `injectCompareBtn(cardEl, originalSrc, resultSrc)` 往缩略图卡片左上角（放大镜按钮旁）插入一个对比图标按钮
3. **`reopenCompare(resultUrl)` 函数** — 从 `__compareCache` 取出比对并重新调用 `showCompare()`

**新增 CSS：**
- `.gallery-compare-btn` — 透明 → hover 显示，与 `gallery-magnify`/`gallery-fav` 等其他悬浮按钮行为一致

### 文件
- 修改：`H:\AI-Tools\art-canvas\static\app\gaoqingxiufu.html`（91764 字节）
- 结构完整：`<div>` 62/62 ✓，`{}` 453/453 ✓，`()` 734/734 ✓
