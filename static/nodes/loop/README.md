# loop —— 循环节点

把上游产物按顺序或批次反复喂给下游，可叠加固定/变量提示词与图片、视频输入。

从 `canvas.js` 的「18 · Loop 与 LLM 节点渲染」原样迁出。**改这个节点的渲染只需要动 `index.js`。**

## 导出

```js
window.LoopNode = {
    type: 'loop',
    title: '循环',
    init(next),   // deps 注入
    body(node),   // 返回节点内容区 DOM
};
```

本节点没有 `run`：执行由宿主的级联引擎（`runNodeCascade` / `computeCascadeOrder`）驱动，
节点自身只负责渲染与参数收集。

## deps

```js
if(window.LoopNode){
    window.LoopNode.init({
        connections: () => connections,
        setConnections: v => { connections = v; },
    });
}
```

**注意这是目前唯一需要「写」状态的节点。** 收起提示词面板或关闭图片输入时，它会剔除
不再合法的入线：

```js
setConnections(getConnections().filter(c => c.to !== node.id || canConnect(c.from, node.id)));
```

写状态必须走 `setConnections`，**不要**写成 `connections = ...`——模块里的 `connections`
是 getter 函数，直接赋值只会覆盖局部变量，宿主状态不会变。规范见 `static/nodes/README.md` 第四节。

## 依赖的宿主函数

| 类别 | 名称 |
|---|---|
| 尺寸自适应 | `autoSizeLoopNode`、`autoSizeLoopForPanels` |
| 连线与级联 | `canConnect`、`computeCascadeOrder`、`findLoopCascadeTarget`、`runNodeCascade`、`isCascadeActive`、`requestCascadeStop` |
| 循环参数 | `loopCount`、`loopEditorText`、`loopVariableHtml`、`insertLoopToken`、`loopInputImageRefs`、`loopInputPromptItems`、`renderLoopPrompt` |
| 输入同步 | `syncGeneratorInputs`、`refreshGeneratorInputViews` |
| 通用 | `render`、`scheduleSave`、`tr`、`trf` |

## 节点字段

| 字段 | 说明 |
|---|---|
| `count` | 循环次数（默认 3） |
| `mode` | `serial`（串行）/ 其他批次模式 |
| `showPrompt` | 是否展开提示词面板（默认 `false`，收起时触发入线清理） |
| `imageInput` / `videoInput` | 是否接受图片 / 视频输入 |
| `loopStart` | 起始序号 |
| `imageBatchSize` / `videoBatchSize` | 每轮取用的图片 / 视频数量 |
| `fixedPrompt` | 每轮都带的固定提示词 |
| `variablePrompt` | 逐轮变化的提示词（配合 `{{index}}` 类 token） |

## 端口

- **输入**：仅当 `imageInput` 或 `showPrompt` 为真时开放（宿主 `canInput` 判断）
- **输出**：始终开放

## 宿主里保留了什么

创建函数 `addLoopNode`、标题 `tr('canvas.loopNode')`、图标 `repeat-2`、尺寸 `{w:336,h:0}`
（高度自适应）、`canInput` / `canOutput` 判断，以及上面那批 loop 专属 helper——
它们被级联引擎和生成源解析复用，暂留宿主，后续「改到就迁」。

## 校验

```bash
node --check static/nodes/loop/index.js
node scripts/check-nodes.mjs
```
