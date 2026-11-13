// IsleChain 桌面端启动器
//
// 双击即用：定位 desktop/scripts/start-desktop.cmd，在一个新的控制台窗口里运行它
// （`node scripts/dev.mjs`）。自身是 windows 子系统程序，双击不会闪黑框。
//
//   IsleChain.exe                -> 后端 + studio 窗口
//   IsleChain.exe --overlay      -> 额外打开透明叠加探针窗口
//   其它参数（--no-server 等）原样透传给 dev.mjs
//
// 脚本查找顺序：exe 所在目录 → 上一级 → 上两级 → 仓库默认路径。
// 这样 exe 既可以放在 desktop/ 下，也可以被拷到别处（只要相对层级不变）。

#![windows_subsystem = "windows"]

use std::env;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// 新开一个控制台窗口承载 dev 服务；关掉该窗口即退出全部进程。
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
const MB_ICONERROR: u32 = 0x10;

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, u_type: u32) -> i32;
}

fn message_box(text: &str, caption: &str) {
    let text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let caption: Vec<u16> = caption.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), MB_ICONERROR);
    }
}

fn exe_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn candidates() -> Vec<PathBuf> {
    let dir = exe_dir();
    let mut list = vec![dir.clone()];
    if let Some(p) = dir.parent() {
        list.push(p.to_path_buf());
        if let Some(pp) = p.parent() {
            list.push(pp.to_path_buf());
        }
    }
    // 兜底：本机仓库默认位置（exe 被单独拷走时仍可用）
    list.push(PathBuf::from(r"H:\AI-Tools\islechain\desktop"));
    list
}

fn find_script() -> Option<PathBuf> {
    for base in candidates() {
        let script = base.join("scripts").join("start-desktop.cmd");
        if script.is_file() {
            return Some(script);
        }
    }
    None
}

fn main() -> ExitCode {
    let extra: Vec<String> = env::args().skip(1).collect();

    let script = match find_script() {
        Some(path) => path,
        None => {
            message_box(
                "找不到 scripts\\start-desktop.cmd。\n\n\
                 请把 IsleChain.exe 放在 islechain\\desktop\\ 目录下再运行，\n\
                 或确认该仓库没有被移动。",
                "IsleChain 启动失败",
            );
            return ExitCode::from(1);
        }
    };

    // 工作目录 = desktop/（脚本的上一级），与快捷方式行为一致
    let workdir = script.parent().and_then(Path::parent).map(Path::to_path_buf);

    let mut cmd = Command::new("cmd");
    cmd.arg("/c").arg(&script).args(&extra);
    if let Some(dir) = workdir {
        cmd.current_dir(dir);
    }

    match cmd.creation_flags(CREATE_NEW_CONSOLE).spawn() {
        Ok(_) => ExitCode::SUCCESS,
        Err(err) => {
            message_box(
                &format!("无法启动开发服务：{err}\n\n脚本：{}", script.display()),
                "IsleChain 启动失败",
            );
            ExitCode::from(1)
        }
    }
}
