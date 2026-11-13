# llm —— LLM 节点

对话式文本生成节点：接收上游文本/图片/视频，调用 `/api/canvas-llm`，支持级联输出。

从 `canvas.js` 的「18 · Loop 与 LLM 节点渲染」和「24 · 节点执行与级联」两段原样迁出。
**改这个节点只需要动 `index.js`。**

## 导出

```js
window.LlmNode = {
    type: 'llm',
    title: 'LLM',
    init(next),
    body(node),                  // 渲染（含节点面板与对话面板）
    run(nodeId, opts),           // 执行，opts 支持 {cascade, cascadeTargetId}
    callCanvasLLM(node, message, messages, options), // 供宿主的对话弹窗复用
};
```

`callCanvasLLM` 之所以显式导出，是因为宿主 `runLLMChat`（右上角对话入口）用的也是同一条链路。

## deps

四个状态全部**只读**：

```js
if(window.LlmNode){
    window.LlmNode.init({
        nodes: () => nodes,           // 按 id 找上下游节点
        connections: () => connections, // 找入线
        viewport: () => viewport,      // 面板拖拽时按 scale 换算
        nodesEl: () => nodesEl,        // 拖拽时定位节点 DOM
    });
}
```

## 依赖的宿主函数

| 类别 | 名称 |
|---|---|
| 模型与 Provider | `resolveChatProviderId`、`resolveChatModel`、`providerChatModels`、`chatModelOptions` |
| 输入解析 | `mediaKindForNode`、`isAudioUrl`、`isVideoUrl`、`gamePlanText`、`renderLoopPrompt` |
| 渲染零件 | `escapeHtml`、`tr`、`langIsEn`、`bindScrollableText`、`bindCascadeButtons`、`refreshNodes`、`render`、`scheduleSave` |
| 执行链路 | `cascadeFetch`、`cascadeTargetIdFromOptions`、`responseErrorMessage`、`isCascadeAbortError`、`runLLMChat` |
| 其他 | `copyTextToClipboard`、`alert` |

`bindScrollableText` 与 `gamePlanText` 留在宿主：前者被提示词编辑器等 3 处复用，后者被生成源解析复用。

## 节点字段

| 字段 | 说明 |
|---|---|
| `llmProvider` | chat provider id（`comfly` / `modelscope` …） |
| `model` | 模型名，默认由 `resolveChatModel` 按 provider 推导 |
| `mode` | `node`（节点内运行）/ 其他 |
| `systemPrompt` | 系统提示词 |
| `chatInput` | 输入框内容 |
| `messages` | 多轮对话历史 |
| `outputText` | 已生成的文本 |
| `llmInputHeight` / `llmOutputHeight` | 输入区 / 输出区高度（面板可拖拽调整，存回节点） |
| `running` | 运行中标记 |

## 端口

- **输入**：文本、图片、视频（经 `connections` 回溯上游）
- **输出**：文本，可级联到下游节点

## 宿主里保留了什么

`addLLMNode`（默认字段）、标题、图标 `message-square-text`、尺寸 `{w:420,h:590}`、
`canInput` / `canOutput`、以及右键菜单里的「LLM（参考视图）」入口。

## 校验

```bash
node --check static/nodes/llm/index.js
node scripts/check-nodes.mjs
```
