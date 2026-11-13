#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
mod overlay;
#[cfg(windows)]
mod desktop_mode;

// 非 Windows 平台留占位，保证 invoke_handler 的注册表一致。
#[cfg(not(windows))]
mod overlay {
    pub fn create_probe(_app: &tauri::AppHandle) -> Result<(), String> {
        Err("桌面叠加模式目前仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn overlay_set_rects(
        _window: tauri::WebviewWindow,
        _rects: Vec<[i32; 4]>,
    ) -> Result<usize, String> {
        Err("桌面叠加模式目前仅支持 Windows".into())
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) const PORT: u16 = 7000;

struct BackendGuard {
    child: Mutex<Option<Child>>,
    started_by_us: AtomicBool,
}

impl BackendGuard {
    fn stop(&self) {
        if !self.started_by_us.load(Ordering::SeqCst) {
            return;
        }
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Default)]
struct BootError(Mutex<Option<String>>);

#[tauri::command]
fn backend_startup_error(app: AppHandle) -> Option<String> {
    app.state::<BootError>().0.lock().unwrap().clone()
}

fn port_open() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{PORT}").parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// 开发模式：由 `desktop/scripts/dev.mjs` 启动，后端跑仓库根目录的 main.py，
/// 不加载打包的 sidecar，也不做进程托管。
fn dev_mode() -> bool {
    matches!(std::env::var("ARTCANVAS_DEV").as_deref(), Ok("1"))
}

fn overlay_probe_enabled() -> bool {
    // "1" = 透明画布穿透态，"probe" = 白卡片探针页
    matches!(std::env::var("ARTCANVAS_OVERLAY").as_deref(), Ok("1") | Ok("probe"))
}

fn spawn_overlay(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(900));
        // 窗口改造必须在主线程：WebView2 的父窗口与消息循环都绑在主线程。
        let inner = handle.clone();
        if let Err(error) = handle.run_on_main_thread(move || {
            let mode = std::env::var("ARTCANVAS_OVERLAY").unwrap_or_default();
            if mode == "probe" {
                if let Err(error) = overlay::create_probe(&inner) {
                    eprintln!("[overlay] 探针窗口创建失败：{error}");
                }
            } else {
                // 启动即穿透：主窗口自己换皮，不再另开一个画布窗口。
                desktop_mode::enter(&inner);
            }
        }) {
            eprintln!("[overlay] 无法调度到主线程：{error}");
        }
    });
}

fn sidecar_root(resource_dir: &std::path::Path) -> PathBuf {
    let bundled = resource_dir.join("sidecar-server");
    if bundled.join("app").join("main.py").exists() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar-server")
    }
}

fn open_studio(app: &AppHandle) {
    let Ok(address) = url::Url::parse(&format!("http://127.0.0.1:{PORT}/")) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(address);
        // 上一次可能是被最小化/藏起来关掉的，这里强制拉回可见状态
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn start_backend(app: &AppHandle) -> Result<(), String> {
    if port_open() {
        open_studio(app);
        return Ok(());
    }
    if dev_mode() {
        // 开发模式：后端由 dev.mjs 拉起，这里只等端口就绪。
        let handle = app.clone();
        std::thread::spawn(move || {
            for _ in 0..120 {
                if port_open() {
                    open_studio(&handle);
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            *handle.state::<BootError>().0.lock().unwrap() = Some(
                "开发模式：等待 127.0.0.1:7000 超时。请用 `npm run dev` 启动，或先手动运行 python main.py。"
                    .into(),
            );
        });
        return Ok(());
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let root = sidecar_root(&resource_dir);
    let python = root.join("python").join("python.exe");
    let app_dir = root.join("app");
    if !python.exists() {
        return Err(format!("未找到内置 Python：{}", python.display()));
    }
    let mut cmd = Command::new(&python);
    cmd.arg("main.py")
        .current_dir(&app_dir)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("启动本地服务失败：{e}"))?;
    app.state::<BackendGuard>().started_by_us.store(true, Ordering::SeqCst);

    if let Some(out) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                println!("[IsleChain] {line}");
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let handle = app.clone();
        std::thread::spawn(move || {
            let mut lines = Vec::new();
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[IsleChain] {line}");
                lines.push(line);
                if lines.len() > 30 {
                    lines.remove(0);
                }
            }
            if !lines.is_empty() {
                *handle.state::<BootError>().0.lock().unwrap() =
                    Some(format!("本地服务启动失败：{}", lines.last().unwrap()));
            }
        });
    }
    app.state::<BackendGuard>().child.lock().unwrap().replace(child);

    let handle = app.clone();
    std::thread::spawn(move || {
        for _ in 0..120 {
            if port_open() {
                open_studio(&handle);
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let state = handle.state::<BootError>();
        let mut error = state.0.lock().unwrap();
        if error.is_none() {
            *error = Some("本地服务启动超时。请确认 7000 端口没有被其他程序占用。".into());
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            // 已有实例在跑时，第二个进程只把意图转发过来。
            // 「叠加模式」快捷方式因此不用先关掉 studio：命令直接开在现有进程里。
            if argv.iter().any(|a| a == "--overlay") {
                if argv.iter().any(|a| a == "--probe") {
                    if app.get_webview_window("overlay").is_none() {
                        if let Err(error) = overlay::create_probe(app) {
                            eprintln!("[overlay] 第二个实例请求开探针窗口失败：{error}");
                        }
                    }
                } else {
                    // 「IsleChain 叠加模式」快捷方式：把已在跑的主窗口切进穿透态。
                    // 指定的画布 id 不再需要——主窗口自己就是那张画布。
                    desktop_mode::enter(app);
                }
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, _shortcut, _event| {
                    #[cfg(windows)]
                    if _event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        desktop_mode::toggle(_app);
                    }
                })
                .build(),
        )
        .manage(BackendGuard {
            child: Mutex::new(None),
            started_by_us: AtomicBool::new(false),
        })
        .manage(BootError::default())
        .invoke_handler(tauri::generate_handler![
            backend_startup_error,
            overlay::overlay_set_rects
        ])
        .setup(|app| {
            if let Err(error) = start_backend(app.handle()) {
                *app.state::<BootError>().0.lock().unwrap() = Some(error);
            }
            if overlay_probe_enabled() {
                spawn_overlay(app.handle());
            }
            #[cfg(windows)]
            if let Err(error) = desktop_mode::init(app.handle()) {
                eprintln!("[desktop-mode] 初始化托盘/热键失败：{error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 IsleChain 失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<BackendGuard>().stop();
            }
        });
}
