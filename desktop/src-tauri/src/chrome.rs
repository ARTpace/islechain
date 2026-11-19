//! 桌面端窗口外壳：无边框 + 圆角 + 自绘窗口按钮 + 关闭收进托盘。
//!
//! 窗口本身在 `tauri.conf.json` 里就是 `decorations: false` + `transparent: true`，
//! 圆角由注入脚本用 `clip-path` 裁出来（透明窗口拿不到 DWM 圆角/阴影）。
//! 这里只负责三件事：给网页一个统一的窗口动作命令、提供注入脚本、以及在
//! 「页面导航后」把外壳补回去。

use tauri::{AppHandle, Manager, WebviewWindow};

const CHROME_JS: &str = include_str!("chrome.js");

/// 网页里的窗口按钮/拖动条统一走这一个命令，免得在前端逐条申请 window ACL。
#[tauri::command]
pub fn desktop_chrome(window: WebviewWindow, action: String) -> Result<String, String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "toggle-maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
        }
        // 走 CloseRequested，统一收口到「收进托盘」那条路径
        "close" => window.close().map_err(|e| e.to_string())?,
        "drag" => window.start_dragging().map_err(|e| e.to_string())?,
        "state" => {
            return Ok(if window.is_maximized().unwrap_or(false) {
                "maximized"
            } else {
                "normal"
            }
            .into())
        }
        "show" => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        other => return Err(format!("未知的窗口动作：{other}")),
    }
    Ok("ok".into())
}

/// 页面每导航一次就会丢掉注入的 DOM，这里做一次廉价的轮询补齐。
/// 脚本自带「已存在就返回」，命中时开销只有一次 getElementById。
pub fn watch(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let Some(window) = handle.get_webview_window("main") else {
            continue;
        };
        let _ = window.eval(CHROME_JS);
    });
}
