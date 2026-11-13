# minimax · MiniMax H3 多段视频工作台

`type: 'minimax'`，画布上的「MiniMax」。一个节点内完成「多段提示词 + 参考图 → 逐段生成 → 时间线预览」，
支持两种引擎：本地 ComfyUI 工作流、RunningHub 云端工作流。

## 目录内三个文件

| 文件 | 行数 | 内容 | 挂载 |
|---|---|---|---|
| `helpers.js` | 354 | 29 个纯工具：时间线读写、参考图归一、片段选中、JSON 压缩、错误可读化、播放器 HTML…… 不碰 DOM、不发请求、不读画布状态 | `window.MiniMaxHelpers` |
| `runninghub.js` | 203 | 12 个 RunningHub 相关函数：参数映射、节点信息列表、工作流附加项、提交与轮询 | `window.MiniMaxRunningHub` |
| `index.js` | 490 | 工作台 UI（`bindMiniMaxWorkbench` 228 行 + 面板拖拽 45 行）+ `renderMiniMaxBody`(104) + `runMiniMaxNode`(85) | `window.MiniMaxNode` |

**加载顺序固定为 helpers → runninghub → index**，都在 `canvas.js` 之前。
`check-nodes.mjs` 会校验这个顺序：`index.js` 在顶层解构 `window.MiniMaxHelpers`，
若 helpers 后加载会拿到 `undefined` 并在解构时直接抛错。

## 为什么拆三份

单个文件 984 行超过规范阈值（600）。拆之前先量了组间依赖：

| 组 | 行数 | 被谁依赖 | 依赖谁 |
|---|---|---|---|
| helpers | 354 | 另外两个都要 | **不依赖任何人** |
| runninghub | 203 | index | helpers 里 5 个 |
| index | 490 | 无 | helpers 16 个 + runninghub 1 个 |

helpers 是纯叶子、runninghub 是中间层、index 是顶——依赖单向，所以拆得干净。
如果三组互相咬合（像 Rh 生成器的字段/参数/执行三层），就不该拆，见 `../README.md` 第十节。

## deps

```js
window.MiniMaxNode.init({ nodes: () => nodes, viewport: () => viewport });
```

| 状态 | 用途 |
|---|---|
| `nodes` | `runMiniMaxNode` 里按 id 找节点，只读 |
| `viewport` | 拖拽工作台左右分隔条时，把屏幕像素换算成画布坐标（`dx / viewport.scale`），只读 |

## 节点字段（宿主 `addMiniMaxNode` 创建时写入）

```js
{
  id: 'mmx_xxx', type: 'minimax', w: 980, h: 720,
  minimaxEngine: CANVAS_MINIMAX_DEFAULT_ENGINE,   // 'comfy' | 'runninghub'
  workflow: 'video/MiniMax_H3.json',
  minimaxRunningHubWorkflowId: CANVAS_MINIMAX_RUNNINGHUB_WORKFLOW_ID,
  rhPayment: 'free',
  duration: 8, aspectRatio: '16:9', megapixels: 0.4,
  selectedSegmentId: '', playhead: 0,
  segments: [],        // 每段：提示词、时长、结果产物、参考图
  materials: [], inputs: [],
  running: false,
}
```

创建函数 `addMiniMaxNode` 仍在宿主「09 · 节点创建与菜单」区，与其余 8 个节点一致。

## 两种引擎的执行路径

```
runMiniMaxNode(nodeId, opts)
  ├─ engine === 'runninghub' → window.MiniMaxRunningHub.run(node, media, opts)
  │                              └─ /api/runninghub/workflow-submit → 轮询 /api/runninghub/query
  └─ engine === 'comfy'      → 宿主 runCanvasGenerate(...) 走 ComfyUI 工作流
```

级联（`opts.cascade`）由宿主的 `cascadeFetch` / `ensureCascadeActive` 控制，
模块里不自己起 AbortController。

## 依赖的宿主函数

`tr` / `escapeHtml` / `runCanvasGenerate` / `refreshRunNodes` / `bindCascadeButtons`
/ `cascadeFetch` / `cascadeTargetIdFromOptions` / `ensureCascadeActive` / `rhUseWallet`
/ `runningHubEntryLabel` / `resultMediaUrls` / `sleep` / `scheduleSave` / `render` 等。
