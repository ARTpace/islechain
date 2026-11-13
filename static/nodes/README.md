# 画布节点目录规范

一个节点 = 一个目录。节点的定义、渲染、执行、样式、说明都放在**同一个目录**里，
改一个节点只动一个目录，不再跨文件搜索。

```
static/nodes/
  README.md                 ← 本文件
  blender-gen/              ← AI 建模节点
    index.js
    README.md               ← 该节点的字段、端口、依赖、注意事项
```

## 一、为什么新建 nodes/，而不是用 modules/

`static/modules/` 里确实有一批 `*-node.js`（`audio-node.js`、`image-node.js`、`llm-node.js`、
`canvas-all.js`…），**但经核实没有任何页面加载它们**——它们是 `canvas-all.html` 时代的遗留，
`canvas-all.js` 里的 `initXxx(moduleDeps)` 初始化块也从未执行。**不要照抄那批文件。**

`static/modules/` 当前只有 11 个「功能模块」在真实使用（lora-manager、generation-options-panel、
comfyui-* 等），它们不是节点，继续留在原处。

- 节点 → `static/nodes/<node-id>/`
- 功能模块 → `static/modules/*.js`（现状不变）
- 老的单文件节点逻辑 → 仍留在 `static/js/canvas.js`，**改到哪个迁哪个**

## 二、什么时候拆成多个文件

默认 `index.js` 单文件。满足任一条件才拆：

| 条件 | 拆法 |
|---|---|
| 单文件 > 600 行 | `index.js`（注册）/ `body.js`（渲染）/ `run.js`（执行） |
| 需要独立样式文件 | `style.css`，由 index.js 注入或在 html 引 |
| 与后端有专属协议 | 加 `protocol.md` 说明请求/响应 |

`blender-gen` 当前是单文件（约 460 行），未来若继续增长再拆。

## 三、index.js 契约

每个节点文件用 IIFE 包裹，只向 `window` 暴露**一个**对象：

```js
(() => {
    let deps = null;

    // …节点的函数…

    window.XxxNode = {
        type: 'xxxGen',              // 节点 type，全项目唯一，必须与后端 NODE_TYPES 一致
        title: 'XX 节点',
        defaults: () => ({ ... }),   // 新建节点时的字段默认值
        init(next) { deps = next; }, // 由 canvas.js 在启动时注入
        addNode,                     // 创建节点（返回 node）
        body,                        // 渲染：node => HTMLElement
        run,                         // 执行：nodeId => Promise
    };
})();
```

必须导出的最小集合：`type` / `init` / `addNode` / `body` / `run`。

## 四、依赖约定（重要）

canvas.js 的顶层符号分两类，**处理方法不同**：

| 类别 | 例子 | 怎么拿 |
|---|---|---|
| 状态变量（`let` / `const` 声明） | `nodes`、`connections`、`canvas` | **必须走 deps**。let/const 不挂到 window，其他脚本拿不到 |
| 工具函数（`function` 声明） | `addNode`、`render`、`scheduleSave`、`uid`、`escapeHtml`、`defaultPoint`、`generatorSources`、`model3dViewerElement`、`cascadeBtnHtml` | 直接调用，全局可见 |

deps 注入结构（canvas.js 负责提供）：

```js
window.XxxNode.init({
    nodes: () => nodes,
    connections: () => connections,
    canvas: () => canvas,
});
```

用函数而不是直接传值，是因为这三个变量会被整体替换（加载另一张画布），
传值会拿到过期引用。

### 需要「写」状态时：必须再给一个 setter

getter 只能读。如果节点要改状态（比如 loop 收起面板时剔除非法入线），**不能**写成
`connections = connections.filter(...)`——模块里的 `connections` 是函数，这么写只是覆盖
局部变量，宿主状态纹丝不动，而且不会报错。

正确做法是宿主额外注入 setter，节点通过它写：

```js
// canvas.js
window.LoopNode.init({
    connections: () => connections,
    setConnections: v => { connections = v; },
});

// nodes/loop/index.js
function getConnections(){ return deps.connections(); }
function setConnections(next){ deps.setConnections(next); }

setConnections(getConnections().filter(c => c.to !== node.id || canConnect(c.from, node.id)));
```

`check-nodes.mjs` 的「裸状态名」检查能抓到 `connections =` 这种漏网写法。
目前只有 `loop` 需要写状态，其余节点都是只读——**能不写就不写**，写入会让拆分边界重新变糊。

## 五、加载方式

1. `static/canvas.html` 里，节点脚本必须放在 **`canvas.js` 之前**
   （IIFE 先把 `window.XxxNode` 挂上，canvas.js 才能 init）。
2. `canvas.js` 顶部「01 · 文件头」区依次调用 `window.XxxNode.init({...})`。
3. 静态资源带版本戳（`?v=20261104xxx`），改完让浏览器强刷。

## 六、canvas.js 里保留什么

迁移后 canvas.js 只留**与节点无关的通用逻辑**（画布、连线、缩放、保存、级联调度）。
节点相关的类型分支改成查表调用：

```js
if(type === 'blenderGen') return window.BlenderGenNode.addNode(point);
if(node.type === 'blenderGen') return window.BlenderGenNode.run(node.id, opts);
```

仍留在 canvas.js 的类型判断（标题映射、输入口判断、默认尺寸）属于**元信息**，
短期内不强制迁移，但新节点应尽量把这些也放进节点对象（`title` / `ports` / `size`）。

## 七、人设与 skill 的位置

节点目录只管**代码**。AI 人设和 skill 属于数据，不放在这里：

| 内容 | 位置 |
|---|---|
| 人设（角色 prompt） | `core/game_role_presets.py` |
| 人设对应的 skill | `packs/blender-skills/<preset-id>/SKILL.md` |

建模节点的 README 里写清它关联哪些人设、skill 目录在哪，避免两处脱节。

## 八、待迁移清单

| 节点 | 当前所在 | 状态 |
|---|---|---|
| `blenderGen` | 已迁出 | ✅ 已迁到 `nodes/blender-gen/` |
| `model3d` | 已移除 | 旧数据由 `game-model3d.js` 原地迁移至 `gameModelAsset`，不再加载独立节点模块 |
| `msgen` | 已迁出 | ✅ 已迁到 `nodes/msgen/`（441 行，只注入 `nodes` getter） |
| `loop` | 已迁出 | ✅ 已迁到 `nodes/loop/`（235 行，唯一需要写状态的节点） |
| `llm` | 已迁出 | ✅ 已迁到 `nodes/llm/`（289 行，4 个只读 getter） |
| `generator` | 已迁出 | ✅ 已迁到 `nodes/generator/`（488 行，只注入 `nodes`） |
| `video` | 已迁出 | ✅ 已迁到 `nodes/video/`（233 行，只注入 `nodes`） |
| `ltxDirector` | 已迁出 | ✅ 已迁到 `nodes/ltx-director/`（455 行，只注入 `nodes`；时间线编辑器仍在 `js/ltx-director-timeline.js`） |
| `minimax` | 已迁出 | ✅ 已迁到 `nodes/minimax/`（三文件 1047 行：helpers 354 / runninghub 203 / index 490） |
| `gameModelAsset` / `gameModel3d` / `gameAnimate3d` | `game-model3d.js` | ✅ 保持现状，属「域模块」，见第十节 |
| 生成源解析（`generatorSources` 等 8 个函数，非节点） | 已迁出 | ✅ 已迁到 `js/canvas-generation-sources.js`（215 行，6 个 deps getter，导出同时挂 window 以兼容裸调用） |
| `imageGen` / `llm` / `comfy` / `video` / `rh` / `ltxDirector` / `minimax` | `canvas.js` 内嵌 | 按「改到就迁」推进 |

## 九、自检

```bash
node scripts/check-nodes.mjs
```

自动核对五件事：模块导出 `window.XxxNode` 且声明 `type`、`canvas.html` 已加载且位置在 `canvas.js` 之前、
宿主里存在调用点（零调用说明是死模块）、模块行数是否超 600 行阈值、是否残留裸状态名（应走 deps getter）。

单个节点的手工核对：

```bash
node --check static/nodes/<node>/index.js
# canvas.js 里除元信息（标题/图标/canInput/尺寸）外不应再有该节点的实现
grep -n "<node 关键字>" static/js/canvas.js
```

## 十、单节点目录 vs 域模块（重要，别误拆）

「按节点建目录」只适用于**一个节点自成一体**的情况。如果一个文件里的多个节点**共享状态与请求逻辑**，
硬拆会让共享状态必须在模块间传递，反而更难维护。判断标准：

| 特征 | 归属 |
|---|---|
| 一个节点，字段/渲染/执行自成一体（`blenderGen`、`model3d`） | 单节点目录 `nodes/<node>/` |
| 多个节点共享缓存、请求封装、弹窗、轮询（`gameModel3d.js` 的 3 个节点共享 `cache`/`request`/`dialog`/`polling`） | **域模块**，保持一个文件 |

`game-model3d.js` 就是域模块：`gameModelAsset` / `gameModel3d` / `gameAnimate3d` 共用
`cache`、`loading`、`polling`、`localBusy`、`request()`、`dialog()`、`advanced()`、`action()`，
`nodeBody()` 里按 `node.type` 分支。它已经是 IIFE + 显式导出 `window.GameModel3D`，架构上健康，
**不要为了目录整齐把它拆成三个目录**。

域模块的规范：

1. 导出对象必须带 `types`（本模块拥有的节点列表），便于宿主和自检发现
2. `nodeBody(node, target)` 按 `node.type` 分支渲染，不要求每个节点一个函数
3. 超过 600 行时按**职责**拆（`state.js` / `dialogs.js` / `body.js`），不是按节点拆

### 单节点目录内部也可以多文件（minimax 模式）

一个节点自己超过 600 行时，允许在 `nodes/<node>/` 里按**依赖方向**分文件，
`index.js` 仍是唯一入口和唯一导出：

```
nodes/minimax/
  helpers.js     354 行  纯工具，不依赖另外两个 → window.MiniMaxHelpers
  runninghub.js  203 行  依赖 helpers 5 个       → window.MiniMaxRunningHub
  index.js       490 行  UI + body/run，顶层解构 helpers 16 个 + runninghub 1 个
```

三条硬规矩：

1. **依赖必须单向**。拆之前先统计「A 组调用 B 组哪些函数」，双向都超过个位数就别拆，
   改按职责合并（`miniMaxSetPlayheadDom` 这种 DOM 工具和 `miniMaxSelectedSegment` 这种纯函数
   混在一起时，按调用方聚簇，不按名字前缀聚簇）。
2. **加载顺序固定**：底层在前，`index.js` 最后。`index.js` 顶层写
   `const { a, b } = window.XxxHelpers;`，若 helpers 后加载会拿到 `undefined` 并当场抛错。
   `check-nodes.mjs` 会校验 `canvas.html` 里附属文件必须排在 `index.js` 之前。
3. **附属文件不导出 `window.XxxNode`**，导出的是 `window.XxxHelpers` / `window.XxxRunningHub`
   这类内部命名。自检对这些文件同样查裸状态名与 600 行阈值。

### 游戏节点清单只定义一次

`canvas.js` 顶部有 `GAME_NODE_TYPES`（18 项）与 `GAME_NODE_OR_DOC`。这份清单以前在渲染、尺寸、
连线、复制等 8 处各抄一遍，加一个游戏节点要改 8 个地方，漏一处就表现为「节点能建但连不上」。

现在四个域模块各自导出 `types`，`canvas.js` 在 `load` 后做一次对账，不一致时控制台会点名：

```
[游戏节点] 模块已声明但清单未收录：xxx
[游戏节点] 清单里有但无模块认领：xxx
```

（`gameTable` / `gamePlay` 由 workflow 特殊处理，不在任何模块的 `types` 里，对账时已排除。）

## 十一、canvas.js 分区索引

`canvas.js` 还有约一万六千行、八百多个顶层函数，节点迁走之前它仍然是宿主主干。
文件里没有任何模块边界（无 `use strict`、无 IIFE，全部函数挂在全局），所以定位全靠**分区锚点**：

```js
// @section 22 · Rh 生成器：字段、参数与执行
function rhFieldIndexes(...){
```

- 正文搜索 `"@section"` 逐个跳分区，或在编辑器大纲/搜索面板里按编号跳。
- **文件头有一份 `@toc` 目录**，列出 30 个分区的标题与起止行号。这份目录是**生成物**，
  手改会被覆盖；真源是正文里的 `@section` 锚点。
- 动了代码之后重建目录：

```bash
node scripts/canvas-index.mjs --write   # 重建文件头目录
node scripts/canvas-index.mjs           # 只校验，目录与实际行号不一致时报 FAIL
```

校验失败通常意味着「代码挪了位置但没重建目录」，此时目录里的行号已经指错地方——必须重建，
否则下次按目录跳转会落到无关代码上。

新增分区：在合适位置（必须是顶层函数定义之前，不能插进函数体内）加一行
`// @section NN · 标题`，NN 顺延，然后跑 `--write`。锚点顺序错乱或编号不连续时校验会直接失败。

**注意**：写脚本批量改这个文件时，务必用 LF 换行。Windows 上 Python 的 `open(..., 'w')` 会把整个文件
翻成 CRLF，产生一万六千行的伪 diff。

## 十一、设置区控件（`shared/node-controls.js`）

设置区（下拉、数量步进、自定义宽高、开关胶囊、运行按钮）**不要再手写 HTML**，
用 `window.NodeControls` 声明字段。`generator` / `msgen` / `video` 已全部迁移，
新增节点照抄下面这张表即可。

```js
const settingsUi = NodeControls.settings();
let modelUi;
const providerUi = NodeControls.select(node, {
    key: 'apiProvider',
    className: 'provider-select',
    options: providerOptions(node.apiProvider),
    onChange: () => modelUi.setOptions(imageModelOptions(node.model, node.apiProvider))
});
modelUi = NodeControls.select(node, { key: 'model', options: imageModelOptions(node.model, node.apiProvider) });

settingsUi.append(NodeControls.row([providerUi, modelUi]));
settingsUi.append(NodeControls.row([
    NodeControls.numberField({ title: tr('canvas.width'), className: 'custom-w-input', min: 64, step: 64, onInput: v => { node.customWidth = v; scheduleSave(); } })
]));
settingsUi.append(NodeControls.stepper(node, { key: 'count', min: 1, max: 8 }).el);
wrap.appendChild(settingsUi.el);
wrap.appendChild(NodeControls.runBar(node, { icon: 'zap', label: () => tr('canvas.apiGenerate'), onRun: () => runCanvasGenerate(node.id) }).el);
```

| API | 说明 | 返回 |
|---|---|---|
| `settings()` | `.gen-settings` 容器 | `{ el, append, row }` |
| `row(children, opts)` | `.gen-settings-row`，`opts.className` / `opts.hidden` | Element |
| `select(node, opts)` | 下拉。`key` 自动读写 `node[key]`，自带 stopPropagation + scheduleSave；`options` 为 HTML 字符串 | `{ el, sync, setOptions, setDisabled }` |
| `stepper(node, opts)` | 数量步进器。`key` / `min` / `max` | `{ el, sync }` |
| `numberField(opts)` | 带标题的数字输入（纯 UI，不绑字段） | `{ el, input }` |
| `labeled(title, control)` | 给不带标题的控件包 `.field` + `.setting-title` | `{ el, control }` |
| `togglePills(node, specs, opts)` | `.setting-check` 开关胶囊组，`onToggle` 处理互斥，`rerender` 需要整节点重绘时传 | `{ el }` |
| `ghostButton(opts)` | 次要按钮 | `{ el }` |
| `runBar(node, opts)` | 运行按钮行，`icon` / `label` / `runningLabel` / `extra` / `onRun` | `{ el, button, setRunning }` |
| `stop(el)` | 阻止指针事件穿透画布 | — |

约定：

- 控件**只做结构 + 通用绑定**。业务联动（如 `resolution` ↔ `ratio` ↔ 自定义宽高）仍写在节点里，
  通过 handle 的 `sync()` / `setOptions()` / `setDisabled()` 操作，不要再去 `querySelector` 自己绑一遍。
- 控件的 `onChange` 在 `node[key]` 写入**之后**触发，回调里不要再赋值一次。
- `select` 的 `options` 传 HTML 字符串（沿用 `providerOptions()` 等既有生成函数）。
- 新增可复用控件加在这个文件里，而不是复制到某个节点目录。

`shared/` 不是节点目录，不参与「一个节点一个目录」的契约检查（`scripts/check-nodes.mjs` 已豁免）。

## 十二、网页节点（`webapp`）

网页节点不是网页截图，而是画布里**真实运行**的网页。实现在 `static/modules/web-node.js`
（属于画布模块而不是 `nodes/` 节点目录：它没有运行管线，只有渲染与交互）。

数据结构：

| 字段 | 说明 |
| --- | --- |
| `node.webMode` | `'url'` 或 `'html'` |
| `node.webUrl` | 网址内容 |
| `node.webHtml` | 内联 HTML 源码 |
| `node.webTitle` | 自定义标题（`CanvasHost.title()` 也会写这里） |
| `node.outputText` | 网页通过 `CanvasHost.emit(text)` 回写，下游 LLM 可直接读 |

实现要点：

- iframe 常驻 `#webNodeLayer`（`#world` 的子节点），**节点重渲染不会重载网页**；
  位置由 `requestAnimationFrame` 每帧与 `.web-node-slot` 的矩形对齐，拖动/缩放/视口缩放都跟得住。
- 非交互态 `pointer-events:none`，不挡拖拽与连线；右下角胶囊或工具栏鼠标按钮进入交互，
  `Esc` 或点画布空白退出。
- iframe 里的 `window.CanvasHost`：`emit(text)` 写输出、`title(text)` 改标题、`input()` 读上游
  `{text, images}`。上游取自连进来的 `prompt` / `llm` / `webapp` / `image` 节点。
- 连线上游允许 `prompt` / `promptGroup` / `loop` / `llm` / `image` / `group` / `output`，
  下游允许 `llm` / 循环（需开提示词）/ 各生成节点。
- 拖入 `.html` 文件直接建节点；`CanvasWebNode.createFromFile(file, point)` 是同一入口。

复用到别处：`CanvasWebNode.createViewer({ className })` 返回
`{ el, iframe, setContent(mode, content), reload(), unlock(bool), destroy() }`，
任何面板都能塞一个可运行网页，不用再写一遍 iframe 生命周期。
