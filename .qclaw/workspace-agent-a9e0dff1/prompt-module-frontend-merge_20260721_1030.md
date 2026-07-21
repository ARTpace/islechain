# prompt 模块前端整合

## 目标
将分散在 `static/modules/` 和 `static/app/` 的三个独立 JS 文件 + 两个 CSS 文件整合为一个统一前端入口，同时保持旧代码向后兼容。

## 做了什么

### 读取并分析了 5 个文件
- `static/modules/smart-prompt.js` — 生成按钮（IIFE，SmartPrompt.init）
- `static/app/smart-prompt-manager.js` — 预设管理浮层（全局函数）
- `static/app/smart-prompt-picker.js` — 预设选择器（全局函数）
- 两个 CSS 文件

### 合并在一个文件中
`prompt/static/prompt-module.js`（48KB）

### 架构
- 统一 IIFE `PromptModule`
- 三个子模块: `Generator` / `PresetManager` / `PresetPicker`
- 可配置 API 前缀: `PromptModule.config({ apiPrefix: '/api/prompt-module' })`
- CSS 全内联注入，无需额外加载 link 标签

### 向后兼容
所有旧全局函数通过 `window.spmOpen = () => PresetManager.open()` 保留。
预设列表和选中 ID 通过 `Object.defineProperty` 保留动态引用。

### 新功能
- 预设标签显示
- 管理浮层保存后自动刷新选择器状态
- PresetPicker.refresh() 外部可调用

## 结论
旧文件未删除，双轨并行。HTML 模板无需修改即可使用新文件，切换后端路由只需改一行配置。下一步：注册 `/api/prompt-module/*` API 路由到 main.py，然后稳定后清理旧文件。
