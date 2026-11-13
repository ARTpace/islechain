# 桌面叠加模式开发文档（透明画布 / 区域穿透 / 文件投放）

> 范围：把画布从"应用内窗口"提升为**桌面叠加层**——背景全透明、只显示节点、空白区域点击穿透到系统桌面；支持把文件/文件夹拖到桌面直接生成节点卡片。
> 状态：以第 13–14 节为准（主窗口换皮）。第 2–5 节的「第二个 overlay 窗口」是已废弃方案，不要再按那个做。
> 前置阅读：`docs/canvas-persistence-migration.md`（项目目录化 A + JSON Schema B）
> 代码基线：`desktop/` = Tauri **2.12.5**，单窗口，`main.rs:61-68` 直接 `navigate("http://127.0.0.1:7000/")`

---

## 0. 结论与范围

### 能做什么

- 一个覆盖显示器的无边框透明窗口，只有节点占据的地方"存在"，其余区域点击/滚轮/右键**直达桌面或其他应用**。
- 节点在桌面上自由摆放、成组、持久化到画布；桌面模式与 studio 模式共享同一份画布数据。
- 拖文件/文件夹到桌面 → 生成对应类型的节点卡片（图片/视频/HTML/文本/模型/文件夹/文件卡）。

### 必须先接受的两个硬约束

1. **"透明"不等于"穿透"。** CSS 透明只改像素，WebView2 仍占满窗口矩形收走全部鼠标事件。真穿透只能靠**系统层缩小窗口形状**（`SetWindowRgn`）或**整窗忽略鼠标**。
2. **"穿透"与"接收投放"互斥。** 没有窗口区域的地方接不到 OLE drop，所以投放必须是**显式状态**（热键/边缘热区武装 → 区域临时整屏 → 松手还原）。这不是 UX 取舍，是 Windows 的机制决定的。

### 明确不做

- 不做 `SetParent` 把外部程序窗口塞进节点（Chromium/Electron/游戏/沙箱程序会崩，DPI 与生命周期不可控）。
- 不做跨进程鼠标注入到别人的窗口（`PostMessage` 对 Chromium/UWP 不可靠）。
- 不做"边穿透边接收投放"。
- 不改 studio 主窗口形态（overlay 失败时 studio 必须完全不受影响）。

---

## 1. 现状

| 项目 | 现状 | 影响 |
| --- | --- | --- |
| 桌面壳 | Tauri v2.12.5，`tauri.conf.json` 单窗口 `main`，`url: "waiting.html"`，启动后 `navigate` 到 `127.0.0.1:7000` | overlay 必须是**第二个窗口**，窗口级属性无法只作用于画布 iframe |
| 前端形态 | `canvas.html` 在 studio 页面里以 iframe 嵌套 | 需要新增 `mode=desktop` 渲染分支 |
| 前端→Rust 通道 | 仅 `backend_startup_error` 一个 command；页面在 `127.0.0.1:7000`（远程 origin） | 远程 origin 的 IPC 默认被 capability 拦，**P0 必须验**（见 §5.3） |
| 拖放 | 浏览器 HTML5 drop，`snapshotCanvasDrop`（`canvas.js:3979`）+ `mediaTypeFor`（`:3654`） | 桌面端可拿到真实路径，不必上传，走"路径登记"更快 |
| 数据 | 画布 JSON（节点世界坐标 + viewport） | 桌面模式需要新增 `desktop` 段（显示器、工作区、屏幕物理坐标约定） |

---

## 2. 核心模型：窗口区域 = 节点矩形的并集

```
屏幕（虚拟桌面）
└── overlay 窗口（无边框 / 透明 / 置顶 / 不进任务栏）
    └── SetWindowRgn( HRGN = ∪ nodeRects )      ← 只有这里"存在"
        ├── 节点矩形内：WebView2 正常收鼠标 → 可点击、可输入、可拖拽
        └── 节点矩形外：窗口不存在 → 系统把点击派发给桌面/其他应用
```

三条推论：

1. **视觉**：区域外不合成任何像素，所以"真透明"（不是半透明叠一层），没有残影、没有黑底。
2. **输入**：命中测试由系统按区域判定，**零延迟**，不存在"进入节点前 8ms 点击漏掉"的竞态。
3. **性能**：区域只在**编辑提交时**重算（拖动结束、新增/删除/缩放节点、工作区切换、DPI 变化），静止时开销为零。

### 2.1 四种实现对比（含淘汰理由）

| 方案 | 穿透行为 | 延迟 | 结论 |
| --- | --- | --- | --- |
| `SetWindowRgn`（区域 = 节点并集） | 区域外窗口不存在 | 0 | ✅ **主方案** |
| `set_ignore_cursor_events(true)` + 光标轮询 | 整窗穿透，轮询决定何时恢复 | 8~16ms 竞态 | ⚠️ 备选/降级 |
| `WS_EX_LAYERED \| WS_EX_TRANSPARENT` | 整窗永远穿透 | — | ❌ 节点也收不到点击 |
| 子类化 WebView2 子窗口返回 `HTTRANSPARENT` | 依赖同线程语义，WebView2 跨线程 | — | ❌ 行为不稳 |

> 关于 `set_ignore_cursor_events`：Tauri 2.12.5 有该方法（`webview_window.rs:2260`），但**没有 Electron 的 `forward` 选项**——一旦忽略鼠标就收不到 `mousemove`，必须由 Rust 侧轮询 `GetCursorPos` 才能判断何时恢复。这就是它只能当备选的原因。

---

## 3. 架构

```
┌──────────────── studio 主窗口（现有）────────────────┐
│ 完整 Web UI：首页 / 画布编辑 / 图库 / 设置            │
└───────────────┬──────────────────────────────────────┘
                │ HTTP PUT /api/canvases/<id>（带 base_revision）
┌───────────────▼──────────────────────────────────────┐
│ FastAPI sidecar :7000                                 │
│  · canvas.json（nodes 世界坐标）                       │
│  · SSE /api/canvases/<id>/events（变更广播）           │
│  · POST /api/overlay/<id>/rects（区域中转，见 §5.3）   │
└───────────────┬──────────────────────────────────────┘
                │ SSE（studio 改 → overlay 刷新）
┌───────────────▼──────────────────────────────────────┐
│ overlay 窗口（每显示器一个）                           │
│  /static/canvas.html?mode=desktop&id=<canvas>         │
│  · 无网格、无工具栏、节点无外框                        │
│  · JS 计算节点物理矩形 → 上报                          │
│  · Rust：SetWindowRgn / 托盘 / 全局热键 / 全屏检测      │
└──────────────────────────────────────────────────────┘
```

**每显示器一个 overlay 窗口**（而不是一个覆盖虚拟桌面的大窗口）：虚拟桌面坐标可能为负、显示器热插拔会变、DPI 各自不同。单屏单窗口把这三个问题都隔离掉了。

---

## 4. 数据模型变更

`canvas.json` 追加 `desktop` 段（B 方案的 schema 同步加 `$defs/desktop`）：

```json
"desktop": {
  "enabled": true,
  "monitor": { "id": "\\\\.\\DISPLAY1", "origin": [0, 0], "scale": 1.25 },
  "viewport": { "x": 0, "y": 0, "scale": 1 },
  "workspaces": [
    { "id": "ws_default", "name": "默认", "hotkey": "Ctrl+Alt+1", "nodeIds": [] }
  ],
  "activeWorkspace": "ws_default",
  "nodeScreenSpace": false
}
```

约定：

- **节点坐标始终用画布世界坐标**，不存屏幕坐标。overlay 模式下 viewport 固定为恒等变换（`x=0,y=0,scale=1`），世界坐标 = 该显示器内物理像素 − `monitor.origin`。
- 显示器换位置/改缩放时只改 `desktop.monitor`，节点坐标不动；由 viewport 的平移吸收偏移。
- `workspaces` 是"一组节点 + 可见性"，切换工作区 = 换 `nodeIds` 过滤 + 重算区域。不要为每个工作区复制节点。

---

## 5. 详细设计

### 5.1 窗口创建

`tauri.conf.json` 不写死 overlay（多显示器数量在运行时才知道），改为 Rust 侧按 `available_monitors()` 创建：

```rust
// 参考实现（未编译验证）
use tauri::{WebviewUrl, WebviewWindowBuilder, Manager};

fn spawn_overlay(app: &tauri::AppHandle, monitor: &tauri::Monitor, canvas_id: &str) -> tauri::Result<()> {
    let pos = monitor.position();
    let size = monitor.size();
    let label = format!("overlay-{}", monitor.name().unwrap_or("main"));
    let url = format!("http://127.0.0.1:7000/static/canvas.html?mode=desktop&id={canvas_id}");
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse()?))
        .title("ArtCanvas Overlay")
        .decorations(false)      // webview_window.rs:601
        .transparent(true)       // :1146
        .shadow(false)           // :673
        .skip_taskbar(true)      // :641
        .always_on_top(true)     // :615
        .resizable(false)
        .position(pos.x as f64 / monitor.scale_factor(), pos.y as f64 / monitor.scale_factor())
        .inner_size(size.width as f64 / monitor.scale_factor(), size.height as f64 / monitor.scale_factor())
        .build()?;
    Ok(())
}
```

注意：

- Tauri 的 `.position()/.inner_size()` 是**逻辑像素**，要用 `physical / scale_factor` 换算（上面已换算）。
- `transparent(true)` 只是让 WebView2 不再填白底，**不提供穿透**；穿透靠 §5.2。
- 前端必须同时设 `html, body { background: transparent }`，否则圆角外会有一层底色。

### 5.2 区域计算（Rust）

```rust
// 参考实现（未编译验证）
// Cargo.toml: windows = { version = "0.62", features = ["Win32_Foundation", "Win32_Graphics_Gdi"] }
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, CombineRgn, SetWindowRgn, DeleteObject, RGN_OR};

#[tauri::command]
fn overlay_set_rects(window: tauri::WebviewWindow, rects: Vec<[i32; 4]>) -> Result<(), String> {
    let hwnd: HWND = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let mut union = CreateRoundRectRgn(0, 0, 0, 0, 0, 0); // 空区域
        for r in &rects {
            let rr = CreateRoundRectRgn(r[0], r[1], r[0] + r[2], r[1] + r[3], 16, 16);
            CombineRgn(Some(union), Some(union), Some(rr), RGN_OR);
            let _ = DeleteObject(rr);
        }
        // 空区域 = 窗口完全穿透（没有节点时）。必须在 JS 侧保证此时仍能通过热键/托盘恢复。
        SetWindowRgn(hwnd, Some(union), true);
        let _ = DeleteObject(union);
    }
    Ok(())
}
```

要点：

| 细节 | 处理 |
| --- | --- |
| 坐标系 | Windows 的区域用**窗口客户端物理像素**；JS 传上来的必须是物理像素（`getBoundingClientRect() × devicePixelRatio`，再减去窗口原点） |
| 圆角 | 区域用 `CreateRoundRectRgn`，圆角半径 16；但视觉圆角由 CSS 做，区域略大 1~2px 以免切掉抗锯齿边缘 |
| 拖动期 | 开始时 `overlay_set_hit_mode("full")`（区域=整屏），结束后再传真实矩形；否则鼠标一滑出节点区域，拖拽立刻中断 |
| 节流 | 只在"编辑提交"时上报，不做逐帧；拖动过程中不上报 |
| 空节点 | 区域为空 = 全屏穿透，此时只能靠托盘/热键恢复（见 §5.4） |
| 失败兜底 | `SetWindowRgn` 失败 → 回落到 `set_ignore_cursor_events(true)` + 轮询，保证功能不挂 |

### 5.3 JS ↔ Rust 通道（两个方案，先验后选）

**方案 A：Tauri IPC**

```js
await window.__TAURI__.core.invoke('overlay_set_rects', { rects });
```

风险：页面 origin 是 `http://127.0.0.1:7000`（远程域），Tauri v2 的 capability 默认不放行远程 origin 的 IPC，需要：

```json
// src-tauri/capabilities/overlay.json
{
  "identifier": "overlay",
  "windows": ["overlay-*"],
  "remote": { "urls": ["http://127.0.0.1:7000"] },
  "permissions": ["core:default"]
}
```

`tauri-utils` 的 `Capability.remote: Option<CapabilityRemote>`（`acl/capability.rs:146`）确认该字段存在，但**实际是否放行 127.0.0.1 需要 P0 实测**（不同版本对 remote 的校验策略有差异）。

**方案 B：后端中转（推荐做默认）**

```
JS → POST /api/overlay/<canvas_id>/rects   （FastAPI 存内存，带 ts）
Rust → 每 80ms GET 一次，变了才 SetWindowRgn
```

优点：完全不依赖 IPC 权限与 `window.__TAURI__` 注入；overlay 页面在普通浏览器里打开也能调试。
缺点：多一次本地 HTTP 往返（约 1ms），区域更新最坏延迟 80ms——但只在拖动结束后触发一次，用户不可感知。

**决策**：P0 先试 A，5 分钟内能跑通就走 A；跑不通直接切 B，不要在这上面纠缠。

### 5.4 逃生口（必须有，否则会把自己锁死）

| 通道 | 实现 | 备注 |
| --- | --- | --- |
| 托盘图标 | `TrayIconBuilder`（需 `tauri` 特性 `tray-icon`） | 菜单：编辑模式 / 穿透模式 / 重载画布 / 退出 |
| 全局热键 | `tauri-plugin-global-shortcut`（当前 `Cargo.toml` 未装，需新增） | 建议 `Ctrl+Alt+O` 切编辑/穿透，`Ctrl+Alt+D` 进入投放态 |
| Esc | 前端监听 | 退出交互态/退出投放态 |
| 崩溃自愈 | 启动时若上次异常退出，强制以"编辑模式"启动 | 写 `desktop-state.json` 标记 |

**规则**：只要区域可能为空（没有任何节点、全部节点在别的显示器），热键与托盘必须独立于 WebView2 存在——所以托盘和热键做在 Rust 侧，不能做在前端。

### 5.5 全屏检测

游戏/视频全屏时置顶窗口会盖住画面。Rust 侧定时（2s）查：

```rust
// windows = { features = ["Win32_UI_Shell"] }
SHQueryUserNotificationState(&mut state);
// QUNS_RUNNING_D3D_FULL_SCREEN / QUNS_PRESENTATION_MODE / QUNS_BUSY → 隐藏 overlay
```

命中时 `window.hide()`，恢复时 `show()`。**不要**用"窗口尺寸 == 屏幕尺寸"来判断全屏（大量普通程序最大化会误判）。

### 5.6 焦点与输入法

| 问题 | 方案 |
| --- | --- |
| 点节点是否抢走其他应用的焦点 | 需要输入就必须抢（`WS_EX_NOACTIVATE` 会让 WebView2 收不到键盘）。默认允许激活；"展示模式"下才加 `NOACTIVATE` |
| 中文输入法候选框错位 | WebView2 在无边框 + 非标准激活窗口下的已知问题；P0 必须实测（用微软拼音输入一段中文） |
| 不进 Alt-Tab | `skip_taskbar(true)` + `WS_EX_TOOLWINDOW` |

### 5.7 投放态（核心状态机）

```
ghost（穿透）
   │  热键 Ctrl+Alt+D / 鼠标撞屏幕顶部 6px 热区
   ▼
armed（区域=整屏，铺淡遮罩 + 提示"松手成节点"，Esc 可退）
   │  拖入（Tauri DragDrop Enter/Over）
   ▼
dragover（命中已有节点 → 高亮"放入此节点"；命中空白 → 显示落点预览）
   │  Drop
   ▼
commit（创建节点 → 新矩形并入区域 → 退出投放态 → 区域收回）
```

实现约束：

- `armed` 期间区域必须整屏，否则接不到 `Enter` 事件（OLE drop 只认光标下的窗口）。
- 遮罩用 `rgba(0,0,0,.18)` + 一行提示，必须**视觉上明显**——这段时间确实挡住了桌面。
- `Esc`/拖出屏幕 → `Leave` → 回 `ghost`，不创建任何东西。
- 投放态只能由一个显示器进入；其他屏保持 `ghost`。

### 5.8 文件摄入（两条入口，一个抽象）

| 入口 | 数据 | 适用 |
| --- | --- | --- |
| Tauri 原生 | `paths: string[]`（含目录）+ `position: PhysicalPosition` | 桌面 overlay 主通路；服务端可直接按路径读，几个 GB 的视频零上传 |
| HTML5 | `File` 对象，无路径 | 浏览器访问兜底；画布内部从图库拖拽 |

统一入口：

```js
CanvasDrop.ingest(items, screenPoint)   // items: [{path} | {file}]
```

Tauri 侧事件（v2.12.5 确认字段：`DragDropEvent::{Enter{paths,position}, Over{position}, Drop{paths,position}, Leave}`）：

```js
// 需同时把该窗口 dragDropEnabled 保持默认 true（tauri-utils config: drag_drop_enabled 默认 true）
const wv = window.__TAURI__.webview.getCurrentWebview?.();
wv?.onDragDropEvent(async e => {
  if (e.payload.type === 'enter') OverlayDrop.arm(e.payload.paths.length);
  if (e.payload.type === 'over')  OverlayDrop.hover(e.payload.position);
  if (e.payload.type === 'drop')  await CanvasDrop.ingest(e.payload.paths.map(path => ({ path })), e.payload.position);
  if (e.payload.type === 'leave') OverlayDrop.cancel();
});
```

⚠️ **P0 必须验证**：`dragDropEnabled: true` 时，窗口内的 HTML5 `dragover/drop` 是否被原生处理器吞掉。若被吞，画布内部"从图库拖到画布"会失效。按窗口配置：overlay 用原生，studio 保 HTML5；若配置是全局的，则统一走原生 + 内部拖拽改用指针事件。

### 5.9 类型映射

| 拖入 | 生成的节点 | 备注 |
| --- | --- | --- |
| `image/*` | `image` | 多张横向一排，间距 24，不重叠 |
| `video/*` | `video` | 首帧缩略图 |
| `.html` | `webapp` | 已有能力（`web-node.js`），直接 `createFromFile` 语义改成 `createFromPath` |
| `.md` / `.txt` | `prompt` | 文本灌入 `text` 字段 |
| `.json`（画布导出） | 导入画布 | 走 A 方案的 import |
| `.glb/.obj/.fbx` | `model3d` | |
| 目录 | 文件夹节点 | 懒加载列表；双击"炸开"成子节点（参考 `gameFolder` 形态） |
| 其他 | 文件卡片 | 图标 + 大小 + 双击用系统默认程序打开；**不复制**，登记引用 |

落位规则：

1. 以投放点为锚点，按 1~3 列网格铺（按宽高比决定列数），复用现有对齐/等距组件算间距。
2. 与已有节点重叠 → 就近找空位（螺旋搜索，步长 40px）。
3. 投放到已有节点内部 → 作为该节点的输入，不新建卡片。

### 5.10 路径与存储（接 A 方案）

- 图片/小文件（< 32MB）→ 复制到 `projects/<slug>/assets/`，节点存 `/assets/<owner>/<slug>/<name>`。
- 大文件（视频/PSD/blend）→ **登记引用**，`project.json` 记：

```json
"externalRefs": [{ "nodeId": "n_x", "path": "D:/素材/a.mp4", "size": 123, "mtime": 1793, "hash": "sha256:..." }]
```

UI 上给这类节点打「引用」角标，并提示"原文件移动后会断链，可右键固化为项目内副本"。

> 这正是 A 方案（项目目录化）值得做的原因：桌面投放让"引用外部路径"的规模爆炸，没有项目内资产目录就没有可搬运性。

### 5.11 节点即应用（三档，不做第四档）

| 档 | 做法 | 输入能力 | 可靠性 |
| --- | --- | --- | --- |
| 1. Web 应用 | `webapp` 节点跑 iframe；支持 `http://localhost:*`，可直接把 ComfyUI / Jupyter 挂成节点 | 完整 | 高 |
| 2. 本机原生程序 | `DwmRegisterThumbnail` 把真实窗口投影到节点矩形 | **只读**，点击仅"唤起原窗口" | 中 |
| 3. 真嵌入 | `SetParent` 外部窗口 | 理论完整 | 极低，**不做** |

---

## 6. 分阶段与 go/no-go

| 阶段 | 内容 | 出口判据 |
| --- | --- | --- |
| **P0**（半天~1 天） | 第二窗口 transparent+frameless；区域硬编码两个矩形；拖放事件只打日志。启动方式：`npm run dev -- --overlay`（见 §10） | **4 条全过才继续**：① 空白处能点桌面图标/右键 ② 节点内能点按钮、拖窗口 ③ 4K+125% 无黑边/残影 ④ 原生 drop 能收到 paths |
| P1 | 区域动态化（编辑提交时上报）+ 托盘 + 全局热键 + 拖动期整屏 + 全屏检测 | 连续使用 1 小时不锁死、不闪 |
| P2 | `mode=desktop` 渲染分支 + 工作区 + 位置持久化 + SSE 双窗同步 | studio 改、overlay 3s 内反映；反之亦然 |
| P3 | 投放态状态机 + 类型映射 + 文件夹节点 + 网格落位 | 拖 20 个文件不重叠、不卡 |
| P4 | 外部引用登记 UI + DWM 缩略图节点 + 共享/录屏自动隐藏 | — |

**P0 的 4 条判据缺一不可**，尤其第 ③ 条：透明 + GPU 在个别驱动上会出黑底，先写完功能再验 = 返工。

---

## 7. 验收清单

- [ ] 无节点时窗口完全不可见、完全穿透；托盘/热键仍可恢复。
- [ ] 有节点时，节点矩形内可点击/输入/拖拽；矩形外点击落到桌面图标。
- [ ] 拖动节点划出原区域时拖拽不中断（区域=整屏）。
- [ ] 拖动结束后区域精确贴合（误差 ≤ 1px，125%/150% 缩放同样成立）。
- [ ] 4K + 125% + 双屏：跨屏拖动节点坐标正确。
- [ ] 全屏视频/游戏时 overlay 自动隐藏，退出全屏后恢复。
- [ ] 拖 1 张图 / 10 张图 / 1 个文件夹 / 1 个 .html 到桌面 → 各自生成正确的节点并按网格排布。
- [ ] 拖到已有 output 节点上 → 作为输入追加，不新建卡片。
- [ ] 投放中按 Esc → 不创建任何节点，回穿透态。
- [ ] studio 里移动节点 → overlay 同步；overlay 里拖节点 → studio 同步（含 revision 冲突提示）。
- [ ] 微软拼音在节点内输入 → 候选框位置正确。
- [ ] `Ctrl+F5` / 进程被杀后重启 → 不锁死在穿透态。

---

## 8. 风险登记

| 风险 | 概率 | 影响 | 处置 |
| --- | --- | --- | --- |
| WebView2 透明在部分驱动出黑底 | 中 | 功能不可用 | P0 先验；降级方案为 `set_ignore_cursor_events` + 轮询 |
| `SetWindowRgn` 在 WebView2 上出现边缘撕裂/闪烁 | 中 | 体验差 | 区域比节点大 1px；避免逐帧设置；不行则切整窗忽略方案 |
| 远程 origin 的 IPC 被 capability 拦 | 高 | 区域无法上报 | 直接走 §5.3 方案 B（HTTP 中转），不纠缠 |
| `dragDropEnabled: true` 吞掉 HTML5 drop | 中 | 画布内部拖拽失效 | P0 实测；按窗口分流或统一改原生 |
| 输入法候选框错位 | 中 | 中文不可用 | P0 实测；退路是"点节点时临时切前台" |
| 常驻置顶层被录屏/共享暴露 | 高 | 隐私 | 设置项"共享时自动隐藏"；默认开 |
| 用户误触：透明层吞掉一次桌面点击 | 低 | 轻微 | 区域严格跟随矩形，无额外热区（投放热区仅在顶部 6px） |
| 多显示器热插拔 | 中 | 窗口错位 | 监听 `available_monitors` 变化，重建 overlay |

---

## 9. 附录：依赖与 API 清单

### 9.1 需要新增的依赖

```toml
# src-tauri/Cargo.toml
tauri = { version = "2", features = ["tray-icon"] }        # 托盘
tauri-plugin-global-shortcut = "2"                          # 全局热键
windows = { version = "0.62", features = [                  # 与 Cargo.lock 现有 0.62.2 对齐
  "Win32_Foundation", "Win32_Graphics_Gdi", "Win32_UI_Shell", "Win32_UI_WindowsAndMessaging"
] }
```

> `windows` 已作为 Tauri 的传递依赖存在于 `Cargo.lock`（0.62.2），显式声明同版本不会引入重复 crate。

### 9.2 已核实的 Tauri 2.12.5 API（本地 crate 源码）

| API | 位置 |
| --- | --- |
| `WebviewWindow::hwnd() -> Result<HWND>` | `webview_window.rs:1966` |
| `set_ignore_cursor_events(bool)` | `webview_window.rs:2260` |
| `WebviewWindowBuilder::transparent / skip_taskbar / always_on_top / shadow` | `:1146 / :641 / :615 / :673` |
| `DragDropEvent::{Enter,Over,Drop,Leave}`，`position: PhysicalPosition<f64>` | `tauri-runtime-2.12.2/src/window.rs:99` |
| 配置项 `drag_drop_enabled`，默认 `true` | `tauri-utils/src/config.rs:1988, 2408` |
| capability `remote.urls` | `tauri-utils/src/acl/capability.rs:146` |
| `TrayIconBuilder`（需 `tray-icon` 特性） | `tauri/src/tray/mod.rs:203` |

### 9.3 后端新增端点（**必须放 `routers/`，不能动 `main.py` 顶层**）

`tests/test_game_pipeline_app.py:85` 会拿 `git show HEAD:main.py` 逐条比对顶层路由，新路由加在 `main.py` 会直接失败。

```
POST /api/overlay/{canvas_id}/rects   # JS 上报节点物理矩形（方案 B 中转）
GET  /api/overlay/{canvas_id}/rects   # Rust 轮询
GET  /api/canvases/{canvas_id}/events # SSE 变更广播（双窗同步）
```

### 9.4 P0 验证脚本骨架

```bash
# 1) 桌面开发模式启动（自动拉起后端 + studio 窗口 + 探针窗口）
cd desktop && npm run dev -- --overlay
# 2) 手工验收 4 条判据（见 §6）
# 3) 拖放日志：Console 里看 onDragDropEvent 是否打出 enter/over/drop
```

P0 期间**不要**改 `static/canvas.html` 与 `canvas.js`——overlay 先用临时页 `desktop/src/overlay-probe.html`，验证通过再谈渲染分支。

---

## 10. 桌面端开发模式

### 10.1 原则

**所有叠加层相关开发都在桌面端验证，不用浏览器。** 浏览器无法验证透明、区域穿透、置顶、原生 drop、DPI——这些恰好是本功能全部风险所在。浏览器只在改 studio 内部 UI 时用。

### 10.2 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 起后端（仓库根 `main.py`）+ Tauri studio 窗口 |
| `npm run dev -- --overlay` / `npm run dev:overlay` | 上面再加一个透明叠加探针窗口（P0 验收用） |
| `npm run dev -- --no-server` | 复用已在跑的 `127.0.0.1:7000` |
| `npm run dev:server` | 只起后端（配合别的前端调试） |
| `npm run dev -- --help` | 参数说明 |

### 10.3 机制

```
desktop/scripts/dev.mjs
  ├── 探测 127.0.0.1:7000；未监听 → spawn 系统 Python 跑 <repo>/main.py
  │      env: PYTHONUTF8=1, ARTCANVAS_DEV=1  ；日志加 [server] 前缀
  ├── 等端口就绪（最多 90s）
  └── spawn `tauri dev`（cwd=desktop）
         env: ARTCANVAS_DEV=1, ARTCANVAS_OVERLAY=0|1
```

Rust 侧响应两个环境变量（`main.rs`）：

| 变量 | 行为 |
| --- | --- |
| `ARTCANVAS_DEV=1` | 跳过 sidecar 启动与进程托管，只等端口；超时提示改用 `npm run dev` |
| `ARTCANVAS_OVERLAY=1` | 主窗口就绪 900ms 后创建探针窗口（主显示器全屏、透明、无边框、置顶、不进任务栏），并把窗口区域设为两张卡片的并集 |

关闭终端 / `Ctrl+C` 会同时杀掉后端与 `tauri dev`（Windows 走 `taskkill /T`）。

### 10.4 探针窗口

- 页面：`desktop/src/overlay-probe.html`（透明背景 + 两张卡片）
- 区域：`src-tauri/src/overlay.rs` 的 `PROBE_CARDS`，单位 CSS 像素，运行时按 `scale_factor` 转物理像素
- **改卡片位置必须同时改 HTML 的 `left/top` 和 `PROBE_CARDS`**，否则区域与视觉错位
- 卡片 A 右下角显示 `dpr / viewport / tauri` 三项，用于判断 DPI 与 API 注入是否正常

### 10.5 已知限制（P0 预期内）

| 限制 | 说明 |
| --- | --- |
| 区域是静态的 | 拖动卡片 B 后区域不跟随，松手处会穿透——这是**预期行为**，正好证明"区域 = 命中范围"；P1 才做动态上报 |
| 只建在主显示器 | 多屏需扩展 `create_probe`（P2 每屏一个窗口） |
| 无托盘/热键 | 探针窗口靠 `Alt+F4` 或结束进程退出；逃生口在 P1 |
| 不引入 `windows` crate | 只用 `gdi32`/`user32` 的 4 个裸 FFI（`CreateRoundRectRgn` / `CombineRgn` / `DeleteObject` / `SetWindowRgn`），避免 crate 版本与 feature 漂移 |

### 10.6 与打包版的关系

`npm run build`（NSIS）流程不变：仍然装配 `build-sidecar.mjs` + `build-python.mjs`。开发模式只绕过 sidecar，不改打包产物；P1 完成后再决定 overlay 是否需要在打包版默认关闭（建议先做成"设置里开启的实验特性"）。

## 11. 快捷启动与图标

开发期不想每次都敲 `cd desktop && npm run dev`，所以提供带图标的系统快捷方式。

### 11.1 一次性安装

```powershell
# 桌面 + 开始菜单，主入口挂全局热键 Ctrl+Alt+C
& desktop\scripts\install-shortcuts.ps1

# 换热键 / 不要热键 / 卸载
& desktop\scripts\install-shortcuts.ps1 -Hotkey "Ctrl+Alt+K"
& desktop\scripts\install-shortcuts.ps1 -NoHotkey
& desktop\scripts\install-shortcuts.ps1 -Uninstall
```

安装后得到两个快捷方式（桌面和开始菜单各一份）：

| 名称 | 行为 | 热键 |
| --- | --- | --- |
| `ArtCanvas` | `scripts\start-desktop.cmd` → `node scripts\dev.mjs` | `Ctrl+Alt+C` |
| `ArtCanvas 叠加模式` | 同上，多带 `--overlay`，额外开透明穿透探针窗 | 无 |

⚠️ 全局热键来自 Windows `.lnk` 的 Hotkey 属性，**只在桌面那份快捷方式存在时生效**，且只能取 `Ctrl+Alt+字母` 形式。若被别的软件抢占（QQ 截图默认 `Ctrl+Alt+A`），右键快捷方式 → 属性 → 快捷键 改一个即可。

### 11.2 为什么保留控制台窗口

`start-desktop.cmd` 会留一个标题为 `ArtCanvas Desktop` 的终端窗口，不隐藏是刻意的：

- 开发模式下 Python 后端日志与 `cargo` 编译进度都在里面，隐藏后只能翻日志文件；
- 隐藏窗口里 `Ctrl+C` 收不到，进程只能从任务管理器结束——没有停止入口是硬伤；
- 启动失败（Python 缺依赖、cargo 编译错误）能直接看到原因，批处理末尾带 `pause`。

关掉这个窗口 = 全部退出（`dev.mjs` 的 `SIGINT` 处理会连带 `taskkill /T` 清理子进程）。

### 11.3 图标

`desktop/scripts/gen-icons.py` 可重复生成，只依赖 Pillow：

- 母题沿用 `static/favicon.svg` 的**等距立方体**，保持浏览器与桌面端一致；
- 深色圆角底（Windows 11 风格 22.5% 圆角）+ 青色三面 + 外发光；
- 3× 超采样后 LANCZOS 降采样；`icon.ico` 内含 16/24/32/48/64/128/256 七个尺寸，逐个从 1024 主图缩放，小尺寸不发糊。

产物写入 `desktop/src-tauri/icons/`：`icon.png`(1024)、`256x256.png`、`128x128@2x.png`、`128x128.png`、`64x64.png`、`32x32.png`、`icon.ico`。
原 Tauri 占位图标备份在 `icons/_tauri-default/`。

⚠️ Windows 可执行文件图标由 `build.rs` 通过 winres 嵌入，**改完图标必须重新编译一次**（`npm run dev` 会自动触发，首次约 1 分钟）。

### 11.4 独立启动器 `ArtCanvas.exe`

`.cmd` 文件本身无法携带图标（Windows 不支持给批处理绑定 icon），所以另做了一个真正的可执行启动器：

```
desktop\ArtCanvas.exe          ← 双击即用，图标已嵌入（约 270 KB）
desktop\launcher\              ← Cargo 项目源码（唯一依赖 embed-resource）
```

| 项 | 说明 |
| --- | --- |
| 子系统 | `windows`，双击不闪黑框，拉起后另开一个 `ArtCanvas Desktop` 控制台承载 dev 服务 |
| 行为 | 定位 `scripts\start-desktop.cmd` 并用 `CREATE_NEW_CONSOLE` 运行；关掉该控制台 = 全部退出 |
| 参数 | `ArtCanvas.exe --overlay` 等原样透传给 `dev.mjs` |
| 查找顺序 | exe 同目录 → 上一级 → 上两级 → `H:\AI-Tools\art-canvas\desktop` 兜底 |
| 失败提示 | 找不到脚本或无法启动时弹 MessageBox，不会静默消失 |

重新编译（改图标、改逻辑后）：

```bash
cd desktop
npm run launcher        # 离线优先，失败自动联网重试一次
npm run icons           # 改图标后先跑这个，会同步 launcher/icon.ico
```

`scripts/install-shortcuts.ps1` 会**优先**把快捷方式指向 `ArtCanvas.exe`，没有该文件时回退到 `.cmd`。

源码位置（改动时只需要看这两个）：
- `launcher/src/main.rs`：查找脚本 + `CREATE_NEW_CONSOLE` 拉起 + MessageBox 兜底
- `launcher/launcher.rc`：`1 ICON "icon.ico"` 与 VERSIONINFO。⚠️ 必须 `#include <winres.h>`，否则 rc.exe 会报 "failed to compile specified resource file"

## 12. 已实现：真实画布叠加（2026-11-06）

P0 探针之后直接落到了「真实画布浮在桌面上」，当前可用。

### 12.1 怎么用

```bash
cd desktop
npm run dev -- --overlay                       # 自动打开最近更新的画布
npm run dev -- --overlay --canvas <canvasId>   # 指定画布
npm run dev -- --overlay --probe               # 回到 P0 白卡片探针页
```

或直接双击桌面上的「**ArtCanvas 叠加模式**」快捷方式。

叠加模式会**先结束已在跑的实例再启动**（`taskkill /IM art-canvas.exe`）：
Tauri 的单实例插件会拦掉第二进程，而 `tauri dev -- --overlay` 的参数会被拼进
`cargo run` 而不是传给应用，所以走「独占重启」这条路最稳。

> 日常切换不用重启了，直接按 `Ctrl+Alt+O` 或点托盘图标，见 §13。

### 12.2 技术结论（踩过的坑）

| 问题 | 结论 |
| --- | --- |
| `tauri` 的 `.transparent(true)` 在 Win11 上黑屏 | tao 0.37 用 `DwmEnableBlurBehindWindow` + 空 region，会把整个窗口（含 WebView2 绘制）一起挖空。**必须设 `transparent(false)`**，改用手动 `DwmExtendFrameIntoClientArea(hwnd, MARGINS{-1,-1,-1,-1})` + `.background_color(Color(0,0,0,0))` |
| 窗口区域 | `SetWindowRgn` 用节点矩形并集，区域外**窗口不存在**，点击直达桌面。`PtInRegion` 已验证：节点内命中、空白处不命中 |
| 区域刷新 | 画布页每 250ms 收集 `#nodes > .node` 的 `getBoundingClientRect()`，变化才 POST；**每 5 秒强制心跳一次**。后端有 6 秒 TTL，静止不发会让区域退化成只剩控制条 |
| 坐标 | JS 上报 CSS 像素（相对窗口左上角），Rust 侧乘 `monitor.scale_factor()` 转物理像素，多屏不同 DPI 不错位 |
| 矩形外扩 | 上报时四边各 +12px，否则 `SetWindowRgn` 会把节点阴影切掉 |
| URL 改写 | 画布启动流程会改写 `location`，所以 `?mode=desktop` 必须在 `<head>` 最前面的内联脚本里就记进 `window.__CANVAS_MODE__`，bridge 只认这个标记 |
| 截图不可靠 | 透明叠加窗口用 BitBlt/ImageGrab 抓不到内容（硬件加速合成层），检查效果要**用 `GetPixel` 取屏幕像素**或用 WebView2 的 `--remote-debugging-port` |

### 12.3 相关文件

| 文件 | 作用 |
| --- | --- |
| `desktop/src-tauri/src/overlay.rs` | 窗口创建、`SetWindowRgn`、DWM 玻璃、HTTP 轮询（裸 `TcpStream`，不引 reqwest） |
| `static/modules/canvas-overlay-bridge.js` | 收集节点矩形并上报，含右下角控制条 |
| `static/css/canvas-overlay.css` | 透明背景、隐藏工具栏/网格/小地图、节点阴影加厚 |
| `routers/desktop_overlay.py` | `POST/GET /api/desktop/overlay-rects`，内存中转 + 6 秒 TTL |
| `static/canvas.html` | head 内联脚本记录模式；引入 bridge 与 overlay 样式 |
| `static/js/canvas.js` | `mode=desktop` 且无 `id` 时自动打开最近更新的画布 |

### 12.4 还没做的

- 拖动节点期间把区域临时设为整屏（现在拖动时鼠标滑出节点区域会中断）
- 多显示器（每屏一个 overlay 窗口）
- 文件投放状态机、节点即应用（DWM 缩略图）

---

## 13. 已实现：运行时切换（单窗口换皮，2026-11-06）

### 13.1 为什么改成单窗口

最初的做法是"另开一个 overlay 窗口加载 `canvas.html`"，用户实测有三个症状：

| 现象 | 根因 |
| --- | --- |
| 像打开了一张新画布，节点位置对不上 | 第二个 WebView 自己 fetch 一次画布，视图平移/缩放从零开始，两个窗口尺寸也不一样 |
| 卡片外面像套了一圈底板 | `canvas-overlay.css` 给节点加了 `outline: 1px`，再叠上阴影和上报外扩的 12px，外扩范围内窗口是"存在"的，桌面被遮住一圈 |
| 拖动不同步、错位 | 拖动发生在编辑窗口，叠加层每 250ms 轮询一次服务端，拿到的永远是上一帧 |

结论：**两个窗口渲染同一份数据，同步怎么做都是错的**。

现在改成：始终只有主窗口，穿透态就是把**主窗口自己**改成
「无边框 + 铺满主屏 + DWM 玻璃 + 窗口区域只剩节点」。
同一份 DOM、同一份状态、同一个拖动会话，位置和同步成本为零。

### 13.2 操作

| 方式 | 动作 |
| --- | --- |
| `Ctrl+Alt+O`（全局） | 编辑态 ⇄ 穿透态 |
| **右下角控制条橙色按钮** | **退出透明，回编辑态**（不依赖热键，最直观的出口） |
| 右下角控制条另两个按钮 | 全部节点适应窗口 / 重新加载画布 |
| 托盘图标右键 | 「透明画布 开 / 关」「打开主窗口」「退出 ArtCanvas」 |
| 托盘图标左键双击 | 同热键 |
| 桌面「ArtCanvas 叠加模式」快捷方式 | 启动即进穿透态（会先把主窗口导航到最近一次画布） |

- **编辑态**：正常带边框的窗口，工具栏/小地图都在。
- **穿透态**：窗口无边框铺满主屏，工具栏隐藏，背景透出桌面，
  只有节点矩形范围内接收鼠标（区域外点击直接落到桌面或其他应用上）。
- **在项目列表页按热键不会切换**，只弹一条提示。以前会强行导航进画布，
  侧边栏突然消失，用户以为回不去了。

### 13.3 切换做了什么

进入穿透态（顺序不能换）：

1. 保存窗口几何（位置/尺寸/最大化/置顶），最小化状态下的 `-32000` 视为无效，用默认值兜底
2. `window.__setOverlayMode(true)` → 页面加 `body.desktop-overlay` 类、创建右下角控制条、开始上报
3. `unmaximize` → `set_decorations(false)` → `set_always_on_top(true)` → `set_skip_taskbar(true)`
4. `set_background_color(Color(0,0,0,0))`（让 WebView2 的默认底透明，否则 DWM 玻璃后面还是白的）
5. `MoveWindow(hwnd, 0, 0, 屏宽, 屏高)` 按物理像素铺满主屏
6. `DwmExtendFrameIntoClientArea(MARGINS{-1,-1,-1,-1})` 开玻璃
7. **立刻把区域收成右下角控制条**（安全网，见 §13.5），再启动轮询线程按节点矩形并集 `SetWindowRgn`

退出：停轮询 → `SetWindowRgn(hwnd, 0)` 清区域 → 关玻璃 → 恢复背景色 →
`__setOverlayMode(false)` → 恢复边框 → 还原几何 → `show()` + `set_focus()`。

如果按热键时主窗口不在画布页：热键路径**什么都不做**（只弹提示），
只有「叠加模式」快捷方式（`--overlay` / `enter()`）才会导航到 `canvas.html?mode=desktop`，
等 2.4 秒页面就绪后再换皮。

### 13.4 验证数据（3840×2160，150% 缩放，双屏）

| 项目 | 结果 |
| --- | --- |
| 进入前窗口 | `(228,228) 2182×1406` |
| 穿透态窗口 | `(0,0) 3840×2160`，`region kind=3` |
| 节点点 `(876,776)` | `PtInRegion=True`，`WindowFromPoint` 落到自身 → 可点 |
| 空白点 `(1920,1080)` | `PtInRegion=False` → 穿透 |
| 右下角控制条 | 恒在区域内，`PtInRegion=True` → 可点 |
| 点控制条橙色按钮 | 窗口回到 `(228,228) 2182×1406`，`region kind=0` |
| 退出后窗口 | 几何、边框、置顶、背景色全部还原 |

### 13.5 踩过的坑

| 问题 | 结论 |
| --- | --- |
| **进穿透后整屏鼠标被吃掉，点不到桌面也点不到别的应用** | 根本没设初始区域时长这样：窗口是全屏**完整矩形**，DWM 玻璃让它看着像透明，但命中测试仍是整块窗口。必须一进穿透态就 `SetWindowRgn` 收成右下角控制条，宁可先只露一条，也不允许整屏。轮询拿不到矩形时同样退回这条兜底区域 |
| 控制条上的按钮没反应 | 页面是 `127.0.0.1:7000` 远程 origin，调自定义 `#[tauri::command]` 会被 ACL 拒（`not allowed. Plugin not found`）。改走 HTTP 信号：页面 `POST /api/desktop/overlay-exit` → 后端置时间戳 → Rust 轮询拿到 `EXIT` → `toggle()` |
| 在项目列表页按热键，结果被强行拽进画布、侧边栏没了 | `apply()` 原来无条件导航到最近画布。改成只有 `enter()`（`--overlay` 快捷方式）允许导航，热键/托盘走 `allow_navigate=false`，不在画布页就只弹提示 |
| 窗口跑到 `(-32000,-32000)`、尺寸 237×39 | 那是 Windows 的**最小化**状态。`outer_position()` / `inner_size()` 此时返回的是废值，必须 `unminimize()` + `show()`，并在保存几何时校验（`x > -30000` 且边长 ≥ 200） |
| 高缩放下窗口只铺到 `1707×960` | `monitor.size()` 已是物理像素，tao 的 `position/inner_size` 收逻辑值又会除一次 scale。统一用 `MoveWindow` 按物理像素摆 |
| `Paint` 时人眼看到深灰底，以为没透明 | 拿 `GetPixel` 判透明不可靠——桌面那个位置可能正好有个深色应用。要判 `PtInRegion` + `WindowFromPoint` 的归属进程 |
| 退出后窗口回来了但看不见 | 恢复几何后补 `show()` + `set_focus()`；最小化状态下保存的几何要丢弃 |

### 13.6 相关文件

| 文件 | 职责 |
| --- | --- |
| `desktop/src-tauri/src/desktop_mode.rs` | 切换状态机、几何保存还原、托盘、热键、非画布页提示 |
| `desktop/src-tauri/src/overlay.rs` | `set_glass` / `clear_region` / `move_to` / `primary_screen` / `dock_rect` 安全区域 / 区域轮询线程（带 generation 停止、`EXIT` 信号处理） |
| `desktop/src-tauri/src/main.rs` | 注册 `tauri-plugin-global-shortcut`、setup 初始化、单实例 `--overlay` 转发、`open_studio` 里的 `show/unminimize` |
| `static/modules/canvas-overlay-bridge.js` | `window.__setOverlayMode(on)` 启停、节点和连线矩形上报、拖动时 `mode=full`、右下角控制条 |
| `static/css/canvas-overlay.css` | `body.desktop-overlay` 下的透明/隐藏规则、控制条样式 |
| `routers/desktop_overlay.py` | 矩形中转（6 秒 TTL）+ `POST /api/desktop/overlay-exit` 退出信号（5 秒 TTL） |

### 13.7 第 13 节当时没做、第 14 节补上的

- 进入穿透态时画布视图不补偿：窗口从 `(304,304)` 变成 `(0,0)` 全屏，节点在屏幕上会整体平移
- 拖动节点期间区域仍按节点矩形追，鼠标滑出卡片就断拖，底板比卡片慢一拍
- 连线层被 CSS 关掉，区域也不包含线，拉线失效

仍未做：多显示器、文件投放状态机、节点即应用（DWM 缩略图）。

---

## 14. 修复：同一视口、拖动整屏、连线可见（2026-11-06）

穿透态仍然只有主窗口这一份 DOM。修的是几何和命中，不是再开一个画布。

### 14.1 节点停在原地

进入和退出都在改窗口几何的前后用 `ClientToScreen(客户区原点)` 量屏幕坐标。差值换成 CSS 像素后调用 `window.__shiftCanvasView(dx, dy)`，只改 `viewport.x/y`，不改节点世界坐标，也不重新拉画布。窗口往哪边挪，视口就往反方向补同样的量。

### 14.2 不再按节点切窗口

按节点矩形 `SetWindowRgn` 会把连线、标题、接口裁掉，卡片看起来套在方块里。透明态改为清掉窗口区域，只把画布底板设为透明。节点卡片仍用原来的卡片底，空白处透出桌面，连线照常显示。空白处的点击不再穿透到桌面。

### 14.2a 区域两种状态（已废弃）

| 状态 | 何时 | 窗口形状 |
| --- | --- | --- |
| `tight` | 静止 | 节点矩形（四边外扩 2px）+ 每条连线的包围盒 + 右下角控制条 |
| `full` | 指针按在节点上直到松开 | 整屏。拖节点、从端口拉线都不会因为滑出卡片而断 |

页面 `POST /api/desktop/overlay-rects` 带 `mode`。Rust 轮询看到 `FULL` 就把区域设成整屏，看到矩形列表才裁切。静止时不做逐帧上报。

外扩从 12px 收到 2px，节点不再加描边。之前那圈「底板」是裁切区域比卡片大，窗口底色露出来，又比 DOM 慢一拍。

### 14.3 连线

去掉 `#links { display: none }`。静止时把每条 `path` 的包围盒并进区域，线才不会被 `SetWindowRgn` 切掉。包围盒超过屏幕约 1/4 的线不并入（斜长线的矩形会挡住大片桌面），这种线在静止时仍可能被裁切；按住端口拉线走 `full`，交互不受影响。

### 14.4 验收

- 在编辑态摆好的节点，按 `Ctrl+Alt+O` 后仍在屏幕上原来的位置；再按一次回到原窗口，位置还在。
- 穿透态拖节点，卡片和可点区域一起走，没有滞后的底板。
- 从端口拖到另一个端口能连上线；已有连线在卡片之间能看见。
- 没按住节点时，卡片和连线以外的点击落到桌面。
