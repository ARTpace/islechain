# generator —— 图像生成节点

调用图像 API（OpenAI 兼容 / 豆包 / ModelScope / 自定义）出图，是整个画布用得最多的节点。

从 `canvas.js` 的「Generator 与 Video 节点渲染」和「生成源解析与级联执行」两段原样迁出。

## 导出

```js
window.GeneratorNode = {
    type: 'generator',
    title: '图像生成',
    init(next),
    body(node),                  // 315 行渲染
    run(genId, opts),            // 执行，opts 支持 {cascade, cascadeTargetId}
    runLegacy(genId, opts),      // 旧通道，宿主已无调用点，保留备查
};
```

## deps

只读 `nodes`（按 id 找节点）：

```js
if(window.GeneratorNode){
    window.GeneratorNode.init({ nodes: () => nodes });
}
```

## 依赖的宿主函数

| 类别 | 名称 |
|---|---|
| 生成源 | `generatorSources`、`orderedSources`、`imageRefsOnly`、`mediaKindForRef` |
| 模型与尺寸 | `providerImageModels`、`imageModelOptions`、`resolveImageModel`、`resolveImageProviderId`、`sanitizeImageNodeProviderModel`、`defaultApiImageResolution`、`normalizeApiNodeSizeChoice`、`normalizedImageQuality`、`isGptImageAutoSizeModel`、`generatorSizeForRun`、`ratioPartsFromDimensions`、`parseSizeValue` |
| 任务链路 | `createCanvasImageTask`、`pollCanvasImageTask`、`waitCanvasImageTaskResult`、`runCanvasGenerate`、`runSnapshot`、`makePendingForRun`、`pendingById`、`collectRunMetas`、`requestMetaFromResult` |
| 渲染零件 | `renderPromptPreview`、`renderImageInputList`、`bindCascadeButtons`、`showErrorModal`、`tr`、`escapeHtml` |
| 产物 | `outputForNode`、`appendOutputImages`、`mergeGeneratedOutputs`、`addGenerationLog`、`refreshRunNodes` |
| 其他 | `scheduleSave`、`saveCanvas`、`uid`、`nowMs`、`getImageDimensions` |

`renderPromptPreview` / `renderImageInputList` 仍在宿主——msgen 节点也在用（见 `static/nodes/README.md` 第十节）。

## 节点字段

`apiProvider`、`model`、`ratio`、`resolution`、`customRatio` / `customSize` / `customWidth` / `customHeight`、
`inputs`（上游引用）、`prompt`、`runStatus` / `runError` / `running`。

## 端口

- **输入**：提示词文本与图片引用
- **输出**：图片列表

## 校验

```bash
node --check static/nodes/generator/index.js
node scripts/check-nodes.mjs
```
