# Infinite-Canvas → art-canvas 画布功能复刻文档

> 基于 Infinite-Canvas `2026.06.24` 版本，对比 art-canvas 最新代码，提取画布相关（`smart-canvas.js` / `smart-canvas.css`）的差异。
> **不涉及 `main.py`**，避免影响 ComfyUI 应用和全局 API 配置。
> 生成时间：2026-06-24
> **复刻状态：已完成**（2026-06-24）

---

## 一、改动总览

| 类别 | 改动数 | 涉及文件 |
|------|--------|----------|
| 分辨率映射更新 | 1 | `smart-canvas.js` |
| 循环节点设置 | 1 | `smart-canvas.js` |
| 分组紧凑成员系统 | ~12 处 | `smart-canvas.js` + `smart-canvas.css` |
| 节点状态管理重构 | ~20 处 | `smart-canvas.js` |
| 连线层性能优化 | ~10 处 | `smart-canvas.js` + `smart-canvas.css` |
| 动态参数滚动保持 | 1 | `smart-canvas.js` |
| 日志系统增强 | ~8 处 | `smart-canvas.js` |
| RunningHub API 增强 | ~~5 处~~ ⛔ | ~~main.py~~ 跳过 |
| 灵境 API 提供商 | ~~1~~ ⛔ | ~~main.py~~ 跳过 |

---

## 二、逐项复刻指南

### 2.1 分辨率映射表更新 ⚠️ 高优先级

**文件：** `static/js/smart-canvas.js`
**位置：** 文件顶部 `const SIZE_MAP = { ... }` 和 `RES_LONG_SIDE` / `RES_PIXEL_LIMIT`

**旧值：**
```js
const SIZE_MAP = {
    square: {'1k':'1024x1024','2k':'2048x2048','4k':'4096x4096'},
    landscape: {'1k':'1536x1024','2k':'2048x1360','4k':'3520x2336'},
    portrait: {'1k':'1024x1536','2k':'1360x2048','4k':'2336x3520'},
    landscape43: {'1k':'1024x768','2k':'2048x1536','4k':'3312x2480'},
    portrait43: {'1k':'768x1024','2k':'1536x2048','4k':'2480x3312'},
    wide: {'1k':'1536x864','2k':'2048x1152','4k':'3840x2160'},
    story: {'1k':'864x1536','2k':'1152x2048','4k':'2160x3840'},
    ultrawide: {'1k':'1536x656','2k':'2048x880','4k':'3840x1648'},
    ultratall: {'1k':'656x1536','2k':'880x2048','4k':'1648x3840'}
};
const RES_LONG_SIDE = { '1k':1024, '2k':2048, '4k':3840 };
const RES_PIXEL_LIMIT = { '1k':2359296, '2k':4194304, '4k':8294400 };
```

**新值：**
```js
const SIZE_MAP = {
    square: {'1k':'1024x1024','2k':'2048x2048','4k':'4096x4096'},
    portrait: {'1k':'1024x1536','2k':'1360x2048','4k':'2352x3520'},
    portrait43: {'1k':'1008x1344','2k':'1536x2048','4k':'2448x3264'},
    landscape43: {'1k':'1344x1008','2k':'2048x1536','4k':'3264x2448'},
    landscape: {'1k':'1536x1024','2k':'2048x1360','4k':'3520x2352'},
    story: {'1k':'720x1280','2k':'1152x2048','4k':'2160x3840'},
    wide: {'1k':'1280x720','2k':'2048x1152','4k':'3840x2160'},
    ultrawide: {'1k':'1280x544','2k':'2048x880','4k':'3840x1648'},
    ultratall: {'1k':'544x1280','2k':'880x2048','4k':'1648x3840'}
};
const RES_LONG_SIDE = { '1k':1536, '2k':2048, '4k':3840 };
const RES_PIXEL_LIMIT = { '1k':1572864, '2k':4194304, '4k':8294400 };
```

**关键变化：**
- 比例键顺序调整（portrait 从第二变第一）
- `landscape43` 从 `1024x768` → `1344x1008`
- `portrait43` 从 `768x1024` → `1008x1344`
- `wide` 从 `1536x864` → `1280x720`（现在是 16:9 标准）
- `story` 从 `864x1536` → `720x1280`（现在是 9:16 标准）
- `RES_LONG_SIDE['1k']` 从 `1024` → `1536`
- `RES_PIXEL_LIMIT['1k']` 从 `2359296` → `1572864`

**操作：** 直接替换 art-canvas 中 `static/js/smart-canvas.js` 的对应常量块。

---

### 2.2 循环节点 smartLoopRoundSettings ⚠️ 高优先级

**文件：** `static/js/smart-canvas.js`
**位置：** `isApiLikeEngine` 函数之后，新增一个函数

```js
function smartLoopRoundSettings(runSettings, ctx=smartLoopContext){
    const next = {...(runSettings || {})};
    const imageCountEngine = isApiLikeEngine(next.engine)
        ? next.apiKind !== 'video'
        : next.engine === 'modelscope';
    if(ctx?.nodeId && imageCountEngine){
        next.count = 1;
    }
    return next;
}
```

**作用：** 循环节点内运行时，如果引擎是 API/火山引擎/ModelScope（且非视频模式），自动将 `count` 限制为 1，防止循环内重复生成多图。

**调用点修改：** 需要修改以下两处调用：

1. `runCascadeStepIntoNode` 中：
```js
// 旧
const runSettings = {...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(requestNode) || {})};
// 新
const runSettings = smartLoopRoundSettings({...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(requestNode) || {})}, ctx);
```

2. `runLoopRoundIntoSlot` 中：
```js
// 旧
const runSettings = {...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(rootNode) || {})};
// 新
const runSettings = smartLoopRoundSettings({...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(rootNode) || {})}, ctx);
```

---

### 2.3 分组紧凑成员系统 🟡 中优先级

这是最大的功能变更，涉及分组内的提示词/循环节点以缩略图形式嵌入分组卡片。

#### 2.3.1 新增函数（在 `smartGroupMembers` 之后）

```js
function smartGroupCompactMembers(node){
    return smartGroupMembers(node).filter(member => member?.type === 'smart-prompt' || member?.type === 'smart-loop');
}
function isSmartGroupCompactMember(node){
    return Boolean(node && (node.type === 'smart-prompt' || node.type === 'smart-loop') && smartGroupContainingNode(node.id));
}
```

#### 2.3.2 修改 `smartGroupThumbLayout`

在函数开头加入 compactMembers 计数：
```js
function smartGroupThumbLayout(node){
    const refs = smartGroupImageRefs(node).filter(ref => ref.item?.url);
    if(!refs.length) return null;
    const compactMembers = smartGroupCompactMembers(node);  // 新增
    const count = refs.length + compactMembers.length;       // 修改：refs.length → count
    // ...后续所有 refs.length 引用改为 count
}
```

在所有 return 对象中加入 `compactMembers` 字段，并将 `refs.length` 替换为 `count`。

在 `maxVisibleRows` 计算处：
```js
const maxVisibleRows = compactMembers.length ? count : SMART_GROUP_MAX_VISIBLE_ROWS;
```

#### 2.3.3 修改 `arrangeSmartGroupMembers`

当分组有缩略图时，也对 compactMembers 进行网格排列：
```js
if(hasThumbImages){
    const compactMembers = smartGroupCompactMembers(group);
    if(!options.skipUndo) pushUndo();
    const layout = smartGroupThumbLayout(group);
    if(!layout) return true;
    // ...计算紧凑成员的位置
    const ordered = compactMembers.slice().sort((a, b) => {
        const ra = nodeRect(a), rb = nodeRect(b);
        const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
        if(Math.abs(dy) > 24) return dy;
        return (Number(ra.x) || 0) - (Number(rb.x) || 0);
    });
    ordered.forEach((member, memberIndex) => {
        const index = refs.length + memberIndex;
        const col = index % cols;
        const row = Math.floor(index / cols);
        member.x = Math.round(originX + col * (thumb + gap));
        member.y = Math.round(originY + row * (thumb + gap));
        member.w = thumb;
        member.h = thumb;
        member.scale = 1;
    });
    if(group._memberZoom !== undefined) group._memberZoom = 1;
    if(options.syncDom) syncSmartGroupMemberElements(group);
    return true;
}
```

#### 2.3.4 修改 `promptNodeLayoutSize`

compactMember 时使用显式尺寸：
```js
function promptNodeLayoutSize(node){
    const oldCollapsedH = 230;
    const oldExpandedH = node?.llmSystemEnabled ? 400 : 340;
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    // 新增：紧凑成员使用显式尺寸
    if(isSmartGroupCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
        return {width:Math.round(explicitW), height:Math.round(explicitH)};
    }
    // ...原有逻辑
}
```

#### 2.3.5 修改 `imageLayout` 中的 loop 节点分支

```js
if(node?.type === 'smart-loop'){
    const explicitW = Number(node.w);
    const explicitH = Number(node.h);
    // 新增：紧凑成员使用显式尺寸
    if(isSmartGroupCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
        return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:96, single:true};
    }
    return {cols:1, rows:1, width:Math.round(Number(node.w) || smartLoopWidth(node)), height:Math.round(Math.max(Number(node.h) || 0, smartLoopHeight(node))), thumb:96, single:true};
}
```

#### 2.3.6 修改 `smartGroupBodyHtml`

分组卡片缩略图渲染时考虑 compactMembers：
```js
const totalThumbs = Math.max(1, Number(groupThumbLayout?.rows || 1) * Number(groupThumbLayout?.cols || 1));
if(totalThumbs === 1 && refThumbs.length === 1){
    // 单图渲染
}
const groupMaxVisibleRows = (groupThumbLayout.compactMembers || []).length ? Number(groupThumbLayout.rows || 1) : SMART_GROUP_MAX_VISIBLE_ROWS;
const visibleRows = Math.max(1, Math.min(groupMaxVisibleRows, Number(groupThumbLayout.visibleRows || groupThumbLayout.rows || 1)));
```

#### 2.3.7 修改 `render` 函数

在节点 HTML 中加入 compactMember 类名和拖拽把手：
```js
const isCompactMember = isSmartGroupCompactMember(node);
// ...
const html = `<div class="image-node ... ${isCompactMember ? 'smart-group-member-node' : ''}" ...>
    // ...
    ${isCompactMember && (isPrompt || isLoop) ? '<div class="smart-group-member-grab" title="拖动移出分组"></div>' : ''}
    // ...
</div>`;
```

#### 2.3.8 新增 `syncSmartGroupMemberElements`

```js
function syncSmartGroupMemberElements(group){
    if(!isSmartGroupNode(group)) return;
    smartGroupCompactMembers(group).forEach(member => {
        const el = world.querySelector(`.image-node[data-id="${CSS.escape(member.id)}"]`);
        if(el){
            el.style.left = `${member.x || 0}px`;
            el.style.top = `${member.y || 0}px`;
        }
        updateNodeElementDuringResize(member);
    });
}
```

#### 2.3.9 CSS 新增（`smart-canvas.css`）

```css
.image-node.smart-group-member-node { padding:0; border-radius:12px; overflow:hidden; background:var(--card); border:1px solid rgba(148,163,184,.34); box-shadow:none; backdrop-filter:none; }
.theme-dark .image-node.smart-group-member-node { background:rgba(15,23,42,.42); border-color:rgba(148,163,184,.24); }
.image-node.smart-group-member-node:hover,
.image-node.smart-group-member-node.selected { border-color:var(--strong); box-shadow:0 0 0 1px var(--strong); }
.image-node.smart-group-member-node.prompt-smart-node { border-color:rgba(100,116,139,.42); box-shadow:inset 0 0 0 1px rgba(255,255,255,.42); }
.theme-dark .image-node.smart-group-member-node.prompt-smart-node { border-color:rgba(148,163,184,.34); box-shadow:inset 0 0 0 1px rgba(15,23,42,.56); }
.image-node.smart-group-member-node.prompt-smart-node:hover,
.image-node.smart-group-member-node.prompt-smart-node.selected { border-color:var(--strong); box-shadow:0 0 0 1px var(--strong), inset 0 0 0 1px rgba(255,255,255,.5); }
.image-node.smart-group-member-node .node-body { width:100%; height:100%; padding:0; overflow:hidden; }
.image-node.smart-group-member-node .prompt-node-card,
.image-node.smart-group-member-node .loop-smart-card { width:100%; height:100%; padding:0; gap:0; overflow:hidden; }
.image-node.smart-group-member-node .prompt-node-text { min-height:0; height:100%; border:0; border-radius:0; padding:16px 8px 8px; background:transparent; box-shadow:none; font-size:10px; line-height:1.35; resize:none; pointer-events:auto; cursor:text; }
.smart-group-member-grab { position:absolute; left:0; top:0; right:0; height:13px; z-index:7; cursor:grab; background:rgba(148,163,184,.12); border-bottom:1px solid rgba(148,163,184,.22); pointer-events:auto; }
.smart-group-member-grab:active { cursor:grabbing; }
.smart-group-member-grab::before { content:""; position:absolute; left:50%; top:4px; width:28px; height:3px; border-radius:999px; transform:translateX(-50%); background:rgba(100,116,139,.48); }
.theme-dark .smart-group-member-grab { background:rgba(148,163,184,.12); border-bottom-color:rgba(148,163,184,.2); }
.theme-dark .smart-group-member-grab::before { background:rgba(203,213,225,.46); }
/* 紧凑成员隐藏的元素 */
.image-node.smart-group-member-node .prompt-node-tools,
.image-node.smart-group-member-node .prompt-node-split-row,
.image-node.smart-group-member-node .prompt-node-segments,
.image-node.smart-group-member-node .prompt-split-preview-resize,
.image-node.smart-group-member-node .smart-node-input-thumbs,
.image-node.smart-group-member-node .prompt-node-llm,
.image-node.smart-group-member-node .loop-smart-top,
.image-node.smart-group-member-node .loop-smart-row,
.image-node.smart-group-member-node .loop-smart-panel,
.image-node.smart-group-member-node .loop-smart-footer,
.image-node.smart-group-member-node .floating-node-actions,
.image-node.smart-group-member-node .smart-node-floating-menu,
.image-node.smart-group-member-node .node-port,
.image-node.smart-group-member-node .node-resize-handle,
.image-node.smart-group-member-node .node-hint { display:none !important; }
.image-node.smart-group-member-node .loop-smart-card::before { content:"Loop"; width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:10px; font-weight:900; background:var(--soft); }
```

#### 2.3.10 resize 时对 compactMembers 重排

在 `onmousemove` 的 resize 分支中，图片分组需要调用 `arrangeSmartGroupMembers`：
```js
if(node.type === 'smart-group' && smartGroupImageRefs(node).some(ref => ref.item?.url)){
    node.w = Math.max(minW, Math.round(resizeState.startW + dx));
    node.h = Math.max(minH, Math.round(resizeState.startH + dy));
    if(smartGroupCompactMembers(node).length) arrangeSmartGroupMembers(node, {skipUndo:true, syncDom:true}); // 新增
    updateNodeElementDuringResize(node);
    return;
}
```

#### 2.3.11 thumbDrag 支持分组内图片拖出

```js
// 旧
if(source && (source.images || []).length > 1){
// 新
const canDetachThumb = source && (isSmartGroupNode(source) ? (source.images || []).length >= 1 : (source.images || []).length > 1);
if(canDetachThumb){
    // ...拖出逻辑
    if(isSmartGroupNode(source)){
        arrangeSmartGroupMembers(source, {skipUndo:true, syncDom:true});
    } else if(source.images.length <= 1){
        // ...原有逻辑
    }
}
```

---

### 2.4 节点状态管理重构 🟡 中优先级

新增了一系列节点完成状态管理函数，解决"生成完成但状态未更新"的问题。

#### 2.4.1 新增函数

在 `smartNodeInFlight` 之前或附近添加：

```js
function smartNodeHasDisplayResult(node){
    return Boolean((node?.images || []).some(img => img?.url && !img.loopInputPreview));
}
function smartNodeHasCompletedResult(node){
    if(!smartNodeHasDisplayResult(node)) return false;
    if(node?.runFinishedAt) return true;
    return !node?.jimengPending && !smartPendingTasks(node).length && !Number(node?.pending || 0) && !node?.queued;
}
function liveSmartNode(node){
    if(!node?.id) return node;
    return nodes.find(n => n.id === node.id) || node;
}
function clearSmartNodeBusyState(node){
    if(!node) return node;
    smartNodeRunTokens.delete(node.id);
    node.running = false;
    node.pending = 0;
    node.queued = false;
    delete node.jimengPending;
    delete node.pendingTasks;
    return node;
}
function markSmartNodeComplete(node, meta=null){
    if(!node) return node;
    const keepHidden = node.runTimerHidden === true;
    clearSmartNodeBusyState(node);
    node.runFinishedAt = Number(node.runFinishedAt || 0) || nowMs();
    if(!node.runStartedAt) node.runStartedAt = meta?.createdAt || node.runFinishedAt;
    node.runElapsedMs = Math.max(0, Number(node.runFinishedAt || nowMs()) - Number(node.runStartedAt || node.runFinishedAt));
    node.runTimerHidden = meta?.hideTimer === true || keepHidden;
    return node;
}
function completedDownstreamOutputForNode(sourceNode){
    if(!sourceNode?.id) return null;
    const startedAt = Number(sourceNode.runStartedAt || 0);
    return downstreamImageTargetsFor(sourceNode).find(target => {
        if(!smartNodeHasCompletedResult(target)) return false;
        if(target.sourceNodeId && target.sourceNodeId !== sourceNode.id) return false;
        const finishedAt = Number(target.runFinishedAt || 0);
        return !startedAt || !finishedAt || finishedAt >= startedAt;
    }) || null;
}
function clearSourceBusyStateIfDownstreamDone(sourceNode, options={}){
    if(!sourceNode || !smartNodeInFlight(sourceNode)) return false;
    if(sourceNode.jimengPending || smartPendingTasks(sourceNode).length) return false;
    if(!completedDownstreamOutputForNode(sourceNode)) return false;
    clearSmartNodeBusyState(sourceNode);
    if(!sourceNode.runFinishedAt){
        sourceNode.runFinishedAt = nowMs();
        if(!sourceNode.runStartedAt) sourceNode.runStartedAt = sourceNode.runFinishedAt;
        sourceNode.runElapsedMs = Math.max(0, sourceNode.runFinishedAt - Number(sourceNode.runStartedAt || sourceNode.runFinishedAt));
        sourceNode.runTimerHidden = options.hideTimer === true || sourceNode.runTimerHidden === true;
    }
    return true;
}
function clearCompletedSourceBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(clearSourceBusyStateIfDownstreamDone(node)) changed = true;
    });
    return changed;
}
function hideCompletedRunTimers(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || node.type === 'smart-prompt') return;
        if(node.pending || node.running || node.jimengPending || !node.runFinishedAt || node.runTimerHidden) return;
        node.runTimerHidden = true;
        changed = true;
    });
    return changed;
}
function clearCompletedNodeBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || !smartNodeHasCompletedResult(node) || !smartNodeInFlight(node)) return;
        markSmartNodeComplete(node);
        changed = true;
    });
    if(clearCompletedSourceBusyStates()) changed = true;
    return changed;
}
function completeSmartNodeWithImages(node, images){
    const copy = {...node, images};
    if(smartNodeHasDisplayResult(copy)) markSmartNodeComplete(copy);
    return copy;
}
```

#### 2.4.2 修改 `smartNodeInFlight`

```js
function smartNodeInFlight(node){
    if(smartNodeHasCompletedResult(node)) return false;  // 新增：已完成的节点不算 inFlight
    return Boolean(node && (node.running || node.pending || node.queued || node.jimengPending || smartPendingTasks(node).length));
}
```

#### 2.4.3 修改 `mergeSmartNode`

```js
function mergeSmartNode(local, remote){
    const images = mergeSmartImageLists(local.images, remote.images);
    const localDone = smartNodeHasCompletedResult(local);
    const remoteDone = smartNodeHasCompletedResult(remote);
    const localBusy = smartNodeInFlight(local);
    const remoteBusy = smartNodeInFlight(remote);
    if(localDone && remoteBusy && !remoteDone) return completeSmartNodeWithImages(local, images);
    if(remoteDone && localBusy && !localDone) return completeSmartNodeWithImages(remote, images);
    if(localDone && remoteDone){
        const localFinished = Number(local.runFinishedAt || 0);
        const remoteFinished = Number(remote.runFinishedAt || 0);
        return completeSmartNodeWithImages(remoteFinished >= localFinished ? remote : local, images);
    }
    if(smartNodeInFlight(local)){
        return {...local, images};
    }
    const merged = {...remote, images};
    return smartNodeHasDisplayResult(merged) && (merged.pending || merged.queued || smartPendingTasks(merged).length)
        ? completeSmartNodeWithImages(merged, images)
        : merged;
}
```

#### 2.4.4 修改 `finalizePendingNode`、`replaceOutputsToNodeWithHistory`、`appendOutputsToNode`

所有清状态的代码统一改为调用 `markSmartNodeComplete(node, meta)`，并加入 `node = liveSmartNode(node)` 保证引用最新。

#### 2.4.5 修改 `loadCanvas`

加载画布时对已有结果的节点调用 `markSmartNodeComplete`：
```js
nodes.forEach(n => {
    const pendingTasks = smartPendingTasks(n);
    if(pendingTasks.length){
        n.pending = Math.max(pendingTasks.length, Number(n.pending || 0) || pendingTasks.length);
        n.running = false;
    } else if(smartNodeHasDisplayResult(n)){
        markSmartNodeComplete(n, {hideTimer:true});  // 新增
    } else if(n.pending || n.queued){
        clearSmartNodeBusyState(n);                   // 新增
    }
});
const cleanedCompletedState = clearCompletedNodeBusyStates();    // 新增
const recoveredLoopOutputs = recoverStuckLoopOutputsFromLogs(); // 新增
const hiddenCompletedTimers = hideCompletedRunTimers();          // 新增
```

---

### 2.5 连线层性能优化 🟡 中优先级

#### 2.5.1 新增 `scheduleConnectionLayerRefresh`

用 `requestAnimationFrame` 合并高频刷新：
```js
let connectionLayerRaf = 0;
function scheduleConnectionLayerRefresh(){
    if(connectionLayerRaf) return;
    connectionLayerRaf = requestAnimationFrame(refreshConnectionLayer);
}
```

#### 2.5.2 修改 `refreshConnectionLayer`

```js
function refreshConnectionLayer(){
    connectionLayerRaf = 0;  // 新增：重置 raf id
    const oldSvg = world.querySelector('svg.connection-layer');
    if(!oldSvg) return;
    // ...原有逻辑
}
```

#### 2.5.3 全局替换

将所有 `refreshConnectionLayer()` 调用替换为 `scheduleConnectionLayerRefresh()`，涉及：
- `applyMergedServerCanvas`
- `updateLoopInsertPreview`
- `runLoopRoundIntoSlot` 中的状态更新
- `runSmartCascade` 中的状态更新
- `onmouseup` 中的拖拽结束

#### 2.5.4 连线动画优化

CSS 变更：
```css
/* 旧 */
.connection-layer .conn-pending { stroke-dasharray:5 4; animation:dash 1.5s linear infinite; }
.connection-layer .conn-cascade-active { stroke-dasharray:7 6; animation:dash .85s linear infinite; opacity:1; }
@keyframes dash { to { stroke-dashoffset:-18; } }

/* 新 */
.connection-layer .conn-pending { stroke-dasharray:5 4; animation:dash-flow-pending .9s linear infinite; }
.connection-layer .conn-cascade-active { stroke-dasharray:7 6; animation:dash-flow .9s linear infinite; opacity:1; }
.connection-layer.conn-reduce-motion .conn-pending,
.connection-layer.conn-reduce-motion .conn-cascade-active { animation:none; stroke-dashoffset:0; }
@keyframes dash-flow { to { stroke-dashoffset:-13; } }
@keyframes dash-flow-pending { to { stroke-dashoffset:-9; } }
```

在 `renderConnections` 中加入 reduce-motion 逻辑：
```js
const activeCascadeCount = (smartCascadeRunPath?.states && Object.values(smartCascadeRunPath.states).filter(state => state && state !== 'done').length) || 0;
const reduceMotion = activeCascadeCount > 24;
// ...
return `<svg class="connection-layer ${reduceMotion ? 'conn-reduce-motion' : ''}" ...>`;
```

---

### 2.6 动态参数滚动位置保持 🟢 低优先级

**文件：** `static/js/smart-canvas.js`

#### 2.6.1 新增函数

```js
function dynamicParamsScrollSnapshot(){
    if(!dynamicParams) return null;
    return {
        top:dynamicParams.scrollTop || 0,
        left:dynamicParams.scrollLeft || 0,
        sizePickers:[...dynamicParams.querySelectorAll('.size-picker-control')].map(ctrl => ({
            key:controlTypeKey(ctrl),
            lists:[...ctrl.querySelectorAll('.size-picker-list')].map(list => ({top:list.scrollTop || 0, left:list.scrollLeft || 0}))
        }))
    };
}
function restoreDynamicParamsScroll(snapshot){
    if(!snapshot || !dynamicParams) return;
    const apply = () => {
        dynamicParams.scrollTop = snapshot.top || 0;
        dynamicParams.scrollLeft = snapshot.left || 0;
        const used = new Set();
        (snapshot.sizePickers || []).forEach(item => {
            const pickers = [...dynamicParams.querySelectorAll('.size-picker-control')];
            const index = pickers.findIndex((ctrl, i) => !used.has(i) && (!item.key || controlTypeKey(ctrl) === item.key));
            if(index < 0) return;
            used.add(index);
            const lists = pickers[index].querySelectorAll('.size-picker-list');
            (item.lists || []).forEach((pos, listIndex) => {
                const list = lists[listIndex];
                if(!list) return;
                list.scrollTop = pos.top || 0;
                list.scrollLeft = pos.left || 0;
            });
        });
    };
    apply();
    requestAnimationFrame(apply);
}
```

#### 2.6.2 修改 `renderDynamicParams`

```js
function renderDynamicParams(){
    if(!dynamicParams) return;
    const keepOpen = openControlState();
    const scrollState = dynamicParamsScrollSnapshot();  // 新增
    // ...渲染逻辑
    bindDynamicParams();
    restoreOpenControl(keepOpen);
    restoreDynamicParamsScroll(scrollState);             // 新增
    updatePromptPlaceholder();
    // ...
}
```

---

### 2.7 日志系统增强 🟢 低优先级

#### 2.7.1 `addSmartGenerationLog` 增强

输出项从纯 URL 改为带元数据的对象：
```js
function addSmartGenerationLog({run, outputs=[], runMs=0, error=''}) {
    if(!canvas) return;
    canvas.logs = canvas.logs || [];
    const outputItems = resultMediaUrls(outputs).map(item => {
        if(typeof item === 'string') return {url:item};
        if(!item || typeof item !== 'object') return null;
        const url = item.url || item.path || item.src || item.uri || '';
        if(!url) return null;
        return copyMediaSizeFields(item, {
            url,
            kind:item.kind || item.type || item.mediaKind || '',
            name:item.name || item.filename || ''
        });
    }).filter(item => item?.url);
    const entry = {
        id:uid('log'),
        createdAt:Date.now(),
        status:error ? 'failed' : 'success',
        platform:smartRunPlatformLabel(run),
        nodeId:run?.nodeId || '',          // 新增
        nodeType:run?.nodeType || 'smart-image',
        model:smartRunTaskLabel(run),
        request:smartRunRequestMeta(run),
        prompt:run?.prompt || '',
        outputs:outputItems,               // 改为 outputItems
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        error:error ? String(error) : ''
    };
    canvas.logs = [entry, ...canvas.logs].slice(0, 500);
    if(!error && recoverStuckLoopOutputsFromLogs()) render();  // 新增：尝试恢复卡住的循环输出
    scheduleSave();
}
```

#### 2.7.2 新增日志辅助函数

```js
function smartLogOutputItem(output){
    if(typeof output === 'string') return {url:output};
    if(!output || typeof output !== 'object') return null;
    const url = output.url || output.path || output.src || output.uri || '';
    if(!url) return null;
    return copyMediaSizeFields(output, {
        url,
        kind:output.kind || output.type || output.mediaKind || '',
        name:output.name || output.filename || ''
    });
}
function smartLogSizeSummary(log, outputs=[]){
    const req = log?.request || {};
    const requestLabel = normalizedSizeLabel(req.size || req.resolution || '');
    const actualLabels = [...new Set(outputs.map(imageResolutionLabel).filter(Boolean))];
    if(!actualLabels.length) return '';
    const actualText = actualLabels.slice(0, 3).join(', ');
    const more = actualLabels.length > 3 ? ` +${actualLabels.length - 3}` : '';
    const actualLabel = `${actualText}${more}`;
    if(requestLabel && actualLabels.some(label => label !== requestLabel)){
        return `请求 ${requestLabel} / 实际 ${actualLabel}`;
    }
    return `实际 ${actualLabel}`;
}
```

#### 2.7.3 修改 `renderSmartCanvasLog`

日志渲染时使用 `smartLogOutputItem` 解析输出，并显示尺寸摘要。

---

### 2.8 循环节点默认提示词优化 🟢 低优先级

#### 2.8.1 新增函数

```js
function smartLoopDefaultPromptText(){
    return tr('smart.loopDefaultPrompt') || '现在生成第《计数》张卖点图片';
}
function isSmartLoopDefaultPrompt(text){
    const value = String(text || '').trim();
    if(!value) return false;
    return value === smartLoopDefaultPromptText()
        || value === '现在生成第《计数》张卖点图片'
        || value === 'Generate selling-point image 《计数》';
}
```

#### 2.8.2 修改 `smartLoopPrompt`

当上游有提示词时，不使用本地默认提示词：
```js
const effectiveLocalPrompt = selected && isSmartLoopDefaultPrompt(localPrompt) ? '' : localPrompt;
const combined = [selected, effectiveLocalPrompt].map(text => String(text || '').trim()).filter(Boolean).join('\n\n');
```

#### 2.8.3 修改 `smartLoopInputPromptItems`

统一使用 `promptTextItemsForNode` 收集上游提示词：
```js
function smartLoopInputPromptItems(node){
    if(!node?.showPrompt || smartLoopPromptVisiting.has(node.id)) return [];
    smartLoopPromptVisiting.add(node.id);
    try {
        return inputNodesFor(node)
            .flatMap(input => promptTextItemsForNode(input))
            .map(text => String(text || '').trim())
            .filter(Boolean);
    } finally {
        smartLoopPromptVisiting.delete(node.id);
    }
}
```

---

### 2.9 ~~RunningHub 后端增强~~ ⛔ 跳过

> **不纳入本次复刻。** 灵境 API 提供商和 image_output_meta 会影响全局（在线生图页面等），可能波及 ComfyUI 应用的 API 配置。如需单独处理，建议在独立分支操作。

---

## 三、复刻操作顺序建议

| 步骤 | 内容 | 复杂度 | 预计耗时 |
|------|------|--------|----------|
| 1 | 替换 SIZE_MAP / RES_LONG_SIDE / RES_PIXEL_LIMIT | ⭐ | 5 分钟 |
| 2 | 添加 smartLoopRoundSettings 函数 + 2 处调用修改 | ⭐ | 15 分钟 |
| 3 | 添加节点状态管理函数（markSmartNodeComplete 等） | ⭐⭐ | 30 分钟 |
| 4 | 修改 finalizePendingNode / mergeSmartNode 等引用点 | ⭐⭐ | 30 分钟 |
| 5 | 添加 scheduleConnectionLayerRefresh + 全局替换 | ⭐ | 15 分钟 |
| 6 | 连线 CSS 动画更新 | ⭐ | 5 分钟 |
| 7 | 分组紧凑成员系统（函数 + CSS + 渲染 + 事件） | ⭐⭐⭐ | 1-2 小时 |
| 8 | 动态参数滚动保持 | ⭐ | 10 分钟 |
| 9 | 日志系统增强 | ⭐⭐ | 20 分钟 |
| 10 | 循环节点默认提示词优化 | ⭐ | 10 分钟 |

**总计约 3-4 小时**，建议按步骤顺序执行，每步完成后测试画布基本功能。

---

## 四、安全影响评估

所有 2.1-2.8 的改动均在 `static/js/smart-canvas.js` 和 `static/css/smart-canvas.css` 内，**不影响** `static/app/` 下的 ComfyUI 独立应用页面。共享函数 `resultMediaUrls` 的变更为向后兼容（仅新增提取字段），`cleanHistoryImages` 的过滤条件不影响 ComfyUI 应用历史。
