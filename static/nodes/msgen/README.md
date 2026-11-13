# msgen —— 多段生图节点

ModelScope（魔搭）上的文生图 / 图生图节点，支持 Z-Image、Qwen-Image-Edit 和自定义模型。

从 `canvas.js` 原样迁出，没有改动业务逻辑。**改这个节点只需要动 `index.js`**，不用再翻一万六千行的宿主文件。

## 导出

```js
window.MsGenNode = {
    type: 'msgen',
    title: '多段生图',
    init(next),        // deps 注入，宿主在 canvas.html 加载后立即调用
    body(node),        // 返回节点内容区 DOM（宿主 renderNode 调用）
    run(nodeId, opts), // 执行，opts 支持 {cascade, cascadeTargetId}
};
```

## deps

只用到 `nodes`，且只读（按 id 找节点）：

```js
if(window.MsGenNode){
    window.MsGenNode.init({ nodes: () => nodes });
}
```

`connections` / `canvas` / `selected` 等状态本节点**没有**使用——不要顺手加，需要时再补 getter。

## 依赖的宿主函数与常量

这些都是 `canvas.js` 顶层的 `function` 声明或 `const`，classic script 之间互相可见，直接调用：

| 类别 | 名称 |
|---|---|
| 模型表 | `MS_GEN_MODELS`、`modelscopeImageModels`、`currentMsModelId`、`modelscopeLorasForModel`、`modelscopeImageModelOptions`、`modelscopeLoraOptions` |
| 输入源 | `generatorSources`、`orderedSources`、`imageRefsOnly`、`mediaKindForRef` |
| 渲染零件 | `escapeHtml`、`tr`、`cascadeBtnHtml`、`retryBarHtml`、`bindCascadeButtons`、`renderImageInputList`、`renderPromptPreview`、`showErrorModal`、`getImageDimensions` |
| 执行链路 | `runCanvasGenerate`、`outputForNode`、`runSnapshot`、`makePendingForRun`、`refreshRunNodes`、`appendOutputImages`、`mergeGeneratedOutputs`、`addGenerationLog`、`collectRunMetas`、`requestMetaFromResult`、`cascadeFetch`、`cascadeTargetIdFromOptions`、`responseErrorMessage`、`isCascadeAbortError`、`cascadeTargetIdFromOptions` |
| 尺寸 | `apiImageSize`、`parseSizeValue`、`urlToBase64` |
| 常量 | `CANVAS_REFERENCE_IMAGE_MAX`、`CLIENT_ID` |

## 节点字段

| 字段 | 说明 |
|---|---|
| `msgenModel` | `zimage` / `qwen_edit` / `custom` / 其他魔搭模型 id |
| `msCustomModel` | 自定义模型（`msgenModel === 'custom'` 时） |
| `msResolution` | `1k` / `2k` / `4k` / `custom` |
| `msRatio` | `square` / `portrait` / `landscape` / … / `custom` |
| `msCustomRatio` | 自定义比例 `w:h`，另有 `msCustomRatioWidth` / `Height` |
| `msCustomSize` / `msCustomWidth` / `msCustomHeight` | 自定义像素尺寸 |
| `msLoraId` / `msLoraEnabled` / `msLoraStrength` | LoRA 绑定与强度（0.1–1.0） |
| `count` | 一次生成张数，1–8 |
| `runStatus` / `runError` / `running` | 执行状态，由宿主统一维护 |

## 端口

- **输入**：文本与图片/视频/音频，来自上游 `generatorSources`
- **输出**：图片列表，走 `outputForNode` + `appendOutputImages`

## 宿主里保留了什么

`addMsGenNode`（创建时的默认字段）、标题、图标、`canInput` / `canOutput`、尺寸 `{w:380,h:0}`、
以及 `CANVAS_GENERATOR_TYPES` 等类型清单——按 `static/nodes/README.md` 第六节，这些属于元信息，留在宿主。

## 校验

```bash
node --check static/nodes/msgen/index.js
node scripts/check-nodes.mjs
```
