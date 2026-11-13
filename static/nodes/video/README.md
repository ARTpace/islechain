# video —— 视频生成节点

调用视频生成 API（可灵 / 即梦 / Vidu 等），支持首帧图、参考视频与音频输入。

从 `canvas.js` 的「Generator 与 Video 节点渲染」和「生成源解析与级联执行」两段原样迁出。

## 导出

```js
window.VideoNode = {
    type: 'video',
    title: '视频生成',
    init(next),
    body(node),          // 137 行渲染
    run(nodeId, opts),   // 执行，opts 支持 {cascade, cascadeTargetId}
};
```

## deps

只读 `nodes`：

```js
if(window.VideoNode){
    window.VideoNode.init({ nodes: () => nodes });
}
```

## 依赖的宿主函数

| 类别 | 名称 |
|---|---|
| 生成源 | `generatorSources`、`orderedSources`、`imageRefsOnly`、`videoRefsOnly`、`audioRefsOnly`、`mediaKindForRef` |
| 模型 | `providerVideoModels`、`videoModelOptions`、`resolveVideoProviderId`、`sanitizeVideoNodeProviderModel` |
| 上传与手动视频 | `uploadCanvasVideosToCloud`、`applyUploadedUrlToRefs`、`manualVideoUrlForNode`、`setCanvasManualVideoUrl`、`tempShUploadedUrlForNode`、`outputUrlValue` |
| 任务链路 | `runCanvasGenerate`、`runSnapshot`、`makePendingForRun`、`cascadeFetch`、`cascadeTargetIdFromOptions`、`requestMetaFromResult`、`collectRunMeta`、`resultMediaUrls` |
| 渲染零件 | `renderPromptPreview`、`renderVideoImageInputs`、`bindCascadeButtons`、`showErrorModal`、`tr`、`render` |
| 产物 | `outputForNode`、`appendOutputImages`、`mergeGeneratedOutputs`、`addGenerationLog`、`refreshRunNodes` |
| 其他 | `scheduleSave`、`uid` |

## 节点字段

`videoProvider`、`videoModel`、`ratio`、`resolution`、`duration`、`inputs`、`prompt`、
`manualVideoUrl`、`runStatus` / `runError` / `running`。

## 端口

- **输入**：提示词、首帧图、参考视频、音频
- **输出**：视频列表

## 校验

```bash
node --check static/nodes/video/index.js
node scripts/check-nodes.mjs
```
