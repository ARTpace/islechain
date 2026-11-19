// WebView2 窗口级偏好设置。
//
// 桌面端所有页面都跑在 WebView2 里，默认右键菜单（返回 / 刷新 / 另存为 /
// 打印 / 更多工具 / 检查）是浏览器语义，不是应用语义。这里在原生层关掉它：
//   * 覆盖整张 webview，页面导航、iframe 都不用各自改代码；
//   * 只关「原生菜单」，DOM 的 contextmenu 事件照常派发，前端自绘的
//     右键菜单（gallery/context-menu.js、图片管理器等）完全不受影响。
#![cfg(windows)]

use tauri::{AppHandle, Manager, WebviewWindow};

/// 逃生开关（配置缝）：临时需要 DevTools 原生菜单时，
/// 设环境变量 ISLECHAIN_NATIVE_CONTEXT_MENU=1 启动即可恢复。
const RESTORE_ENV: &str = "ISLECHAIN_NATIVE_CONTEXT_MENU";

fn native_menu_restored() -> bool {
    matches!(
        std::env::var(RESTORE_ENV).as_deref(),
        Ok("1") | Ok("true") | Ok("on")
    )
}

/// 关闭单个窗口的 WebView2 默认右键菜单。
pub fn disable_native_context_menu(window: &WebviewWindow) {
    if native_menu_restored() {
        return;
    }
    let _ = window.with_webview(|webview| unsafe {
        let result = webview
            .controller()
            .CoreWebView2()
            .and_then(|core| core.Settings())
            .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false));
        if let Err(error) = result {
            eprintln!("[webview-prefs] 关闭原生右键菜单失败：{error}");
        }
    });
}

/// 应用到当前所有窗口。之后新建的窗口请在创建处再调一次
/// `disable_native_context_menu`（见 overlay.rs::create_probe）。
pub fn apply_to_all(app: &AppHandle) {
    for (_label, window) in app.webview_windows() {
        disable_native_context_menu(&window);
    }
}
