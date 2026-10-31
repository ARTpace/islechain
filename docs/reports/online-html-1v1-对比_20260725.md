# 在线生图页 1:1 对比：art-canvas vs Infinite-Canvas

> 两个项目的 `static/online.html` 直接对比

---

## 一、宏观对比

| 维度 | **art-canvas `static/online.html`** | **Infinite-Canvas `static/online.html`** |
|------|:---|:---|
| **页面代码量** | 1441 行（CSS+HTML+JS 混编） | 761 行（精简） |
| **版本号（CSS/JS）** | 20260520 / 20260528（早期） | 20260715+（新） |
| **页面标题** | "在线生图 / GPT / NANO BANANA IMAGE STUDIO" | "在线生图 / GPT / NANO BANANA IMAGE STUDIO" |
| **布局结构** | 左右分栏 (lg:col-span-5 + 7) + 下方独立 Archives | 左右分栏 (lg:col-span-5 + 7) + 下方独立 Archives |
| **画布尺寸** | `min-h-[500px] lg:h-full` | `min-h-[500px] lg:h-full` |
| **色彩主题** | 青色 `#00b4d8` 为主，紫色辅 | 青色 `#00b4d8` 为主，紫色辅 |
| **i18n** | ❌ | ✅ |

## 二、同位置功能对照表

| 模块 | art-canvas | Infinite-Canvas | 谁更全？ |
|:----|:----------|:---------------|:-------:|
| **标题区** | "在线生图" + "GPT / NANO BANANA IMAGE STUDIO" | "在线生图" + "GPT / NANO BANANA IMAGE STUDIO" | ⏺ 平 |
| **顶部导航** | CREATE 链接 | CREATE 链接 | ⏺ 平 |
| **PROMPT 区** | 5 行 textarea + 2 个 quick prompt (正面全身/角色三视图) | 5 行 textarea + 2 个 quick prompt (正面全身/角色三视图) | ⏺ 平 |
| **预设按钮 (✦)** | ✅ togglePresetPanel() | ✅ togglePresetPanel() | ⏺ 平 |
| **参考图 3 槽** | ✅ Main/Aux A/Aux B | ✅ Main/Aux A/Aux B | ⏺ 平 |
| **资产库选择按钮** | ✅ 右上角"从资产库选择" | ✅ 右上角"从资产库选择" | ⏺ 平 |
| **Provider 按钮** | ✅ 自定义下拉 + chevron + refresh 按钮 | ✅ 自定义下拉 + chevron + refresh 按钮 | ⏺ 平 |
| **Provider 数据源** | /api/providers 动态 | /api/providers 动态 | ⏺ 平 |
| **Model 按钮** | ✅ 自定义下拉 + 协议徽标 | ✅ 自定义下拉 + 协议徽标 | ⏺ 平 |
| **协议徽标显示** | OPENAI / RUNNINGHUB / etc. | OPENAI / RUNNINGHUB / etc. | ⏺ 平 |
| **Ratio 选择** | ✅ 5 个 pill (1:1/2:3/3:2/9:16/16:9) | ✅ 5 个 pill (1:1/2:3/3:2/9:16/16:9) | ⏺ 平 |
| **Resolution 切换** | ✅ 1K/2K pill | ✅ 1K/2K pill | ⏺ 平 |
| **Batch 选择** | ✅ 1/2/3/4 pill | ✅ 1/2/3/4 pill | ⏺ 平 |
| **Generate 按钮** | ⚡ + "GENERATE" 黑底玻璃按钮 | ⚡ + "GENERATE" 黑底玻璃按钮 | ⏺ 平 |
| **结果画布** | ✅ 含 loader 动画 + progress ring + 下载按钮 | ✅ 含 loader 动画 + progress ring + 下载按钮 | ⏺ 平 |
| **Loader 动画** | 金字塔 loader + 进度环 + 进度文字 | 金字塔 loader + 进度环 + 进度文字 | ⏺ 平 |
| **Output 图片** | ✅ + zoomImage() | ✅ + zoomImage() | ⏺ 平 |
| **下载按钮** | ✅ 右上角玻璃按钮 | ✅ 右上角玻璃按钮 | ⏺ 平 |
| **Archives 画廊** | ✅ grid 2/4 列 + Load More | ✅ grid 2/4 列 + Load More | ⏺ 平 |
| **Lightbox** | ✅ prev/next + 下载 + 分辨率 | ✅ prev/next + 下载 + 分辨率 | ⏺ 平 |

## 三、art-canvas 唯一具有的功能

| 功能 | 位置 | Infinite-Canvas 缺失 |
|:----|:----|:------------------:|
| **Image Editor 集成** | `image-editor.js?v=20260528025` | ❌ |
| **jiandanbeijing 模块** | `comfyui-jiandanbeijing.js?v=20260528002` | ❌ |
| **预设面板 (preset-overlay)** | ✅ 完整 dark 主题预设网格 (cyan 边框 + 玻璃) | ❌ 仅 ✦ 按钮 |
| **资产选择面板 (asset-picker)** | ✅ 完整 4 列网格 | ❌ |
| **参考图编辑按钮 (✎)** | ✅ 每个槽右上角独立的"编辑"按钮 | ❌ |

## 四、Infinite-Canvas 唯一具有的功能

| 功能 | 位置 | art-canvas 缺失 |
|:----|:----|:--------------:|
| **i18n 完整支持** | ✅ 7 个 i18n 文件 | ❌ |
| **多 provider 协议支持** | ✅ 7 种协议自适应 | ⚠ 早期版仅 comfly/modelscope/jimeng |
| **Gemini CLI / Codex CLI / Grok / Volcengine** | ✅ provider 列表中 | ❌ 早期版没有 |

## 五、对比小结

### 实质上：两个 online.html 是同一个设计稿的两个版本！

> 两者布局、控件、行为 95% 相同。Infinite-Canvas 是新版（更精简），art-canvas 是早期版（功能更丰富）。

### Infinite-Canvas 升级点
1. ✅ 代码量减少 47%（1441 → 761 行）
2. ✅ 添加 i18n 国际化
3. ✅ 添加 4 种新协议 (Gemini/Codex/Grok/Volcengine)
4. ✅ 多 provider 协议自适应

### art-canvas 优势
1. ✅ Image Editor 集成（参考图编辑功能）
2. ✅ 完整预设面板 UI（cyan 玻璃风）
3. ✅ 完整资产选择面板 UI
4. ✅ 参考图编辑按钮 (✎)
5. ✅ jiandanbeijing（简单背景去除）模块

---

## 六、文件路径

| 项目 | 路径 |
|:----|:----|
| **art-canvas 在线生图** | `H:\AI-Tools\art-canvas\static\online.html` |
| **Infinite-Canvas 在线生图** | `H:\AI-Tools\Infinite-Canvas\static\online.html` |