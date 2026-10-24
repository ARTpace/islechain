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
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PORT: u16 = 7000;

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
    }
}

fn start_backend(app: &AppHandle) -> Result<(), String> {
    if port_open() {
        open_studio(app);
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
                println!("[art-canvas] {line}");
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let handle = app.clone();
        std::thread::spawn(move || {
            let mut lines = Vec::new();
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                eprintln!("[art-canvas] {line}");
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
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(BackendGuard {
            child: Mutex::new(None),
            started_by_us: AtomicBool::new(false),
        })
        .manage(BootError::default())
        .invoke_handler(tauri::generate_handler![backend_startup_error])
        .setup(|app| {
            if let Err(error) = start_backend(app.handle()) {
                *app.state::<BootError>().0.lock().unwrap() = Some(error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 ArtCanvas 失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<BackendGuard>().stop();
            }
        });
}
