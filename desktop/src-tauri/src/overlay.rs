// 桌面叠加模式 P0 探针窗口。
// 目的：验证「区域外穿透 / 区域内可交互 / 透明无黑底」三件事，不接业务逻辑。
#![cfg(windows)]

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use std::sync::atomic::{AtomicU64, Ordering};

// 直接用 gdi32/user32 的裸 FFI，避免为 4 个函数引入 windows crate 与版本/特性漂移。
#[link(name = "gdi32")]
extern "system" {
    fn CreateRectRgn(x1: i32, y1: i32, x2: i32, y2: i32) -> isize;
    fn CombineRgn(dst: isize, src1: isize, src2: isize, mode: i32) -> i32;
    fn DeleteObject(obj: isize) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(hwnd: isize, hrgn: isize, redraw: i32) -> i32;
    fn MoveWindow(hwnd: isize, x: i32, y: i32, w: i32, h: i32, repaint: i32) -> i32;
    fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
}

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

/// 客户区左上角的屏幕坐标。穿透态搬家前后各量一次，差值用来补画布平移。
pub fn client_origin(hwnd: isize) -> (i32, i32) {
    let mut point = Point { x: 0, y: 0 };
    unsafe {
        ClientToScreen(hwnd, &mut point);
    }
    (point.x, point.y)
}

// tao 的 transparent 走的是 DwmEnableBlurBehindWindow，这个 API 在 Win11 上
// 已经不再让整个客户区透明（只剩标题栏玻璃），窗口会渲染成纯黑。
// 补一层 DwmExtendFrameIntoClientArea(MARGINS{-1}) 才是 Win10/11 通用做法：
// 整个客户区变成"玻璃"，WebView2 的透明背景才真正透出桌面。
#[link(name = "dwmapi")]
extern "system" {
    fn DwmExtendFrameIntoClientArea(hwnd: isize, margins: *const Margins) -> i32;
}

#[repr(C)]
struct Margins {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn extend_frame_for_transparency(hwnd: isize) {
    let margins = Margins { left: -1, top: -1, right: -1, bottom: -1 };
    unsafe {
        let code = DwmExtendFrameIntoClientArea(hwnd, &margins);
        if code != 0 {
            eprintln!("[overlay] DwmExtendFrameIntoClientArea 返回 {code:#x}");
        }
    }
}

const RGN_OR: i32 = 2;

/// 探针卡片矩形（CSS 像素），必须与 overlay-probe.html 里的位置保持一致。
const PROBE_CARDS: [(i32, i32, i32, i32); 2] = [(120, 160, 280, 180), (460, 340, 320, 220)];

/// 把窗口形状收窄为所有矩形的并集。矩形坐标为窗口内物理像素。
pub fn apply_region(window: &tauri::WebviewWindow, rects: &[(i32, i32, i32, i32)]) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    apply_region_hwnd(hwnd, rects)
}

pub fn apply_region_hwnd(hwnd: isize, rects: &[(i32, i32, i32, i32)]) -> Result<(), String> {
    if hwnd == 0 {
        return Err("窗口句柄为空".into());
    }
    unsafe {
        let mut union = 0isize;
        for (x, y, w, h) in rects {
            // 圆角半径为 0 时 GDI 会裁进卡片里，标题和接口被切掉。直角区域才和节点外框一致。
            let one = CreateRectRgn(*x, *y, x + w, y + h);
            if one == 0 {
                continue;
            }
            if union == 0 {
                union = one;
            } else {
                CombineRgn(union, union, one, RGN_OR);
                DeleteObject(one);
            }
        }
        if union == 0 {
            // 无矩形 = 完全穿透。仍需一个合法区域句柄，否则 SetWindowRgn 会失败。
            union = CreateRectRgn(0, 0, 0, 0);
        }
        // 成功后区域所有权归系统，不能再 DeleteObject。
        if SetWindowRgn(hwnd, union, 1) == 0 {
            DeleteObject(union);
            return Err("SetWindowRgn 失败".into());
        }
    }
    Ok(())
}

/// 前端上报节点矩形（物理像素），用于后续把探针换成真实节点。
#[tauri::command]
pub fn overlay_set_rects(window: tauri::WebviewWindow, rects: Vec<[i32; 4]>) -> Result<usize, String> {
    let boxes: Vec<(i32, i32, i32, i32)> = rects.iter().map(|r| (r[0], r[1], r[2], r[3])).collect();
    apply_region(&window, &boxes)?;
    Ok(boxes.len())
}

/// 覆盖主显示器的透明探针窗口。
pub fn create_probe(app: &AppHandle) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app.available_monitors().ok().and_then(|list| list.into_iter().next()))
        .ok_or_else(|| "没有可用显示器".to_string())?;

    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();

    let window = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay-probe.html".into()))
        .title("IsleChain Overlay Probe")
        .decorations(false)
        // alpha 背景色不能代替透明合成；与主窗口一样在创建时开启。
        // 下方 DWM 扩展客户区继续处理无边框窗口的玻璃区域。
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .position(pos.x as f64 / scale, pos.y as f64 / scale)
        .inner_size(size.width as f64 / scale, size.height as f64 / scale)
        .build()
        .map_err(|e| e.to_string())?;

    extend_frame_for_transparency(window.hwnd().map_err(|e| e.to_string())?.0 as isize);

    let rects: Vec<(i32, i32, i32, i32)> = PROBE_CARDS
        .iter()
        .map(|(x, y, w, h)| {
            let s = |v: i32| (v as f64 * scale).round() as i32;
            (s(*x), s(*y), s(*w), s(*h))
        })
        .collect();

    apply_region(&window, &rects)?;
    println!("[overlay] 探针窗口已创建：scale={scale}，区域 {} 块", rects.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// 真实画布叠加：窗口加载 canvas.html?mode=desktop，节点矩形走 HTTP 中转。
// ---------------------------------------------------------------------------

const DEV_PORT: u16 = 7000;

/// 极简 HTTP GET，只用于本机 127.0.0.1 的矩形中转端点。
/// 不引入 reqwest/ureq：一个 GET 不值得多一个异步运行时。
pub(crate) fn http_get_text(port: u16, path: &str) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("地址解析失败: {e}"))?,
        Duration::from_millis(400),
    )
    .map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(900)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nAccept: text/plain\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    Ok(match text.split_once("\r\n\r\n") {
        Some((_, body)) => body.to_string(),
        None => String::new(),
    })
}

/// 主屏的物理像素范围与缩放比例。
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub scale: f64,
}

pub fn screen_at(app: &AppHandle, x: i32, y: i32) -> Result<ScreenRect, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            x >= pos.x && y >= pos.y && x < pos.x + size.width as i32 && y < pos.y + size.height as i32
        });
    match monitor {
        Some(monitor) => screen_from(monitor),
        None => primary_screen(app),
    }
}

fn screen_from(monitor: tauri::Monitor) -> Result<ScreenRect, String> {
    let pos = monitor.position();
    let size = monitor.size();
    Ok(ScreenRect {
        x: pos.x,
        y: pos.y,
        w: size.width as i32,
        h: size.height as i32,
        scale: monitor.scale_factor(),
    })
}

pub fn primary_screen(app: &AppHandle) -> Result<ScreenRect, String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app.available_monitors().ok().and_then(|list| list.into_iter().next()))
        .ok_or_else(|| "没有可用显示器".to_string())?;
    screen_from(monitor)
}

/// 开关 DWM 玻璃：开 = 客户区透出桌面，关 = 恢复正常不透明客户区。
/// 只改视觉效果，真正的"点击穿透"仍然靠 SetWindowRgn。
pub fn set_glass(hwnd: isize, on: bool) {
    let margins = if on {
        Margins { left: -1, top: -1, right: -1, bottom: -1 }
    } else {
        Margins { left: 0, top: 0, right: 0, bottom: 0 }
    };
    unsafe {
        let code = DwmExtendFrameIntoClientArea(hwnd, &margins);
        if code != 0 {
            eprintln!("[overlay] DwmExtendFrameIntoClientArea({on}) 返回 {code:#x}");
        }
    }
}

/// 取消窗口区域裁剪，恢复成完整矩形。
pub fn clear_region(hwnd: isize) {
    unsafe {
        // 传空区域句柄 = 移除区域。
        SetWindowRgn(hwnd, 0, 1);
    }
}

/// 按物理像素摆窗口。tao 的 set_position/inner_size 在高缩放下会重复应用 scale，
/// 这里直接用 Win32，缩放多少都不影响结果。
pub fn move_to(hwnd: isize, x: i32, y: i32, w: i32, h: i32) {
    unsafe {
        MoveWindow(hwnd, x, y, w, h, 1);
    }
}

static REGION_GEN: AtomicU64 = AtomicU64::new(0);

/// 透明态不再按节点切窗口。
/// 切成方块会把连线、标题和接口一起裁掉，看起来像卡片套在矩形里。
/// 这里只清掉区域，让整张画布（含连线）照常画在透明底上，并继续听退出信号。
pub fn start_region_sync(hwnd: isize, _screen: &ScreenRect, app: AppHandle) {
    clear_region(hwnd);

    let generation = REGION_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let path = "/api/desktop/overlay-rects";
    std::thread::spawn(move || {
        println!("[overlay] 透明态已打开，窗口不再按节点裁切");
        while REGION_GEN.load(Ordering::SeqCst) == generation {
            std::thread::sleep(std::time::Duration::from_millis(80));
            if REGION_GEN.load(Ordering::SeqCst) != generation {
                break;
            }
            let Ok(body) = http_get_text(DEV_PORT, path) else { continue };
            if body.trim() == "EXIT" {
                println!("[overlay] 收到页面退出请求，还原窗口");
                crate::desktop_mode::toggle(&app);
                break;
            }
        }
        println!("[overlay] 透明态监听已停止");
    });
}

pub fn stop_region_sync() {
    REGION_GEN.fetch_add(1, Ordering::SeqCst);
}
