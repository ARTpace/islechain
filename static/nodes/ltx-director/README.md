# ltx-director · LTX 导演台节点

`type: 'ltxDirector'`，画布上的「LTX Director」。多镜头时间线 + 视频生成。

## 这个目录只管什么

**只管节点壳**：body 渲染、时间线数据与节点字段之间的一次性转换、执行入口。

真正的时间线编辑器（拖拽、缩放、片段增删、波形、多轨）在
`static/js/ltx-director-timeline.js`（4000+ 行），属于独立**域模块**，
被多个节点复用，不在本目录内、也不建议搬进来。两者关系：

```
canvas.js  ──init({nodes})──▶  nodes/ltx-director/index.js
                                      │
                                      ├─ renderLTXDirectorBody(node)
                                      │       └─ window.ltxMountEditor?(node)
                                      ▼
                          static/js/ltx-director-timeline.js
                                  （时间线编辑器本体）
```

## 导出

`window.LtxDirectorNode`

| 字段 | 说明 |
|---|---|
| `type` / `title` | `ltxDirector` / `LTX Director` |
| `init(deps)` | 注入 `{ nodes }`（只读） |
| `body(node)` | 渲染节点主体 |
| `run(nodeId, opts)` | 执行单个节点，`opts.cascade` 时走级联 |
| `ltxSyncConnectedImagesToTimeline(node)` | 上游连线变化时同步图片到时间线，宿主「生成源解析」两处会调 |
| `ltxParseTimeline` / `ltxFlushTimelineToNode` / `ltxRefreshTimelineEditor` / `ltxDirectorTimelineSegments` / `ltxBuildContiguousRelay` / `ltxDirectorBuildTimelinePayload` / `updateLTXNodeElementSize` | 时间线域模块可能反向调用的工具，一并导出防止以后断裂 |

## deps

```js
window.LtxDirectorNode.init({ nodes: () => nodes });
```

只依赖 `nodes` 一个状态，且只读（`run` 里按 id 找节点）。
模块内 `nodes.find(...)` 已改成 `getNodes().find(...)`。

## 节点字段（宿主 `addLTXDirectorNode` 创建时写入）

```js
{
  id: 'ltxdir_xxx', type: 'ltxDirector',
  w: 1000, h: 800,
  globalPrompt: '', durationFrames: 120, durationSeconds: 5, frameRate: 24,
  customWidth: 0, customHeight: 0, displayMode: 'seconds', useCustomAudio: false,
  ltxTimelineData: {...},   // 时间线主体，由 ltx-director-timeline.js 维护
  _ltxEditor: {...},        // 编辑器实例，非持久化
}
```

`ltxMigrateLegacySegments(node)` 会把老的 `segments` 数组升级成 `ltxTimelineData`：
它定义在 `ltx-director-timeline.js`，本模块用 `typeof window.ltxMigrateLegacySegments === 'function'`
做守卫调用——因为 `canvas.html` 里该文件在第 396 行加载、节点模块在 422 行之后，
正常情况下已就绪，守卫只是防顺序被人改动时炸掉。

## 依赖的宿主函数

`tr` / `escapeHtml` / `addNode` / `render` / `scheduleSave` / `refreshRunNodes`
/ `bindCascadeButtons` / `runCanvasGenerate` / `showErrorModal` / `canvasFetch`
等，都是 `canvas.js` 顶层 `function` 声明，classic script 之间互相可见。

## 迁移记录

从 `canvas.js` 的「LTX 导演台：时间线」与「节点执行与级联」两段原样迁出，共 409 行。
迁出时顺手把夹在中间的 **级联执行簇**（`clearStuckGeneratorRunning` … `cascadeFetch`，
172 行）归位到宿主「节点执行与级联」区——它跟 LTX 无关，只是历史追加时插在了这里。
