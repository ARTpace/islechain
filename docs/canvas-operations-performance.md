# 画布操作与性能优化（2026-11-06）

参照工具：`H:\AI-Tools\artflow`。参考了它两份文档——`docs/PureRef功能对齐清单.md`（操作清单）
与 `docs/画布渲染性能优化P2实施记录.md`（性能教训：相机 transform 必须挂在合成层、
纹理预算要分档）。本文记录本批在 art-canvas 落地了什么、为什么这么做、怎么验证的。

本批范围：性能 P1–P6 + 操作 O1–O3。O4（去色/暗化非选中）、O5（导出画布 PNG）、
O6（多选整体缩放）本轮未做。

## 一、性能

| 编号 | 问题（改前） | 做法 | 位置 |
| --- | --- | --- | --- |
| P2 | `applyViewport()` 每帧**同步**调 `renderSelectionHub(true)`，内部读 `offsetWidth` 等布局 → 每次滚轮/mousemove 强制同步布局 | 改为 rAF 合并，每帧最多定位一次 | `canvas.js` `scheduleSelectionHubPosition()` |
| P3 | `renderLinks()` 每帧 `innerHTML=''` 全量重建，每条连线新建 2~3 个 SVG 节点 | 加结构签名（连线集合/选中集合/切点/来源线数）：结构不变只改 `d`，变了才全量重建。几何更新先批量读端点再统一写，避免重排往返 | `canvas.js` `renderLinks()` / `buildLinkElements()` / `updateLinkGeometry()` |
| P4 | `el.style.zIndex = 2 + nodes.indexOf(node)`，全量渲染是 O(n²)；`reusableMediaNodes` 收集也用了 `nodes.find` | 渲染前建一次 `Map<id,index>`，`renderNode(node, paintIndex)` 直接用 | `canvas.js` `render()` / `refreshNodes()` / `renderNode()` |
| P5 | 相机 transform 只有 pan/drag 时才有 `will-change` | transform 改 `translate3d(...)`，相机常驻合成层，平移只移动图层；`applyViewport` 加同值短路，值没变不写样式 | `canvas.js` `applyViewport()` |
| P1 | 节点 DOM 全量常驻，无离屏裁剪 | 自建裁剪：节点 ≥ 60 个时，视口外扩半屏之外的**纯内容节点**从 DOM 摘掉，回到视口再挂回。见下节说明 | `canvas.js` `runNodeCulling()` / `restoreAllCulledNodes()` |
| P6 | 图片固定 512 预览档，放大后糊；换成原图只看「是否选中」 | 清晰度跟缩放走：节点在屏幕上宽度 > 520px 就上原图，每轮限 16 张，缩放手势结束后 260ms 再决定，避免手势中反复换 `src` | `canvas.js` `syncCanvasSelectedImageResolution()` / `scheduleHighResSync()` |

### 为什么 P1 没用 `content-visibility: auto`

一开始想用 CSS 一行解决，但 `content-visibility` 隐含 `contain: paint`。
本项目的端口 `.port.in { left:-29px }` / `.port.out { right:-15px }` 是**伸出节点框**的，
上 `contain: paint` 会把端口裁掉一半，`.node::before` 的圆角底也有影响。
所以改成自己摘 DOM：`portPoint()` 本来就有「没有 DOM 时用节点几何兜底」的分支，
被摘掉的节点连线依然画在正确位置。

裁剪的两个硬性约束：

- 只摘 `image / prompt / llm / document / promptGroup / group`。网页节点、视频、3D、
  生成器带 iframe 或活媒体，重挂会丢播放进度或重新加载 iframe，一律不动。
- 阈值 60：普通画布完全不受影响，行为零变化。

## 二、操作

| 编号 | 操作 | 交互 | 存储 |
| --- | --- | --- | --- |
| O1 | **节点锁定** | `L` 切换选中节点的锁定；锁定后拖不动、框选跳过、删不掉；右上角挂锁徽标 + 虚线边框 | `node.locked`，随画布 JSON 保存（`serializableCanvasNode` 是浅拷贝保留字段） |
| O2 | **层级顺序** | `Alt+]` / `Alt+[` 上移/下移一层；加 `Shift` 直接置顶/置底 | 直接调整 `nodes` 数组顺序（数组顺序即 zIndex），保存后与数据一致 |
| O3 | **节点搜索定位** | `Ctrl+F` 打开搜索，匹配标题/名称/提示词/文本/类型，`↑↓` 选择、`Enter` 定位并选中、`Esc` 关闭；命中节点闪一下高亮 | 无持久化，纯视图 |

搜索匹配字段：`title / name / prompt / text / comment / type`，上限 40 条。

## 三、验证（真机，3840×2160）

用 WebView2 调试端口 + CDP 在真实运行实例上跑：

| 项目 | 结果 |
| --- | --- |
| 新函数就位 | `openNodeFinder` / `toggleSelectedNodeLock` / `moveSelectedNodesLayer` / `runNodeCulling` / `updateLinkGeometry` 全部 `function` |
| 离屏裁剪 | 80 节点的临时画布，移开视口 → `dom=0 culled=80`；移回 → `dom=80 culled=0` |
| 层级 | 置顶后目标节点在数组末尾 ✅ |
| 锁定 | `locked=true`、徽标 class 生效、`deleteSelectedNodes()` 后节点仍在 ✅ |
| 锁定持久化 | 锁定 → 等保存 → 拉后端 JSON 复查 `locked:true`；解锁后复查 `false` ✅ |
| 搜索 | 搜「测试节点 4」命中 11 条（t4 + t40~t49），回车后 `selected=t4`、flash 元素 1 个 ✅ |
| 连线增量 | 连续两次 `renderLinks()` 复用同一 SVG 元素（`reuseEl=true`）；移动节点后 `d` 变化、元素不换 ✅ |
| 连线不重复堆积 | 连续 `renderLinks()` + `applyViewport()`，path 总数 62 → 62 ✅ |
| 多选工具条 | 选 3 个节点后工具条 261×37、8 个按钮正常 ✅ |
| 真实画布回归 | 35 节点 / 27 连线：19 普通 + 8 选中态 + 27 命中层 + 8 流动层，数量与连线一一对应 ✅ |

临时测试画布用完已 `DELETE` + `purge`，未触碰用户画布数据。

## 四、改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `static/js/canvas.js` | P1–P6 全部逻辑；O1–O3 逻辑与快捷键 |
| `static/css/canvas.css` | `.node.locked` 挂锁徽标；`.node-finder` 搜索框；`finderFlash` 高亮动画 |
| `static/canvas.html` | `canvas.css` / `canvas.js` 缓存戳升到 `20261106ops1` |

## 五、还没做 / 已知边界

- O4 观察模式（去色、暗化非选中）、O5 导出画布 PNG、O6 多选整体缩放：本轮未做。
- 裁剪只覆盖半边场景：生成器、网页、视频、3D 节点不裁剪，这类节点很多时收益有限。
- `Alt+]` 在部分键盘布局上用 `e.code === 'BracketRight'` 判断，非 US 布局若无效需改键位。
- 拖动节点时连线仍走增量更新，但 `portPoint` 内部每次 `nodes.find` 是 O(n)，
  连线极多（>200）时还可以再加一个 id→node 的索引。

## 六、追加：编组（任意类型）+ 智能粘贴（2026-11-06 晚）

| 改动 | 说明 | 位置 |
| --- | --- | --- |
| 编组放开类型 | 原 `groupSelectedImages()` 只收 `image/prompt`，现收任意非组、未锁定节点；入组前先从其它组 `items` 摘除，避免双归属；组内统计补「N 个节点」 | `canvas.js` `groupSelectedImages()`、`renderNode()` group 分支 |
| 解组 | `Ctrl+Shift+G` 或工具栏「解组」：删组容器、成员留原地恢复独立、指向组的连线改挂首个 image/prompt 成员、丢弃悬空连线 | `canvas.js` `ungroupSelectedGroups()`、`canvas.html:97` |
| 智能粘贴 | `paste` 扩展为六类分流；输入框内不拦截；新建卡统一一次 `render/save` | `canvas.js` `handleSmartPasteText()` / `handleSmartPasteFiles()` |

粘贴映射：媒体文件 → 原上传管线（含空白图片卡填充）；其它文件 → 可读扩展名走 `file.text()`，二进制记文件名/类型/大小；单/多行 URL → 图片媒体卡或 `webapp(webMode:'url')` 节点；含 `nodes` 的 JSON → `insertWorkflowIntoCanvas()`；其它 JSON → 格式化文本卡；Markdown/纯文本 → `prompt` 卡（带 title）。落点取 `lastMouseBoard`，多卡错开 36px。

边界与约定：非媒体文件只记录文件信息、**不上传资产库**；JSON 工作流分支由 `insertWorkflowIntoCanvas` 自带 `pushUndo`，其余分支各 push 一次；解组不改成员坐标/尺寸/类型；`lastMouseBoard` 初始 `{0,0}` 时回退视口中心，避免贴到世界原点。缓存戳 `20261106paste1`。本批只做 `node --check` 语法验证，未跑浏览器。

## 七、第二批：A1 视口补间 / P8 拖线节流 / A2 保存状态（2026-11-07）

| 编号 | 做法 | 位置 |
| --- | --- | --- |
| A1 | 新增 `animateViewportTo()`（easeOutCubic，240/260ms）与 `cancelViewportTween()`；两个视口跳转函数加可选 `animate`；搜索定位、小地图单击、Z 键进入缩放预览走补间 | `canvas.js` `applyViewport()` 之后、`centerViewportOnWorldPoint()` / `fitAllNodesViewport()` |
| P8 | 两处拖线 `onmousemove` 里的 `renderLinks()` 改 `scheduleLinksRender()`（rAF 合并），松手仍同步重画 | `startSelectionLink()` / `startLink()` |
| A2 | `scheduleSave()` 不再每次写 `Saving...`；改由 `saveCanvas()` 发起请求时延迟 300ms 才提示，`finally` 清 timer，秒存直接写 `Saved` | `scheduleSave()` / `saveCanvas()` |

★ 结构事实：`#links`、`#linkControls`、`#nodes` 都在 `#world` 内（`canvas.html:136-139`），相机 transform 会带着走，**补间期间无需重画连线**，每帧只调 `applyViewport()`（内部已有 minimap / selectionHub / culling 的 rAF 调度）。

交互接管：board 上加了捕获阶段的 `mousedown` / `wheel` 监听取消补间；`exitZoomPreview()` / `exitZoomPreviewToNode()` 开头也取消，防止退出缩放预览时被动画覆盖恢复的视口。遵守已有 `prefers-reduced-motion`（直接跳到目标，不播动画）。缓存戳 `20261107opt1`。

边界：补间只用于一次性跳转，节点拖拽、画布 pan、滚轮缩放、小地图拖动全部保持跟手；视口只在补间结束时 `scheduleViewportSave()`。本批只做 `node --check` 语法验证，未跑浏览器。

## 八、第三批：U1 Ctrl+K 命令面板（2026-11-07）

透明穿透态把 topbar / 工具栏 / 小地图 / selectionHub 全部隐藏，操作入口归零 —— 命令面板是这一态下唯一能触达全部操作的入口。

| 做法 | 位置 |
| --- | --- |
| 命令表 6 组 25 条（视图 / 编辑 / 节点 / 创建 / 文件 / 桌面），全部只调已有画布函数，不复制业务逻辑；支持 label + 分组 + 快捷键提示 + 中文/英文关键词的多词 AND 匹配 | `canvas.js` §28 `COMMANDS` |
| `Ctrl+K` 开关面板；面板打开期间画布其余快捷键（L / Z / Ctrl+G 等）短路，避免输入框打字误触 | `canvas.js` 全局 `keydown` |
| ↑↓ 选择、Enter 执行、Esc 关闭、点击行执行、点面板外关闭；`window.CanvasCommandPalette.register(cmd)` 供后续模块贡献命令 | §28 暴露的 API |
| 面板用 `position:fixed` 挂 `body`，不能挂 `#board`（那里有 `translate3d/scale`，会被相机带着缩放平移） | `canvas.css` `.command-palette` |
| 透明态：`overlayDock` 新增「命令」按钮；`collect()` 把打开的面板矩形并进 `SetWindowRgn`，开关时调 `CanvasOverlay.sync()` 立即刷新区域；`CanvasOverlay.exit()` 暴露给「退出透明穿透模式」命令 | `canvas-overlay-bridge.js` / `canvas-overlay.css` |
| 顺手修死链：dock 的 fit 按钮原来调不存在的 `fitCanvasToNodes`，静默失效；改调 `fitAllNodesViewport(undefined, true)` | `canvas-overlay-bridge.js` `buildDock()` |

★ 关键约束：透明态窗口由 Rust `SetWindowRgn` 裁成「节点 + dock」形状，**任何新增浮层都必须并进 `collect()` 的矩形列表**，否则该位置点击会穿透到桌面其它应用，面板可见但点不到。

缓存戳 `20261107opt1 → 20261107cmd1`（canvas.css / canvas.js 共用）、`20261106clear1 → clear2`（bridge）、`20261106overlay5 → overlay6`（canvas-overlay.css）。本批只做 `node --check` 语法验证，未跑浏览器。「退出透明模式」命令仅在 `CanvasOverlay.enabled` 为真时出现。

## 九、第四批：A3–A5 动效反馈 / U3 Toast / U5 描边减重（2026-11-07）

| 编号 | 做法 | 位置 |
| --- | --- | --- |
| A3 | undo / redo 的变化节点闪 850ms。不碰 `performUndo/Redo`，直接挂在 `canvasHistory.apply()` 上：apply 前取 `nodeSignatureMap()`，render 后比对签名并 `flashChangedNodes()`，一处覆盖两个入口 | `canvas.js:701` `apply`、§反馈层 |
| A4 | 连线松手：成功端口脉冲 + 首次连接 Toast，失败端口红色回弹 + Toast；删除节点留 220ms 轮廓淡出 | `startLink()` / `startSelectionLink()` / `deleteSelectedNodes()` |
| A5 | 所有新动画（Toast / change-flash / ghost / 端口脉冲）都在 `prefers-reduced-motion` 下关闭，JS 侧 `prefersReducedMotion()` 直接跳过 | `canvas.css` 末尾 media |
| U3 | 新增 `window.showToast(text, type, ms)`，最多 3 条、自动淡出。接入保存失败、连线成功/失败、锁定跳过删除、撤销新增节点 | `canvas.js` §反馈层 |
| U5 | `.node.selected` 从「2px outline + 双层 shadow + 4px 外光晕」减成 1.5px 单层描边 | `canvas.css:260` |

★ 两个易踩的坑：
1. `render()` 会**全量重建节点 DOM**，所以连线成功脉冲必须在 render 之后按 `data-id` 重新查端口；拿松手时的 `targetPort` 引用去加类，脉冲会打在已脱离文档的旧元素上，什么也看不到。
2. 删除动效**不改数据时序**：只在 `render()` 之前按 `getBoundingClientRect()` 生成一圈 `position:fixed` 轮廓，数据/连线/选中态仍同步删除，避免异步删除引入竞态。透明态直接跳过 ghost（区域已被裁，也本来不该有花哨动效）。

★ 承接 §八 的硬约束：Toast 也是新增浮层，已并进 `canvas-overlay-bridge.js` 的 `collect()`，且 `showToast()` 创建时立即 `CanvasOverlay.sync()`。

边界：本批**没有全局替换现存 `alert()`**（数量多、散在各生成模块，留待 U3 后续批次）；U2 智能工具栏、U4 主题变量收敛、U6 高 DPI/多显示器属结构性改动，另起一批；P7 `render()` 局部 patch 仍留最后。缓存戳 `20261107cmd1 → 20261107fx1`、bridge `clear2 → clear3`。本批只做 `node --check` 语法验证，未跑浏览器。

## 十、第五批：U2 智能工具栏（2026-11-07）

| 做法 | 位置 |
| --- | --- |
| `.toolbar-items` 内 12 个创建按钮加 `data-tool="create"` + 完整 `title`，分组/解组加 `data-tool="group/ungroup"`；三个原本的裸文本（LLM / ComfyUI / Output）统一包 `<span>` | `canvas.html:83-98` |
| `updateToolbarForSelection(nodeById)` 放在 `render()` 开头、**复用 render 已建好的 id→node Map**，只切一个 `has-selection` class；选中含 group/promptGroup 时才启用「解组」，否则置灰 | `canvas.js` `render()` 之前 |
| 创建按钮折叠成图标（隐藏 span，靠原生 title 识别）；有选中时隐藏整排创建按钮，只留分组/解组；无选中时反之 | `canvas.css` §U2 |

★ 坑：`.toolbar` / `.toolbar-items` 都是 `overflow:hidden`（`canvas.css:137-138`），**绝对定位的 hover 气泡会被裁掉**，所以没做 CSS tooltip，统一用原生 `title`。

选中态下想新建节点的三条路径：点空白取消选中、画布右键创建菜单、Ctrl+K 命令面板。工具栏 `toolbar-fixed` 区（AI 对话 / 资产库 / 工作流 / 日志）始终可见，不受切换影响。缓存戳 `20261107fx1 → 20261107ui1`。本批只做 `node --check` 语法验证，未跑浏览器。

### 本批未动的两项，附诊断

- **U4 主题变量**：不是简单的「选择器写法不统一」。`canvas.html:27-28` 已把 `studio-theme-dark` 与 `theme-dark` 两个类同时加在 `html` 上；`canvas.css:4` 的 `.theme-dark`（权重 0,1,0）定义 `--panel/--card/--line/--text/--strong`，`theme.css:46` 的 `body.studio-theme-dark`（权重 0,1,1）又定义 `--card/--bg/--accent` 等 —— 同名 `--card` 在 body 带类时会被后一套覆盖，节点与面板色值因此不齐。正确收敛是给画布变量加命名空间（如 `--canvas-card`）并改所有引用，波及多个 CSS 文件与明暗两套视觉，**必须跑视觉回归**，不适合在没有实机验证的批次里盲改。
- **U6 高 DPI / 多显示器**：透明态进出的 pan 补偿、多屏 `SetWindowRgn` 坐标、拖动期整屏区域，全部在 Rust `desktop/src-tauri/src/overlay.rs` 与 `desktop_mode.rs`，且需要多显示器实机才能验证。留作独立批次。

P7 `render()` 局部 patch 仍留最后单独一批配完整回归；P9–P14 性能项、上轮遗留 O4–O6 未动。

## 十一、性能第六批：P11 端口索引 / P10 小地图 DOM 池 / P13 流光降载

| 项 | 做法 | 位置 |
| --- | --- | --- |
| P11 | `buildPortIndex()` 一次建 `id → {node, el, out/in port}` 三张 Map；`portPoint(id, kind, idx)` / `canResolvePort(id, idx)` 加**可选**索引参数，帧内复用，零散单条调用（连线删除按钮、切点等）不传索引仍走原路径 | `canvas.js` `buildPortIndex` / `renderLinks`→`buildLinkElements` / `updateLinkGeometry` |
| P10 | 小地图不再每帧 `innerHTML` 重建 N 个 div + viewport + 重查 `getElementById`：viewport / EMPTY 常驻，节点 div 用 DOM 池只扩容、每帧只写 `style` 与 `selected` class | `canvas.js` `ensureMinimapLayer()` / `renderMinimap()` |
| P13 | 去掉 `.link-flow` 的 `filter:drop-shadow`（每条流光线多一个滤镜合成层），改由 3.2px 描边承担辨识度；`flowBudget=12`，多选大量连线时只给前 12 条挂 infinite 动画 | `canvas-media.css:147` / `canvas.js` `buildLinkElements` |

设计约束：P11 索引**只在同步渲染函数内有效、不跨帧缓存** —— `render()` 会全量重建节点 DOM，跨帧缓存必然指向已销毁元素；离屏裁剪摘掉 DOM 的节点在索引里查不到，仍走原有几何坐标兜底，行为不变。`updateLinkGeometry()` 里 `entry.flow` 允许为 null（超出预算时），已用可选链，无需改动。

★ 坑：`canvas-media.css` 在 `canvas.html:44` 用的是**独立缓存戳** `20261103cutfollow1`，不随统一戳 `20261107ui1` 更新。只改 CSS 不升这个戳，P13 完全不生效。本批统一戳 `20261107ui1 → 20261107perf1`，并单独把 `canvas-media.css` 的戳也升到 `20261107perf1`。

本批只做 `node --check` 语法验证，未跑浏览器。P9（delta undo，要重构 `canvasHistory.apply()`，与 §九 A3 反馈耦合）、P12（iframe/活媒体裁剪，会碰播放状态）、P14（差量保存，要动后端 API）仍留独立批次；P7 最后单独一批配完整回归。
