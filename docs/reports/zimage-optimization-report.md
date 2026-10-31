# zimage.html 优化分析报告

> 生成时间：2026-07-28
> 分析对象：`static/app/zimage.html`（3651 行）、`main.py`（在线 API 端点）、`static/modules/`（generation-controls.js / reverse-image.js / lora-manager.js）
> 说明：本报告仅分析，未做任何代码改动。

---

## 一、已完成优化回顾（前几轮）

| 轮次 | 内容 | 收益 |
|------|------|------|
| 1 | 合并 `cloudToggleMenu` 到通用 `toggleMenu`，抽 `ICON` 常量 | 菜单逻辑统一 |
| 2 | `cloud` 比例/质量/分辨率改为 `renderDropdown` 动态渲染 | 删除重复 HTML |
| 3 | `local` 比例/分辨率也用 `renderDropdown`；统一 `setDropdownActive` | 下拉完全统一 |
| 模块 | 反推图片拆为 `reverse-image.js` 独立模块（IIFE + `init/open/close`） | 可复用 |
| 进度 | 反推图片进度条由假定时器改为 SSE 真实进度 | 进度真实 |
| 修复 | 顶部按钮（角色/画师/LoRA/负面）显隐改为按 `currentEngine==='local'` 判定 | 各工作流按钮不缺失 |

---

## 二、当前代码态势（实测）

- `zimage.html`：**3651 行**，内嵌 `function` 约 **90 个**
- `fetch(` 调用：**17 处**
- `currentWorkflow.toLowerCase().includes(...)` 硬编码工作流判断：**约 12 处**
- 重复最严重的两段：local 与 cloud 的结果提交逻辑（约 60 行几乎一致）

---

## 三、待优化项详细

### A. 在线 API 生成进度条仍是「假数字」【🔴 推荐 · 低风险 · 修复误导】

**现状证据**
- `zimage.html:2812-2823`（`handleRenderCloud`）：
  ```js
  let _cloudSimTimer = null;
  ...
  const _pctEl = placeholder.querySelector('.card-progress-pct');
  let _simPct = 0;
  _cloudSimTimer = setInterval(function () {
      _simPct = Math.min(95, _simPct + Math.random() * 7 + 2);
      if (_pctEl) { _pctEl.style.visibility = 'visible'; _pctEl.textContent = Math.floor(_simPct) + '%'; }
  }, 600);
  ```
- `main.py:5545` 的 `/api/online-image` 是普通 `POST`，后端**不支持流式进度**，返回完整结果才结束。

**问题**
用户之前明确问过「进度条是真实的吗」，我们当时只改了反推图片，漏了在线生成。在线模式显示假百分比爬升到 95% 会**误导用户以为快好了**，实际上后端可能还在排队/等上游返回。

**改造方案**
由于后端无法提供真实采样进度，正确做法是「诚实的不确定进度」：
```js
// 替换 _cloudSimTimer 假爬升逻辑：
if (typeof CardProgress !== 'undefined') {
    CardProgress.update(placeholder, { status: 'started' });
    setTimeout(() => CardProgress.update(placeholder, { status: 'executing' }), 300);
    // 改成 indeterminate 样式：显示「生成中…」，不显示具体百分比
    const pctEl = placeholder.querySelector('.card-progress-pct');
    if (pctEl) {
        pctEl.style.visibility = 'hidden';
        const label = placeholder.querySelector('.card-progress-label');
        if (label) label.textContent = '生成中…';
    }
}
```
并在 `CardProgress` 模块增加 `indeterminate` 模式（CSS 用无确定宽度的条纹动画）。

**收益**：消除误导，符合用户此前对「真实进度」的关注诉求。
**风险**：低。仅改 cloud 进度展示，不影响生成流程。需确认 `CardProgress` 已有/可加 indeterminate 样式。
**工作量**：S（约 20 行 + 少量 CSS）

---

### B. local / cloud 结果提交逻辑重复约 60 行【🟡 中价值 · 低风险】

**现状证据**
- `zimage.html:2535-2571`（local `handleRender` 成功分支）与 `zimage.html:2860-2893`（`handleRenderCloud` 成功分支）高度重复：
  1. `GalleryList.pushNewImage(record, { _skipRender: true })`
  2. `CardProgress.update(placeholder, { status: 'complete' })`
  3. `GalleryCard.render(...)` + 把 `placeholder` 替换为真实卡片的 DOM 逻辑（约 30 行）
  4. `fetch('/api/history/save', { ...record })`

**改造方案**
抽一个公共函数（建议放在 `zimage.html` 顶部或一个共享模块）：
```js
// 把 placeholder 替换为真实生成卡片，并后台保存历史
function commitGeneratedResult(record, placeholder, opts) {
    opts = opts || {};
    if (window.GalleryList) GalleryList.pushNewImage(record, { _skipRender: true });
    if (typeof CardProgress !== 'undefined') CardProgress.update(placeholder, { status: 'complete' });
    if (placeholder.parentNode && window.GalleryCard && typeof window.GalleryCard.render === 'function') {
        const tempContainer = document.createElement('div');
        window.GalleryCard.render(Object.assign(
            { container: tempContainer, record, isNew: true },
            { eagerFirstImage: true }
        ));
        const tempCard = tempContainer.querySelector('.masonry-item');
        if (tempCard) {
            if (opts.aspectRatio) tempCard.style.aspectRatio = opts.aspectRatio;
            const fullImg = tempCard.querySelector('img');
            if (fullImg && opts.fadeImageSrc) {
                const progress = placeholder.querySelector('.card-progress');
                if (progress) progress.remove();
                placeholder.classList.remove('bg-gray-50', 'border-dashed', 'border-2', 'border-gray-200');
                const parent = placeholder.parentNode, sibling = placeholder.nextSibling;
                parent.insertBefore(tempCard, sibling);
                placeholder.remove();
                if (fullImg.naturalWidth === 0) { /* 透明渐显 fade 逻辑 */ }
            } else {
                const parent = placeholder.parentNode, sibling = placeholder.nextSibling;
                if (parent) { parent.insertBefore(tempCard, sibling); placeholder.remove(); }
            }
        } else { placeholder.remove(); }
    } else { placeholder.remove(); }
    try {
        fetch('/api/history/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
    } catch (e) {}
}
```
- local 调用：`commitGeneratedResult(record, placeholder, { aspectRatio: _aspectRatio, fadeImageSrc: localUrls[0] })`
- cloud 调用：`commitGeneratedResult(record, placeholder, { aspectRatio: _aspectRatio })`

**收益**：删除约 50–60 行重复，两处行为后续统一维护。
**风险**：低。逻辑等价迁移，需逐模式（local/cloud）浏览器验证一次。
**工作量**：S–M

---

### C. API 调用封装 + `featureOf` 映射【🟡 中价值 · 低风险】

**现状证据**
- 17 处 `fetch`，其中 `/api/workflows/${currentWorkflow}` 重复 4 次（`1531` / `2289` / `2337` / `3088`）。
- `record.type` 的三目嵌套在 `2268` 和 `2519` 各写一遍：
  ```js
  // 2268
  const lockedFeatureName = lockedWorkflow.toLowerCase().includes('anima') ? 'anima'
      : lockedWorkflow.toLowerCase().includes('krea2') ? 'krea2'
      : lockedWorkflow.toLowerCase().includes('ideogram4') ? 'ideogram4'
      : lockedWorkflow.toLowerCase().includes('boogu') ? 'boogu' : 'zimage';
  // 2519（record.type 里又重复一次）
  type: lockedFeatureName === 'anima' ? 'anima' : ... : 'zimage',
  ```

**改造方案**
1. 抽请求 helper（页面顶部）：
   ```js
   async function apiGet(path) {
       const r = await fetch(path);
       if (!r.ok) throw new Error('请求失败: ' + path);
       return r.json();
   }
   async function apiPost(path, body) {
       const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
       if (!r.ok) throw new Error('请求失败: ' + path);
       return r.json();
   }
   ```
2. 抽 `featureOf(workflow)` 配置表（消除三目嵌套 + 让 A/B/C 项共用）：
   ```js
   const WORKFLOW_FEATURE = [
       { key: 'anima',      feature: 'anima' },
       { key: 'krea2',      feature: 'krea2' },
       { key: 'ideogram4',  feature: 'ideogram4' },
       { key: 'boogu',      feature: 'boogu' },
   ];
   function featureOf(workflow) {
       const wf = (workflow || '').toLowerCase();
       for (const m of WORKFLOW_FEATURE) if (wf.includes(m.key)) return m.feature;
       return 'zimage';
   }
   function typeOfFeature(feature) { return feature; } // type 与 feature 当前 1:1
   ```
   `2268` 改为 `const lockedFeatureName = featureOf(lockedWorkflow)`；`2519` 改为 `type: lockedFeatureName`。

**收益**：可读性提升，减少魔法字符串，便于后续加工作流只改配置表。
**风险**：低。`featureOf` 需注意 `krea2-turbo` 等子名仍能被 `includes('krea2')` 命中（现有逻辑已依赖此行为，保持一致）。
**工作量**：S

---

### D. 生成核心 `handleRender` 工作流分支数据驱动化【🟠 高价值 · 高风险】

**现状证据**
- `zimage.html:2300-2438`（`handleRender` 内）按工作流名写死 `if/else` 注入不同节点：
  - `anima`：解析角色/画师标签 → 写 `node51/69/19/64` 的输入
  - `krea2`：参考图存在时切换 `image-edit` 工作流、注入 `node13/14`、`krea2-turbo` 特殊处理
  - `ideogram4` / `boogu`：各自专属参数
- 这是当前最大的技术债，新增/修改工作流需改核心函数，易引入回归。

**改造方案（数据驱动）**
把每个工作流的「参数注入 + 工作流选择」抽成策略表：
```js
const WORKFLOW_STRATEGIES = {
    anima: {
        build: (workflow, ctx) => { /* 写 node51/69/19/64 */ },
        selectWorkflow: (ctx) => ctx.currentWorkflow,
    },
    krea2: {
        build: (workflow, ctx) => { /* 注入参考图节点 */ },
        selectWorkflow: async (ctx) => { /* 有参考图返回 image-edit 工作流 */ },
    },
    // ideogram4 / boogu ...
    _default: { build: () => {}, selectWorkflow: (ctx) => ctx.currentWorkflow },
};
```
`handleRender` 改为：解析 `feature = featureOf(currentWorkflow)` → 取 `WORKFLOW_STRATEGIES[feature] || _default` → 调 `selectWorkflow` / `build`。

**收益**：新增工作流只加配置，不碰核心；分支逻辑集中、可单测。
**风险**：高。直接改生成流程，本机无法实跑 ComfyUI 验证，**必须逐工作流（anima/krea2/ideogram4/boogu/zimage）在浏览器实跑确认生成正确**。建议放在所有低风险项之后做。
**工作量**：L

---

### E. 顶部 picker 框架统一【⚪ 可选 · 中风险 · 可能过度】

**现状**
角色 / 画师 / 预设 / 参考图 / LoRA / 额外负面 六个 picker 各有独立 HTML、事件绑定、状态变量、显隐逻辑。

**改造方案**
抽统一 `PickerController({ btnId, panelId, getState, setState, render })`，各 picker 注册实例。

**收益**：理论上去重、统一行为。
**风险/备注**：当前六个 picker 行为差异较大（角色/画师依赖 DB 索引，参考图是文件上传，LoRA 是独立模块），强行统一可能引入复杂度 **高于收益**。建议暂缓，除非后续还要加更多 picker。

---

## 四、推荐实施顺序

| 顺序 | 项 | 理由 |
|------|----|------|
| 1 | **A 在线API假进度** | 修复误导，低风险，呼应你此前的「真实进度」诉求 |
| 2 | **C API封装 + featureOf** | 为 B/D 打基础（featureOf 被多处复用），低风险 |
| 3 | **B 抽 commitGeneratedResult** | 低风险去重，依赖 C 的 featureOf 已就位 |
| 4 | **D 生成核心重构** | 高价值但高风险，留到最后，需你逐工作流验证 |
| 5 | E picker 框架 | 可选，暂缓 |

顺序 1–3 可在一次会话内连续完成且互相不冲突；第 4 项建议单独成轮、逐工作流验证。

---

## 五、验证清单（落地时逐项确认）

- [ ] 在线 API 生成：进度显示为「生成中…」而非假百分比，完成后卡片正常替换
- [ ] 本地 ComfyUI 各工作流（anima/krea2/ideogram4/boogu/zimage）生成与历史保存正常
- [ ] 切换 local/cloud 引擎后顶部按钮显隐正确
- [ ] `featureOf` 对 `krea2-turbo` 等子名判定正确
- [ ] 反推图片进度仍为真实 SSE（不受本次改动影响）
