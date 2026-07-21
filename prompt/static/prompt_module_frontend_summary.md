# 前端整合 — prompt 模块第二阶段

## 改动

**新增文件：** `prompt/static/prompt-module.js`（48KB）

**三文件合一的合并策略：**

| 旧文件 | 源 | 新子模块 |
|---|---|---|
| `static/modules/smart-prompt.js` | ~210 行 | `PromptModule.Generator` |
| `static/app/smart-prompt-manager.js` | ~190 行 | `PromptModule.PresetManager` |
| `static/app/smart-prompt-picker.js` | ~150 行 | `PromptModule.PresetPicker` |
| `static/app/smart-prompt-manager.css` | ~150 行 | 内联合并 |
| `static/app/smart-prompt-picker.css` | ~150 行 | 内联合并 |

**旧文件未删除** — 双轨并行

## 关键设计决策

**1. 可配置 API 前缀：**
```js
// 默认旧路由
PromptModule.config({ apiPrefix: '/api/prompt-module' }); // 切到新后端
```

**2. 向后兼容：**
- 所有旧全局函数通过 `window.spmOpen = () => PresetManager.open()` 保留
- 旧 HTML 模板中的 `onclick="spmOpen()"` 和 `onclick="spPickerOpen()"` 无需修改
- 两个 `Object.defineProperty` 保留 `spPickerPresets` / `spPickerSelectedId`
- CSS class 名全部（spm-shell/sp-picker-shell 等）保留

**3. 新功能：**
- 选择器列表显示预设标签（`tags` 字段）
- 管理浮层保存后自动刷新选择器状态
- 清晰的内聚命名空间，避免全局函数污染
