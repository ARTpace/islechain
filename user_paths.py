"""个人数据目录。

词库、风格包、通配符仍留在工程 data/ 里。
生成图、历史、账号、会话和密钥放到当前系统用户目录，
可用环境变量 ART_CANVAS_HOME 改位置。
"""
import os
import shutil
import sys

APP_NAME = "art-canvas"

# (工程内相对路径, 用户目录内相对路径, 是否目录)
_MOVES = (
    ("output", "output", True),
    ("input", "input", True),
    ("history.json", "history.json", False),
    ("global_config.json", "global_config.json", False),
    ("API/.env", "api.env", False),
    ("data/users.json", "users.json", False),
    ("data/conversations", "conversations", True),
    ("data/canvases", "canvases", True),
    ("data/asset_library.json", "asset_library.json", False),
    ("data/user-prompt-dict.json", "user-prompt-dict.json", False),
    ("data/translate-config.json", "translate-config.json", False),
    ("data/smart-prompt-config.json", "smart-prompt-config.json", False),
    ("data/smart-prompt-presets", "smart-prompt-presets", True),
    ("data/tts_voices", "tts_voices", True),
    ("data/media_previews", "media_previews", True),
    ("data/thumbnails", "thumbnails", True),
    ("data/backups", "backups", True),
    ("data/shared_folders.json", "shared_folders.json", False),
    ("data/runninghub_workflows.json", "runninghub_workflows.json", False),
    ("data/_test_localstorage.json", "_test_localstorage.json", False),
)


def user_data_dir() -> str:
    override = (os.environ.get("ART_CANVAS_HOME") or "").strip()
    if override:
        return os.path.abspath(os.path.expanduser(override))
    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, APP_NAME)
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", APP_NAME)
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, APP_NAME)


def _relocate(src: str, dst: str) -> None:
    """搬到目标路径。跨磁盘时先复制，失败则清掉半成品，源文件保留。"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    src_drive = os.path.splitdrive(os.path.abspath(src))[0]
    dst_drive = os.path.splitdrive(os.path.abspath(dst))[0]
    if src_drive.lower() == dst_drive.lower():
        shutil.move(src, dst)
        return
    try:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    except Exception:
        if os.path.isdir(dst):
            shutil.rmtree(dst, ignore_errors=True)
        elif os.path.isfile(dst):
            try:
                os.remove(dst)
            except OSError:
                pass
        raise
    if os.path.isdir(src):
        shutil.rmtree(src)
    else:
        os.remove(src)


def _same_path(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def migrate_project_user_data(project_dir: str, home: str | None = None) -> list[str]:
    """把工程里已有的个人数据搬到用户目录。目标已存在则跳过，不覆盖。"""
    home = home or user_data_dir()
    if _same_path(project_dir, home):
        return []
    os.makedirs(home, exist_ok=True)
    moved: list[str] = []
    for src_rel, dst_rel, _is_dir in _MOVES:
        src = os.path.join(project_dir, *src_rel.split("/"))
        dst = os.path.join(home, *dst_rel.split("/"))
        if not os.path.exists(src) or os.path.exists(dst):
            continue
        print(f"[art-canvas] 正在迁出 {src_rel}", flush=True)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        _relocate(src, dst)
        moved.append(dst_rel)

    log_dst = os.path.join(home, "logs")
    os.makedirs(log_dst, exist_ok=True)
    log_sources = [project_dir]
    data_dir = os.path.join(project_dir, "data")
    if os.path.isdir(data_dir):
        log_sources.append(data_dir)
    for folder in log_sources:
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            if not name.endswith(".log"):
                continue
            src = os.path.join(folder, name)
            dst = os.path.join(log_dst, name)
            if os.path.isfile(src) and not os.path.exists(dst):
                _relocate(src, dst)
                moved.append("logs/" + name)
    return moved
