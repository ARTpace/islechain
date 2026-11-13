# model3d · 3D 模型节点

旧版本的本地模型卡片。**新拖入的模型现在会直接变成「模型资产」（`gameModelAsset`）**，
这个节点只用于兼容老画布里已经存在的卡片。

## 契约

| 项 | 值 |
|---|---|
| type | `model3d` |
| 导出 | `window.Model3dNode` |
| 默认尺寸 | 240 × 300（`size`） |
| 输入 | 有（`canvas.js` 的 `canInput` 含 `model3d`），用于接 PBR 贴图 |
| 输出 | 无 |

## 字段

| 字段 | 说明 |
|---|---|
| `url` | GLB 文件地址，没有时显示材质球 |
| `name` | 显示名 |
| `size` | 字节数，用于显示 `x.xx MiB` |
| `ballGeometry` / `ballRepeat` | 材质球形状与重复 |
| `ballView` | `'ball'` 时强制显示材质球，否则在模型与球之间切换 |
| `spinPaused` | 自动旋转是否暂停（右上角按钮） |

## 两种渲染模式

- **有模型（`url` 存在）** → `model3dViewerElement(node)` 渲染 `<model-viewer>`，可拖拽旋转
- **接入 PBR 贴图且无模型**（或 `ballView='ball'`）→ `CanvasMaterialPreview.block(node)` 渲染材质球

两者都可用右上角按钮暂停/恢复自动旋转；状态存节点字段，重绘后保持。

## 依赖

| 依赖 | 来源 |
|---|---|
| `model3dViewerElement` / `model3dViewerCache` | `canvas.js` 顶部，与建模节点共用 |
| `escapeHtml` / `escapeAttr` / `scheduleSave` / `render` / `addNode` / `uid` / `showErrorModal` | `canvas.js` 全局函数声明 |
| `deps.canvas()` | `init()` 注入的 getter |
| `window.CanvasMaterialPreview` | 材质预览模块 |
| `window.GameModel3D.adoptLocal` | 「纳入资产」按钮 |
| `window.GamePipeline.project` | 判断是否已有项目 |

## 迁移备注

从 `canvas.js` 内嵌的 `renderNode` 分支迁出，原来是一段带 `return el` 的内嵌代码。
现在 `body(node)` 只返回 `node-body` 元素，外层容器和图标刷新由宿主负责：

```js
if(node.type === 'model3d'){
    el.appendChild(window.Model3dNode.body(node));
    if(window.lucide) lucide.createIcons();
    return el;
}
```
