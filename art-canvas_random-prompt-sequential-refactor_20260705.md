# art-canvas: random-prompt.js 顺序生成模式链路打通

## 目标
将 `fetchCategoryFromAPI()`、`applyRandomRatio()`、`applyRandomLoras()` 中的手动随机抽样逻辑替换为调用共享的 `sampleFromGroups()`，使每个分组独立的 `mode: 'random' | 'sequential'` 值在所有抽样入口生效。

## 改动

### `random-prompt.js`
1. **`fetchCategoryFromAPI(catKey, cat, planName)`** — 新增第 3 参数 `planName`，内部从手动 shuffle 改为 `sampleFromGroups(cat, planName, catKey)`
2. **`applyRandomRatio(ratios, planName)`** — 新增第 2 参数 `planName`，内部改为 `sampleFromGroups(ratios, planName, 'ratios')`
3. **`applyRandomLoras(loras, planName)`** — 新增第 2 参数 `planName`，内部改为 `sampleFromGroups(loras, planName, 'loras')`

### 调用点更新（共 10 处）
- `applyPlan()` → 3 处：`fetchCategoryFromAPI(name)`, `applyRandomRatio(name)`, `applyRandomLoras(name)`
- `testCurrentPlan()` → 5 处：`fetchCategoryFromAPI(currentPlan.name)`, `sampleFromGroups(currentPlan.name)`, `applyRandomRatio(currentPlan.name)`, `applyRandomLoras(currentPlan.name)`
- `applyAutoRandom()` → 2 处：`fetchCategoryFromAPI(activePlanName)`, `applyRandomRatio(activePlanName)`
- `applyLoras()` → 1 处：`applyRandomLoras(loras, activePlanName)`

## 效果
- 角色/画师/预设/文本/比例/LoRA 六个类别的本地抽样全部统一经 `sampleFromGroups()` 调度
- 每个分组支持独立设置 `mode: 'random' | 'sequential'`
- 顺序状态通过 `sequentialState` 持久化到 `localStorage`
- API 层（`/api/random/apply-plan`）无需任何改动
