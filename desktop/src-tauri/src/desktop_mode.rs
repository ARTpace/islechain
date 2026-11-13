//! 桌面模式运行时切换：托盘图标 + 全局热键。
//!
//! **只有一个窗口**。穿透态不是"再开一个画布"，而是把主窗口自己改成
//! 「无边框 + 铺满主屏 + DWM 玻璃 + 窗口区域只剩节点」。
//! 这样 DOM、画布状态、拖动会话全都是同一份，节点位置与拖动天然同步，
//! 不存在两套页面互相追的问题。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::overlay;

/// 全局热键，托盘菜单文案里也用它。
pub const HOTKEY_LABEL: &str = "Ctrl+Alt+O";

/// 当前是否处于透明穿透态。
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// 进入穿透态前的窗口状态，退出时原样还原。
#[derive(Clone, Copy)]
struct SavedWindow {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    maximized: bool,
    always_on_top: bool,
}

static SAVED: Mutex<Option<SavedWindow>> = Mutex::new(None);

pub fn active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

/// 切换编辑态 / 穿透态。可从任意线程调用。
pub fn toggle(app: &AppHandle) {
    let next = !active();
    ACTIVE.store(next, Ordering::SeqCst);

    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        // 热键/托盘是「就地切换」：不在画布页就不该把用户强行拽进画布，
        // 否则项目列表的侧边栏会突然消失，用户还以为回不去了。
        if let Err(error) = apply(&handle, next, false) {
            ACTIVE.store(false, Ordering::SeqCst);
            if error != NOT_CANVAS {
                eprintln!("[desktop-mode] 切换失败：{error}");
                if let Err(error) = apply(&handle, false, false) {
                    eprintln!("[desktop-mode] 回退编辑态失败：{error}");
                }
            }
        }
    }) {
        eprintln!("[desktop-mode] 无法调度到主线程：{error}");
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// 进入穿透态（单实例转发 `--overlay` 时用）。这条路径允许自动打开最近画布。
pub fn enter(app: &AppHandle) {
    if active() {
        return;
    }
    ACTIVE.store(true, Ordering::SeqCst);
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(error) = apply(&handle, true, true) {
            eprintln!("[desktop-mode] 进入穿透态失败：{error}");
            ACTIVE.store(false, Ordering::SeqCst);
        }
    }) {
        eprintln!("[desktop-mode] 无法调度到主线程：{error}");
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// 回到编辑态（托盘「打开主窗口」用）。
pub fn show_studio(app: &AppHandle) {
    ACTIVE.store(false, Ordering::SeqCst);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = apply(&handle, false, false) {
            eprintln!("[desktop-mode] 打开主窗口失败：{error}");
        }
    });
}

/// 「当前页面不是画布」的专用错误：调用方看到它只需静默复位，不必再还原窗口。
const NOT_CANVAS: &str = "not-canvas";

fn is_canvas_document(window: &WebviewWindow) -> bool {
    window
        .url()
        .map(|url| {
            let path = url.path();
            path.ends_with("canvas.html") || path.ends_with("smart-canvas.html")
        })
        .unwrap_or(false)
}

const PAGE_PROBE: &str = r#"(function(){
  var where = 'no';
  var x = 0, y = 0;
  var frame = document.getElementById('frame-canvas');
  if (document.getElementById('board')) where = 'canvas';
  else {
    var doc = frame && frame.contentDocument;
    if (frame && frame.classList.contains('active') && doc && doc.getElementById('board')) where = 'frame';
  }
  if (where === 'frame' && frame) {
    var r = frame.getBoundingClientRect();
    x = r.left; y = r.top;
  }
  fetch('/api/desktop/overlay-where', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({where: where, x: x, y: y}), keepalive: true}).catch(function(){});
})()"#;

static FRAME_ANCHOR: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));
/// 进入透明态时实际加到视口上的平移。退出时原数减回，避免每次重测窗口带来的误差往下叠。
static APPLIED_SHIFT: Mutex<(f64, f64)> = Mutex::new((0.0, 0.0));

/// 等页面把「是不是画布」报上来。必须在主线程之外等，否则网页脚本跑不起来。
fn wait_page_kind() -> String {
    for _ in 0..25 {
        std::thread::sleep(std::time::Duration::from_millis(20));
        let Ok(body) = overlay::http_get_text(crate::PORT, "/api/desktop/overlay-where") else {
            continue;
        };
        let kind = body.trim().to_string();
        if kind == "canvas" || kind == "frame" || kind == "no" {
            return kind;
        }
    }
    "no".into()
}

fn set_page_overlay(window: &WebviewWindow, on: bool) {
    let flag = if on { "true" } else { "false" };
    let js = format!(
        r#"(function(on){{
  if (document.getElementById('board')) {{
    window.__setOverlayMode && window.__setOverlayMode(on);
    return;
  }}
  document.documentElement.classList.toggle('desktop-overlay', !!on);
  document.body.classList.toggle('desktop-overlay', !!on);
  [document.documentElement, document.body].concat([].slice.call(document.querySelectorAll('.stage, .shell, .app-shell, #frame-canvas'))).forEach(function(el){{
    if (on) {{
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
    }} else {{
      el.style.removeProperty('background');
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
    }}
  }});
  var s = document.getElementById('artcanvas-overlay-style');
  if (!s) {{ s = document.createElement('style'); s.id = 'artcanvas-overlay-style'; document.head.appendChild(s); }}
  s.textContent = 'html.desktop-overlay,html.desktop-overlay body,html.studio-theme-dark.desktop-overlay,html.studio-theme-dark.desktop-overlay body,html.studio-theme-dark.desktop-overlay body .stage,html.studio-theme-dark.desktop-overlay body .app-shell,html.studio-theme-dark.desktop-overlay body .shell,html.desktop-overlay body .stage,html.desktop-overlay body .shell{{background:transparent!important;background-color:transparent!important;background-image:none!important}}html.desktop-overlay aside{{display:none!important}}html.desktop-overlay .stage{{position:fixed!important;inset:0!important}}html.desktop-overlay .stage iframe{{visibility:hidden!important;background:transparent!important}}html.desktop-overlay #frame-canvas{{visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;border:0!important;background:transparent!important}}';
  var frame = document.getElementById('frame-canvas');
  var inner = frame && frame.contentWindow;
  if (inner && inner.__setOverlayMode) inner.__setOverlayMode(!!on);
}})({flag});"#
    );
    let _ = window.eval(&js);
}

/// 在页面顶部弹一条 2 秒的提示（不依赖页面自身的 toast 实现）。
fn hint(window: &WebviewWindow, text: &str) {
    let js = format!(
        r#"(function(t){{
  var d=document.createElement('div');
  d.textContent=t;
  d.style.cssText='position:fixed;left:50%;top:26px;transform:translateX(-50%);z-index:2147483647;'
    +'padding:10px 16px;border-radius:10px;background:rgba(24,24,22,.94);color:#fff;'
    +'font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.38);pointer-events:none';
  document.body.appendChild(d);
  setTimeout(function(){{ d.remove(); }}, 2200);
}})('{text}');"#
    );
    let _ = window.eval(&js);
}

/// 主线程入口：必要时先导航到画布页，再套透明皮肤。
/// `allow_navigate` = 用户是否明确要求「直接进透明态」（快捷方式 / `--overlay`）。
/// 热键走 false：在项目列表按热键不该把侧边栏跳没了。
fn apply(app: &AppHandle, on: bool, allow_navigate: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("找不到主窗口".into());
    };

    if on && !is_canvas_document(&window) {
        let _ = window.eval(PAGE_PROBE);
        let handle = app.clone();
        std::thread::spawn(move || {
            let kind = wait_page_kind();
            let inner = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if kind == "no" {
                    if !allow_navigate {
                        if let Some(window) = inner.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            hint(&window, "先在画布里打开一张画布，再按 Ctrl+Alt+O");
                        }
                        ACTIVE.store(false, Ordering::SeqCst);
                        return;
                    }
                    if let Err(error) = open_canvas_then_overlay(&inner) {
                        eprintln!("[desktop-mode] 打开画布失败：{error}");
                        ACTIVE.store(false, Ordering::SeqCst);
                    }
                    return;
                }
                if let Err(error) = apply_window(&inner, true) {
                    eprintln!("[desktop-mode] 切换失败：{error}");
                    ACTIVE.store(false, Ordering::SeqCst);
                    let _ = apply_window(&inner, false);
                }
            });
        });
        return Ok(());
    }

    apply_window(app, on)
}

fn open_canvas_then_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let address = format!(
        "http://127.0.0.1:{}/static/canvas.html?mode=desktop",
        crate::PORT
    );
    let parsed = url::Url::parse(&address).map_err(|e| e.to_string())?;
    window.navigate(parsed).map_err(|e| e.to_string())?;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2400));
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Err(error) = apply_window(&inner, true) {
                eprintln!("[desktop-mode] 导航后进入穿透态失败：{error}");
                ACTIVE.store(false, Ordering::SeqCst);
                let _ = apply_window(&inner, false);
            }
        });
    });
    Ok(())
}

/// 窗口客户区在屏幕上挪了多少，就把画布平移补回去，节点世界坐标不动。
fn read_frame_anchor() -> (f64, f64) {
    let Ok(body) = overlay::http_get_text(crate::PORT, "/api/desktop/overlay-anchor") else {
        return (0.0, 0.0);
    };
    let mut parts = body.trim().split(',');
    let x = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    (x, y)
}

/// 把 WebView2 控件铺满客户区。窗口是用 MoveWindow 直接挪的，tao 不知道尺寸变了，
/// 不补这一步网页仍停留在切换前的窗口大小，看起来就是一块白板。
///
/// 网页底色的透明不在这里改：WebView2 只认创建时的 alpha，事后 SetDefaultBackgroundColor
/// 会被忽略。所以 `tauri.conf.json` 里 main 窗口的 `backgroundColor` 固定为 `#00000000`，
/// 平时由页面自己的 CSS 背景盖住，透明态把 CSS 背景清掉就透出桌面。
fn fit_webview(window: &WebviewWindow, w: i32, h: i32) {
    if w <= 0 || h <= 0 {
        return;
    }
    let _ = window.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetBounds(windows::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
        });
    });
}

fn shift_view(window: &WebviewWindow, before: (i32, i32), after: (i32, i32), scale: f64, frame: (f64, f64)) {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let dx = (before.0 - after.0) as f64 / scale + frame.0;
    let dy = (before.1 - after.1) as f64 / scale + frame.1;
    if dx.abs() < 0.5 && dy.abs() < 0.5 {
        return;
    }
    *APPLIED_SHIFT.lock().unwrap() = (dx, dy);
    let js = format!(
        r#"(function(dx,dy){{
  var target = window;
  if (!document.getElementById('board')) {{
    var frame = document.getElementById('frame-canvas');
    if (frame && frame.contentWindow) target = frame.contentWindow;
  }}
  target.__shiftCanvasView && target.__shiftCanvasView(dx, dy);
}})({dx:.2},{dy:.2});"#
    );
    let _ = window.eval(&js);
}

/// 真正的窗口改造 / 还原。
fn apply_window(app: &AppHandle, on: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;

    if on {
        // 先记下原状态，退出时才好原样还原。
        // 如果窗口当前是最小化（Windows 会把最小化窗口挪到 -32000 并缩成几十像素），
        // 这些几何值没有意义，直接换个默认的，否则退出后会"回来但看不见"。
        let _ = window.unminimize();
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let usable = position.x > -30000 && position.y > -30000 && size.width >= 200 && size.height >= 200;
        *SAVED.lock().unwrap() = Some(if usable {
            SavedWindow {
                x: position.x,
                y: position.y,
                w: size.width,
                h: size.height,
                maximized: window.is_maximized().unwrap_or(false),
                always_on_top: window.is_always_on_top().unwrap_or(false),
            }
        } else {
            SavedWindow {
                x: 120,
                y: 120,
                w: 1440,
                h: 900,
                maximized: false,
                always_on_top: false,
            }
        });

        // 画布框在侧栏右侧。皮肤会把它铺满窗口，这一段要加进平移补偿。
        let frame = read_frame_anchor();
        *FRAME_ANCHOR.lock().unwrap() = frame;
        // 先让页面变成透明皮肤，再改窗口属性，避免放大的一瞬间闪白底
        set_page_overlay(&window, true);
        let origin_before = overlay::client_origin(hwnd);

        let _ = window.unmaximize();
        window
            .set_decorations(false)
            .map_err(|e| format!("去边框失败：{e}"))?;
        let _ = window.set_always_on_top(true);
        let _ = window.set_skip_taskbar(true);
        // 不要 set_background_color：
        // None 会把网页底刷成纯白，(0,0,0,0) 会把窗口刷成纯黑。
        let center = (position.x + size.width as i32 / 2, position.y + size.height as i32 / 2);
        let screen = overlay::screen_at(app, center.0, center.1)?;
        overlay::move_to(hwnd, screen.x, screen.y, screen.w, screen.h);
        let _ = window.show();
        overlay::set_glass(hwnd, true);
        fit_webview(&window, screen.w, screen.h);
        shift_view(&window, origin_before, overlay::client_origin(hwnd), screen.scale, frame);
        overlay::start_region_sync(hwnd, &screen, app.clone());
        println!("[desktop-mode] 已进入穿透态");
    } else {
        overlay::stop_region_sync();
        overlay::clear_region(hwnd);
        overlay::set_glass(hwnd, false);
        set_page_overlay(&window, false);

        let _ = window.set_skip_taskbar(false);
        window
            .set_decorations(true)
            .map_err(|e| format!("恢复边框失败：{e}"))?;

        if let Some(saved) = SAVED.lock().unwrap().take() {
            let _ = window.set_always_on_top(saved.always_on_top);
            let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
            let _ = window.set_size(PhysicalSize::new(saved.w, saved.h));
            if saved.maximized {
                let _ = window.maximize();
            }
        }
        let _ = window.show();
        let _ = window.set_focus();
        let applied = *APPLIED_SHIFT.lock().unwrap();
        *APPLIED_SHIFT.lock().unwrap() = (0.0, 0.0);
        *FRAME_ANCHOR.lock().unwrap() = (0.0, 0.0);
        shift_view(&window, (0, 0), (0, 0), 1.0, (-applied.0, -applied.1));
        *APPLIED_SHIFT.lock().unwrap() = (0.0, 0.0);
        println!("[desktop-mode] 已回到编辑态");
    }
    Ok(())
}

/// 托盘图标 + 右键菜单。
pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(
        app,
        "toggle",
        format!("透明画布 开 / 关   ({HOTKEY_LABEL})"),
        true,
        None::<&str>,
    )?;
    let studio_item = MenuItem::with_id(app, "studio", "打开主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 IsleChain", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &studio_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("artcanvas-tray")
        .tooltip(format!("IsleChain · {HOTKEY_LABEL} 切换透明画布"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle(app),
            "studio" => show_studio(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                toggle(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    println!("[desktop-mode] 托盘图标已就绪");
    Ok(())
}

/// 注册全局热键。handler 在 main.rs 的插件构建处绑定。
pub fn init_hotkey(app: &AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO);
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("注册 {HOTKEY_LABEL} 失败：{e}"))?;
    println!("[desktop-mode] 全局热键 {HOTKEY_LABEL} 已注册");
    Ok(())
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    init_tray(app)?;
    if let Err(error) = init_hotkey(app) {
        // 热键被别的软件占了不该拖垮启动，托盘菜单仍然能切。
        eprintln!("[desktop-mode] {error}");
    }
    Ok(())
}
