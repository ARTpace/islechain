import json
import uuid
import base64
import hashlib
import urllib.request
import urllib.parse
import urllib.error
import os
import sys
import re
import subprocess
import glob
import random
import time
import shutil
import asyncio
import shlex
import tempfile
import threading
from contextvars import ContextVar
import concurrent.futures
import zipfile
from io import BytesIO
import requests
from typing import List, Dict, Any, Optional, Tuple
from threading import Lock
from contextlib import asynccontextmanager
import httpx
import ssl
import certifi

# 内部 ComfyUI 请求共用校验证书，避免在事件循环里反复加载证书文件。
COMFY_HTTP_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
# 清除坏掉的 SSL_CERT_FILE 环境变量(ComfyUI/python_embeded 遗留的 CA 路径可能不存在)
os.environ.pop("SSL_CERT_FILE", None)
os.environ.pop("REQUESTS_CA_BUNDLE", None)
import websockets as ws_client
# 强制本地地址绕过系统代理(VPN 等),避免 httpx 误走代理导致 502
# 注意: 原代码用 os.environ.setdefault, 在用户环境已存在 NO_PROXY(如 Clash 注入,
# 只含 localhost 不含 127.0.0.1) 时会直接失效, 导致 127.0.0.1:8188 仍走代理 -> 502。
# 改为"在原有 NO_PROXY 基础上追加本地地址", 确保 127.0.0.1 必被豁免, 同时保留用户其他豁免项。
_existing_np = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
_required_np = ["127.0.0.1", "localhost", "::1", "0.0.0.0"]
_parts_np = [p.strip() for p in _existing_np.split(",") if p.strip()]
for _r in _required_np:
    if _r not in _parts_np:
        _parts_np.append(_r)
os.environ["NO_PROXY"] = ",".join(_parts_np)
os.environ["no_proxy"] = os.environ["NO_PROXY"]

# ── 启动环境诊断日志 ──────────────────────────────────
from datetime import datetime  # noqa: E402  (需早于下方诊断日志)
try:
    _env_keys = ["HTTP_PROXY","HTTPS_PROXY","NO_PROXY","no_proxy","http_proxy","https_proxy",
                 "COMFYUI_INSTANCES","COMFYUI_BASE_PATH","ALL_PROXY","all_proxy",
                 "SystemRoot","USERNAME","HOMEPATH"]
    _log_lines = [f"=== art-canvas startup {datetime.now().isoformat()} ==="]
    for _k in _env_keys:
        _v = os.environ.get(_k, "<NOT SET>")
        _log_lines.append(f"  {_k}={_v!r}")
    _log_lines.append(f"  PYTHON_EXE={sys.executable}")
    _log_lines.append(f"  CWD={os.getcwd()}")
    _log_lines.append(f"  httpx_version={httpx.__version__}")
    import platform; _log_lines.append(f"  platform={platform.platform()}")
    from core.user_paths import user_data_dir, migrate_project_user_data
    _project_dir = os.path.dirname(os.path.abspath(__file__))
    _user_home = user_data_dir()
    try:
        _moved = migrate_project_user_data(_project_dir, _user_home)
        print(f"[art-canvas] 个人数据目录: {_user_home}")
        if _moved:
            print(f"[art-canvas] 已从工程目录迁出 {len(_moved)} 项个人数据")
    except Exception as _migrate_exc:
        print(f"[art-canvas] 个人数据迁移失败: {_migrate_exc}")
    _log_dir = os.path.join(_user_home, "logs")
    os.makedirs(_log_dir, exist_ok=True)
    with open(os.path.join(_log_dir, "startup_env.log"), "w", encoding="utf-8") as _f:
        _f.write("\n".join(_log_lines))
except Exception:
    pass  # 启动诊断日志失败不阻塞启动
# ──────────────────────────────────────────────────────

from PIL import Image, ImageOps
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Request, Form
from fastapi.responses import FileResponse, Response, StreamingResponse, RedirectResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# --- WebSocket 状态管理器 ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_connections: Dict[str, WebSocket] = {}
        self.connection_clients: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, client_id: str = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_clients[websocket] = client_id or f"anon-{id(websocket)}"
        if client_id:
            self.user_connections[client_id] = websocket
        print(f"WS Connected. Total: {len(self.active_connections)}, Online: {self.online_count()}")
        await self.broadcast_count()

    async def disconnect(self, websocket: WebSocket, client_id: str = None):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_clients.pop(websocket, None)
        if client_id and self.user_connections.get(client_id) is websocket:
            del self.user_connections[client_id]
        print(f"WS Disconnected. Total: {len(self.active_connections)}, Online: {self.online_count()}")
        await self.broadcast_count()

    def online_count(self):
        visible_clients = {
            client_id for client_id in self.connection_clients.values()
            if client_id and not str(client_id).startswith("canvas_")
        }
        return len(visible_clients)

    async def broadcast_count(self):
        count = self.online_count()
        data = json.dumps({"type": "stats", "online_count": count})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                print(f"Broadcast error: {e}")
                self.active_connections.remove(connection)

    async def broadcast_new_image(self, image_data: dict):
        data = json.dumps({"type": "new_image", "data": image_data})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                print(f"Broadcast image error: {e}")
                self.active_connections.remove(connection)

    async def send_personal_message(self, message: dict, client_id: str):
        ws = self.user_connections.get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                print(f"Personal message error for {client_id}: {e}")

# --- 应用初始化 ---
manager = ConnectionManager()
GLOBAL_LOOP = None
CANVAS_TASKS: Dict[str, Dict[str, Any]] = {}
CANVAS_TASK_LOCK = Lock()
APP_BOOT_ID = uuid.uuid4().hex
AI_IMAGE_TASKS = {}  # {task_id: {status, result, updated_at, ...}}
AI_IMAGE_TASK_LOCK = Lock()
IMAGE_REQUEST_MODES = {"openai", "openai-json", "openai-video-proxy", "openai-responses", "openai-async-image"}
OPENAI_ASYNC_IMAGE_DEFAULT_MODELS = ["gpt-image-2-all"]
OPENAI_ASYNC_IMAGE_TASK_TIMEOUT = 1800
OPENAI_ASYNC_IMAGE_POLL_INTERVAL = 5
OPENAI_ASYNC_IMAGE_INITIAL_POLL_DELAY = 10

@asynccontextmanager
async def lifespan(app: FastAPI):
    global GLOBAL_LOOP
    GLOBAL_LOOP = asyncio.get_running_loop()
    try:
        await asyncio.to_thread(migrate_account_private_data)
    except Exception as exc:
        print(f"账号数据拆分失败: {exc}")
    # 启动时整理资产库
    try:
        await asyncio.to_thread(migrate_unified_asset_storage)
        await asyncio.to_thread(migrate_asset_library_into_dirs)
    except Exception as exc:
        print(f"资产库分组整理失败: {exc}")
    try:
        await asyncio.to_thread(migrate_double_extension_uploads)
    except Exception as exc:
        print(f"修复双重扩展名素材失败: {exc}")
    print("Application startup complete.")
    try:
        from core import lan_sharing
        await asyncio.to_thread(lan_sharing.sync_listeners)
    except Exception as exc:
        print(f"局域网共享启动失败: {exc}")
    yield
    print("Application shutting down.")

app = FastAPI(lifespan=lifespan)

REQUEST_TOKEN: ContextVar[str] = ContextVar("request_token", default="")
LAN_VISITOR: ContextVar[bool] = ContextVar("lan_visitor", default=False)

class RequestTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        token = ""
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        if not token:
            token = (request.query_params.get("token") or "").strip()
        if not token:
            token = (request.cookies.get("xy_auth_token") or "").strip()
        handle = REQUEST_TOKEN.set(token)
        try:
            return await call_next(request)
        finally:
            REQUEST_TOKEN.reset(handle)

app.add_middleware(RequestTokenMiddleware)

class LanShareMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        from core import lan_sharing
        return await lan_sharing.guard(request, call_next)

app.add_middleware(LanShareMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
from tools.performance_timing import PerformanceTimingMiddleware
app.add_middleware(PerformanceTimingMiddleware, boot_id=APP_BOOT_ID)

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket, client_id)
    except Exception as e:
        print(f"WS Error: {e}")
        await manager.disconnect(websocket, client_id)

# --- 即梦 CLI 配置 ---
JIMENG_LOGIN_SESSION = {
    "proc": None,
    "stdout": "",
    "stderr": "",
    "started_at": 0.0,
}
JIMENG_DEFAULT_IMAGE_MODELS = ["5.0", "4.6", "4.5", "4.1", "4.0", "3.1", "3.0"]
JIMENG_DEFAULT_VIDEO_MODELS = ["seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0", "seedance2.0fast", "3.5pro", "3.0pro", "3.0", "3.0fast"]
JIMENG_LEGACY_IMAGE_MODELS = {"jimeng-image-2k", "jimeng-image-4k"}
JIMENG_LEGACY_VIDEO_MODELS = {"jimeng-video-720p", "jimeng-video-1080p"}
try:
    JIMENG_DEFAULT_POLL_SECONDS = max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", "900"))))
except Exception:
    JIMENG_DEFAULT_POLL_SECONDS = 900
JIMENG_MIN_CLI_VERSION = (1, 4, 2)
JIMENG_TEXT2IMAGE_MODELS = {"3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "5.0"}
JIMENG_IMAGE2IMAGE_MODELS = {"4.0", "4.1", "4.5", "4.6", "5.0"}
JIMENG_VIDEO_1080P_MODELS = {"seedance2.0_vip", "seedance2.0fast_vip"}
JIMENG_RATIO_CHOICES = [(21, 9), (16, 9), (3, 2), (4, 3), (1, 1), (3, 4), (2, 3), (9, 16)]

# --- 即梦 CLI 依赖函数 ---

def provider_protocol(provider):
    return str((provider or {}).get("protocol") or "openai").strip().lower()

def is_jimeng_provider(provider):
    return provider_protocol(provider) == "jimeng" or str((provider or {}).get("id") or "").strip().lower() == "jimeng"

def read_api_env_value(key: str) -> str:
    key = str(key or "").strip()
    if not key or not os.path.exists(API_ENV_FILE):
        return ""
    try:
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                env_key, value = line.split("=", 1)
                if env_key.strip() == key:
                    return value.strip().strip('"').strip("'")
    except Exception:
        return ""

def parse_size_pair(size):
    match = re.fullmatch(r"\s*(\d+)\s*[xX*]\s*(\d+)\s*", str(size or ""))
    if not match:
        return 0, 0
    return int(match.group(1)), int(match.group(2))

async def save_remote_video_to_output(url, prefix="video_", owner="", feature="video"):
    """下载远程视频到 output（走统一层级 output/{owner}/video/{feature}/{date}/）。"""
    if not url:
        return ""
    if url.startswith("/output/") or url.startswith("/assets/"):
        return url
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.mp4"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = (response.headers.get("Content-Type") or "").lower()
            clean_path = urllib.parse.urlparse(url).path
            ext = os.path.splitext(clean_path)[1].lower()
            if ext in {".mp4", ".webm", ".mov"}:
                filename = filename[:-4] + ext
            elif "webm" in content_type:
                filename = filename[:-4] + ".webm"
            elif "quicktime" in content_type or "mov" in content_type:
                filename = filename[:-4] + ".mov"
            directory, url_prefix = media_paths.resolve_media_dir(
                owner=owner, feature=feature, kind="video", ext=filename, root=OUTPUT_DIR)
            with open(os.path.join(directory, filename), "wb") as f:
                f.write(response.content)
            return f"{url_prefix}/{filename}"
    except Exception as e:
        print(f"保存上游视频失败: {e}")
        return url

# --- 即梦 CLI 辅助函数 ---

def jimeng_env_value(key):
    return os.getenv(key, "") or read_api_env_value(key)

def jimeng_use_wsl():
    value = str(jimeng_env_value("JIMENG_USE_WSL") or "").strip().lower()
    return value in {"1", "true", "yes", "on", "wsl"}

def jimeng_cli_executable():
    if jimeng_use_wsl():
        return shutil.which("wsl.exe") or shutil.which("wsl") or "wsl.exe"
    configured = str(
        jimeng_env_value("JIMENG_BIN")
        or jimeng_env_value("DREAMINA_BIN")
        or ""
    ).strip()
    if configured:
        return configured
    return shutil.which("dreamina") or shutil.which("dreamina.exe") or shutil.which("dreamina.cmd") or ""

def decode_wsl_output(data: bytes) -> str:
    data = data or b""
    if not data:
        return ""
    if b"\x00" in data[:200]:
        try:
            return data.decode("utf-16le", errors="ignore")
        except Exception:
            pass
    return data.decode("utf-8-sig", errors="ignore")

def jimeng_wsl_base_args(exe="wsl.exe"):
    configured = str(jimeng_env_value("JIMENG_WSL_DISTRO") or "").strip()
    names = []
    try:
        proc = subprocess.run(
            [exe, "-l", "-q"],
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        names = [
            line.replace("\x00", "").strip().lstrip("*").strip()
            for line in decode_wsl_output(proc.stdout).splitlines()
            if line.replace("\x00", "").strip()
        ]
    except Exception:
        names = []
    if configured and (not names or configured in names):
        return ["-d", configured]
    if configured and names:
        print(f"JIMENG_WSL_DISTRO={configured} 不存在,已回退自动选择。可用发行版:{names}")
    try:
        ubuntu = next((name for name in names if re.match(r"^Ubuntu($|-)", name)), "")
        if ubuntu:
            return ["-d", ubuntu]
    except Exception:
        pass
    return []

def jimeng_clean_wsl_stderr(text):
    lines = []
    for line in str(text or "").splitlines():
        clean = line.replace("\x00", "").strip()
        low = clean.lower()
        is_proxy_warning = "localhost" in low and "wsl" in low and ("nat" in low or "proxy" in low or "代理" in clean)
        if clean and not is_proxy_warning:
            lines.append(clean)
    return "\n".join(lines).strip()

def windows_path_to_wsl(path):
    text = str(path or "").replace("\\", "/")
    match = re.match(r"^([A-Za-z]):/(.*)$", text)
    if match:
        return f"/mnt/{match.group(1).lower()}/{match.group(2)}"
    return text

def wsl_path_to_windows(path):
    text = str(path or "").strip()
    match = re.match(r"^/mnt/([A-Za-z])/(.*)$", text)
    if match:
        tail = match.group(2).replace("/", "\\")
        return f"{match.group(1).upper()}:\\{tail}"
    return text

def jimeng_cli_path_arg(path):
    return windows_path_to_wsl(path) if jimeng_use_wsl() else path

def jimeng_poll_seconds(default=JIMENG_DEFAULT_POLL_SECONDS):
    try:
        return max(1, min(3600, int(os.getenv("JIMENG_POLL_SECONDS", str(default)) or default)))
    except Exception:
        return default

def jimeng_extract_json(text):
    text = str(text or "").strip()
    if not text:
        return {}
    decoder = json.JSONDecoder()
    parsed = []
    for i, ch in enumerate(text):
        if ch not in "[{":
            continue
        try:
            obj, _end = decoder.raw_decode(text[i:])
            if not text[:i].strip():
                return obj
            parsed.append((i, obj))
        except Exception:
            continue
    def score(item):
        _idx, obj = item
        if not isinstance(obj, dict):
            return 1
        keys = {str(key).lower() for key in obj.keys()}
        weight = 0
        for key in ("submit_id", "gen_status", "result_json", "images", "videos", "data", "total_credit"):
            if key in keys:
                weight += 10
        return weight
    return max(parsed, key=score)[1] if parsed else {"text": text}

async def run_jimeng_cli(args, timeout=120, raw_text=False):
    exe = jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 dreamina CLI。请先安装:curl -fsSL https://jimeng.jianying.com/cli | bash,并完成 dreamina login。")
    clean_args = [str(arg) for arg in args if str(arg) != ""]
    command = jimeng_command(clean_args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail=f"即梦 CLI 执行超时:{' '.join(command[:3])}") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI:{exe}") from exc
    out_text, clean_err_text = jimeng_decode_cli_output(stdout, stderr)
    if proc.returncode != 0:
        message = clean_err_text or out_text or f"exit={proc.returncode}"
        raise HTTPException(status_code=502, detail=f"即梦 CLI 调用失败:{message[:1000]}")
    if raw_text:
        return {"_stdout": out_text, "_stderr": clean_err_text}
    raw = jimeng_extract_json(f"{out_text}\n{clean_err_text}".strip())
    if isinstance(raw, dict):
        raw.setdefault("_stdout", out_text)
        if clean_err_text:
            raw.setdefault("_stderr", clean_err_text)
    return raw

def jimeng_parse_version(text):
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", str(text or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())

async def jimeng_cli_version():
    for flag in ("--version", "-V", "version"):
        try:
            raw = await run_jimeng_cli([flag], timeout=15)
        except HTTPException:
            continue
        text = raw if isinstance(raw, str) else (raw.get("_stdout") or raw.get("_stderr") or "" if isinstance(raw, dict) else "")
        version = jimeng_parse_version(text)
        if version:
            return version, str(text).strip()
    return None, ""

def jimeng_command(clean_args, exe=None):
    exe = exe or jimeng_cli_executable()
    if jimeng_use_wsl():
        shell_line = (
            ". ~/.profile >/dev/null 2>&1 || true; . ~/.bashrc >/dev/null 2>&1 || true; "
            "DREAMINA_BIN=$(command -v dreamina || find \"$HOME\" -maxdepth 4 -type f -name dreamina 2>/dev/null | head -n 1); "
            "if [ -z \"$DREAMINA_BIN\" ]; then echo 'dreamina CLI not found in WSL' >&2; exit 127; fi; "
            '\"$DREAMINA_BIN\" ' + " ".join(shlex.quote(arg) for arg in clean_args)
        )
        return [exe, *jimeng_wsl_base_args(exe), "-e", "sh", "-lc", shell_line]
    return [exe, *clean_args]

def jimeng_decode_cli_output(stdout, stderr):
    out_text = (decode_wsl_output(stdout) if jimeng_use_wsl() else stdout.decode("utf-8", errors="replace")).strip()
    err_text = (decode_wsl_output(stderr) if jimeng_use_wsl() else stderr.decode("utf-8", errors="replace")).strip()
    clean_err_text = jimeng_clean_wsl_stderr(err_text) if jimeng_use_wsl() else err_text
    return out_text, clean_err_text

def jimeng_login_text():
    parts = []
    for key in ("stdout", "stderr"):
        value = str(JIMENG_LOGIN_SESSION.get(key) or "").strip()
        if value:
            parts.append(value)
    return "\n".join(parts).strip()

def jimeng_login_qr_from_text(text):
    text = str(text or "")
    candidates = []
    patterns = [
        r"(https?://[^\s\"'<>]+)",
        r"(dreamina://[^\s\"'<>]+)",
        r"(data:image/[^\s\"'<>]+)",
    ]
    for pattern in patterns:
        candidates.extend(re.findall(pattern, text))
    for value in candidates:
        if "login" in value.lower() or "qr" in value.lower() or value.startswith(("data:image", "dreamina://")):
            return value
    return candidates[0] if candidates else ""

async def jimeng_login_reader(proc):
    async def read_stream(stream, key):
        while True:
            chunk = await stream.readline()
            if not chunk:
                break
            text = (decode_wsl_output(chunk) if jimeng_use_wsl() else chunk.decode("utf-8", errors="replace"))
            if key == "stderr":
                text = jimeng_clean_wsl_stderr(text)
            if text:
                JIMENG_LOGIN_SESSION[key] = str(JIMENG_LOGIN_SESSION.get(key) or "") + text
    await asyncio.gather(read_stream(proc.stdout, "stdout"), read_stream(proc.stderr, "stderr"))

def jimeng_submit_id(raw):
    found = []
    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() in {"submit_id", "submitid", "task_id", "taskid"} and item:
                    found.append(str(item))
                else:
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else ""

class JimengPendingError(Exception):
    """即梦任务还在云端排队/生成(轮询超时但未失败)。submit_id 可用于后续续查。"""
    def __init__(self, submit_id, kind="image", queue_info=None, raw=None):
        self.submit_id = str(submit_id or "")
        self.kind = kind or "image"
        self.queue_info = queue_info if isinstance(queue_info, dict) else {}
        self.raw = raw
        super().__init__(f"jimeng pending submit_id={self.submit_id}")

def jimeng_queue_info(raw):
    """从即梦原始返回里就近取出 queue_info(含 queue_idx/queue_length/queue_status)。"""
    found = []
    def visit(value):
        if isinstance(value, dict):
            qi = value.get("queue_info")
            if isinstance(qi, dict) and qi:
                found.append(qi)
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else {}

def jimeng_pending_payload(exc: "JimengPendingError"):
    qi = exc.queue_info or {}
    idx = qi.get("queue_idx")
    length = qi.get("queue_length")
    if idx is not None and length is not None:
        msg = f"即梦云端排队中(第 {idx}/{length} 位),任务未丢失,可继续等待或手动查询。submit_id={exc.submit_id}"
    else:
        msg = f"即梦任务仍在生成中,任务未丢失。submit_id={exc.submit_id}"
    return {
        "jimeng_pending": True,
        "submit_id": exc.submit_id,
        "kind": exc.kind,
        "queue_info": qi,
        "message": msg,
    }

@app.exception_handler(JimengPendingError)
async def jimeng_pending_exception_handler(request: Request, exc: JimengPendingError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=202, content=jimeng_pending_payload(exc))

def jimeng_failure_reason(raw):
    found = []
    def visit(value):
        if isinstance(value, dict):
            status = str(value.get("gen_status") or value.get("status") or "").strip().lower()
            reason = value.get("fail_reason") or value.get("failReason") or value.get("error") or value.get("message") or value.get("msg")
            if reason and (status in {"fail", "failed", "error"} or "fail" in str(reason).lower() or "invalid param" in str(reason).lower()):
                found.append(str(reason))
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(raw)
    return found[0] if found else ""

def jimeng_collect_media_values(value, outputs):
    media_ext = re.compile(r"\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)", re.I)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return
        if text.startswith(("http://", "https://", "/output/", "/assets/", "file://")) or media_ext.search(text):
            outputs.append(text)
        return
    if isinstance(value, list):
        for item in value:
            jimeng_collect_media_values(item, outputs)
        return
    if isinstance(value, dict):
        for key in (
            "url", "urls", "image", "images", "image_url", "image_urls",
            "video", "videos", "video_url", "video_urls", "output", "outputs",
            "result", "results", "file", "files", "path", "paths",
            "download_url", "download_urls", "downloadUrl", "file_path", "filePath",
        ):
            if key in value:
                jimeng_collect_media_values(value.get(key), outputs)
        for item in value.values():
            if isinstance(item, (dict, list)):
                jimeng_collect_media_values(item, outputs)

def jimeng_output_values(raw):
    outputs = []
    jimeng_collect_media_values(raw, outputs)
    deduped = []
    for value in outputs:
        if value not in deduped:
            deduped.append(value)
    return deduped

def jimeng_ratio_from_size(size, fallback="1:1"):
    width, height = parse_size_pair(size)
    if not width or not height:
        return fallback
    ratio = width / max(1, height)
    left, right = min(JIMENG_RATIO_CHOICES, key=lambda item: abs(ratio - item[0] / item[1]))
    return f"{left}:{right}"

def jimeng_normalize_image_model(model):
    match = re.search(r"(\d+\.\d+)", str(model or ""))
    return match.group(1) if match else ""

def jimeng_image_model_version(model, mode="text2image"):
    version = jimeng_normalize_image_model(model)
    allowed = JIMENG_IMAGE2IMAGE_MODELS if mode == "image2image" else JIMENG_TEXT2IMAGE_MODELS
    return version if version in allowed else ""

def jimeng_image_resolution(model, size, mode="text2image"):
    text = str(model or "").lower()
    if "4k" in text:
        desired = "4k"
    elif "1k" in text:
        desired = "1k"
    elif "2k" in text:
        desired = "2k"
    else:
        width, height = parse_size_pair(size)
        desired = "4k" if max(width, height) > 2048 else "2k"
    version = jimeng_normalize_image_model(model)
    if mode == "image2image":
        return "4k" if desired == "4k" else "2k"
    if version in ("3.0", "3.1"):
        return "1k" if desired == "1k" else "2k"
    return "4k" if desired == "4k" else "2k"

def jimeng_video_resolution(model, resolution):
    version = jimeng_video_model_version(model)
    requested = str(resolution or "").strip().upper()
    if requested not in {"480P", "720P", "1080P"}:
        text = str(model or "").lower()
        requested = "1080P" if "1080" in text else "720P"
    if requested == "1080P" and version in JIMENG_VIDEO_1080P_MODELS:
        return "1080P"
    return "720P"

def jimeng_video_duration_range(model):
    version = jimeng_video_model_version(model)
    if version in ("3.0", "3.0fast", "3.0pro"):
        return 3, 10
    if version == "3.5pro":
        return 4, 12
    return 4, 15

def jimeng_video_duration(duration, model=None):
    low, high = jimeng_video_duration_range(model)
    default = max(low, min(high, 5))
    try:
        text = str(duration).strip() if duration is not None else ""
        value = default if text == "" else int(text)
    except Exception:
        value = default
    return max(low, min(high, value))

def jimeng_transition_duration(total_duration, transition_count):
    count = max(1, int(transition_count or 1))
    try:
        total = float(total_duration or 5)
    except Exception:
        total = 5.0
    return max(0.5, min(8.0, total / count))

def jimeng_video_model_version(model):
    value = str(model or "").strip()
    low = value.lower()
    aliases = {
        "seedance2.0fast_vip": "seedance2.0fast_vip",
        "seedance2.0_vip": "seedance2.0_vip",
        "seedance2.0fast": "seedance2.0fast",
        "seedance2.0": "seedance2.0",
        "3.0_fast": "3.0fast",
        "3.0fast": "3.0fast",
        "3.0_pro": "3.0pro",
        "3.0pro": "3.0pro",
        "3.5_pro": "3.5pro",
        "3.5pro": "3.5pro",
        "3.0": "3.0",
    }
    for key, mapped in aliases.items():
        if key in low:
            return mapped
    return ""

def jimeng_video_resolution_arg(model, resolution):
    return jimeng_video_resolution(model, resolution).lower()

def jimeng_video_ratio_arg(aspect_ratio):
    value = str(aspect_ratio or "").strip()
    allowed = {"1:1", "3:4", "16:9", "4:3", "9:16", "21:9"}
    if value in allowed:
        return value
    return ""

def jimeng_append_model_resolution_args(args, payload, include_model=False):
    model_version = jimeng_video_model_version(payload.model)
    if include_model and model_version:
        args.append(f"--model_version={model_version}")
    if payload.resolution:
        args.append(f"--video_resolution={jimeng_video_resolution_arg(payload.model, payload.resolution)}")

def jimeng_video_ref_role(ref):
    role = getattr(ref, "role", "")
    if isinstance(ref, dict):
        role = ref.get("role", role)
    return str(role or "").lower()

def jimeng_video_ref_url(ref):
    url = getattr(ref, "url", "")
    if isinstance(ref, dict):
        url = ref.get("url", url)
    return str(url or "").strip()

def jimeng_local_output_url(path, kind="image"):
    path = os.path.abspath(str(path or ""))
    if not os.path.isfile(path):
        return ""
    ext = os.path.splitext(path)[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
    if ext not in allowed:
        ct = content_type_for_path(path)
        ext = ".mp4" if ct.startswith("video/") else ".png"
    prefix = "jimeng_video_" if kind == "video" else "jimeng_"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    # 即梦 CLI 落本地文件，按 kind 分开登记，避免图片/视频混进同一个目录
    feature = {"video": "jimeng-video", "audio": "jimeng-audio"}.get(kind, "jimeng")
    directory, url_prefix = media_paths.resolve_media_dir(
        owner="", feature=feature, kind=kind, ext=ext, root=OUTPUT_DIR)
    shutil.copyfile(path, os.path.join(directory, filename))
    return f"{url_prefix}/{filename}"

async def jimeng_store_output_value(value, kind="image"):
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("/output/") or text.startswith("/assets/"):
        return text
    if text.startswith("file://"):
        text = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", text):
            text = text[1:]
    if jimeng_use_wsl() and text.startswith("/mnt/"):
        text = wsl_path_to_windows(text)
    if text.startswith(("http://", "https://")):
        if kind == "video":
            return await save_remote_video_to_output(text, prefix="jimeng_video_", feature="jimeng-video")
        return await save_ai_image_to_output({"type": "url", "value": text}, prefix="jimeng_")
    if os.path.isfile(text):
        return jimeng_local_output_url(text, kind)
    return ""

async def jimeng_query_result(submit_id, kind="image"):
    args = [
        "query_result",
        f"--submit_id={submit_id}",
        f"--download_dir={jimeng_cli_path_arg(OUTPUT_DIR)}",
    ]
    return await run_jimeng_cli(args, timeout=min(300, jimeng_poll_seconds() + 60))

async def jimeng_store_outputs(raw, kind="image", allow_query=True):
    failure = jimeng_failure_reason(raw)
    if failure:
        raise HTTPException(status_code=502, detail=f"即梦生成失败:{failure}")
    values = jimeng_output_values(raw)
    urls = []
    for value in values:
        local_url = await jimeng_store_output_value(value, kind)
        if local_url and local_url not in urls:
            urls.append(local_url)
    if urls:
        return urls
    submit_id = jimeng_submit_id(raw)
    if submit_id and allow_query:
        queried = await jimeng_query_result(submit_id, kind)
        try:
            return await jimeng_store_outputs(queried, kind, allow_query=False)
        except HTTPException as exc:
            if getattr(exc, "status_code", None) == 502:
                status_text = json.dumps(queried, ensure_ascii=False)[:800] if isinstance(queried, (dict, list)) else str(queried)[:800]
                raise HTTPException(status_code=502, detail=f"即梦任务已返回但没有下载到媒体:{status_text}") from exc
            raise
    status_text = json.dumps(raw, ensure_ascii=False)[:800] if isinstance(raw, (dict, list)) else str(raw)[:800]
    if submit_id:
        raise JimengPendingError(submit_id, kind, jimeng_queue_info(raw), raw)
    raise HTTPException(status_code=502, detail=f"即梦 CLI 未返回可用媒体结果:{status_text}")

async def jimeng_prepare_local_media(ref_url, kind="image"):
    text = str(ref_url or "").strip()
    if not text:
        return "", []
    if text.startswith("/output/") or text.startswith("/assets/"):
        path = output_file_from_url(text)
        if path:
            return path, []
        raise HTTPException(status_code=404, detail=f"即梦参考素材不存在:{text}")
    if text.startswith("file://"):
        path = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        if os.path.isfile(path):
            return path, []
    if os.path.isfile(text):
        return text, []
    suffix = ".mp4" if kind == "video" else (".mp3" if kind == "audio" else ".png")
    temp_paths = []
    if text.startswith("data:"):
        if ";base64," not in text:
            raise HTTPException(status_code=400, detail="即梦参考素材 data URL 缺少 base64 数据")
        header, encoded = text.split(";base64,", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0] if ":" in header else ""
        suffix = mimetypes.guess_extension(mime) or suffix
        fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(base64.b64decode(encoded))
        temp_paths.append(path)
        return path, temp_paths
    if text.startswith(("http://", "https://")):
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0), follow_redirects=True) as client:
            response = await client.get(text)
            response.raise_for_status()
            clean_path = urllib.parse.urlparse(text).path
            suffix = os.path.splitext(clean_path)[1] or mimetypes.guess_extension(response.headers.get("content-type", "")) or suffix
            fd, path = tempfile.mkstemp(prefix="jimeng_ref_", suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(response.content)
            temp_paths.append(path)
            return path, temp_paths
    raise HTTPException(status_code=400, detail=f"即梦 CLI 只支持本地文件参考素材,无法读取:{text[:120]}")

async def generate_jimeng_provider_image(prompt, size, model, reference_images=None, provider=None):
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    temp_paths = []
    try:
        args = []
        if refs:
            image_path, created = await jimeng_prepare_local_media(refs[0].get("url"), "image")
            temp_paths.extend(created)
            model_version = jimeng_image_model_version(model, "image2image")
            args = [
                "image2image",
                f"--images={jimeng_cli_path_arg(image_path)}",
                f"--prompt={prompt}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'image2image')}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        else:
            model_version = jimeng_image_model_version(model, "text2image")
            args = [
                "text2image",
                f"--prompt={prompt}",
                f"--ratio={jimeng_ratio_from_size(size)}",
                f"--resolution_type={jimeng_image_resolution(model, size, 'text2image')}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            if model_version:
                args.append(f"--model_version={model_version}")
        raw = await run_jimeng_cli(args, timeout=jimeng_poll_seconds() + 120)
        urls = await jimeng_store_outputs(raw, "image")
        return {"type": "url", "value": urls[0]}, raw
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

async def generate_jimeng_video(payload, provider):
    image_refs = [ref for ref in (payload.images or []) if jimeng_video_ref_url(ref)]
    video_refs = [url for url in (payload.videos or []) if str(url or "").strip()]
    audio_refs = [url for url in (payload.audios or []) if str(url or "").strip()][:3]
    duration = jimeng_video_duration(payload.duration, payload.model)
    temp_paths = []
    try:
        if payload.multimodal or video_refs or audio_refs:
            image_paths = []
            video_paths = []
            audio_paths = []
            for ref in image_refs[:9]:
                image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                temp_paths.extend(created)
                image_paths.append(image_path)
            for ref_url in video_refs[:3]:
                video_path, created = await jimeng_prepare_local_media(ref_url, "video")
                temp_paths.extend(created)
                video_paths.append(video_path)
            for ref_url in audio_refs:
                audio_path, created = await jimeng_prepare_local_media(ref_url, "audio")
                temp_paths.extend(created)
                audio_paths.append(audio_path)
            args = [
                "multimodal2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            ratio = jimeng_video_ratio_arg(payload.aspect_ratio)
            if ratio:
                args.append(f"--ratio={ratio}")
            jimeng_append_model_resolution_args(args, payload, include_model=True)
            for image_path in image_paths:
                args.append(f"--image={jimeng_cli_path_arg(image_path)}")
            for video_path in video_paths:
                args.append(f"--video={jimeng_cli_path_arg(video_path)}")
            for audio_path in audio_paths:
                args.append(f"--audio={jimeng_cli_path_arg(audio_path)}")
        elif len(image_refs) >= 2:
            first_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "first_frame"), None)
            last_frame = next((ref for ref in image_refs if jimeng_video_ref_role(ref) == "last_frame"), None)
            if first_frame and last_frame:
                first_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(first_frame), "image")
                temp_paths.extend(created)
                last_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(last_frame), "image")
                temp_paths.extend(created)
                args = [
                    "frames2video",
                    f"--first={jimeng_cli_path_arg(first_path)}",
                    f"--last={jimeng_cli_path_arg(last_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
            else:
                image_paths = []
                for ref in image_refs:
                    image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(ref), "image")
                    temp_paths.extend(created)
                    image_paths.append(image_path)
                args = [
                    "multiframe2video",
                    f"--images={','.join(jimeng_cli_path_arg(path) for path in image_paths)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
        elif image_refs:
            image_path, created = await jimeng_prepare_local_media(jimeng_video_ref_url(image_refs[0]), "image")
            temp_paths.extend(created)
            ratio = jimeng_video_ratio_arg(payload.aspect_ratio)
            if ratio:
                args = [
                    "multimodal2video",
                    f"--image={jimeng_cli_path_arg(image_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--ratio={ratio}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
            else:
                args = [
                    "image2video",
                    f"--image={jimeng_cli_path_arg(image_path)}",
                    f"--prompt={payload.prompt}",
                    f"--duration={duration}",
                    f"--poll={jimeng_poll_seconds()}",
                ]
                jimeng_append_model_resolution_args(args, payload, include_model=True)
        else:
            args = [
                "text2video",
                f"--prompt={payload.prompt}",
                f"--duration={duration}",
                f"--ratio={payload.aspect_ratio or '16:9'}",
                f"--video_resolution={jimeng_video_resolution(payload.model, payload.resolution)}",
                f"--poll={jimeng_poll_seconds()}",
            ]
            model_version = jimeng_video_model_version(payload.model)
            if model_version:
                args.append(f"--model_version={model_version}")
        raw = await run_jimeng_cli(args, timeout=jimeng_poll_seconds() + 180)
        urls = await jimeng_store_outputs(raw, "video")
        return {"videos": urls, "task_id": jimeng_submit_id(raw) or None, "raw": raw}
    finally:
        for path in temp_paths:
            try:
                os.remove(path)
            except Exception:
                pass

# --- 配置区域 ---

CLIENT_ID = str(uuid.uuid4())
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
# 个人数据在系统用户目录；DATA_DIR 只放随工程发布的词库和风格包
from core.user_paths import user_data_dir as _user_data_dir
from core import media_paths
USER_DATA_DIR = _user_data_dir()
# 工作流：内置基线随包只读，运行时同步到用户目录；用户自建与 config 改动都留用户目录
BUILTIN_WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
WORKFLOW_DIR = os.path.join(USER_DATA_DIR, "workflows")
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "text2image", "z-image.json")
OUTPUT_DIR = os.path.join(USER_DATA_DIR, "output")
INPUT_DIR = os.path.join(USER_DATA_DIR, "input")
HISTORY_FILE = os.path.join(USER_DATA_DIR, "history.json")
API_ENV_FILE = os.path.join(USER_DATA_DIR, "api.env")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONVERSATION_DIR = os.path.join(USER_DATA_DIR, "conversations")
CANVAS_DIR = os.path.join(USER_DATA_DIR, "canvases")
GLOBAL_CONFIG_FILE = os.path.join(USER_DATA_DIR, "global_config.json")
THUMBNAIL_DIR = os.path.join(USER_DATA_DIR, "thumbnails")
SMART_PRESETS_DIR = os.path.join(USER_DATA_DIR, "smart-prompt-presets")
SMART_PROMPT_CONFIG_FILE = os.path.join(USER_DATA_DIR, "smart-prompt-config.json")
LOG_DIR = os.path.join(USER_DATA_DIR, "logs")
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
PROMPT_PRESETS_FILE = os.path.join(DATA_DIR, "prompt-presets.json")
STATIC_PROMPT_TEMPLATE_MD = os.path.join(STATIC_DIR, "system-prompts", "infinite-canvas-prompt-templates.md")
PROMPT_TEMPLATE_PATHS = [STATIC_PROMPT_TEMPLATE_MD]

# --- 素材库配置 ---
# /assets/{path} 路由以 INPUT_DIR 为根，素材必须落在 INPUT_DIR 下才访问得到；
# 同时不能写安装目录（Program Files 不可写、覆盖升级会冲掉、卸载连文件一起删）。
ASSETS_DIR = INPUT_DIR
OUTPUT_INPUT_DIR = os.path.join(ASSETS_DIR, "input")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
ASSET_LIBRARY_DIR = os.path.join(ASSETS_DIR, "library")
LEGACY_LOCAL_UPLOAD_DIR = os.path.join(ASSETS_DIR, "uploads")
LOCAL_UPLOAD_DIR = os.path.join(ASSET_LIBRARY_DIR, "_local")
ASSET_LIBRARY_PATH = os.path.join(USER_DATA_DIR, "asset_library.json")
BUILTIN_PROMPT_LIBRARY = os.path.join(DATA_DIR, "prompt_libraries.json")   # 随包基线，只读
PROMPT_LIBRARY_PATH = os.path.join(USER_DATA_DIR, "prompt_libraries.json")  # 用户覆盖层，可写
SHARED_FOLDERS_FILE = os.path.join(USER_DATA_DIR, "shared_folders.json")
MEDIA_PREVIEW_DIR = os.path.join(USER_DATA_DIR, "media_previews")
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
RUNNINGHUB_WORKFLOW_STORE_FILE = os.path.join(USER_DATA_DIR, "runninghub_workflows.json")
SEED_UINT32_MAX = 4294967295


def _file_digest(path: str) -> str:
    h = hashlib.md5()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
    except OSError:
        return ""
    return h.hexdigest()


def migrate_legacy_assets():
    """老版本把素材写在安装目录 assets/，搬到用户目录（目标已存在则不覆盖）。"""
    legacy = os.path.join(BASE_DIR, "assets")
    if os.path.abspath(legacy) == os.path.abspath(ASSETS_DIR) or not os.path.isdir(legacy):
        return
    moved = 0
    for sub in ("library", "uploads", "input", "output"):
        src_root = os.path.join(legacy, sub)
        if not os.path.isdir(src_root):
            continue
        dst_root = os.path.join(ASSETS_DIR, sub)
        for cur, _dirs, files in os.walk(src_root):
            rel = os.path.relpath(cur, src_root)
            dst_dir = dst_root if rel == "." else os.path.join(dst_root, rel)
            try:
                os.makedirs(dst_dir, exist_ok=True)
            except OSError:
                continue
            for fn in files:
                dst = os.path.join(dst_dir, fn)
                if os.path.exists(dst):
                    continue
                try:
                    shutil.copy2(os.path.join(cur, fn), dst)
                    moved += 1
                except OSError:
                    pass
    if moved:
        print(f"[assets] 已从安装目录迁移 {moved} 个素材文件到 {ASSETS_DIR}")


def sync_builtin_workflows():
    """把随包内置工作流同步到用户目录。

    内置工作流是程序资产（升级应带上新版），内容不同就以内置为准覆盖；
    用户自建的 wf_*.json 不在内置集合里，不会被碰。工作流配置写 .config.json，
    是独立文件，属于用户层，同样不受影响。
    """
    if not os.path.isdir(BUILTIN_WORKFLOW_DIR):
        return
    copied = 0
    for cur, _dirs, files in os.walk(BUILTIN_WORKFLOW_DIR):
        rel_dir = os.path.relpath(cur, BUILTIN_WORKFLOW_DIR)
        dst_dir = WORKFLOW_DIR if rel_dir == "." else os.path.join(WORKFLOW_DIR, rel_dir)
        try:
            os.makedirs(dst_dir, exist_ok=True)
        except OSError:
            continue
        for fn in files:
            if not fn.endswith(".json") or fn.endswith(".config.json"):
                continue
            src = os.path.join(cur, fn)
            dst = os.path.join(dst_dir, fn)
            try:
                if os.path.isfile(dst) and os.path.getsize(dst) == os.path.getsize(src) \
                        and _file_digest(dst) == _file_digest(src):
                    continue
                shutil.copy2(src, dst)
                copied += 1
            except OSError:
                pass
    if copied:
        print(f"[workflow] 已同步 {copied} 个内置工作流到 {WORKFLOW_DIR}")


def prompt_library_read_path():
    """仅供个人数据迁移使用，不回退工程内旧提示词库。"""
    return PROMPT_LIBRARY_PATH

# === history.json 进程内缓存 ===
# 第一次 GET 时读盘并缓存,save_to_history 写穿透更新(不再失效重读)
# history.json 越大,这个优化收益越明显(从 N ms 读盘 + N ms json.load → 0)
# 与 _USERS_CACHE 一致: 按 HISTORY_FILE 路径失效, 防止路径变化后读到陈旧数据
_HISTORY_CACHE = {"path": None, "data": None}
_HISTORY_LOCK = threading.Lock() if 'threading' in dir() else None
def _load_history_cached():
    global _HISTORY_CACHE
    if _HISTORY_CACHE["data"] is not None and _HISTORY_CACHE["path"] == HISTORY_FILE:
        return _HISTORY_CACHE["data"]
    data = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"读取历史文件失败: {e}")
            data = []
    _HISTORY_CACHE["path"] = HISTORY_FILE
    _HISTORY_CACHE["data"] = data
    # 迁移旧版时间戳：秒→毫秒（兼容旧记录）
    for item in _HISTORY_CACHE["data"]:
        ts = item.get("timestamp", 0)
        if isinstance(ts, (int, float)) and 1000000000 < ts < 2000000000:
            item["timestamp"] = ts * 1000
    return _HISTORY_CACHE["data"]
def _invalidate_history_cache():
    global _HISTORY_CACHE
    _HISTORY_CACHE = {"path": None, "data": None}

# --- YAML 预设缓存 ---
_preset_cache = None
_preset_cache_mtime = 0

# API 提供商配置文件路径
# 放用户目录而非安装目录：perMachine 安装到 Program Files 后安装目录不可写，
# 在界面里增删 provider 会失败，或被 Windows 静默重定向，导致改动不生效。
API_PROVIDERS_FILE = os.path.join(USER_DATA_DIR, "api_providers.json")


def migrate_api_providers_from_app_dir():
    """把安装目录里的旧配置搬进用户目录。目标已存在则不覆盖，保留个人修改。"""
    legacy = os.path.join(BASE_DIR, "api_providers.json")
    if os.path.exists(API_PROVIDERS_FILE) or not os.path.exists(legacy):
        return
    try:
        with open(legacy, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list) or not data:
            return
        atomic_write_json(API_PROVIDERS_FILE, data, ensure_ascii=False, indent=2)
        print(f"[art-canvas] 已从安装目录迁移 API 提供商配置: {API_PROVIDERS_FILE}")
    except Exception as e:
        print(f"[art-canvas] API 提供商配置迁移失败: {e}")

def sanitize_folder_name(title, canvas_id):
    """生成安全的文件夹名称"""
    # 替换非法字符
    name = re.sub(r'[\/\:*?"<>|]', '_', title or '未命名')
    # 截断到合理长度
    name = name[:60].strip()
    # 追加画布ID前8位
    suffix = canvas_id[:8]
    return f"{name}_{suffix}" if name else suffix

def get_canvas_output_dir(canvas):
    """获取画布的输出目录路径(含用户隔离)"""
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    folder = canvas.get("output_folder", "")
    if owner and folder:
        return os.path.join(OUTPUT_DIR, owner, folder)
    elif folder:
        return os.path.join(OUTPUT_DIR, folder)
    elif owner:
        path = os.path.join(OUTPUT_DIR, owner)
        os.makedirs(path, exist_ok=True)
        return path
    return OUTPUT_DIR

def get_canvas_asset_dir(canvas):
    """获取画布的资产目录路径(含用户隔离)"""
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    folder = canvas.get("output_folder", "")
    if owner and folder:
        return os.path.join(INPUT_DIR, owner, folder)
    elif folder:
        return os.path.join(INPUT_DIR, folder)
    elif owner:
        path = os.path.join(INPUT_DIR, owner)
        os.makedirs(path, exist_ok=True)
        return path
    return INPUT_DIR

def build_output_url(canvas, filename, username=None, subfolder=None):
    """构建 output 文件的 URL 路径"""
    if canvas:
        owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
        folder = canvas.get("output_folder", "")
        if owner and folder:
            return f"/output/{owner}/{folder}/{filename}"
        elif folder:
            return f"/output/{folder}/{filename}"
        elif owner:
            return f"/output/{owner}/{filename}"
        else:
            return f"/output/{filename}"
    elif username:
        user_dirname = get_user_dirname(username)
        if subfolder:
            return f"/output/{user_dirname}/{subfolder}/{filename}"
        return f"/output/{user_dirname}/{filename}"
    else:
        if subfolder:
            return f"/output/{subfolder}/{filename}"
        return f"/output/{filename}"

def build_asset_url(canvas, filename):
    """构建 asset 文件的 URL 路径(含用户隔离)"""
    if canvas:
        owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
        folder = canvas.get("output_folder", "")
        if owner and folder:
            return f"/assets/{owner}/{folder}/{filename}"
        elif folder:
            return f"/assets/{folder}/{filename}"
        elif owner:
            return f"/assets/{owner}/{filename}"
        else:
            return f"/assets/{filename}"
    return f"/assets/{filename}"

QUEUE = []
QUEUE_LOCK = Lock()
HISTORY_LOCK = Lock()
GLOBAL_CONFIG_LOCK = Lock()
CONVERSATION_LOCK = Lock()
CANVAS_LOCK = Lock()
LOAD_LOCK = Lock()
RUNNINGHUB_WORKFLOW_LOCK = Lock()
NEXT_TASK_ID = 1

# --- 账号认证配置 ---
SUPER_ADMIN_USERNAME = "admin"
USERS_FILE = os.path.join(USER_DATA_DIR, "users.json")

def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def atomic_write_json(path, data, encoding="utf-8", **json_kwargs):
    """原子化 JSON 落盘：同目录临时文件写入 + fsync + os.replace 原地替换。

    旧写法直接 open(path, 'w')，一旦进程在写入中途崩溃/断电，原文件已被
    截断成半截 JSON（数据全丢）。本函数保证任何时刻磁盘上要么是旧完整
    文件、要么是新完整文件。json_kwargs 透传给 json.dump，默认
    ensure_ascii=False, indent=2（与既有落盘格式一致）。
    """
    json_kwargs.setdefault("ensure_ascii", False)
    json_kwargs.setdefault("indent", 2)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            json.dump(data, f, **json_kwargs)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


_USERS_CACHE = {"path": None, "data": None}
_USERS_CACHE_LOCK = threading.Lock()


def load_users():
    """读取用户表（进程内缓存，按 USERS_FILE 路径失效）。

    返回浅拷贝：既避免调用方直接 mutate 污染缓存，也消除
    「register 插入顶层键」与「find_user_by_token 迭代」并发时的
    RuntimeError。内层 user dict 仍为共享引用（CPython GIL 下读写原子）。
    契约：调用方 mutate 后必须调 save_users 回写。
    """
    with _USERS_CACHE_LOCK:
        if _USERS_CACHE["path"] != USERS_FILE or _USERS_CACHE["data"] is None:
            users = {}
            if os.path.exists(USERS_FILE):
                try:
                    with open(USERS_FILE, "r", encoding="utf-8") as f:
                        users = json.load(f)
                    if not isinstance(users, dict):
                        users = {}
                except Exception:
                    users = {}
            _USERS_CACHE["path"] = USERS_FILE
            _USERS_CACHE["data"] = users
        return dict(_USERS_CACHE["data"])


def save_users(users):
    atomic_write_json(USERS_FILE, users)
    with _USERS_CACHE_LOCK:
        _USERS_CACHE["path"] = USERS_FILE
        _USERS_CACHE["data"] = users

def find_user_by_token(token):
    token = (token or "").strip() or REQUEST_TOKEN.get()
    if not token:
        return None, None
    users = load_users()
    for username, data in users.items():
        if data.get("token") == token:
            return username, data
    return None, None

# --- 用户文件隔离辅助函数 ---

def get_username_by_token(token):
    """根据 token 获取用户名,返回 None 表示未登录。查询参数为空时，沿用本次请求的 Authorization。"""
    username, user = find_user_by_token(token)
    return username

def request_auth_token(request: Request = None, token: str = "") -> str:
    """查询参数、Authorization 头、当前请求上下文，按这个顺序取登录令牌。"""
    token = (token or "").strip()
    if token:
        return token
    if request is not None:
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    return token or (REQUEST_TOKEN.get() or "").strip()

def require_valid_token(token):
    """要求有效的登录令牌,否则抛出 401。用于需要登录才能使用的接口(如图片生成)。

    返回对应的用户名。这样既能强制登录,又能继续沿用 username 做文件隔离等逻辑。
    """
    # 空 token 一律视为未登录(注意: 已注销用户的 token 字段为 "", 必须显式拒绝,
    # 否则 find_user_by_token("") 会把空串误匹配成该用户而放行)
    token = (token or "").strip() or (REQUEST_TOKEN.get() or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="请先登录后再使用")
    username, user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录后再使用")
    return username

def is_admin_by_token(token):
    """根据 token 判断是否为管理员。查询参数为空时，沿用本次请求的 Authorization。"""
    _, user = find_user_by_token(token)
    return bool(user and user.get("is_admin", False))

def validate_canvas_owner(canvas, token):
    """校验画布归属。管理员可操作所有画布，普通用户只能操作自己的画布。"""
    token = (token or "").strip() or (REQUEST_TOKEN.get() or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="请先登录后再使用")
    if is_admin_by_token(token):
        return
    username = get_username_by_token(token)
    if not username or canvas.get("owner") != username:
        raise HTTPException(status_code=403, detail="无权操作此画布")

def account_dirname(username=None) -> str:
    """当前登录账号对应的目录名。不接受客户端自报的用户名。"""
    if not username:
        username = get_username_by_token("")
    if not username:
        raise HTTPException(status_code=401, detail="请先登录后再使用")
    return safe_user_id(username, None)

def account_data_dir(username=None) -> str:
    path = os.path.join(USER_DATA_DIR, "accounts", account_dirname(username))
    os.makedirs(path, exist_ok=True)
    return path

def user_prompt_dict_path() -> str:
    return os.path.join(account_data_dir(), "user-prompt-dict.json")

def asset_library_path() -> str:
    return os.path.join(account_data_dir(), "asset_library.json")

def smart_prompt_config_path() -> str:
    return os.path.join(account_data_dir(), "smart-prompt-config.json")

def smart_presets_dir() -> str:
    path = os.path.join(account_data_dir(), "smart-prompt-presets")
    os.makedirs(path, exist_ok=True)
    return path

def account_prompt_libraries_path() -> str:
    return os.path.join(account_data_dir(), "prompt_libraries.json")

def tts_voice_dir() -> str:
    path = os.path.join(account_data_dir(), "tts_voices")
    os.makedirs(path, exist_ok=True)
    os.makedirs(os.path.join(path, "characters"), exist_ok=True)
    return path

def assert_account_media(rel_path: str) -> None:
    """生成图和参考图只允许本人访问。没有用户前缀的旧文件，登录后仍可打开。"""
    username = get_username_by_token("")
    if not username:
        raise HTTPException(status_code=401, detail="请先登录后再使用")
    if is_admin_by_token(""):
        return
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    first = rel.split("/", 1)[0] if rel else ""
    own = get_user_dirname(username)
    known = {get_user_dirname(name) for name in load_users() if get_user_dirname(name)}
    if first in known and first != own:
        raise HTTPException(status_code=403, detail="无权查看此文件")

def private_data_owner() -> str:
    users = load_users()
    for name, data in users.items():
        if isinstance(data, dict) and data.get("is_admin"):
            return name
    return next(iter(users), "") if users else ""

def migrate_account_private_data() -> None:
    """把原先全站一份的个人创作数据交给管理员账号，其他账号从空目录开始。"""
    owner = private_data_owner()
    if not owner:
        return
    root = os.path.join(USER_DATA_DIR, "accounts", safe_user_id(owner, None))
    os.makedirs(root, exist_ok=True)
    for filename in ("user-prompt-dict.json", "smart-prompt-config.json", "asset_library.json"):
        src = os.path.join(USER_DATA_DIR, filename)
        dst = os.path.join(root, filename)
        if os.path.isfile(src) and not os.path.exists(dst):
            shutil.move(src, dst)
    for dirname in ("smart-prompt-presets", "tts_voices"):
        src = os.path.join(USER_DATA_DIR, dirname)
        dst = os.path.join(root, dirname)
        if os.path.isdir(src) and not os.path.exists(dst):
            shutil.move(src, dst)
    user_lib = os.path.join(root, "prompt_libraries.json")
    source_lib = prompt_library_read_path()
    if os.path.isfile(source_lib) and not os.path.isfile(user_lib):
        try:
            with open(source_lib, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            libs = data.get("libraries") if isinstance(data, dict) else []
            system, personal = [], []
            for lib in libs or []:
                if isinstance(lib, dict) and (lib.get("id") == "system" or lib.get("system") is True):
                    system.append(lib)
                elif isinstance(lib, dict):
                    personal.append(lib)
            if personal:
                atomic_write_json(user_lib, {
                    "active_library_id": data.get("active_library_id") or "system",
                    "libraries": personal,
                }, ensure_ascii=False, indent=2)
                data["libraries"] = system
                if data.get("active_library_id") not in {lib.get("id") for lib in system}:
                    data["active_library_id"] = "system"
                atomic_write_json(PROMPT_LIBRARY_PATH, data, ensure_ascii=False, indent=2)
        except Exception as exc:
            print(f"提示词库按账号拆分失败: {exc}")

def get_user_dirname(username):
    """将用户名转换为安全的文件夹名"""
    if not username:
        return None
    return safe_user_id(username, None)

def get_user_output_dir(username):
    """获取用户的 output 子目录,返回 (目录路径, 目录名)"""
    dirname = get_user_dirname(username)
    if not dirname:
        return OUTPUT_DIR, ""
    path = os.path.join(OUTPUT_DIR, dirname)
    os.makedirs(path, exist_ok=True)
    return path, dirname

def get_user_input_dir(username):
    """获取用户的 input 子目录,返回 (目录路径, 目录名)"""
    dirname = get_user_dirname(username)
    if not dirname:
        return INPUT_DIR, ""
    path = os.path.join(INPUT_DIR, dirname)
    os.makedirs(path, exist_ok=True)
    return path, dirname

# --- API 提供商管理辅助函数 ---

MODELSCOPE_DEFAULT_LORAS = [
    {
        "id": "Daniel8152/film",
        "name": "Z-Image Film",
        "target_model": "Tongyi-MAI/Z-Image-Turbo",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Qwen-Image-2512-Film",
        "name": "Qwen Image 2512 Film",
        "target_model": "Qwen/Qwen-Image-2512",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Klein-enhance",
        "name": "Klein enhance",
        "target_model": "black-forest-labs/FLUX.2-klein-9B",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
]

BUILTIN_PROVIDERS = [
    {
        "id": "modelscope",
        "name": "ModelScope",
        "base_url": "https://api-inference.modelscope.cn/v1",
        "protocol": "openai",
        "image_models": [
            "Tongyi-MAI/Z-Image-Turbo",
            "Qwen/Qwen-Image-2512",
            "Qwen/Qwen-Image-Edit-2511",
            "black-forest-labs/FLUX.2-klein-9B"
        ],
        "chat_models": ["Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-Coder-480B-A35B-Instruct"],
        "video_models": [],
        "ms_loras": MODELSCOPE_DEFAULT_LORAS,
        "primary": False,
        "enabled": True,
    },
    {
        "id": "runninghub",
        "name": "RunningHub",
        "base_url": "https://www.runninghub.ai",
        "protocol": "runninghub",
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "primary": False,
        "enabled": True,
    },
    {
        "id": "volcengine",
        "name": "火山引擎",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "protocol": "volcengine",
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "primary": False,
        "enabled": True,
    },
]

def ensure_builtin_providers(providers):
    """确保内置平台（ModelScope/RunningHub/火山引擎）始终存在；为旧 ModelScope 补默认 LoRA"""
    existing_ids = {p.get("id") for p in providers}
    changed = False
    for bp in BUILTIN_PROVIDERS:
        if bp["id"] not in existing_ids:
            providers.append(dict(bp))
            existing_ids.add(bp["id"])
            changed = True
    # 为已存在的 ModelScope 补 LoRA 默认值
    for p in providers:
        if p.get("id") == "modelscope" and not p.get("ms_loras"):
            p["ms_loras"] = list(MODELSCOPE_DEFAULT_LORAS)
            changed = True
    return providers, changed

def load_api_providers():
    """从文件加载 API 提供商列表（内置平台自动补全）"""
    migrate_api_providers_from_app_dir()
    if not os.path.exists(API_PROVIDERS_FILE):
        try:
            atomic_write_json(API_PROVIDERS_FILE, list(BUILTIN_PROVIDERS), ensure_ascii=False, indent=2)
        except Exception:
            pass
        return list(BUILTIN_PROVIDERS)
    try:
        with open(API_PROVIDERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if not isinstance(data, list):
                data = []
    except Exception:
        data = []
    data, changed = ensure_builtin_providers(data)
    if changed:
        try:
            atomic_write_json(API_PROVIDERS_FILE, data, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return data

def save_api_providers(providers):
    """保存 API 提供商列表到文件"""
    try:
        atomic_write_json(API_PROVIDERS_FILE, providers, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Failed to save API providers: {e}")

def provider_key_env(provider_id):
    """生成提供商 API Key 的环境变量名"""
    return f"{provider_id.upper()}_API_KEY"

def clean_model_labels(raw, models):
    if not isinstance(raw, dict):
        return {}
    allowed = {str(model).strip() for model in (models or []) if str(model).strip()}
    labels = {}
    for key, value in raw.items():
        model = str(key or "").strip()
        name = str(value or "").strip()[:40]
        if model in allowed and name:
            labels[model] = name
    return labels

def normalize_provider(data):
    """规范化提供商数据"""
    image_models = data.get("image_models") or []
    chat_models = data.get("chat_models") or []
    video_models = data.get("video_models") or []
    return {
        "id": data.get("id", "").strip(),
        "name": data.get("name", "").strip(),
        "base_url": data.get("base_url", "").strip(),
        "protocol": data.get("protocol", "openai"),
        "model_capabilities": data.get("model_capabilities") or {},
        "image_request_mode": normalize_image_request_mode(data.get("image_request_mode", "")),
        "image_models": image_models,
        "chat_models": chat_models,
        "video_models": video_models,
        "model_labels": clean_model_labels(data.get("model_labels"), list(image_models) + list(chat_models) + list(video_models)),
        "ms_loras": data.get("ms_loras") or [],
        "primary": bool(data.get("primary", False)),
        "enabled": bool(data.get("enabled", True)),
    }

def public_provider(provider):
    """返回公开的提供商信息(隐藏 API Key)"""
    env_key = provider_key_env(provider["id"])
    has_key = bool(os.getenv(env_key, "") or read_api_env_value(env_key))
    key_preview = ''
    if has_key and not LAN_VISITOR.get():
        raw = os.getenv(env_key, "") or read_api_env_value(env_key)
        key_preview = raw[:4] + '••••' + raw[-4:] if len(raw) > 8 else '••••••••'
    return {
        "id": provider["id"],
        "name": provider["name"],
        "base_url": provider["base_url"],
        "protocol": provider["protocol"],
        "model_capabilities": provider.get("model_capabilities") or {},
        "image_request_mode": normalize_image_request_mode(provider.get("image_request_mode", "")),
        "image_models": provider["image_models"] or (["gpt-image-2"] if provider_protocol(provider) == "codex" else []),
        "chat_models": provider["chat_models"],
        "video_models": provider.get("video_models") or [],
        "model_labels": provider.get("model_labels") or {},
        "ms_loras": provider.get("ms_loras") or [],
        "primary": provider["primary"],
        "enabled": provider["enabled"],
        "has_key": has_key,
        "key_preview": key_preview,
        "key_env": env_key,
    }

def get_provider_api_key(provider_id: str) -> str:
    """从 API/.env 读取指定 provider 的 API Key（优先读实时文件，避免沿用进程启动时的旧值）"""
    env_key = provider_key_env(provider_id)
    return read_api_env_value(env_key) or os.getenv(env_key, "")

def get_api_provider(provider_id):
    """根据 ID 获取提供商"""
    providers = load_api_providers()
    for p in providers:
        if p["id"] == provider_id:
            return p
    return None

def get_api_provider_exact(provider_id):
    """精确匹配提供商"""
    provider = get_api_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"API 平台不存在:{provider_id}")
    return provider

def reload_env_globals():
    """重新加载环境变量到全局变量(用于热更新)"""
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, AI_BASE_URL, AI_API_KEY, MODELSCOPE_API_KEY
    global CHAT_MODEL, IMAGE_MODEL, CHAT_MODELS, IMAGE_MODELS, COMFYUI_BASE_PATH

    load_env_file()

    COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
    COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]
    COMFYUI_BASE_PATH = os.getenv("COMFYUI_BASE_PATH", "").rstrip("\\")

    AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ukiyoapi.apifox.cn").rstrip("/")
    AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
    MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")

    CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
    IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-1")

    def model_list_reloaded(env_name, primary, defaults):
        configured = os.getenv(env_name, "")
        configured_values = [item.strip() for item in configured.split(",") if item.strip()]
        values = configured_values or [primary, *defaults]
        deduped = []
        for value in values:
            if value and value not in deduped:
                deduped.append(value)
        return deduped

    CHAT_MODELS = model_list_reloaded("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
    IMAGE_MODELS = model_list_reloaded("IMAGE_MODELS", IMAGE_MODEL, ["gpt-image-2-all", "nano-banana"])

def load_env_file():
    if not os.path.exists(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, 'r', encoding='utf-8-sig') as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ[key] = value
    except Exception as e:
        print(f"加载 API/.env 失败: {e}")

def save_env_file(updates):
    """更新 .env 文件中的指定键值对"""
    if not os.path.exists(API_ENV_FILE):
        return False
    try:
        with open(API_ENV_FILE, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()

        updated_keys = set()
        new_lines = []
        for line in lines:
            stripped = line.strip()
            if "=" in stripped and not stripped.startswith("#"):
                key = stripped.split("=", 1)[0].strip()
                if key in updates:
                    new_lines.append(f"{key}={updates[key]}\n")
                    updated_keys.add(key)
                    continue
            new_lines.append(line)

        for key, value in updates.items():
            if key not in updated_keys:
                new_lines.append(f"{key}={value}\n")

        with open(API_ENV_FILE, 'w', encoding='utf-8-sig') as f:
            f.writelines(new_lines)
        return True
    except Exception as e:
        print(f"保存 API/.env 失败: {e}")
        return False

load_env_file()

COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]
COMFYUI_BASE_PATH = os.getenv("COMFYUI_BASE_PATH", "").rstrip("\\")

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"
MODELSCOPE_CHAT_MODELS = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "Qwen/Qwen3-235B-A22B,MiniMax/MiniMax-M2.7:MiniMax").split(",") if m.strip()]
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-1")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful assistant.")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "300"))
IMAGE_POLL_INTERVAL = float(os.getenv("IMAGE_POLL_INTERVAL", "2"))

def model_list(env_name, primary, defaults):
    configured = os.getenv(env_name, "")
    configured_values = [item.strip() for item in configured.split(",") if item.strip()]
    values = configured_values or [primary, *defaults]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped

CHAT_MODELS = model_list("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["gpt-image-2-all", "nano-banana"])

BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(WORKFLOW_DIR, exist_ok=True)
os.makedirs(CONVERSATION_DIR, exist_ok=True)
os.makedirs(CANVAS_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(OUTPUT_INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
# 素材与工作流落到用户目录：迁移老位置数据 + 同步随包内置工作流
migrate_legacy_assets()
sync_builtin_workflows()

# 生成物目录升级到 output/{owner}/{type}/{feature}/{date}/：老文件搬到新层级并改写 history/画布 URL
# 幂等，已经是新结构时只做一次目录扫描；失败不阻塞启动
try:
    from core import media_migration
    media_migration.migrate(media_paths, OUTPUT_DIR, HISTORY_FILE, CANVAS_DIR)
    _HISTORY_CACHE["data"] = None
except Exception as _media_migrate_exc:
    print(f"[media-migrate] 跳过: {_media_migrate_exc}")

# 不再自动导入旧风格快照；运行数据仅来自显式安装的内容包与用户增量。

# Custom static files with no-cache headers for HTML files
from starlette.staticfiles import StaticFiles as StarletteStaticFiles
import mimetypes

# 确保 .js 文件被正确识别为 application/javascript
mimetypes.add_type('application/javascript', '.js')

class NoCacheStaticFiles(StarletteStaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if hasattr(response, 'headers'):
            # ponytail: 资源可缓存但每次校验 ETag，更新立即生效，未变化时只返回 304。
            response.headers['Cache-Control'] = 'no-store' if path.lower().endswith('.html') else 'no-cache'
        return response

app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")

# prompt 模块静态文件
PROMPT_STATIC_DIR = os.path.join(BASE_DIR, "prompt", "static")
app.mount("/prompt/static", NoCacheStaticFiles(directory=PROMPT_STATIC_DIR), name="prompt_static")

# 自定义 output 静态文件服务,支持子文件夹访问
from starlette.responses import FileResponse as StarletteFileResponse

@app.get("/output/{path:path}")
async def serve_output_file(path: str):
    """提供 output 目录下的文件访问,支持子文件夹"""
    # 安全检查:防止路径遍历攻击
    clean_path = path.replace("\\", "/")
    if ".." in clean_path or clean_path.startswith("/"):
        raise HTTPException(status_code=404, detail="File not found")
    assert_account_media(clean_path)

    full_path = os.path.abspath(os.path.join(OUTPUT_DIR, clean_path))
    output_root = os.path.abspath(OUTPUT_DIR)

    # 确保请求的路径在 OUTPUT_DIR 内
    if not full_path.startswith(output_root):
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    # 设置正确的 Content-Type
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".txt": "text/plain; charset=utf-8",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".m4a": "audio/mp4",
    }.get(ext, "application/octet-stream")

    is_media = ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov')
    if is_media:
        mtime = os.path.getmtime(full_path)
        import hashlib as _hl
        etag = _hl.md5(f"{full_path}:{int(mtime)}".encode()).hexdigest()
        cache_h = {
            'Cache-Control': 'public, max-age=2592000, immutable',
            'ETag': f'"{etag}"',
            'Last-Modified': time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(mtime)),
        }
    else:
        cache_h = {'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0'}
    return StarletteFileResponse(full_path, media_type=media_type, headers=cache_h)

@app.get("/assets/{path:path}")
async def serve_asset_file(path: str):
    """提供 input 目录下的文件访问,支持子文件夹"""
    clean_path = path.replace("\\", "/")
    if ".." in clean_path or clean_path.startswith("/"):
        raise HTTPException(status_code=404, detail="File not found")
    assert_account_media(clean_path)
    if clean_path.startswith("library/"):
        assert_account_media(clean_path[len("library/"):])
    if clean_path.startswith("uploads/"):
        clean_path = "library/_local/" + clean_path[len("uploads/"):]

    full_path = os.path.abspath(os.path.join(INPUT_DIR, clean_path))
    input_root = os.path.abspath(INPUT_DIR)

    if not full_path.startswith(input_root):
        raise HTTPException(status_code=404, detail="File not found")

    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".txt": "text/plain",
    }.get(ext, content_type_for_path(full_path))

    is_media = ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif')
    if is_media:
        mtime = os.path.getmtime(full_path)
        import hashlib as _hl
        etag = _hl.md5(f"{full_path}:{int(mtime)}".encode()).hexdigest()
        cache_h = {
            'Cache-Control': 'public, max-age=2592000, immutable',
            'ETag': f'"{etag}"',
            'Last-Modified': time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(mtime)),
        }
    else:
        cache_h = {'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0'}
    return StarletteFileResponse(full_path, media_type=media_type, headers=cache_h)

# --- Pydantic 模型 ---

class GenerateRequest(BaseModel):
    prompt: str = ""
    width: int = 1024
    height: int = 1024
    workflow_json: str = ""
    workflow_data: Optional[Dict[str, Any]] = None
    params: Dict[str, Any] = {}
    type: str = "zimage"
    client_id: str = ""
    convert_to_jpg: bool = False
    prompt_id: str = ""
    canvas_id: str = ""  # 新增:画布ID,可选
    extra_pnginfo: Optional[Dict[str, Any]] = None  # ComfyUI extra_pnginfo,用于 GJJ_MultiImageLoader 等节点
    feature: str = ""  # 输出子目录(zimage/anima/krea2)
    conversation_id: str = ""
    message_id: str = ""

class WorkflowField(BaseModel):
    id: str = ""
    node: Optional[str] = None
    input: Optional[str] = None
    type: str = "text"
    display_name: str = ""
    default: Any = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: List[str] = []

class WorkflowConfig(BaseModel):
    title: str = ""
    fields: List[WorkflowField] = []

class WorkflowRunRequest(BaseModel):
    fields: Dict[str, Any] = {}
    config: WorkflowConfig
    client_id: str = ""

class DeleteHistoryRequest(BaseModel):
    timestamp: float

class TokenRequest(BaseModel):
    token: str

class CloudGenRequest(BaseModel):
    prompt: str
    api_key: str = ""
    resolution: str = "1024*1024"
    type: str = "zimage"
    image_urls: List[str] = []
    client_id: Optional[str] = None

class CloudPollRequest(BaseModel):
    task_id: str
    api_key: str = ""
    client_id: Optional[str] = None

class AIReference(BaseModel):
    url: str = ""
    name: str = ""

class OnlineImageRequest(BaseModel):
    generation_params: Dict[str, Any] = Field(default_factory=dict)
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = ""
    size: str = "1024x1024"
    quality: str = "medium"
    protocol: str = "openai"
    provider_id: str = ""
    image_request_mode: str = ""
    reference_images: List[AIReference] = []
    feature: str = ""  # 落盘子目录与画廊类型, 如 "zimage" 表示并入文生图画廊; 留空保持默认 online
    conversation_id: str = ""
    message_id: str = ""

class OnlineVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = ""
    size: str = "1024x1024"
    duration: int = 5
    protocol: str = "jimeng"
    provider_id: str = ""
    image_request_mode: str = ""
    reference_images: List[AIReference] = []
    feature: str = ""   # 落盘子目录（注册表 key），留空按 "视频"

class ChatRequest(BaseModel):
    conversation_id: str = ""
    message: str = Field(min_length=1, max_length=20000)
    model: str = ""
    image_model: str = ""
    mode: str = "chat"
    size: str = "1024x1024"
    quality: str = "auto"
    reference_images: List[AIReference] = []
    provider: str = "comfly"
    ms_model: str = ""
    system_prompt: str = Field(default="", max_length=20000)

class MsGenerateRequest(BaseModel):
    prompt: str
    model: str = "black-forest-labs/FLUX.2-klein-9B"
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
    size: str = ""
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CanvasLLMRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    system_prompt: str = "You are a helpful assistant."
    model: str = ""
    messages: List[Dict[str, str]] = []
    provider: str = "comfly"
    ms_model: str = ""

class ConversationCreateRequest(BaseModel):
    title: str = "新对话"

class CanvasCreateRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    kind: str = "classic"

class CanvasSaveRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    viewport: Dict[str, Any] = {}
    logs: List[Dict[str, Any]] = []

class DeleteCanvasLogRequest(BaseModel):
    log_id: str = ""
    delete_unreferenced_media: bool = False
    reset_referencing_nodes: bool = False
    base_updated_at: int = 0


class CanvasMetaUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None

class ConfigUpdateRequest(BaseModel):
    comfly_api_key: Optional[str] = None
    modelscope_api_key: Optional[str] = None
    comfly_base_url: Optional[str] = None

class AuthRegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=100)

class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=100)

class AdminResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1)
    username: str = Field(min_length=1, max_length=40)
    new_password: str = Field(min_length=1, max_length=100)

class AdminDeleteUserRequest(BaseModel):
    token: str = Field(min_length=1)
    username: str = Field(min_length=1, max_length=40)

# --- 素材库 Pydantic 模型 ---

class CanvasAssetCheckRequest(BaseModel):
    urls: List[str] = []

class CanvasAssetDownloadRequest(BaseModel):
    urls: List[str] = []
    items: List[Dict[str, Any]] = []
    filename: str = "canvas-output-images.zip"

class LocalAssetCaptionRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = "描述图片"

class LocalAssetCaptionSaveRequest(BaseModel):
    name: str = ""
    caption: str = ""

class LocalAssetClassifyRequest(BaseModel):
    names: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class LocalAssetUrlImportItem(BaseModel):
    url: str = ""
    name: str = ""
    data: str = ""
    content_type: str = ""

class LocalAssetUrlImportRequest(BaseModel):
    items: List[LocalAssetUrlImportItem] = []
    folder: str = ""
    classify: bool = False
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class LocalAssetFolderRequest(BaseModel):
    parent: str = ""
    path: str = ""
    name: str = ""

class LocalAssetRenameRequest(BaseModel):
    path: str = ""
    name: str = ""

class AssetLibraryCategoryRequest(BaseModel):
    name: str = "新文件夹"
    type: str = "image"
    library_id: str = ""

class AssetLibraryRequest(BaseModel):
    name: str = "资产库"

class AssetLibraryAddRequest(BaseModel):
    category_id: str = ""
    url: str = ""
    name: str = ""
    library_id: str = ""

class AssetLibraryBatchAddRequest(BaseModel):
    category_id: str = ""
    library_id: str = ""
    items: List[AssetLibraryAddRequest] = []

class SharedFolderRegister(BaseModel):
    path: str = ""
    name: str = ""

class SharedFolderImport(BaseModel):
    library_id: str = ""
    category_id: str = ""
    folder_id: str = ""
    paths: List[str] = []

class AssetLibraryRenameRequest(BaseModel):
    name: str = ""
    library_id: str = ""
    caption: Optional[str] = None

class AssetLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""

class AssetLibraryBatchMoveRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
    target_library_id: str = ""
    target_category_id: str = ""

class AssetLibraryBatchCropRequest(BaseModel):
    ids: List[str] = []
    library_id: str = ""
    target_library_id: str = ""
    target_category_id: str = ""
    mode: str = "square"

class AssetLibraryCategoryReorderRequest(BaseModel):
    library_id: str = ""
    order: List[str] = []

class AssetLibraryMaintenanceScanRequest(BaseModel):
    library_id: str = ""

class AssetAvatarRegisterRequest(BaseModel):
    library_id: str = ""
    provider_id: str = ""
    project_name: str = "default"
    group_name: str = ""

class AssetLibraryClassifyRequest(BaseModel):
    library_id: str = ""
    ids: List[str] = []
    provider: str = "comfly"
    model: str = ""
    ms_model: str = ""
    prompt: str = ""

class PromptLibraryRequest(BaseModel):
    name: str = "提示词库"

class PromptLibraryItemRequest(BaseModel):
    library_id: str = ""
    item_id: str = ""
    name: str = "提示词"
    category: str = "custom"
    positive: str = ""
    negative: str = ""
    scene: str = ""

class PromptLibraryBatchDeleteRequest(BaseModel):
    ids: List[str] = []

class PromptLibraryImportRequest(BaseModel):
    library_id: str = ""
    items: List[dict] = []
    category: str = ""          # 非空则强制覆盖每条的分类
    dedupe: bool = True         # 按 id 与正文归一化指纹去重
    dry_run: bool = False       # 只统计不落盘

class PromptLibraryCategoryRequest(BaseModel):
    name: str = "新分组"
    library_id: str = ""

# --- 负载均衡 ---

def check_images_exist(backend_addr, images):
    if not images: return True
    for img in images:
        try:
            url = f"http://{backend_addr}/view?filename={urllib.parse.quote(img)}&type=input"
            r = requests.get(url, stream=True, timeout=0.5)
            r.close()
            if r.status_code != 200: return False
        except: return False
    return True

def get_best_backend(required_images: List[str] = None):
    best_backend = COMFYUI_INSTANCES[0]
    min_queue_size = float('inf')
    candidates_with_images = []
    candidates_others = []
    backend_stats = {}

    for addr in COMFYUI_INSTANCES:
        try:
            with urllib.request.urlopen(f"http://{addr}/queue", timeout=1) as response:
                data = json.loads(response.read())
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                with LOAD_LOCK:
                    local_load = BACKEND_LOCAL_LOAD.get(addr, 0)
                effective_load = max(remote_load, local_load)
                has_images = check_images_exist(addr, required_images)
                backend_stats[addr] = {"load": effective_load, "has_images": has_images}
                if has_images:
                    candidates_with_images.append(addr)
                else:
                    candidates_others.append(addr)
        except Exception as e:
            print(f"Backend {addr} unreachable: {e}")
            continue

    target_candidates = candidates_with_images if candidates_with_images else candidates_others
    if not target_candidates:
        if candidates_others:
            target_candidates = candidates_others
        else:
            return COMFYUI_INSTANCES[0]

    for addr in target_candidates:
        load = backend_stats[addr]["load"]
        if load < min_queue_size:
            min_queue_size = load
            best_backend = addr

    return best_backend

# --- 辅助工具 ---

def comfy_output_file(comfy_url_path: str):
    """ComfyUI 已经把图写在本机 output 目录时，直接返回那个文件，避免再走 /view 下载。"""
    if not COMFYUI_BASE_PATH or not str(comfy_url_path or "").startswith("/view"):
        return None
    parsed = urllib.parse.urlparse(comfy_url_path)
    qs = urllib.parse.parse_qs(parsed.query)
    filename = urllib.parse.unquote((qs.get("filename") or [""])[0])
    subfolder = urllib.parse.unquote((qs.get("subfolder") or [""])[0]).replace("\\", "/").strip("/")
    kind = urllib.parse.unquote((qs.get("type") or ["output"])[0])
    if kind not in ("output", "temp", "input"):
        kind = "output"
    if not filename or ".." in filename or ".." in subfolder:
        return None
    root = os.path.abspath(os.path.join(COMFYUI_BASE_PATH, kind))
    path = os.path.abspath(os.path.join(root, subfolder, os.path.basename(filename)))
    if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
        return None
    return path


def download_image(comfy_address, comfy_url_path, prefix="studio_", canvas=None, username=None, feature=""):
    src_file = comfy_output_file(comfy_url_path)
    src_ext = os.path.splitext(src_file or "")[1].lower()
    if src_ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        src_ext = ".png"
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{src_ext}"
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
        os.makedirs(canvas_output_dir, exist_ok=True)
        local_path = os.path.join(canvas_output_dir, filename)
        url = build_output_url(canvas, filename, username)
    else:
        # 统一落盘：output/{owner}/{type}/{feature}/{date}/，类型由注册表决定
        owner = get_user_dirname(username) or ""
        canvas_output_dir, url_prefix = media_paths.resolve_media_dir(
            owner=owner, feature=feature or "other", kind="image", ext=src_ext, root=OUTPUT_DIR)
        local_path = os.path.join(canvas_output_dir, filename)
        url = f"{url_prefix}/{filename}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        if src_file:
            shutil.copy2(src_file, local_path)
        else:
            with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
                shutil.copyfileobj(response, out_file)
        # 缩略图放到后台生成，避免 4 张图都压完才把地址返回给页面
        threading.Thread(target=_prewarm_thumbnails, args=(local_path, (768, 600)), daemon=True).start()
        return url
    except Exception as e:
        print(f"下载图片失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def download_audio(comfy_address, comfy_url_path, prefix="tts_", canvas=None, username=None, subfolder=None, feature=""):
    """从 ComfyUI 下载音频文件。落盘同样走 media_paths，与图片/视频同一套层级。"""
    # 根据 URL 推断扩展名
    ext = ".wav"
    if ".flac" in comfy_url_path.lower():
        ext = ".flac"
    elif ".mp3" in comfy_url_path.lower():
        ext = ".mp3"
    elif ".ogg" in comfy_url_path.lower():
        ext = ".ogg"

    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
        os.makedirs(canvas_output_dir, exist_ok=True)
        local_path = os.path.join(canvas_output_dir, filename)
        url = build_output_url(canvas, filename, username)
    else:
        # subfolder 是旧参数，语义等同 feature（历史上只传 "tts"）
        owner = get_user_dirname(username) or ""
        canvas_output_dir, url_prefix = media_paths.resolve_media_dir(
            owner=owner, feature=feature or subfolder or "tts", kind="audio", ext=ext, root=OUTPUT_DIR)
        local_path = os.path.join(canvas_output_dir, filename)
        url = f"{url_prefix}/{filename}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return url
    except Exception as e:
        print(f"下载音频失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def download_video(comfy_address, comfy_url_path, prefix="video_", canvas=None, username=None, subfolder="video", feature=""):
    """从 ComfyUI 下载视频文件(SaveVideo / VHS_VideoCombine 等)
    落盘规则与 download_image 对齐:
      - canvas 指定时走画布目录(仍允许 feature 决定子目录)
      - username + feature -> output/{user}/{feature}/{date}/
      - 仅 username         -> output/{user}/{date}/
      - 仅 feature          -> output/{feature}/{date}/
      - 都没有              -> output/
    feature 为空时退回旧的 subfolder 逻辑(向后兼容其他调用方)
    """
    # 推断扩展名: ComfyUI SaveVideo 默认 mp4; 也能从 URL 路径识别 webm/mov/mkv/gif
    ext = ".mp4"
    url_lower = comfy_url_path.lower()
    if ".webm" in url_lower:
        ext = ".webm"
    elif ".mov" in url_lower:
        ext = ".mov"
    elif ".mkv" in url_lower:
        ext = ".mkv"
    elif ".gif" in url_lower:
        ext = ".gif"

    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
        os.makedirs(canvas_output_dir, exist_ok=True)
        local_path = os.path.join(canvas_output_dir, filename)
        url = build_output_url(canvas, filename, username)
    else:
        # subfolder 是旧参数（默认 "video"），语义等同 feature
        owner = get_user_dirname(username) or ""
        canvas_output_dir, url_prefix = media_paths.resolve_media_dir(
            owner=owner, feature=feature or subfolder or "video", kind="video", ext=ext, root=OUTPUT_DIR)
        local_path = os.path.join(canvas_output_dir, filename)
        url = f"{url_prefix}/{filename}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return url
    except Exception as e:
        print(f"下载视频失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def save_to_history(record):
    with HISTORY_LOCK:
        # 走进程内缓存, 避免每次生成都全量读盘(history.json 4.4MB/2654 条, 5000 条封顶约 8MB)
        history = _load_history_cached()
        if "timestamp" not in record:
            record["timestamp"] = time.time() * 1000
        # 幂等：同首图 URL + 同 type 视为同一条记录，更新而非重复插入。
        # 杜绝「后端生成接口已 save_to_history + 前端又 /api/history/save」导致的
        # 一张图两条历史记录（时间戳不同，前端去重按 imgs[0] 能合并，但会污染数据）。
        first = (record.get("images") or [None])[0]
        if first:
            for i, item in enumerate(history):
                exist_first = (item.get("images") or [None])[0]
                if exist_first == first and item.get("type") == record.get("type"):
                    history[i] = record
                    break
            else:
                history.insert(0, record)
        else:
            history.insert(0, record)
        # 缓存与磁盘保持一致: 截断到 5000 条后写穿透(不再失效缓存重读)
        del history[5000:]
        atomic_write_json(HISTORY_FILE, history, ensure_ascii=False, indent=4)

def get_comfy_history(comfy_address, prompt_id):
    try:
        with urllib.request.urlopen(f"http://{comfy_address}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except Exception:
        return {}

def safe_user_id(user_id, request: Request):
    candidate = (user_id or "").strip()
    if not candidate and request.client:
        candidate = f"ip-{request.client.host}"
    if not candidate:
        candidate = "anonymous"
    candidate = re.sub(r"[^a-zA-Z0-9_.-]", "-", candidate)[:80].strip(".-")
    return candidate or "anonymous"

def user_dir(user_id):
    path = os.path.join(CONVERSATION_DIR, user_id)
    os.makedirs(path, exist_ok=True)
    return path

def conversation_path(user_id, conversation_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", conversation_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的对话 ID")
    return os.path.join(user_dir(user_id), f"{cleaned}.json")

def now_ms():
    return int(time.time() * 1000)

def save_conversation(user_id, conversation):
    with CONVERSATION_LOCK:
        path = conversation_path(user_id, conversation["id"])
        atomic_write_json(path, conversation, ensure_ascii=False, indent=2)

def finish_chat_generation(conversation_id, message_id, images=None, error="", user_id=""):
    """把已经完成的生图写回对话。页面关掉后，后台任务仍能把图挂上。"""
    conversation_id = str(conversation_id or "").strip()
    message_id = str(message_id or "").strip()
    if not conversation_id or not message_id:
        return
    if not user_id:
        try:
            user_id = account_dirname()
        except Exception:
            return
    try:
        conversation = load_conversation(user_id, conversation_id)
    except Exception:
        return
    message = next((item for item in conversation.get("messages") or [] if item.get("id") == message_id), None)
    if not message:
        return
    urls = message.setdefault("image_urls", [])
    for url in images or []:
        if url and url not in urls:
            urls.append(url)
    message.pop("pending_generation", None)
    if error and not urls:
        message["generation_error"] = str(error)[:300]
    else:
        message.pop("generation_error", None)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

def new_conversation(user_id, title="新对话"):
    timestamp = now_ms()
    conversation = {
        "id": uuid.uuid4().hex,
        "title": (title or "新对话")[:80],
        "created_at": timestamp,
        "updated_at": timestamp,
        "messages": [],
    }
    save_conversation(user_id, conversation)
    return conversation

def load_conversation(user_id, conversation_id):
    path = conversation_path(user_id, conversation_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="对话不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

_conversation_list_cache = {}


def list_conversations(user_id):
    directory = user_dir(user_id)
    signature = []
    with os.scandir(directory) as entries:
        for entry in entries:
            if not entry.name.endswith(".json"):
                continue
            try:
                stat = entry.stat()
                if entry.is_file():
                    signature.append((entry.name, stat.st_mtime_ns, stat.st_size))
            except FileNotFoundError:
                continue  # 删除历史对话时，目录可能正被另一请求更新。
    signature = tuple(sorted(signature))
    cached = _conversation_list_cache.get(directory)
    if cached and cached[0] == signature:
        return cached[1]
    records = []
    for filename in os.listdir(user_dir(user_id)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(user_dir(user_id), filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        messages = data.get("messages", [])
        last_message = next((m for m in reversed(messages) if m.get("role") != "system"), None)
        records.append({
            "id": data.get("id"),
            "title": data.get("title", "新对话"),
            "created_at": data.get("created_at", 0),
            "updated_at": data.get("updated_at", 0),
            "last_message": (last_message or {}).get("content", ""),
        })
    records.sort(key=lambda item: item["updated_at"], reverse=True)
    # ponytail: 仅缓存摘要，文件变更自动失效；限制账户数量避免无限增长。
    if len(_conversation_list_cache) >= 32:
        _conversation_list_cache.pop(next(iter(_conversation_list_cache)))
    _conversation_list_cache[directory] = (signature, records)
    return records

def canvas_path(canvas_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", canvas_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的画布 ID")
    return os.path.join(CANVAS_DIR, f"{cleaned}.json")

def save_canvas(canvas):
    canvas["updated_at"] = now_ms()
    with CANVAS_LOCK:
        atomic_write_json(canvas_path(canvas["id"]), canvas, ensure_ascii=False, indent=2)

def new_canvas(title="未命名画布", icon="layers", owner=None):
    timestamp = now_ms()
    canvas_id = uuid.uuid4().hex
    folder_name = sanitize_folder_name(title, canvas_id)

    # 创建画布专属输出文件夹(含用户目录嵌套)
    user_dirname = get_user_dirname(owner) if owner else ""
    canvas_dir = os.path.join(OUTPUT_DIR, user_dirname, folder_name) if user_dirname else os.path.join(OUTPUT_DIR, folder_name)
    os.makedirs(canvas_dir, exist_ok=True)

    canvas = {
        "id": canvas_id,
        "title": (title or "未命名画布")[:80],
        "icon": (icon or "🧩")[:4],
        "owner": owner,
        "output_folder": folder_name,
        "created_at": timestamp,
        "updated_at": timestamp,
        "nodes": [],
        "connections": [],
        "viewport": {"x": 0, "y": 0, "scale": 1},
    }
    save_canvas(canvas)
    return canvas

def load_canvas(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        canvas = json.load(f)
    if canvas.get("deleted_at"):
        raise HTTPException(status_code=404, detail="画布已在回收站")
    return canvas

def load_canvas_any(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def canvas_record(data):
    return {
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": data.get("kind", "classic"),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "deleted_at": data.get("deleted_at", 0),
        "node_count": len(data.get("nodes", [])),
    }

def cleanup_expired_canvas_trash():
    cutoff = now_ms() - CANVAS_TRASH_RETENTION_MS
    with CANVAS_LOCK:
        for filename in os.listdir(CANVAS_DIR):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(CANVAS_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                deleted_at = int(data.get("deleted_at") or 0)
                if deleted_at and deleted_at < cutoff:
                    os.remove(path)
            except Exception:
                continue

def iter_canvas_records(include_deleted=False, owner_filter=None):
    cleanup_expired_canvas_trash()
    records = []
    for filename in os.listdir(CANVAS_DIR):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(CANVAS_DIR, filename), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        is_deleted = bool(data.get("deleted_at"))
        if include_deleted != is_deleted:
            continue
        if owner_filter is not None and data.get("owner") != owner_filter:
            continue
        records.append(canvas_record(data))
    return records

def list_canvases(owner_filter=None):
    records = iter_canvas_records(include_deleted=False, owner_filter=owner_filter)
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)

def list_deleted_canvases(owner_filter=None):
    records = iter_canvas_records(include_deleted=True, owner_filter=owner_filter)
    return sorted(records, key=lambda item: item["deleted_at"], reverse=True)

def display_title(text):
    title = re.sub(r"\s+", " ", text or "").strip()
    return title[:24] or "新对话"

from tools.api_compat import api_root, models_endpoint, model_items, is_cloudflare


def resolve_chat_provider(provider: str, model: str, ms_model: str):
    if provider == "modelscope":
        if not MODELSCOPE_API_KEY:
            raise HTTPException(status_code=400, detail="未配置 MODELSCOPE_API_KEY,请在 API/.env 中填写。")
        base = MODELSCOPE_CHAT_BASE_URL
        hdrs = {"Authorization": f"Bearer {sanitize_api_key(MODELSCOPE_API_KEY)}", "Content-Type": "application/json"}
        mdl = selected_model(ms_model or model, MODELSCOPE_CHAT_MODELS[0] if MODELSCOPE_CHAT_MODELS else "MiniMax/MiniMax-M2.7")
        return base, hdrs, mdl
    # 查找 api_providers.json 中的自定义 provider
    providers = load_api_providers()
    for p in providers:
        if p["id"] == provider and p.get("chat_models"):
            base_url = p.get("base_url", "").rstrip("/")
            api_key = get_provider_api_key(p["id"])
            if not base_url:
                raise HTTPException(status_code=400, detail=f"提供商 {p.get('name', provider)} 未配置请求地址")
            if not api_key:
                raise HTTPException(status_code=400, detail=f"提供商 {p.get('name', provider)} 未配置 API Key")
            base = api_root(base_url)
            hdrs = {"Authorization": f"Bearer {sanitize_api_key(api_key)}", "Content-Type": "application/json"}
            mdl = selected_model(model, p["chat_models"][0] if p["chat_models"] else "")
            return base, hdrs, mdl
    # 默认走 comfly
    base = AI_BASE_URL + "/v1"
    hdrs = api_headers()
    mdl = selected_model(model, CHAT_MODEL)
    return base, hdrs, mdl

def api_headers(json_body=True):
    if not AI_API_KEY:
        raise HTTPException(status_code=400, detail="未配置 COMFLY_API_KEY,请在 API/.env 中填写。")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {sanitize_api_key(AI_API_KEY)}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers

def selected_model(requested, fallback):
    model = (requested or fallback).strip()
    if not model:
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    if len(model) > 120 or not re.fullmatch(r"[a-zA-Z0-9_@.:/+-]+", model):
        raise HTTPException(status_code=400, detail=f"模型名称不合法:{model}")
    return model

def text_from_chat_response(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "\n".join(part for part in parts if part)
    return str(content)

def text_delta_from_chat_chunk(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "".join(parts)
    return str(content) if content else ""

def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

def extract_image(data):
    if isinstance(data.get("data"), dict) and isinstance(data["data"].get("data"), dict):
        data = data["data"]["data"]

    images = data.get("data") or []
    if not images:
        raise HTTPException(status_code=502, detail="生图接口没有返回图片数据")
    first = images[0]
    if first.get("url"):
        return {"type": "url", "value": first["url"]}
    if first.get("b64_json"):
        return {"type": "b64", "value": first["b64_json"]}
    raise HTTPException(status_code=502, detail="无法识别生图接口返回格式")

def extract_image_from_chat(data):
    """从对话接口响应中提取图像(Gemini 模型)"""
    choices = data.get("choices") or []
    if not choices:
        raise HTTPException(status_code=502, detail="对话接口没有返回图像数据")

    message = choices[0].get("message") or {}
    content = message.get("content", "")

    if isinstance(content, str):
        if content.startswith("data:image"):
            base64_data = content.split(",", 1)[-1] if "," in content else content
            return {"type": "b64", "value": base64_data}
        if content.startswith("http"):
            return {"type": "url", "value": content}
        m = re.search(r'!\[.*?\]\(data:image/[^;]+;base64,([^)]+)\)', content)
        if m:
            return {"type": "b64", "value": m.group(1)}

    parts = message.get("parts") or []
    for part in parts:
        if isinstance(part, dict):
            if part.get("inlineData"):
                return {"type": "b64", "value": part["inlineData"]["data"]}
            if part.get("fileData"):
                return {"type": "url", "value": part["fileData"].get("fileUri", "")}

    raise HTTPException(status_code=502, detail="无法从对话响应中提取图像")

def extract_task_id(data):
    if data.get("task_id"):
        return str(data["task_id"])
    if data.get("id") and str(data.get("id", "")).startswith("task"):
        return str(data["id"])
    nested = data.get("data")
    if isinstance(nested, dict):
        return extract_task_id(nested)
    return None

async def wait_for_image_task(client, task_id):
    deadline = time.monotonic() + AI_REQUEST_TIMEOUT
    last_payload = {}
    while time.monotonic() < deadline:
        response = await client.get(f"{AI_BASE_URL}/v1/images/tasks/{task_id}", headers=api_headers())
        response.raise_for_status()
        last_payload = response.json()
        task_data = last_payload.get("data") if isinstance(last_payload.get("data"), dict) else last_payload
        status = str(task_data.get("status", "")).upper()
        if status == "SUCCESS":
            return last_payload
        if status == "FAILURE":
            reason = task_data.get("fail_reason") or last_payload.get("message") or "生图任务失败"
            raise HTTPException(status_code=502, detail=f"生图任务失败:{reason}")
        await asyncio.sleep(IMAGE_POLL_INTERVAL)
    raise HTTPException(status_code=504, detail=f"生图任务超时,task_id={task_id}")



def convert_output_to_jpg(url, quality=88):
    path = output_file_from_url(url)
    if not path:
        return url
    root, ext = os.path.splitext(path)
    if ext.lower() in [".jpg", ".jpeg"]:
        return url
    jpg_path = f"{root}.jpg"
    try:
        with Image.open(path) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.save(jpg_path, "JPEG", quality=quality, optimize=True)
        return f"/output/{os.path.basename(jpg_path)}"
    except Exception as e:
        print(f"转换 JPG 失败: {e}")
        return url

def reference_to_data_url(ref):
    path = output_file_from_url(ref.get("url", ""))
    if not path:
        return ref.get("url", "")
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{content_type_for_path(path)};base64,{encoded}"

async def save_ai_image_to_output(image_data, prefix="online_", canvas=None, username=None, subfolder=None, feature="", kind="image"):
    """把上游返回的图片存进 output。

    落盘统一走 media_paths（output/{owner}/{type}/{feature}/{date}/）；
    subfolder 仅保留向后兼容，新调用请用 feature。
    """
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
        url_prefix = ""
    else:
        owner = get_user_dirname(username) or ""
        canvas_output_dir, url_prefix = media_paths.resolve_media_dir(
            owner=owner, feature=feature or subfolder or "online", kind=kind, ext=".png", root=OUTPUT_DIR)
    os.makedirs(canvas_output_dir, exist_ok=True)

    def _url(name):
        if canvas:
            return build_output_url(canvas, name, username)
        return f"{url_prefix}/{name}"

    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    path = os.path.join(canvas_output_dir, filename)
    if image_data["type"] == "b64":
        with open(path, "wb") as f:
            f.write(base64.b64decode(image_data["value"]))
        return _url(filename)
    value = image_data["value"]
    if value.startswith("/output/"):
        # 已有 output URL：提取文件名并重新构建带子文件夹的 URL
        orig_filename = value.rsplit("/", 1)[-1]
        if not orig_filename:
            return value
        # 复制到新子文件夹位置
        orig_path = os.path.join(OUTPUT_DIR, *value.replace("/output/", "", 1).split("/"))
        if os.path.exists(orig_path):
            import shutil
            os.makedirs(canvas_output_dir, exist_ok=True)
            try:
                shutil.copy2(orig_path, os.path.join(canvas_output_dir, orig_filename))
            except Exception:
                pass
        return _url(orig_filename)
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            response = await client.get(value)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "jpeg" in content_type or "jpg" in content_type:
                filename = filename[:-4] + ".jpg"
                path = os.path.join(canvas_output_dir, filename)
            elif "webp" in content_type:
                filename = filename[:-4] + ".webp"
                path = os.path.join(canvas_output_dir, filename)
            with open(path, "wb") as f:
                f.write(response.content)
            return _url(filename)
    except Exception as e:
        print(f"保存上游图片失败: {e}")
        return value

# ==================== 多提供商在线生图分发器 ====================

PROTOCOL_OPENAI = "openai"
PROTOCOL_GEMINI = "gemini"
PROTOCOL_APIMART = "apimart"
PROTOCOL_ROS = "openai-responses"
PROTOCOL_GROK = "grok"
PROTOCOL_VOLCENGINE = "volcengine"
PROTOCOL_RUNNINGHUB = "runninghub"


def _resolve_image_provider(provider_id, protocol_hint=None):
    """Resolve provider config and credentials (Infinite-Canvas unified style)."""
    prov = get_api_provider(provider_id)
    if not prov:
        raise HTTPException(status_code=400, detail=f"未找到提供商: {provider_id}")
    proto = provider_protocol(prov)
    key_env = provider_key_env(prov["id"])
    api_key = read_api_env_value(key_env) or os.getenv(key_env, "")
    # 对 modelscope 回退到全局变量（兼容 API 设置页更新）
    if not api_key and prov["id"] == "modelscope":
        api_key = MODELSCOPE_API_KEY or ""
    base_url = (prov.get("base_url") or "").rstrip("/")
    # ModelScope already includes /v1; other OpenAI providers may not
    base_has_v1 = base_url.endswith("/v1")
    if proto not in ("jimeng", "codex", "gemini-cli", "runninghub"):
        if not base_url:
            raise HTTPException(status_code=400, detail=f"提供商 {prov.get('name', provider_id)} 未配置请求地址")
        if not api_key and proto != PROTOCOL_VOLCENGINE:
            raise HTTPException(status_code=400, detail=f"提供商 {prov.get('name', provider_id)} 未配置 API Key")
    # Normalize: strip /v1 suffix here; _gen_openai_sync appends its own /v1/images/...
    if base_has_v1:
        base_url = base_url[:-3].rstrip("/")
    return {
        "id": prov["id"],
        "name": prov.get("name", provider_id),
        "protocol": proto,
        "model_capabilities": prov.get("model_capabilities") or {},
        "base_url": base_url,
        "api_key": api_key,
        "image_models": prov.get("image_models") or (["gpt-image-2"] if proto == "codex" else []),
        "video_models": prov.get("video_models") or [],
        "chat_models": prov.get("chat_models") or [],
    }


def normalize_image_request_mode(mode):
    """统一 image_request_mode 值"""
    m = str(mode or "").strip().lower()
    return m if m in IMAGE_REQUEST_MODES else "openai"

def normalize_image_request_mode_display(mode):
    m = normalize_image_request_mode(mode)
    display = {
        "openai": "OpenAI 标准",
        "openai-json": "OpenAI JSON",
        "openai-video-proxy": "OpenAI 中转",
        "openai-responses": "OpenAI RS",
        "openai-async-image": "OpenAI 异步图片",
    }
    return display.get(m, m)

def _openai_headers(base_url, api_key, multipart=False):
    h = {"Accept": "application/json", "Authorization": f"Bearer {sanitize_api_key(api_key)}"}
    if not multipart:
        h["Content-Type"] = "application/json"
    return h


async def _gen_openai_responses(client, base_url, api_key, model, prompt, size, quality, refs):
    """OpenAI Responses API: POST /v1/responses"""
    body = {
        "model": model,
        "input": prompt,
        "tools": [],
    }
    # size 映射
    resp = await client.post(
        f"{base_url.rstrip('/')}/v1/responses",
        headers=_openai_headers(base_url, api_key),
        json=body,
        timeout=httpx.Timeout(connect=20.0, read=300.0, write=120.0),
    )
    resp.raise_for_status()
    data = resp.json()
    return await _download_data_urls(client, data)


async def _gen_openai_async_submit(client, base_url, api_key, model, prompt, size, quality, refs):
    """OpenAI 异步生图: POST /v1/images/generations/async → 返回 task_id"""
    body = {"model": model, "prompt": prompt, "size": size, "n": 1}
    endpoint = f"{base_url.rstrip('/')}/v1/images/generations/async"
    resp = await client.post(
        endpoint,
        headers=_openai_headers(base_url, api_key),
        json=body,
        timeout=httpx.Timeout(connect=20.0, read=60.0, write=60.0),
    )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("id") or data.get("task_id") or data.get("data", {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"异步提交成功但未返回 task_id: {data}")
    # 轮询结果
    poll_url = f"{base_url.rstrip('/')}/v1/images/generations/{task_id}"
    await asyncio.sleep(OPENAI_ASYNC_IMAGE_INITIAL_POLL_DELAY)
    deadline = time.time() + OPENAI_ASYNC_IMAGE_TASK_TIMEOUT
    while time.time() < deadline:
        try:
            poll_resp = await client.get(poll_url, headers=_openai_headers(base_url, api_key), timeout=20)
            poll_resp.raise_for_status()
            poll_data = poll_resp.json()
            status = (poll_data.get("status") or poll_data.get("state", "")).lower()
            if status in ("succeeded", "completed", "done", "success"):
                urls = poll_data.get("data", {}).get("urls") or poll_data.get("urls") or [poll_data.get("url")] or [poll_data.get("output", {}).get("url")]
                return await _download_data_urls(client, {"images": [{"url": u} for u in urls if u]})
            elif status in ("failed", "error"):
                raise HTTPException(status_code=502, detail=f"异步任务失败: {poll_data.get('error') or poll_data.get('message', '')}")
        except httpx.TimeoutException:
            pass
        await asyncio.sleep(OPENAI_ASYNC_IMAGE_POLL_INTERVAL)
    raise HTTPException(status_code=504, detail="异步生图超时")


async def _gen_modelscope(client, base_url, api_key, model, prompt, size, quality, refs):
    """ModelScope 专用生图：异步提交 + 轮询（API 路径与 OpenAI 不同）"""
    clean_token = sanitize_api_key(api_key)
    print(f"[_gen_modelscope] model={model} has_key={bool(clean_token)} base_url={base_url}")
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
    width, height = parse_size_pair(size) if size else (1024, 1024)
    payload = {"model": model, "prompt": prompt.strip()}
    if width and height:
        payload["width"] = width
        payload["height"] = height
    ref_urls = [ref for ref in (refs or [])[:4] if isinstance(ref, dict) and ref.get("url")]
    if ref_urls:
        converted = []
        for ref in ref_urls:
            part = reference_file_part(ref)
            if part:
                _filename, data, mime = part
                converted.append(f"data:{mime};base64,{base64.b64encode(data).decode()}")
                continue
            url = ref.get("url", "")
            if url.startswith("/output/") or url.startswith("/assets/"):
                try:
                    data_url = reference_to_data_url({"url": url})
                    if data_url:
                        converted.append(data_url)
                        continue
                except Exception:
                    pass
            if url:
                converted.append(url)
        if converted:
            payload["image_url"] = converted
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
    }
    api_root = base_url.rstrip("/") + "/v1"  # ModelScope 需要 /v1 前缀（base_url 已被 _resolve_image_provider 去掉/v1）
    print(f"[_gen_modelscope] submitting to {api_root}/images/generations model={model} size={width}x{height} payload_keys={list(payload.keys())}")
    print(f"[_gen_modelscope] payload={json.dumps(payload)[:500]}")
    submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
    submit_res.raise_for_status()
    raw = submit_res.json()
    task_id = raw.get("task_id")
    if not task_id:
        try:
            extracted = extract_image(raw)
            if extracted and extracted.get("value"):
                return extracted, raw
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=f"ModelScope 未返回 task_id：{raw}")
    deadline = time.monotonic() + AI_REQUEST_TIMEOUT
    last_payload = raw
    while time.monotonic() < deadline:
        await asyncio.sleep(IMAGE_POLL_INTERVAL)
        poll_resp = await client.get(
            f"{api_root}/tasks/{task_id}",
            headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
        )
        poll_resp.raise_for_status()
        data = poll_resp.json()
        last_payload = data
        status = str(data.get("task_status") or data.get("status", "")).upper()
        if status in ("SUCCEED", "SUCCEEDED", "SUCCESS", "DONE", "COMPLETED"):
            images = data.get("output_images") or data.get("images", []) or data.get("data", {}).get("urls", [])
            if images:
                return {"type": "url", "value": (images[0] if isinstance(images, list) else images)}, data
            raise HTTPException(status_code=502, detail=f"ModelScope 成功但没有返回图片：{data}")
        if status in ("FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"):
            detail = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
            raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{detail}")
    raise HTTPException(status_code=504, detail=f"ModelScope 生图任务超时：{last_payload}")


async def _download_data_urls(client, data):
    """从 API 返回中提取图片 URL 并下载成 bytes"""
    raw = data
    images_info = []
    if isinstance(data, dict):
        images_info = data.get("images") or data.get("data") or []
    if not images_info:
        urls = data.get("urls") or [data.get("url")] if data.get("url") else []
        images_info = [{"url": u} for u in urls]
    image_data_list = []
    for img in images_info:
        url = img.get("url") or img.get("b64_json") or ""
        if not url:
            continue
        if url.startswith("data:"):
            import base64
            _, b64 = url.split(",", 1)
            image_data_list.append(base64.b64decode(b64))
        elif url.startswith("http"):
            try:
                resp = await client.get(url, timeout=30)
                resp.raise_for_status()
                image_data_list.append(resp.content)
            except Exception:
                pass
    return image_data_list, raw


_OPTIONAL_IMAGE_FIELDS = ("output_format", "quality", "style", "background")

def _drop_rejected_image_fields(payload, response_text):
    """上游点名拒绝的可选字段去掉后再试，例如 Agnes 不接受 output_format。"""
    raw = response_text or ""
    text = raw.lower()
    trimmed = dict(payload)
    changed = False
    # multipart 里的 n 只能是字符串，Agnes 要求 uint：cannot unmarshal string into ... field Alias.n
    for match in re.finditer(r"struct field\s+\w+\.(\w+)", raw):
        key = match.group(1)
        if key in trimmed:
            trimmed.pop(key, None)
            changed = True
    if any(word in text for word in ("not supported", "unsupported", "invalid", "unknown")):
        for key in _OPTIONAL_IMAGE_FIELDS:
            if key in trimmed and key in text:
                trimmed.pop(key, None)
                changed = True
    return trimmed, changed

def _post_kwargs(headers, timeout):
    kwargs = {"headers": headers}
    if timeout is not None:
        kwargs["timeout"] = timeout
    return kwargs

async def _post_image_json(client, url, headers, payload, timeout):
    body = dict(payload)
    resp = None
    for _ in range(1 + len(_OPTIONAL_IMAGE_FIELDS)):
        resp = await client.post(url, json=body, **_post_kwargs(headers, timeout))
        if resp.status_code < 400:
            return resp
        body, changed = _drop_rejected_image_fields(body, resp.text)
        if not changed:
            return resp
    return resp

async def _post_image_form(client, url, headers, data, files, timeout):
    body = dict(data)
    resp = None
    for _ in range(1 + len(_OPTIONAL_IMAGE_FIELDS)):
        for item in files or []:
            handle = item[1][1] if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], tuple) and len(item[1]) > 1 else None
            if handle is not None and hasattr(handle, "seek"):
                handle.seek(0)
        resp = await client.post(url, data=body, files=files, **_post_kwargs(headers, timeout))
        if resp.status_code < 400:
            return resp
        body, changed = _drop_rejected_image_fields(body, resp.text)
        if not changed:
            return resp
    return resp

def agnes_size_ratio(size):
    text = str(size or "").strip()
    upper = text.upper()
    if upper in ("1K", "2K", "3K", "4K"):
        return upper, "1:1"
    ratios = {
        "1:1": 1, "3:4": 3 / 4, "4:3": 4 / 3, "16:9": 16 / 9,
        "9:16": 9 / 16, "2:3": 2 / 3, "3:2": 3 / 2, "21:9": 21 / 9,
    }
    if "x" not in text.lower():
        return "1K", "1:1"
    width_text, height_text = text.lower().split("x", 1)
    try:
        width, height = int(float(width_text)), int(float(height_text))
    except ValueError:
        return "1K", "1:1"
    if width <= 0 or height <= 0:
        return "1K", "1:1"
    target = width / height
    ratio = min(ratios, key=lambda key: abs(ratios[key] - target))
    longest = max(width, height)
    if longest >= 3600:
        tier = "4K"
    elif longest >= 2800:
        tier = "3K"
    elif longest >= 1800:
        tier = "2K"
    else:
        tier = "1K"
    return tier, ratio


async def _gen_agnes_image(client, base_url, api_key, model, prompt, size, refs):
    """Agnes 图生图走 /v1/images/generations，参考图放在 extra_body.image。"""
    tier, ratio = agnes_size_ratio(size)
    extra = {"response_format": "url"}
    images = []
    for ref in (refs or [])[:4]:
        part = reference_file_part(ref)
        if part:
            _name, data, mime = part
            images.append("data:%s;base64,%s" % (mime, base64.b64encode(data).decode()))
            continue
        url = ref.get("url", "") if isinstance(ref, dict) else ""
        if url:
            images.append(url)
    if images:
        extra["image"] = images
    body = {
        "model": model,
        "prompt": prompt,
        "size": tier,
        "ratio": ratio,
        "extra_body": extra,
    }
    resp = await _post_image_json(
        client,
        f"{base_url.rstrip('/')}/v1/images/generations",
        _openai_headers(base_url, api_key),
        body,
        httpx.Timeout(connect=30.0, read=180.0, write=120.0, pool=30.0),
    )
    if resp.status_code >= 400:
        text = resp.text or ""
        if "queue is full" in text.lower():
            detail = "生图排队已满，请稍后再试。"
        else:
            message = re.search(r'"message"\s*:\s*"([^"]+)"', text)
            detail = (message.group(1) if message else text)[:180] or "Agnes 生图失败"
        raise HTTPException(status_code=502, detail=detail)
    try:
        raw = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Agnes 返回无效响应")
    return extract_image(raw), raw


async def _gen_openai_sync(client, base_url, api_key, model, prompt, size, quality, refs, is_grok=False):
    """OpenAI /v1/images/generations or /edits, also Grok via /v1/messages."""
    hdrs = _openai_headers(base_url, api_key)
    base = base_url.rstrip("/")
    
    if is_grok:
        content = [{"type": "text", "text": prompt}]
        for ref in (refs or [])[:4]:
            path = output_file_from_url(ref.get("url", ""))
            if path:
                b64 = base64.b64encode(open(path, "rb").read()).decode()
                ct = content_type_for_path(path)
                content.append({"type": "image_url", "image_url": {"url": f"data:{ct};base64,{b64}"}})
            elif ref.get("url"):
                content.append({"type": "image_url", "image_url": {"url": ref["url"]}})
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}]}, ensure_ascii=False)
        resp = await client.post(f"{base}/v1/messages", headers={**hdrs, "Content-Type": "application/json"}, content=body)
        resp.raise_for_status()
        raw = resp.json()
        text = ""
        choices = raw.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            c = msg.get("content", "")
            if isinstance(c, str): text = c
            elif isinstance(c, list):
                for part in c:
                    if isinstance(part, dict): text += part.get("text", "") or part.get("content", "") or ""
        m = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', text)
        if m: return {"type":"b64","value":m.group(1)}, raw
        m = re.search(r'https?://\S+', text)
        if m: return {"type":"url","value":m.group(0)}, raw
        task_id = extract_task_id(raw)
        if task_id:
            result = await wait_for_image_task_v2(client, task_id, tasks_base=base.replace("/v1",""), key=api_key)
            return extract_image(result), result
        raise HTTPException(status_code=502, detail="Grok 接口未返回图片结果")

    if str(model or "").lower().startswith("agnes-image") or "agnes-ai" in base.lower():
        return await _gen_agnes_image(client, base, api_key, model, prompt, size, refs)

    # Standard OpenAI
    if refs:
        files = reference_upload_files(refs)
        if not files:
            raise HTTPException(status_code=400, detail="参考图无法读取，请重新选择图片后再试。")
        data = {"model":model,"prompt":prompt,"size":size,"quality":quality,"output_format":"png"}
        resp = await _post_image_form(client, f"{base}/v1/images/edits", _openai_headers(base_url, api_key, multipart=True), data, files, httpx.Timeout(connect=30.0, read=180.0, write=60.0, pool=30.0))
    else:
        resp = await _post_image_json(client, f"{base}/v1/images/generations", _openai_headers(base_url, api_key), {"model":model,"prompt":prompt,"size":size,"quality":quality,"output_format":"png","n":1}, httpx.Timeout(connect=30.0, read=120.0, write=60.0, pool=30.0))
    
    resp.raise_for_status()
    try: raw = resp.json()
    except: raise HTTPException(status_code=502, detail=f"API 返回无效响应: {resp.text[:200]}")
    try: return extract_image(raw), raw
    except HTTPException:
        task_id = extract_task_id(raw)
        if not task_id: raise
    result = await wait_for_image_task_v2(client, task_id, tasks_base=base.replace("/v1",""), key=api_key)
    return extract_image(result), result


async def _gen_gemini(client, base_url, api_key, model, prompt, size, quality, refs):
    """Gemini: chat/completions with multimodal input."""
    system_prompt = f"Generate an image with requirements. Size: {size}, Quality: {quality}."
    if refs:
        gemini_content = [{"type":"text","text":prompt}]
        for ref in refs[:4]:
            url = reference_to_data_url(ref)
            if url.startswith("data:"):
                gemini_content.append({"type":"image_url","image_url":{"url":url}})
        messages = [{"role":"system","content":system_prompt},{"role":"user","content":gemini_content}]
    else:
        messages = [{"role":"system","content":system_prompt},{"role":"user","content":prompt}]
    hdrs = _openai_headers(base_url, api_key)
    resp = await client.post(f"{base_url.rstrip('/')}/v1/chat/completions", headers=hdrs, json={"model":model,"messages":messages})
    resp.raise_for_status()
    raw = resp.json()
    return extract_image_from_chat(raw), raw


async def _gen_webai2api(client, prov, model, prompt, size, refs, generation_params=None, on_progress=None):
    from tools.webai_gateway import image_results
    content = [{"type": "text", "text": prompt}]
    for ref in refs:
        content.append({"type": "image_url", "image_url": {"url": reference_to_data_url(ref)}})
    body = {"model": model, "messages": [{"role": "user", "content": content}], "stream": False, "n": 1}
    # 网页端按比例选择，像素尺寸仅作提示；不传不受支持的采样器、种子等参数。
    if re.fullmatch(r"\d+x\d+", size or ""):
        import math
        width, height = map(int, size.split("x"))
        if width > 0 and height > 0:
            divisor = math.gcd(width, height)
            body["ratio"] = f"{width // divisor}:{height // divisor}"
    metadata = prov.get("model_capabilities", {}).get(model, {})
    capabilities = metadata.get('generation_params') or {}
    if capabilities.get('source') == 'website':
        # 直接调用 API、历史重试也要读取网关最新能力，不能只信前端缓存。
        response = await client.get(prov['base_url'] + '/v1/models',
            headers=_openai_headers(prov['base_url'], prov['api_key']), timeout=90.0)
        response.raise_for_status()
        from tools.webai_gateway import model_catalog
        metadata = model_catalog(response.json().get('data', [])).get(model, {})
        capabilities = metadata.get('generation_params') or {}
        if capabilities.get('source') != 'website':
            raise HTTPException(status_code=400, detail='未获取当前模型的参数，请刷新模型后重试')
        body.pop('ratio', None)
    policy = metadata.get('image_policy', 'optional')
    if policy in ('forbidden', 'none') and refs:
        raise HTTPException(status_code=400, detail='该网页模型不支持参考图，请移除参考图或切换模型')
    if policy == 'required' and not refs:
        raise HTTPException(status_code=400, detail='该网页模型需要至少一张参考图')
    if metadata.get('available') is False:
        raise HTTPException(status_code=400, detail='上游当前未开放该模型')
    from tools.webai_gateway import validate_generation_params
    try:
        params = validate_generation_params(capabilities, generation_params or {}, len(refs))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if params:
        body['params'] = params
        body.update(params)
        body['n'] = params.get('count', 1)
    if on_progress:
        from tools.webai_gateway import read_progress_stream
        body.update(stream=True, progress=True)
        async with client.stream('POST', prov['base_url'] + '/v1/chat/completions',
                headers=_openai_headers(prov['base_url'], prov['api_key']), json=body,
                timeout=httpx.Timeout(900.0, connect=20.0)) as response:
            response.raise_for_status()
            try:
                raw = await read_progress_stream(response, on_progress)
            except ValueError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
    else:
        response = await client.post(prov['base_url'] + '/v1/chat/completions',
            headers=_openai_headers(prov['base_url'], prov['api_key']), json=body,
            timeout=httpx.Timeout(900.0, connect=20.0))
        response.raise_for_status()
        raw = response.json()
    images = image_results(raw, prov["base_url"])
    if not images:
        raise HTTPException(status_code=502, detail="网页模型没有返回图片，请检查登录状态、平台额度或更换生图模型")
    raw["_webai_images"] = images
    return images[0], raw


async def _gen_apimart(client, base_url, api_key, model, prompt, size, quality, refs):
    """APIMart async: POST -> poll GET /v1/images/tasks/{task_id}."""
    hdrs = _openai_headers(base_url, api_key)
    base = base_url.rstrip("/")
    if refs:
        files = reference_upload_files(refs)
        if not files:
            raise HTTPException(status_code=400, detail="参考图无法读取，请重新选择图片后再试。")
        data = {"model":model,"prompt":prompt,"size":size,"quality":quality,"output_format":"png"}
        resp = await _post_image_form(client, f"{base}/v1/images/edits", _openai_headers(base_url, api_key, multipart=True), data, files, None)
    else:
        resp = await _post_image_json(client, f"{base}/v1/images/generations", hdrs, {"model":model,"prompt":prompt,"size":size,"quality":quality,"output_format":"png","n":1}, None)
    resp.raise_for_status()
    try: raw = resp.json()
    except: raise HTTPException(status_code=502, detail=f"APIMart 返回无效响应: {resp.text[:200]}")
    task_id = extract_task_id(raw)
    if not task_id:
        try: return extract_image(raw), raw
        except: pass
        raise HTTPException(status_code=502, detail="APIMart 未返回任务ID或图片结果")
    result = await wait_for_image_task_v2(client, task_id, tasks_base=base.replace("/v1",""), key=api_key)
    return extract_image(result), result


async def _gen_volcengine(client, ak, sk, model, prompt, size, quality, refs):
    """VolcEngine Ark image/vision: uses /api/v3/text-to-image."""
    base_root = os.getenv("VOLCENGINE_BASE_ROOT", "https://ark.cn-beijing.volces.com").rstrip("/")
    ak = ak or jimeng_env_value("VOLCENGINE_AK") or os.getenv("VOLCENGINE_ACCESS_KEY", "")
    sk = sk or jimeng_env_value("VOLCENGINE_SK") or os.getenv("VOLCENGINE_SECRET_KEY", "")
    if not ak or not sk:
        raise HTTPException(status_code=400, detail="火山引擎 AK/SK 未配置")
    # VolcEngine requires signature auth; simplest approach: use ark.cn-beijing.volces.com with token
    token = jimeng_env_value("VOLCENGINE_TOKEN") or os.getenv("VOLCENGINE_TOKEN", ak)
    hdrs = {"Content-Type":"application/json","Authorization":f"Bearer {token}"}
    body = {"model":model,"prompt":prompt,"size":size,"quality":quality,"n":1}
    resp = await client.post(f"{base_root}/api/v3/images/generations", headers=hdrs, json=body)
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"火山引擎接口错误: {resp.text[:300]}")
    raw = resp.json()
    return extract_image(raw), raw


async def _gen_runninghub(client, provider_cfg, model, prompt, size, quality, refs):
    """RunningHub workflow/app image generation."""
    rh_base = str((provider_cfg or {}).get("base_url") or os.getenv("RUNNINGHUB_BASE_URL", "https://www.runninghub.ai")).rstrip("/")
    wf_store = load_runninghub_workflow_store()
    cfg = None
    for wid, c in wf_store.items():
        if c.get("workflowJson"):
            cfg = c; break
    if not cfg:
        raise HTTPException(status_code=400, detail="RunningHub 未配置工作流")
    wj = cfg.get("workflowJson", {})
    for nid, node in wj.items():
        inp = node.get("inputs", {})
        for k in ("text","prompt","positive_prompt","negative_prompt"):
            if k in inp and isinstance(inp[k], str) and "{PROMPT}" in inp[k]:
                inp[k] = inp[k].replace("{PROMPT}", prompt)
        if "width" in inp:
            try: inp["width"] = int(size.split("x")[0]) if "x" in size else 1024
            except: pass
        if "height" in inp:
            try: inp["height"] = int(size.split("x")[1]) if "x" in size else 1024
            except: pass
    api_key = runninghub_api_key(provider_cfg)
    hdrs = runninghub_app_headers(provider_cfg)
    submit_body = {"workflowId": cfg.get("workflowId",""),"nodeInfoList":[],"useWallet":True}
    resp = await client.post(f"{rh_base}/enterprise-api/consumerApi/run", headers=hdrs, json=submit_body)
    resp.raise_for_status()
    raw = resp.json()
    task_id = raw.get("data",{}).get("taskId") or raw.get("data",{}).get("task_id")
    if task_id:
        deadline = time.monotonic() + AI_REQUEST_TIMEOUT
        while time.monotonic() < deadline:
            qresp = await client.get(f"{rh_base}/enterprise-api/consumerApi/query", headers=hdrs, params={"taskId":task_id})
            qresp.raise_for_status()
            qraw = qresp.json()
            st = str(qraw.get("data",{}).get("status","")).upper()
            if st in ("SUCCESS","DONE","COMPLETED"):
                return extract_image(qraw), qraw
            if st in ("FAIL","FAILED","ERROR"):
                raise HTTPException(status_code=502, detail=f"RunningHub 任务失败: {qraw.get('data',{}).get('error','unknown')}")
            await asyncio.sleep(IMAGE_POLL_INTERVAL)
        raise HTTPException(status_code=504, detail=f"RunningHub 任务超时: {task_id}")
    return extract_image(raw), raw


async def wait_for_image_task_v2(client, task_id, tasks_base=None, key=None):
    """Poll async image generation task for any OpenAI-compatible protocol."""
    base = (tasks_base or AI_BASE_URL).rstrip("/")
    key = key or AI_API_KEY
    deadline = time.monotonic() + AI_REQUEST_TIMEOUT
    last_payload = {}
    while time.monotonic() < deadline:
        resp = await client.get(f"{base}/v1/images/tasks/{task_id}", headers={"Accept":"application/json","Authorization":f"Bearer {sanitize_api_key(key)}"})
        resp.raise_for_status()
        last_payload = resp.json()
        td = last_payload.get("data") if isinstance(last_payload.get("data"), dict) else last_payload
        status = str(td.get("status","")).upper()
        if status == "SUCCESS": return last_payload
        if status == "FAILURE":
            reason = td.get("fail_reason") or last_payload.get("message") or "生图任务失败"
            raise HTTPException(status_code=502, detail=f"生图任务失败:{reason}")
        await asyncio.sleep(IMAGE_POLL_INTERVAL)
    raise HTTPException(status_code=504, detail=f"生图任务超时,task_id={task_id}")


async def generate_ai_image(prompt, size, quality, model, reference_images=None, protocol="openai", provider_id="", provider=None, image_request_mode="openai", generation_params=None, on_progress=None):
    """Multi-protocol online image generation dispatcher.
    
    Supported: openai (with modes: openai-json, openai-responses, openai-async-image), 
               gemini, apimart, grok, volcengine, runninghub
    Falls back to default comfly/MODELSCOPE when no provider specified.
    """
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    q = {"auto":"medium","low":"low","medium":"medium","high":"high","standard":"low","hd":"high"}.get(quality, "medium")
    mode = normalize_image_request_mode(image_request_mode)
    
    prov = provider or _resolve_image_provider(provider_id, protocol)
    actual_proto = provider_protocol(prov) if isinstance(prov, dict) else (protocol or PROTOCOL_OPENAI)

    if actual_proto == "codex":
        from tools.codex_image import generate_image
        parts = [await asyncio.to_thread(reference_file_part, ref) for ref in refs]
        if any(part is None for part in parts):
            raise HTTPException(status_code=400, detail="Codex 参考图请先上传到本机，暂不支持外部图片 URL。")
        try:
            return await generate_image(prompt, size, quality, model, parts)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        # ModelScope 专用（使用 async task API，与 OpenAI 标准不同）
        if str(provider_id).lower() == "modelscope" or str(prov.get("id", "")).lower() == "modelscope":
            return await _gen_modelscope(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)
        if actual_proto == "webai2api":
            return await _gen_webai2api(client, prov, model, prompt, size, refs, generation_params, on_progress)
        if actual_proto == PROTOCOL_GEMINI:
            return await _gen_gemini(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)
        elif actual_proto == PROTOCOL_APIMART:
            return await _gen_apimart(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)
        elif actual_proto == PROTOCOL_GROK:
            return await _gen_openai_sync(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs, is_grok=True)
        elif actual_proto == PROTOCOL_VOLCENGINE:
            return await _gen_volcengine(client, prov.get("ak",""), prov.get("sk",""), model, prompt, size, q, refs)
        elif actual_proto == PROTOCOL_RUNNINGHUB:
            return await _gen_runninghub(client, prov, model, prompt, size, q, refs)
        else:
            # OpenAI 协议下按 image_request_mode 分发
            if mode == "openai-responses":
                return await _gen_openai_responses(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)
            elif mode == "openai-async-image":
                return await _gen_openai_async_submit(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)
            else:
                return await _gen_openai_sync(client, prov["base_url"], prov["api_key"], model, prompt, size, q, refs)


def upstream_message_from_record(item):
    role = item.get("role")
    if role not in {"user", "assistant"} or item.get("type") == "image":
        return None
    refs = item.get("attachments") or []
    if refs and role == "user":
        content = [{"type": "text", "text": item.get("content", "")}]
        for ref in refs:
            url = reference_to_data_url(ref)
            if url:
                content.append({"type": "image_url", "image_url": {"url": url}})
        return {"role": role, "content": content}
    return {"role": role, "content": item.get("content", "")}

# === 素材库辅助函数 ===

def ensure_same_origin_request(request: Request):
    host = str(request.headers.get("host") or "").lower()
    expected = f"{request.url.scheme}://{host}".lower() if host else ""
    origin = origin_from_url(request.headers.get("origin", ""))
    referer = origin_from_url(request.headers.get("referer", ""))
    actual = origin or referer
    if expected and actual != expected:
        raise HTTPException(status_code=403, detail="只允许从当前页面导入本地图片")

def origin_from_url(value):
    parsed = urllib.parse.urlparse(str(value or ""))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}".lower()

def sanitize_export_filename(name: str, fallback: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(name or "")).strip(" ._")
    return name[:120] or fallback

def prompt_template_markdown_path() -> str:
    for path in PROMPT_TEMPLATE_PATHS:
        if os.path.exists(path):
            return path
    return ""

def parse_prompt_template_markdown(content: str) -> list:
    """解析提示词模板 Markdown 文件"""
    templates = []
    blocks = re.split(r'\n(?=##\s)', content)
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        title_match = re.match(r'^##\s+(.+)$', block, re.MULTILINE)
        if not title_match:
            continue
        title = title_match.group(1).strip()
        scene = ""
        positive = ""
        scene_match = re.search(r'###\s*场景描述\s*\n(.+?)(?=\n###|$)', block, re.DOTALL)
        if scene_match:
            scene = scene_match.group(1).strip()
        prompt_match = re.search(r'###\s*提示词\s*\n(.+?)(?=\n###|$)', block, re.DOTALL)
        if prompt_match:
            positive = prompt_match.group(1).strip()
        if positive:
            templates.append({
                "name": title,
                "scene": scene,
                "positive": positive,
                "category": "storyboard",
            })
    return templates

def builtin_prompt_templates():
    try:
        template_path = prompt_template_markdown_path()
        if not template_path:
            return []
        with open(template_path, "r", encoding="utf-8") as f:
            return parse_prompt_template_markdown(f.read())
    except Exception as e:
        print(f"读取提示词模板失败: {e}")
        return []

def smart_group_export_folder(folder: str, group_name: str) -> str:
    text = str(folder or "").strip()
    if text:
        path = os.path.abspath(os.path.expanduser(text))
    else:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe_group = sanitize_export_filename(group_name or "group", "group")
        path = os.path.abspath(os.path.join(OUTPUT_DIR, "smart-groups", f"{safe_group}-{stamp}"))
    os.makedirs(path, exist_ok=True)
    return path

def sanitize_asset_name(name, fallback="asset"):
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(name or fallback)).strip()
    return name[:120] or fallback

def content_type_for_path(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in [".mp4", ".m4v"]:
        return "video/mp4"
    if ext == ".webm":
        return "video/webm"
    if ext == ".mov":
        return "video/quicktime"
    if ext == ".avi":
        return "video/x-msvideo"
    if ext == ".mkv":
        return "video/x-matroska"
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".wav":
        return "audio/wav"
    if ext == ".ogg":
        return "audio/ogg"
    if ext == ".flac":
        return "audio/flac"
    if ext == ".aac":
        return "audio/aac"
    if ext == ".m4a":
        return "audio/mp4"
    if ext == ".png":
        return "image/png"
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    if ext == ".gif":
        return "image/gif"
    if ext == ".txt":
        return "text/plain"
    return "application/octet-stream"

def reference_file_part(ref):
    """把参考图变成可上传的文件。支持本机 /output 路径和对话里的 data URL。"""
    url = ""
    name = ""
    if isinstance(ref, dict):
        url = str(ref.get("url") or "")
        name = str(ref.get("name") or "")
    else:
        url = str(ref or "")
    path = output_file_from_url(url)
    if path:
        with open(path, "rb") as handle:
            data = handle.read()
        return _cap_reference_image(os.path.basename(path), data, content_type_for_path(path))
    if not url.startswith("data:"):
        return None
    header, _, payload = url.partition(",")
    mime = "image/png"
    if header.startswith("data:") and ";" in header:
        mime = header[5:].split(";", 1)[0] or mime
    try:
        data = base64.b64decode(payload)
    except Exception:
        return None
    if not data:
        return None
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(mime, "png")
    filename = os.path.basename(name) if name else f"reference.{ext}"
    if "." not in filename:
        filename = f"{filename}.{ext}"
    return _cap_reference_image(filename, data, mime)


def _cap_reference_image(filename, data, mime, max_edge=1536):
    try:
        img = ImageOps.exif_transpose(Image.open(BytesIO(data)))
        img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        stem = os.path.splitext(filename)[0] or "reference"
        return f"{stem}.jpg", buf.getvalue(), "image/jpeg"
    except Exception:
        return filename, data, mime


def reference_upload_files(refs):
    files = []
    for ref in (refs or [])[:4]:
        part = reference_file_part(ref)
        if not part:
            continue
        filename, data, mime = part
        files.append(("image", (filename, BytesIO(data), mime)))
    return files


def output_file_from_url(url):
    if isinstance(url, dict):
        url = url.get("url", "")
    if not url or not (url.startswith("/output/") or url.startswith("/assets/")):
        return None
    clean = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/assets/"):
        root = ASSETS_DIR if os.path.isdir(ASSETS_DIR) else INPUT_DIR
        rel = clean[len("/assets/"):]
        if rel.startswith("uploads/"):
            rel = "library/_local/" + rel[len("uploads/"):]
    else:
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    rel = rel.lstrip("/")
    if not rel:
        return None
    path = os.path.abspath(os.path.join(root, rel))
    output_root = os.path.abspath(root)
    if os.path.commonpath([output_root, path]) != output_root or not os.path.exists(path):
        return None
    return path

def asset_library_item_path(url):
    """把资产 url 解析成本地绝对路径，不校验文件是否存在。

    output_file_from_url 在文件丢失时返回 None，无法区分「路径非法」和「文件丢了」，
    整理/清理功能需要后者，所以单独留出这条只解析、不检查的分支。
    """
    if isinstance(url, dict):
        url = url.get("url", "")
    url = str(url or "")
    if not (url.startswith("/output/") or url.startswith("/assets/")):
        return None
    clean = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/assets/"):
        root = ASSETS_DIR if os.path.isdir(ASSETS_DIR) else INPUT_DIR
        rel = clean[len("/assets/"):]
        if rel.startswith("uploads/"):
            rel = "library/_local/" + rel[len("uploads/"):]
    else:
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    rel = rel.lstrip("/")
    if not rel:
        return None
    try:
        path = os.path.abspath(os.path.join(root, rel))
        if os.path.commonpath([os.path.abspath(root), path]) != os.path.abspath(root):
            return None
    except (ValueError, OSError):
        return None
    return path

def asset_file_fingerprint(path, size=0):
    """重复素材检测用的快速指纹：文件前 2MB + 总大小。

    素材里混着几十 MB 的视频，全量 md5 太慢；同大小 + 前 2MB 一致
    已经足够判定图文重复，误判概率可忽略。
    """
    import hashlib
    try:
        digest = hashlib.md5()
        with open(path, "rb") as handle:
            remaining = 2 * 1024 * 1024
            while remaining > 0:
                chunk = handle.read(min(262144, remaining))
                if not chunk:
                    break
                digest.update(chunk)
                remaining -= len(chunk)
        digest.update(str(size or 0).encode("utf-8"))
        return digest.hexdigest()
    except OSError:
        return ""

def local_media_file_by_basename(name: str):
    safe = os.path.basename(urllib.parse.unquote(str(name or "")))
    if not safe:
        return None
    roots = [
        OUTPUT_OUTPUT_DIR,
        OUTPUT_INPUT_DIR,
        os.path.join(ASSETS_DIR, "output"),
        os.path.join(ASSETS_DIR, "input"),
        os.path.join(ASSETS_DIR, "library"),
    ]
    for root in roots:
        if not os.path.isdir(root):
            continue
        path = os.path.abspath(os.path.join(root, safe))
        root_abs = os.path.abspath(root)
        if os.path.commonpath([root_abs, path]) == root_abs and os.path.isfile(path):
            return path
    return None

def filename_from_media_url(url: str, fallback: str = "download.bin") -> str:
    path = urllib.parse.urlsplit(str(url or "")).path
    name = os.path.basename(urllib.parse.unquote(path))
    return sanitize_export_filename(name or fallback, fallback)

def fetch_remote_media_bytes(url: str, timeout: float = 30.0, max_bytes: int = 200 * 1024 * 1024):
    text = str(url or "").strip()
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    with requests.get(text, stream=True, timeout=timeout, headers={"User-Agent": "ComfyUI-API-Modelscope/1.0"}) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type") or "application/octet-stream"
        chunks = []
        total = 0
        for chunk in response.iter_content(chunk_size=1024 * 256):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="文件太大,无法下载")
            chunks.append(chunk)
        return b"".join(chunks), content_type

# --- 资产库辅助函数 ---

def default_asset_library():
    categories = [
        {"id": "characters", "name": "角色", "type": "image", "items": []},
        {"id": "scenes", "name": "场景", "type": "image", "items": []},
        {"id": "workflows", "name": "工作流", "type": "workflow", "items": []},
    ]
    return {
        "active_library_id": "default",
        "libraries": [{"id": "default", "name": "默认资产库", "type": "asset", "categories": categories}],
        "categories": categories,
        "updated_at": now_ms(),
    }

AVATAR_LEGACY_FLAT_FIELDS = ("platform", "provider_id", "project_name", "avatar_task_id",
                             "avatar_status", "avatar_detail", "asset_uri", "asset_id", "registered_at")

def migrate_asset_item_registrations(item):
    if not isinstance(item, dict):
        return
    regs = item.get("registrations")
    if not isinstance(regs, dict):
        regs = {}
    legacy_platform = str(item.get("platform") or "").strip()
    if legacy_platform and legacy_platform not in regs and (item.get("asset_uri") or item.get("avatar_task_id")):
        regs[legacy_platform] = {
            "provider_id": item.get("provider_id") or "",
            "project_name": item.get("project_name") or "default",
            "task_id": item.get("avatar_task_id") or "",
            "status": item.get("avatar_status") or "",
            "detail": item.get("avatar_detail") or "",
            "asset_uri": item.get("asset_uri") or "",
            "asset_id": item.get("asset_id") or "",
            "registered_at": item.get("registered_at") or 0,
        }
    item["registrations"] = regs if isinstance(regs, dict) else {}
    for key in AVATAR_LEGACY_FLAT_FIELDS:
        item.pop(key, None)

def normalize_asset_library(lib):
    from core.asset_repository import normalize_repository_title
    if not isinstance(lib, dict):
        lib = default_asset_library()
    legacy_categories = lib.get("categories") if isinstance(lib.get("categories"), list) else None
    libraries = lib.get("libraries") if isinstance(lib.get("libraries"), list) else []
    if not libraries:
        libraries = [{
            "id": "default",
            "name": "默认资产库",
            "type": "asset",
            "categories": legacy_categories or default_asset_library()["categories"],
        }]
    for library in libraries:
        library["id"] = re.sub(r"[^A-Za-z0-9_-]+", "_", str(library.get("id") or f"lib_{uuid.uuid4().hex[:8]}"))[:40]
        library["name"] = sanitize_asset_name(library.get("name") or "资产库", "资产库")
        cats = library.get("categories") if isinstance(library.get("categories"), list) else []
        if library.get("id") == "default" and not any(c.get("type") == "workflow" for c in cats):
            cats.append({"id": "workflows", "name": "工作流", "type": "workflow", "items": []})
        for cat in cats:
            for item in (cat.get("items") or []):
                normalize_repository_title(item)
                migrate_asset_item_registrations(item)
        library["categories"] = cats
    active = str(lib.get("active_library_id") or libraries[0].get("id") or "default")
    if not any(item.get("id") == active for item in libraries):
        active = libraries[0].get("id") or "default"
    active_library = next((item for item in libraries if item.get("id") == active), libraries[0])
    lib["libraries"] = libraries
    lib["active_library_id"] = active
    lib["categories"] = active_library.get("categories") or []
    lib["updated_at"] = int(lib.get("updated_at") or now_ms())
    sort_asset_library_items(lib)
    return lib

def sort_asset_library_items(lib):
    cats = list(lib.get("categories", []))
    for library in lib.get("libraries", []) if isinstance(lib.get("libraries"), list) else []:
        cats.extend(library.get("categories") or [])
    seen = set()
    for cat in cats:
        if id(cat) in seen:
            continue
        seen.add(id(cat))
        items = cat.get("items")
        if isinstance(items, list):
            def created_at_key(item):
                if not isinstance(item, dict):
                    return 0
                try:
                    return int(float(item.get("created_at") or 0))
                except (TypeError, ValueError):
                    return 0
            items.sort(key=created_at_key, reverse=True)

def load_asset_library():
    path = asset_library_path()
    if not os.path.exists(path):
        lib = default_asset_library()
        save_asset_library(lib)
        return lib
    try:
        with open(path, "r", encoding="utf-8") as f:
            lib = json.load(f)
    except Exception:
        lib = default_asset_library()
    lib = normalize_asset_library(lib)
    if synchronize_asset_storage(lib):
        backup_asset_index(path)
        atomic_write_json(path, lib, ensure_ascii=False, indent=2)
    return lib

def save_asset_library(lib):
    lib = normalize_asset_library(lib)
    from core.unified_asset_storage import canonicalize_items
    canonicalize_items(lib, ASSET_LIBRARY_DIR, output_file_from_url, account_dirname())
    sort_asset_library_items(lib)
    lib["updated_at"] = now_ms()
    path = asset_library_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    atomic_write_json(path, lib, ensure_ascii=False, indent=2)

def asset_library_media_kind(path: str, content_type: str = "") -> str:
    ext = os.path.splitext(path or "")[1].lower()
    ct = (content_type or "").lower()
    if ext in {".json", ".zip"}:
        return "workflow"
    if ext in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"} or ct.startswith("video/"):
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"} or ct.startswith("audio/"):
        return "audio"
    return "image"

def asset_library_safe_extension(path: str, kind: str) -> str:
    ext = os.path.splitext(path or "")[1].lower()
    allowed = {
        "image": {".png", ".jpg", ".jpeg", ".webp", ".gif"},
        "video": {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"},
        "audio": {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"},
        "workflow": {".json", ".zip"},
    }
    fallback = {"image": ".png", "video": ".mp4", "audio": ".mp3", "workflow": ".zip"}
    return ext if ext in allowed.get(kind, allowed["image"]) else fallback.get(kind, ".png")

def unique_asset_category_dir(library, base_name: str) -> str:
    base = sanitize_asset_name(base_name, "分组").strip(" .") or "分组"
    existing = {
        str(c.get("dir")) for c in (library.get("categories") or [])
        if isinstance(c, dict) and c.get("dir")
    }
    candidate = base
    i = 2
    while candidate in existing or os.path.exists(os.path.join(ASSET_LIBRARY_DIR, candidate)):
        candidate = f"{base}_{i}"
        i += 1
    return candidate

def remove_asset_library_file(item) -> None:
    try:
        url = item.get("url") if isinstance(item, dict) else ""
        path = output_file_from_url(url)
        if path and os.path.isfile(path):
            os.remove(path)
    except Exception as exc:
        print(f"删除资产文件失败: {exc}")

def make_asset_library_item(src: str, name: str = "", subdir: str = "") -> Tuple[str, Dict[str, Any]]:
    kind = asset_library_media_kind(src)
    ext = asset_library_safe_extension(src, kind)
    safe_name = sanitize_asset_name(name or os.path.basename(src), "asset")
    if not os.path.splitext(safe_name)[1]:
        safe_name += ext
    dest_name = f"lib_{uuid.uuid4().hex[:12]}_{safe_name}"
    subdir = str(subdir or "").strip("/").strip()
    if subdir:
        dest_dir = os.path.join(ASSET_LIBRARY_DIR, subdir)
        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, dest_name)
        rel = f"{subdir}/{dest_name}"
    else:
        dest_path = os.path.join(ASSET_LIBRARY_DIR, dest_name)
        rel = dest_name
    shutil.copy2(src, dest_path)
    item = {
        "id": f"asset_{uuid.uuid4().hex[:12]}",
        "name": os.path.splitext(safe_name)[0][:120],
        "url": "/assets/library/" + urllib.parse.quote(rel, safe="/"),
        "kind": kind,
        "created_at": now_ms(),
    }
    return dest_name, item

def make_workflow_library_item_from_bytes(raw: bytes, filename: str, name: str = "") -> Dict[str, Any]:
    ext = os.path.splitext(filename or "")[1].lower()
    display_name = sanitize_asset_name(name or os.path.splitext(filename)[0], "workflow")
    dest_name = f"wf_{uuid.uuid4().hex[:8]}_{display_name}{ext or '.zip'}"
    dest_path = os.path.join(ASSET_LIBRARY_DIR, dest_name)
    os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(raw)
    return {
        "id": f"wf_{uuid.uuid4().hex[:12]}",
        "name": display_name[:120],
        "url": f"/assets/library/{dest_name}",
        "kind": "workflow",
        "type": "workflow",
        "format": "zip" if ext == ".zip" else "json",
        "size": len(raw),
        "created_at": now_ms(),
    }

# --- 媒体预览辅助函数 ---

def image_has_alpha(img: Image.Image) -> bool:
    if img.mode in ("RGBA", "LA"):
        return True
    if img.mode == "P":
        return "transparency" in img.info
    return False

def media_preview_cache_paths(path: str, width: int):
    stat = os.stat(path)
    key = hashlib.sha1(
        f"{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")
    ).hexdigest()
    return (
        os.path.join(MEDIA_PREVIEW_DIR, f"{key}.webp"),
        os.path.join(MEDIA_PREVIEW_DIR, f"{key}.png"),
    )

_PREVIEW_LOCKS = tuple(threading.Lock() for _ in range(32))


def _prewarm_thumbnails(local_path: str, widths=(768, 600)):
    """后台预热与首次预览请求共用锁、缓存和原图解码；缓存文件原子发布。"""
    try:
        from PIL import Image, ImageOps
        if not local_path or not os.path.isfile(local_path):
            return
        ext = os.path.splitext(local_path)[1].lower()
        if ext in ('.mp4', '.webm', '.mov', '.mkv', '.avi'):
            return
        os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
        with _PREVIEW_LOCKS[hash(os.path.abspath(local_path)) % len(_PREVIEW_LOCKS)]:
            missing = []
            for width in dict.fromkeys(widths):
                webp_path, png_path = media_preview_cache_paths(local_path, width)
                if not os.path.exists(webp_path) and not os.path.exists(png_path):
                    missing.append((width, webp_path))
            if not missing:
                return
            with Image.open(local_path) as source:
                src = source
                src = ImageOps.exif_transpose(src)
                has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
                for w_target, webp_path in missing:
                    out = src.copy()
                    out.thumbnail((w_target, w_target), Image.BILINEAR)
                    out = out.convert("RGBA" if has_alpha else "RGB")
                    temporary = webp_path + '.' + uuid.uuid4().hex + '.tmp'
                    try:
                        try:
                            out.save(temporary, format="WEBP", quality=88, method=2)
                            target = webp_path
                        except Exception:
                            out.save(temporary, format="PNG")
                            target = os.path.splitext(webp_path)[0] + '.png'
                        os.replace(temporary, target)
                    finally:
                        if os.path.exists(temporary):
                            os.remove(temporary)
    except Exception as e:
        print(f"[prewarm-thumb] failed {os.path.basename(local_path or '')}: {e}")


def _etag_for(path: str, stat=None) -> str:
    """基于文件路径+mtime+size 生成弱 ETag"""
    if stat is None:
        stat = os.stat(path)
    return hashlib.md5(f"{path}|{stat.st_mtime_ns}|{stat.st_size}".encode()).hexdigest()

def is_video_preview_file(path: str) -> bool:
    return os.path.splitext(str(path or "").split("?", 1)[0])[1].lower() in {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}

def generate_video_preview_image(path: str, width: int) -> Image.Image:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg,无法生成视频预览图")
    fd, frame_path = tempfile.mkstemp(prefix="media_preview_frame_", suffix=".jpg")
    os.close(fd)
    try:
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", "0.5",
            "-i", path,
            "-frames:v", "1",
            "-vf", f"scale='min({width},iw)':-2",
            frame_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0 or not os.path.exists(frame_path) or os.path.getsize(frame_path) <= 0:
            raise RuntimeError((proc.stderr or "ffmpeg 未能抽取视频首帧").strip()[:300])
        with Image.open(frame_path) as frame:
            img = ImageOps.exif_transpose(frame).copy()
            img.thumbnail((width, width), Image.BILINEAR)
            return img.convert("RGB")
    finally:
        try:
            os.remove(frame_path)
        except OSError:
            pass

# --- 路径转换辅助函数 ---

def output_path_for(filename, category="output"):
    if category == "input":
        return os.path.join(INPUT_DIR, filename)
    return os.path.join(OUTPUT_DIR, filename)

def output_url_for(filename, category="output"):
    if category == "input":
        return f"/assets/{filename}"
    return f"/output/{filename}"

# --- MiniMax 时间轴导出 ---
class MiniMaxTimelineClip(BaseModel):
    url: str = ""
    name: str = ""
    start: float = 0
    end: float = 0
    duration: float = 0

class MiniMaxTimelineExportRequest(BaseModel):
    clips: List[MiniMaxTimelineClip] = []
    filename: str = "minimax-timeline.mp4"

@app.post("/api/smart-canvas/minimax-export")
async def export_minimax_timeline(payload: MiniMaxTimelineExportRequest):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="未找到 ffmpeg，无法导出完整剪辑")
    clips = [clip for clip in (payload.clips or []) if clip.url]
    if not clips:
        raise HTTPException(status_code=400, detail="时间轴里还没有可导出的视频")
    tmpdir = tempfile.mkdtemp(prefix="minimax_timeline_")
    try:
        clip_sources = []
        for clip in clips:
            src = output_file_from_url(clip.url)
            if not src:
                raise HTTPException(status_code=400, detail="完整剪辑导出只支持本地生成素材")
            clip_sources.append(src)
        ffprobe = shutil.which("ffprobe")
        preserve_audio = bool(ffprobe)
        if ffprobe:
            for src in clip_sources:
                probe_cmd = [
                    ffprobe, "-v", "error", "-select_streams", "a:0",
                    "-show_entries", "stream=index", "-of", "csv=p=0", src,
                ]
                probe = await asyncio.to_thread(subprocess.run, probe_cmd, capture_output=True, text=True, timeout=30)
                if probe.returncode != 0 or not (probe.stdout or "").strip():
                    preserve_audio = False
                    break
        part_paths = []
        normalize_video = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
        for index, (clip, src) in enumerate(zip(clips, clip_sources)):
            start = max(0.0, float(clip.start or 0))
            end = float(clip.end or 0)
            source_duration = max(0.0, float(clip.duration or 0))
            if end <= start:
                end = source_duration if source_duration > start else start + 0.1
            trim_duration = max(0.1, end - start)
            part_path = os.path.join(tmpdir, f"part_{index:03d}.mp4")
            if preserve_audio:
                cmd = [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", f"{start:.3f}", "-t", f"{trim_duration:.3f}", "-i", src,
                    "-map", "0:v:0", "-map", "0:a:0", "-vf", normalize_video,
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-ar", "48000", "-ac", "2",
                    "-movflags", "+faststart", part_path,
                ]
            else:
                cmd = [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", f"{start:.3f}", "-t", f"{trim_duration:.3f}", "-i", src,
                    "-f", "lavfi", "-t", f"{trim_duration:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                    "-map", "0:v:0", "-map", "1:a:0", "-vf", normalize_video, "-shortest",
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-ar", "48000", "-ac", "2",
                    "-movflags", "+faststart", part_path,
                ]
            proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=300)
            if proc.returncode != 0:
                raise HTTPException(status_code=500, detail=(proc.stderr or "视频裁剪失败").strip()[:300])
            part_paths.append(part_path)
        filename = sanitize_export_filename(payload.filename or "minimax-timeline.mp4", "minimax-timeline.mp4")
        if not filename.lower().endswith(".mp4"):
            filename += ".mp4"
        output_path = output_path_for(filename, "output")
        if len(part_paths) == 1:
            shutil.copyfile(part_paths[0], output_path)
        else:
            concat_path = os.path.join(tmpdir, "concat.txt")
            with open(concat_path, "w", encoding="utf-8") as fh:
                for part in part_paths:
                    safe_part = part.replace("\\", "/").replace("'", "'\\''")
                    fh.write(f"file '{safe_part}'\n")
            cmd = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", concat_path,
                "-c", "copy", "-movflags", "+faststart", output_path,
            ]
            proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=300)
            if proc.returncode != 0:
                raise HTTPException(status_code=500, detail=(proc.stderr or "视频拼接失败").strip()[:300])
        return {"url": output_url_for(filename, "output"), "name": filename, "kind": "video"}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

# --- RunningHub 辅助函数 ---

def runninghub_wallet_key_env():
    return "RUNNINGHUB_WALLET_API_KEY"

def runninghub_wallet_key_value() -> str:
    env_key = runninghub_wallet_key_env()
    return os.getenv(env_key, "") or read_api_env_value(env_key)

def strip_auth_scheme(value, scheme="Bearer"):
    text = str(value or "").strip()
    if not text:
        return ""
    pattern = rf"^{re.escape(scheme)}\s+"
    return re.sub(pattern, "", text, flags=re.I).strip()

def sanitize_api_key(value: str) -> str:
    """Remove non-ASCII characters from API key to prevent latin-1 encoding errors in HTTP headers."""
    return value.encode('ascii', 'ignore').decode('ascii').strip()

def bearer_auth_value(value):
    token = strip_auth_scheme(value, "Bearer")
    token = sanitize_api_key(token)
    return f"Bearer {token}" if token else ""

def runninghub_api_headers(provider):
    api_key = str((provider or {}).get("api_key") or "").strip() or runninghub_api_key(provider)
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key,请在 API 设置中填写。")
    return {"Authorization": bearer_auth_value(api_key), "Accept": "application/json", "Content-Type": "application/json"}

def runninghub_provider():
    return get_api_provider_exact("runninghub")

def runninghub_api_key(provider=None, use_wallet=False, prefer_wallet=False):
    provider = provider or runninghub_provider()
    free_key = str((provider or {}).get("api_key") or "").strip() or os.getenv(provider_key_env(provider["id"]), "")
    wallet_key = str((provider or {}).get("wallet_api_key") or "").strip() or os.getenv(runninghub_wallet_key_env(), "")
    api_key = wallet_key if (use_wallet or prefer_wallet) and wallet_key else free_key
    if not api_key:
        raise HTTPException(status_code=400, detail="未配置 RunningHub API Key,请在 RH 设置中填写。")
    return api_key

def runninghub_app_headers(json_body=True, use_wallet=False):
    headers = {"Host": "www.runninghub.cn"}
    provider = runninghub_provider()
    if provider:
        free_key = os.getenv(provider_key_env(provider["id"]), "")
        wallet_key = os.getenv(runninghub_wallet_key_env(), "")
        api_key = wallet_key if use_wallet and wallet_key else free_key
        if api_key:
            headers["Authorization"] = bearer_auth_value(api_key)
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers

def runninghub_endpoint_url(provider, path):
    base_url = str((provider or {}).get("base_url") or "https://www.runninghub.cn").strip().rstrip("/")
    return f"{base_url}{path}"

def runninghub_local_asset_path(url):
    text = str(url or "").strip()
    if not text:
        return None
    if text.startswith("/assets/input/") or text.startswith("/input/"):
        clean = urllib.parse.unquote(text.split("?", 1)[0]).replace("\\", "/")
        rel = clean[len("/assets/input/"):] if clean.startswith("/assets/input/") else clean[len("/input/"):]
        root = OUTPUT_INPUT_DIR
    elif text.startswith("/assets/output/"):
        clean = urllib.parse.unquote(text.split("?", 1)[0]).replace("\\", "/")
        rel = clean[len("/assets/output/"):]
        root = OUTPUT_OUTPUT_DIR
    elif text.startswith("/output/") or text.startswith("/assets/"):
        return output_file_from_url(text)
    else:
        return None
    rel = rel.lstrip("/")
    if not rel:
        return None
    path = os.path.abspath(os.path.join(root, rel))
    root_abs = os.path.abspath(root)
    if os.path.commonpath([root_abs, path]) != root_abs or not os.path.exists(path):
        return None
    return path

def runninghub_output_ext(remote, content_type=""):
    tail = str(remote or "").split("?", 1)[0].split("#", 1)[0]
    ext = os.path.splitext(tail)[1].lower().strip(".")
    allowed = {"png","jpg","jpeg","webp","gif","bmp","mp4","webm","mov","m4v","mkv","mp3","wav","ogg","m4a","flac","aac"}
    if ext in allowed:
        return ext
    ct = str(content_type or "").lower()
    if "mp4" in ct:
        return "mp4"
    if "webm" in ct:
        return "webm"
    if "quicktime" in ct:
        return "mov"
    if "mpeg" in ct:
        return "mp3"
    if "wav" in ct:
        return "wav"
    if "ogg" in ct:
        return "ogg"
    if "webp" in ct:
        return "webp"
    if "jpeg" in ct:
        return "jpg"
    return "png"

def runninghub_extract_outputs(data):
    arr = []
    if isinstance(data, list):
        arr = data
    elif isinstance(data, dict):
        for key in ("outputs", "results", "files", "data"):
            value = data.get(key)
            if isinstance(value, list):
                arr = value
                break
        if not arr and (data.get("fileUrl") or data.get("url")):
            arr = [data]
    outputs = []
    for item in arr:
        if isinstance(item, str):
            outputs.append(item)
        elif isinstance(item, dict):
            url = item.get("fileUrl") or item.get("file_url") or item.get("url") or item.get("downloadUrl") or item.get("download_url")
            if isinstance(url, list):
                outputs.extend([str(u) for u in url if u])
            elif url:
                outputs.append(str(url))
    return outputs

async def runninghub_store_remote_output(client, remote):
    if not str(remote or "").startswith(("http://", "https://")):
        return remote
    response = await client.get(remote, follow_redirects=True)
    if not response.is_success:
        return remote
    ext = runninghub_output_ext(remote, response.headers.get("content-type", ""))
    filename = f"rh_{uuid.uuid4().hex[:12]}.{ext}"
    path = output_path_for(filename, "output")
    with open(path, "wb") as f:
        f.write(response.content)
    return output_url_for(filename, "output")

def runninghub_fail_reason(raw):
    data = raw.get("data") if isinstance(raw, dict) else None
    values = []
    if isinstance(data, dict):
        values.extend([data.get("failedReason"), data.get("failReason"), data.get("message"), data.get("error")])
    if isinstance(raw, dict):
        values.extend([raw.get("msg"), raw.get("message"), raw.get("error")])
    for value in values:
        if not value:
            continue
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            return value.get("exception_message") or value.get("message") or json.dumps(value, ensure_ascii=False)
        return str(value)
    return ""

def runninghub_infer_workflow_field_type(field_name, field_value):
    key = f"{field_name or ''} {field_value or ''}".lower()
    if re.search(r"\b(image|img|mask|photo|picture)\b", key) or re.search(r"\.(png|jpe?g|webp|gif|bmp)(\?|$)", key, re.I):
        return "IMAGE"
    if re.search(r"\b(video|movie|mp4)\b", key) or re.search(r"\.(mp4|webm|mov|m4v|mkv)(\?|$)", key, re.I):
        return "VIDEO"
    if re.search(r"\b(audio|sound|music|voice)\b", key) or re.search(r"\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)", key, re.I):
        return "AUDIO"
    text = str(field_value or "").strip()
    if text.lower() in {"true", "false"}:
        return "BOOLEAN"
    try:
        if text:
            float(text)
            return "NUMBER"
    except Exception:
        pass
    return "TEXT"

def runninghub_is_workflow_link_value(value):
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )

def runninghub_workflow_node_info_list(workflow_json):
    result = []
    if not isinstance(workflow_json, dict):
        return result
    for node_id, node_content in workflow_json.items():
        inputs = node_content.get("inputs") if isinstance(node_content, dict) else None
        if not isinstance(inputs, dict):
            continue
        for field_name, raw_value in inputs.items():
            if runninghub_is_workflow_link_value(raw_value):
                continue
            if isinstance(raw_value, (dict, list)):
                field_value = json.dumps(raw_value, ensure_ascii=False)
            elif raw_value is None:
                field_value = ""
            else:
                field_value = str(raw_value)
            result.append({
                "nodeId": str(node_id),
                "fieldName": str(field_name),
                "fieldValue": field_value,
                "fieldType": runninghub_infer_workflow_field_type(field_name, field_value),
                "source": "workflow",
            })
    return result

def rh_is_seed_like_name(*parts) -> bool:
    text = " ".join(str(part or "") for part in parts).lower()
    return any(key in text for key in ("seed", "noise", "随机", "种子", "噪"))

def normalize_seed_uint32(value):
    try:
        if isinstance(value, bool):
            return value
        raw = str(value).strip()
        if not raw:
            return value
        num = int(float(raw))
    except Exception:
        return value
    if 0 <= num <= SEED_UINT32_MAX:
        return value
    safe = ((abs(num) - 1) % SEED_UINT32_MAX) + 1
    return str(safe) if isinstance(value, str) else safe

def sanitize_seed_like_workflow_values(value, parent_key=""):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if rh_is_seed_like_name(key) and not isinstance(item, (dict, list)):
                result[key] = normalize_seed_uint32(item)
            else:
                result[key] = sanitize_seed_like_workflow_values(item, key)
        return result
    if isinstance(value, list):
        return [sanitize_seed_like_workflow_values(item, parent_key) for item in value]
    if rh_is_seed_like_name(parent_key):
        return normalize_seed_uint32(value)
    return value

def sanitize_runninghub_node_info_list(items):
    result = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        clean = dict(item)
        if rh_is_seed_like_name(clean.get("fieldName"), clean.get("label"), clean.get("note")):
            clean["fieldValue"] = normalize_seed_uint32(clean.get("fieldValue"))
        result.append(clean)
    return result

def runninghub_workflow_store_key(workflow_id: str) -> str:
    return str(workflow_id or "").strip()

def runninghub_normalize_field(raw, fallback=None):
    fallback = fallback or {}
    if hasattr(raw, "dict"):
        raw = raw.dict()
    if not isinstance(raw, dict):
        raw = {}
    options = raw.get("options", fallback.get("options", []))
    if isinstance(options, str):
        options = [item.strip() for item in re.split(r"[\r\n,]+", options) if item.strip()]
    elif isinstance(options, list):
        options = [str(item).strip() for item in options if str(item).strip()]
    else:
        options = []
    field_id = str(raw.get("id") or raw.get("fieldId") or raw.get("key") or raw.get("nodeId") or fallback.get("id") or "").strip()
    node_id = str(raw.get("nodeId") or fallback.get("nodeId") or raw.get("node_id") or "").strip()
    field_name = str(raw.get("fieldName") or raw.get("inputName") or raw.get("name") or fallback.get("fieldName") or "").strip()
    field_value = raw.get("fieldValue")
    if field_value is None:
        field_value = raw.get("defaultValue")
    if field_value is None:
        field_value = raw.get("value")
    if field_value is None:
        field_value = fallback.get("fieldValue", "")
    if isinstance(field_value, (dict, list)):
        field_value = json.dumps(field_value, ensure_ascii=False)
    elif field_value is None:
        field_value = ""
    else:
        field_value = str(field_value)
    return {
        "id": field_id or f"{node_id}::{field_name}",
        "nodeId": node_id,
        "fieldName": field_name,
        "fieldValue": field_value,
        "fieldType": str(raw.get("fieldType") or fallback.get("fieldType") or "TEXT"),
        "label": str(raw.get("label") or raw.get("title") or field_name or fallback.get("label") or ""),
        "enabled": bool(raw.get("enabled", fallback.get("enabled", True))),
        "sourceFromUpstream": bool(raw.get("sourceFromUpstream", fallback.get("sourceFromUpstream", True))),
        "group": str(raw.get("group") or fallback.get("group") or ""),
        "note": str(raw.get("note") or fallback.get("note") or ""),
        "options": options,
        "random_enabled": bool(raw.get("random_enabled", fallback.get("random_enabled", False))),
        "min": raw.get("min", fallback.get("min", "")),
        "max": raw.get("max", fallback.get("max", "")),
        "step": raw.get("step", fallback.get("step", "")),
        "imageOrder": int(raw.get("imageOrder") or raw.get("image_order") or fallback.get("imageOrder") or 0),
        "required": bool(raw.get("required", fallback.get("required", False))),
    }

def runninghub_is_saved_link_field(field):
    if not isinstance(field, dict):
        return False
    value = field.get("fieldValue")
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not (text.startswith("[") and text.endswith("]")):
        return False
    try:
        parsed = json.loads(text)
    except Exception:
        return False
    return runninghub_is_workflow_link_value(parsed)

def runninghub_collect_workflow_fields(workflow_json):
    fields = []
    if not isinstance(workflow_json, dict):
        return fields
    for node_id, node_content in workflow_json.items():
        if not isinstance(node_content, dict):
            continue
        inputs = node_content.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for field_name, raw_value in inputs.items():
            if runninghub_is_workflow_link_value(raw_value):
                continue
            if isinstance(raw_value, (dict, list)):
                field_value = json.dumps(raw_value, ensure_ascii=False)
            elif raw_value is None:
                field_value = ""
            else:
                field_value = str(raw_value)
            field_type = runninghub_infer_workflow_field_type(field_name, field_value)
            fields.append({
                "id": f"{node_id}::{field_name}",
                "nodeId": str(node_id),
                "fieldName": str(field_name),
                "fieldValue": field_value,
                "fieldType": field_type,
                "label": str(field_name),
                "enabled": False,
                "sourceFromUpstream": True,
                "group": str(
                    (node_content.get("_meta") or {}).get("title")
                    or node_content.get("class_type")
                    or node_content.get("_class")
                    or node_content.get("type")
                    or ""
                ),
                "note": "",
                "imageOrder": 0,
                "required": field_type == "IMAGE",
            })
    return fields

# --- RunningHub 工作流持久化 ---

def load_runninghub_workflow_store():
    if not os.path.exists(RUNNINGHUB_WORKFLOW_STORE_FILE):
        return {}
    try:
        with open(RUNNINGHUB_WORKFLOW_STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def save_runninghub_workflow_store(store):
    os.makedirs(DATA_DIR, exist_ok=True)
    atomic_write_json(RUNNINGHUB_WORKFLOW_STORE_FILE, store, ensure_ascii=False, indent=2)

def runninghub_provider_workflow_config(workflow_id: str):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        return None
    providers = load_api_providers()
    provider = next((item for item in providers if item.get("id") == "runninghub"), None)
    if not provider:
        return None
    for entry in provider.get("rh_workflows") or []:
        entry_key = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
        if entry_key != key:
            continue
        cfg = {
            "workflowId": key,
            "title": entry.get("title") or key,
            "description": entry.get("note") or entry.get("description") or "",
            "fields": [
                field for field in (runninghub_normalize_field(item) for item in (entry.get("fields") or []))
                if not runninghub_is_saved_link_field(field)
            ],
            "workflowJson": entry.get("workflowJson") if isinstance(entry.get("workflowJson"), dict) else {},
            "optionalImageMode": entry.get("optionalImageMode") or "prune-workflow",
            "raw": entry.get("raw") if isinstance(entry.get("raw"), dict) else {},
            "updatedAt": entry.get("updatedAt") or 0,
            "source": "api_providers",
        }
        return cfg if bool(cfg.get("fields") or cfg.get("workflowJson") or cfg.get("raw")) else None
    return None

def runninghub_select_workflow_config(local_cfg, provider_cfg, workflow_id: str = ""):
    if isinstance(local_cfg, dict) and isinstance(provider_cfg, dict):
        try:
            local_updated = int(local_cfg.get("updatedAt") or 0)
        except Exception:
            local_updated = 0
        try:
            provider_updated = int(provider_cfg.get("updatedAt") or 0)
        except Exception:
            provider_updated = 0
        return provider_cfg if provider_updated > local_updated else local_cfg
    if isinstance(local_cfg, dict):
        return local_cfg
    if isinstance(provider_cfg, dict):
        return provider_cfg
    return None

def sync_runninghub_workflow_to_provider(cfg):
    if not isinstance(cfg, dict):
        return
    key = runninghub_workflow_store_key(cfg.get("workflowId"))
    if not key:
        return
    providers = load_api_providers()
    provider = next((item for item in providers if item.get("id") == "runninghub"), None)
    if not provider:
        provider = {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": "https://www.runninghub.cn",
            "protocol": "runninghub",
            "enabled": True,
            "primary": False,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
            "rh_apps": [],
            "rh_workflows": [],
        }
        providers.append(provider)
    workflows = provider.setdefault("rh_workflows", [])
    entry = None
    for item in workflows:
        item_key = runninghub_workflow_store_key(item.get("workflowId") or item.get("id"))
        if item_key == key:
            entry = item
            break
    if entry is None:
        entry = {
            "id": key,
            "workflowId": key,
            "title": cfg.get("title") or f"工作流 {key[-6:]}",
            "note": cfg.get("description") or "",
            "thumbnail": "",
            "enabled": True,
        }
        workflows.append(entry)
    entry.update({
        "id": key,
        "workflowId": key,
        "title": cfg.get("title") or entry.get("title") or f"工作流 {key[-6:]}",
        "note": cfg.get("description") or "",
        "fields": [
            field for field in (runninghub_normalize_field(item) for item in (cfg.get("fields") or []))
            if not runninghub_is_saved_link_field(field)
        ],
        "workflowJson": cfg.get("workflowJson") if isinstance(cfg.get("workflowJson"), dict) else {},
        "optionalImageMode": cfg.get("optionalImageMode") or "prune-workflow",
        "raw": cfg.get("raw") if isinstance(cfg.get("raw"), dict) else {},
        "updatedAt": cfg.get("updatedAt") or now_ms(),
    })
    if "enabled" not in entry:
        entry["enabled"] = True
    if "thumbnail" not in entry:
        entry["thumbnail"] = ""
    save_api_providers([normalize_provider(item) for item in providers])

def remove_runninghub_workflow_from_provider(workflow_id: str):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        return
    providers = load_api_providers()
    changed = False
    for provider in providers:
        if provider.get("id") != "runninghub":
            continue
        workflows = provider.get("rh_workflows") or []
        kept = [
            item for item in workflows
            if runninghub_workflow_store_key(item.get("workflowId") or item.get("id")) != key
        ]
        if len(kept) != len(workflows):
            provider["rh_workflows"] = kept
            changed = True
    if changed:
        save_api_providers([normalize_provider(item) for item in providers])

# --- 云视频上传辅助函数 ---

def local_media_path_for_cloud_upload(ref_url: str, allowed_prefixes=("image/", "video/")) -> str:
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        raise HTTPException(status_code=400, detail="没有可上传的媒体文件")
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return ""
    if not (ref_url.startswith("/output/") or ref_url.startswith("/assets/")):
        raise HTTPException(status_code=400, detail="云端上传只支持画布里的本地图片或视频文件")
    path = output_file_from_url(ref_url)
    if not path:
        raise HTTPException(status_code=404, detail="本地媒体文件不存在或已被删除")
    ct = content_type_for_path(path)
    if not any(ct.startswith(prefix) for prefix in allowed_prefixes):
        raise HTTPException(status_code=400, detail="请选择图片或视频文件再上传云端")
    max_bytes = int(os.getenv("TEMP_SH_MAX_BYTES", str(4 * 1024 * 1024 * 1024)))
    size = os.path.getsize(path)
    if size > max_bytes:
        raise HTTPException(status_code=400, detail=f"媒体文件超过云端上传大小限制:{size} bytes")
    return path

async def upload_video_to_litterbox(path: str, source_url: str) -> Dict[str, str]:
    upload_url = os.getenv("LITTERBOX_UPLOAD_URL", "https://litterbox.catbox.moe/resources/internals/api.php").strip() or "https://litterbox.catbox.moe/resources/internals/api.php"
    time_value = os.getenv("LITTERBOX_TIME", "72h").strip() or "72h"
    ct = content_type_for_path(path)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0), follow_redirects=True) as client:
            with open(path, "rb") as fh:
                files = {"fileToUpload": (os.path.basename(path), fh, ct)}
                data = {"reqtype": "fileupload", "time": time_value}
                response = await client.post(upload_url, data=data, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=f"Litterbox 上传失败:{response.text[:300]}")
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail=f"Litterbox 返回了无法识别的链接:{response.text[:300]}")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": time_value, "service": "litterbox"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Litterbox 上传异常:{exc}") from exc

async def upload_video_to_temp_sh(path: str, source_url: str) -> Dict[str, str]:
    upload_url = os.getenv("TEMP_SH_UPLOAD_URL", "https://temp.sh/upload").strip() or "https://temp.sh/upload"
    ct = content_type_for_path(path)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=600.0, write=600.0, pool=20.0), follow_redirects=True) as client:
            with open(path, "rb") as fh:
                files = {"file": (os.path.basename(path), fh, ct)}
                response = await client.post(upload_url, files=files)
        if not response.is_success:
            raise HTTPException(status_code=response.status_code, detail=f"Temp.sh 上传失败:{response.text[:300]}")
        direct_url = response.text.strip().splitlines()[0].strip()
        if not re.match(r"^https?://", direct_url, re.I):
            raise HTTPException(status_code=502, detail=f"Temp.sh 返回了无法识别的链接:{response.text[:300]}")
        return {"url": direct_url, "source": source_url, "name": os.path.basename(path), "expires": "3 days", "service": "temp.sh"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Temp.sh 上传异常:{exc}") from exc

async def upload_local_video_to_cloud(ref_url: str, service: str = "auto") -> Dict[str, str]:
    ref_url = str(ref_url or "").strip()
    if ref_url.startswith("http://") or ref_url.startswith("https://"):
        return {"url": ref_url, "source": ref_url, "service": "existing"}
    path = local_media_path_for_cloud_upload(ref_url)
    service = str(service or os.getenv("CLOUD_VIDEO_UPLOAD_SERVICE", "auto") or "auto").strip().lower()
    if service in {"litterbox", "catbox"}:
        return await upload_video_to_litterbox(path, ref_url)
    if service in {"temp", "temp.sh", "tempsh"}:
        return await upload_video_to_temp_sh(path, ref_url)
    errors = []
    for name, func in (("litterbox", upload_video_to_litterbox), ("temp.sh", upload_video_to_temp_sh)):
        try:
            return await func(path, ref_url)
        except HTTPException as exc:
            errors.append(f"{name}: {exc.detail}")
    raise HTTPException(status_code=502, detail="云端上传失败:" + ";".join(errors))

# --- 本地图片导入辅助函数 ---

def normalize_local_image_path(value):
    text = str(value or "").strip().strip('"').strip("'")
    if not text:
        raise HTTPException(status_code=400, detail="本地图片路径为空")
    if text.lower().startswith("file:"):
        parsed = urllib.parse.urlparse(text)
        if parsed.scheme.lower() != "file":
            raise HTTPException(status_code=400, detail="只支持本地图片路径")
        if parsed.netloc and re.match(r"^[a-zA-Z]:$", parsed.netloc) and os.name == "nt":
            path = f"{parsed.netloc}{urllib.request.url2pathname(parsed.path or '')}"
        elif parsed.netloc and parsed.netloc.lower() not in ("localhost",):
            raise HTTPException(status_code=400, detail="只支持本机图片路径")
        else:
            path = urllib.request.url2pathname(parsed.path or "")
    else:
        path = text
    path = path.strip().strip('"').strip("'")
    if re.match(r"^/[a-zA-Z]:[\\/]", path):
        path = path[1:]
    if re.match(r"^[a-zA-Z]:[\\/]", path):
        return os.path.abspath(path)
    if path.startswith("/") and os.name != "nt":
        return os.path.abspath(path)
    raise HTTPException(status_code=400, detail="只支持本机绝对图片路径")

def import_local_image_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in LOCAL_IMAGE_IMPORT_EXTS:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPG、JPEG、WEBP、GIF 图片")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="本地图片不存在或无法读取")
    try:
        size = os.path.getsize(path)
    except OSError:
        raise HTTPException(status_code=404, detail="本地图片不存在或无法读取")
    if size <= 0:
        raise HTTPException(status_code=400, detail="本地图片为空")
    if size > LOCAL_IMAGE_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="本地图片过大,请使用 50MB 以内的图片")
    try:
        with Image.open(path) as img:
            img.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="文件不是可识别的图片")
    filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
    dest = output_path_for(filename, "input")
    try:
        shutil.copyfile(path, dest)
    except OSError:
        raise HTTPException(status_code=500, detail="导入本地图片失败")
    return {"url": output_url_for(filename, "input"), "name": os.path.basename(path) or filename, "kind": "image"}

def asset_library_workflow_category(lib, library_id="", category_id=""):
    lib = normalize_asset_library(lib)
    library_id = str(library_id or lib.get("active_library_id") or "").strip()
    libraries = lib.get("libraries", []) or []
    library = None
    if library_id:
        library = next((item for item in libraries if item.get("id") == library_id), None)
    if not library and libraries:
        library = libraries[0]
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    categories = library.setdefault("categories", [])
    cat = None
    if category_id:
        cat = next((c for c in categories if c.get("id") == category_id), None)
        if not cat:
            raise HTTPException(status_code=404, detail="工作流分类不存在")
        if cat.get("type") != "workflow":
            raise HTTPException(status_code=400, detail="目标分组不是工作流分类")
    if not cat:
        cat = next((c for c in categories if c.get("type") == "workflow"), None)
    if not cat:
        cat = {"id": f"wf_{uuid.uuid4().hex[:12]}", "name": "工作流", "type": "workflow", "items": []}
        categories.append(cat)
    lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
    return library, cat

def find_asset_category(lib, category_id):
    for cat in lib.get("categories", []):
        if cat.get("id") == category_id:
            return cat
    return None

def find_asset_library(lib, library_id=""):
    lib = normalize_asset_library(lib)
    library_id = str(library_id or lib.get("active_library_id") or "").strip()
    return next((item for item in lib.get("libraries", []) if item.get("id") == library_id), None) or (lib.get("libraries") or [None])[0]

def find_asset_category_in_library(lib, category_id, library_id=""):
    library = find_asset_library(lib, library_id)
    if not library:
        return None
    for cat in library.get("categories", []):
        if cat.get("id") == category_id:
            return cat
    return None

def find_asset_category_with_library(lib, category_id, library_id=""):
    lib = normalize_asset_library(lib)
    preferred = str(library_id or "").strip()
    libraries = lib.get("libraries", []) or []
    if preferred:
        libraries = [item for item in libraries if item.get("id") == preferred]
    for library in libraries:
        for cat in library.get("categories", []) or []:
            if cat.get("id") == category_id:
                return library, cat
    return None, None

def find_asset_item_in_library(lib, item_id, library_id=""):
    for library in lib.get("libraries", []):
        if library_id and library.get("id") != library_id:
            continue
        for cat in library.get("categories", []):
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    return item
    return None

def update_unified_local_reference(old, new=None):
    from core.unified_asset_storage import update_local_reference
    owner = private_data_owner()
    if not owner:
        return
    path = os.path.join(USER_DATA_DIR, 'accounts', safe_user_id(owner, None), 'asset_library.json')
    if not os.path.isfile(path):
        return
    with open(path, encoding='utf-8') as handle:
        lib = normalize_asset_library(json.load(handle))
    if update_local_reference(lib, old, new):
        atomic_write_json(path, lib, ensure_ascii=False, indent=2)


def write_asset_caption(item, caption):
    path = output_file_from_url(item.get('url') or '')
    if not path or not os.path.isfile(path) or item.get('kind') != 'image':
        raise HTTPException(status_code=400, detail='仅支持为已归档的图片保存提示词')
    caption = str(caption or '')[:100000]
    txt_path = os.path.splitext(path)[0] + '.txt'
    with open(txt_path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(caption)
    item['caption'] = caption
    item['caption_file'] = os.path.basename(txt_path)
    item['sidecar_mtime'] = os.path.getmtime(txt_path)


def backup_asset_index(path):
    if os.path.isfile(path) and not os.path.exists(path + '.before-unified-assets.bak'):
        shutil.copy2(path, path + '.before-unified-assets.bak')


def synchronize_asset_storage(lib, include_local=None):
    from core.unified_asset_storage import canonicalize_items, import_local_entries
    username = get_username_by_token('') or private_data_owner()
    namespace = safe_user_id(username, None) if username else ''
    changed = canonicalize_items(lib, ASSET_LIBRARY_DIR, output_file_from_url, namespace)
    if include_local is None:
        include_local = get_username_by_token('') == private_data_owner()
    if include_local:
        _, entries = _local_upload_tree_and_items()
        changed = import_local_entries(lib, entries) or changed
    return changed


def migrate_unified_asset_storage():
    from core.unified_asset_storage import migrate_upload_directory
    migrate_upload_directory(LEGACY_LOCAL_UPLOAD_DIR, LOCAL_UPLOAD_DIR)
    owner = private_data_owner()
    if not owner:
        return
    path = os.path.join(USER_DATA_DIR, 'accounts', safe_user_id(owner, None), 'asset_library.json')
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as handle:
            lib = normalize_asset_library(json.load(handle))
    else:
        lib = default_asset_library()
    if synchronize_asset_storage(lib, include_local=True):
        backup_asset_index(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        atomic_write_json(path, lib, ensure_ascii=False, indent=2)


def migrate_asset_library_into_dirs():
    owner = private_data_owner()
    if not owner:
        return
    path = os.path.join(USER_DATA_DIR, "accounts", safe_user_id(owner, None), "asset_library.json")
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lib = normalize_asset_library(json.load(handle))
    except Exception as exc:
        print(f"资产库分组整理:加载失败 {exc}")
        return
    changed = False
    for library in lib.get("libraries", []) or []:
        for cat in library.get("categories", []) or []:
            if cat.get("type") == "workflow":
                continue
            cat_dir = cat.get("dir") or ""
            if not cat_dir:
                cat_dir = unique_asset_category_dir(library, cat.get("name") or "分组")
                cat["dir"] = cat_dir
                changed = True
            cat_abs = os.path.join(ASSET_LIBRARY_DIR, cat_dir)
            os.makedirs(cat_abs, exist_ok=True)
    if changed:
        atomic_write_json(path, lib, ensure_ascii=False, indent=2)

def get_primary_provider_id(providers=None):
    for p in (providers or load_api_providers()):
        if p.get("primary") and p.get("enabled", True):
            return p["id"]
    for p in load_api_providers():
        if p.get("enabled", True):
            return p["id"]
    return "comfly"

def get_vision_provider_id():
    """为反推(多模态)选择一个真正可用的 chat provider,复用与「AI 提示词」相同的 API 配置。
    条件: enabled + 有 chat_models + 已配 API Key。优先 primary,其次首个可用,最后 comfly 兜底。
    这样能自动跳过像 uki 这种没有 chat_models 的平台,避免落到未配 key 的默认 comfly。"""
    providers = load_api_providers()
    usable = [
        p for p in providers
        if p.get("enabled", True) and p.get("chat_models") and get_provider_api_key(p["id"])
    ]
    for p in usable:
        if p.get("primary"):
            return p["id"]
    if usable:
        return usable[0]["id"]
    if AI_API_KEY:
        return "comfly"
    return get_primary_provider_id()

def has_usable_vision_provider():
    """是否存在可用于反推的多模态 chat provider(已配 key)。"""
    for p in load_api_providers():
        if p.get("enabled", True) and p.get("chat_models") and get_provider_api_key(p["id"]):
            return True
    return bool(AI_API_KEY)

# --- 资产分类辅助 ---

ASSET_CLASSIFICATION_PROMPT = """请识别这张图片,输出严格 JSON,不要 Markdown,不要解释。
目标是给素材库做非常全面的筛选分类。所有字段都用中文短标签数组,尽量具体但不要虚构。
JSON 结构:
{
  "summary": "一句话描述",
  "categories": {
    "environment": ["室内/室外/自然/城市/棚拍/商业空间等环境大类"],
    "scene": ["室内/室外/棚拍/街景/自然/商业空间等"],
    "space": ["卧室/餐厅/客厅/厨房/浴室/办公室/店铺/展厅/户外道路等"],
    "subject": ["人物/模特/产品/家具/建筑/食物/动物/车辆/植物等"],
    "model": ["无人/单人模特/多人模特/男性模特/女性模特/儿童模特/半身模特/全身模特/手部模特等"],
    "people": ["无人/单人/多人/男性/女性/儿童/半身/全身/手部特写等"],
    "style": ["写实/摄影/插画/3D/极简/奢华/复古/现代/电商/电影感等"],
    "lighting": ["自然光/硬光/柔光/逆光/侧光/夜景/暖光/冷光/高对比/低对比等"],
    "color": ["白色/黑色/暖色/冷色/高饱和/低饱和/莫兰迪/金属色等"],
    "composition": ["近景/中景/远景/俯拍/仰拍/正面/侧面/居中/留白/对称/特写等"],
    "mood": ["温馨/高级/清爽/科技/自然/浪漫/神秘/活力/安静等"],
    "use_case": ["广告/电商主图/海报/社媒/样机/参考图/背景/角色参考/空间参考等"],
    "objects": ["画面中重要物体"],
    "materials": ["木材/金属/玻璃/布料/皮革/石材/陶瓷等"],
    "quality": ["高清/模糊/低清/噪点/水印/截图/透明背景等"]
  },
  "tags": ["综合关键词,20个以内"]
}
要求:只返回可解析 JSON;每个数组最多 8 项;如果不确定就省略该标签。"""

ASSET_CLASSIFICATION_DIMENSION_NAMES = {
    "environment": "环境", "scene": "场景", "space": "空间",
    "subject": "主体", "model": "模特", "people": "人物",
    "style": "风格", "lighting": "光影", "color": "色彩",
    "composition": "构图", "mood": "氛围", "use_case": "用途",
    "objects": "物体", "materials": "材质", "quality": "质量",
}

def _local_upload_classification_path(filename):
    return os.path.splitext(os.path.join(LOCAL_UPLOAD_DIR, filename))[0] + ".classification.json"

def _safe_asset_tag(value, limit=24):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    text = re.sub(r"^[##]+", "", text).strip(" ,,、;;|/")
    return text[:limit]

def normalize_asset_classification(raw):
    if not isinstance(raw, dict):
        raw = {}
    categories = raw.get("categories") if isinstance(raw.get("categories"), dict) else {}
    clean_categories = {}
    flat = []
    for key, values in categories.items():
        norm_key = re.sub(r"[^A-Za-z0-9_-]+", "_", str(key or "").strip().lower())[:40]
        if not norm_key:
            continue
        if isinstance(values, str):
            values = re.split(r"[,,、/|;;\n]+", values)
        if not isinstance(values, list):
            continue
        clean_values = []
        seen = set()
        for value in values:
            tag = _safe_asset_tag(value)
            if not tag or tag in seen:
                continue
            seen.add(tag)
            clean_values.append(tag)
            flat.append({"dimension": norm_key, "label": ASSET_CLASSIFICATION_DIMENSION_NAMES.get(norm_key, norm_key), "tag": tag})
            if len(clean_values) >= 8:
                break
        if clean_values:
            clean_categories[norm_key] = clean_values
    tags = raw.get("tags") if isinstance(raw.get("tags"), list) else []
    clean_tags = []
    seen_tags = set()
    for value in tags:
        tag = _safe_asset_tag(value)
        if not tag or tag in seen_tags:
            continue
        seen_tags.add(tag)
        clean_tags.append(tag)
        flat.append({"dimension": "tags", "label": "标签", "tag": tag})
        if len(clean_tags) >= 20:
            break
    seen_flat = set()
    flat_unique = []
    for item in flat:
        key = f"{item['dimension']}::{item['tag']}"
        if key in seen_flat:
            continue
        seen_flat.add(key)
        flat_unique.append(item)
    return {
        "summary": str(raw.get("summary") or "").strip()[:240],
        "categories": clean_categories,
        "tags": clean_tags,
        "flat": flat_unique,
        "updated_at": now_ms(),
    }

def parse_asset_classification_text(text):
    value = str(text or "").strip()
    if not value:
        return normalize_asset_classification({})
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE).strip()
    value = re.sub(r"\s*```$", "", value).strip()
    try:
        data = json.loads(value)
    except Exception:
        match = re.search(r"\{.*\}", value, re.S)
        data = json.loads(match.group(0)) if match else {}
    return normalize_asset_classification(data)

def _read_local_upload_classification(filename):
    path = _local_upload_classification_path(filename)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return normalize_asset_classification(json.load(f))
    except Exception:
        return None

def _write_local_upload_classification(filename, classification):
    path = _local_upload_classification_path(filename)
    atomic_write_json(path, normalize_asset_classification(classification), ensure_ascii=False, indent=2)

def asset_classification_prompt(extra_prompt=""):
    extra = str(extra_prompt or "").strip()
    if not extra:
        return ASSET_CLASSIFICATION_PROMPT
    return ASSET_CLASSIFICATION_PROMPT + "\n\n用户补充分类要求:\n" + extra[:4000]

async def classify_image_with_provider(abs_path, provider_id="", model="", ms_model="", prompt=""):
    text, resolved_model = await caption_image_with_provider(
        abs_path,
        asset_classification_prompt(prompt),
        provider_id or get_primary_provider_id(),
        model,
        ms_model,
    )
    classification = parse_asset_classification_text(text)
    classification["model"] = resolved_model
    classification["provider"] = provider_id or get_primary_provider_id()
    return classification

async def classify_asset_image_best_effort(abs_path, provider_id="", model="", ms_model="", prompt=""):
    try:
        return await classify_image_with_provider(abs_path, provider_id, model, ms_model, prompt)
    except Exception as exc:
        print(f"素材智能分类失败: {exc}")
        return None

async def caption_image_with_provider(abs_path, prompt, provider_id, model, ms_model=""):
    chat_base, chat_hdrs, resolved_model = resolve_chat_provider(provider_id, model, ms_model)
    prompt_text = (prompt or "描述图片").strip() or "描述图片"
    data_url = image_path_to_data_url(abs_path, max_size=1024)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt_text},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }]
    raw = None
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json={"model": resolved_model, "messages": messages},
            )
            response.raise_for_status()
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误:{body[:200]}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败:{exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解析上游响应失败:{exc}") from exc
    text = text_from_chat_response(raw).strip() if isinstance(raw, dict) else ""
    return text or "接口返回了空回复。", resolved_model

def image_path_to_data_url(path, max_size=1024):
    if max_size:
        try:
            with Image.open(path) as img:
                img.load()
                if max(img.size) > max_size:
                    img.thumbnail((max_size, max_size), Image.BILINEAR)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                from io import BytesIO
                buf = BytesIO()
                fmt = "PNG" if img.mode == "RGBA" else "JPEG"
                img.save(buf, format=fmt, quality=88 if fmt == "JPEG" else None)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png" if fmt == "PNG" else "image/jpeg"
                return f"data:{mime};base64,{encoded}"
        except Exception as e:
            print(f"image_path_to_data_url resize failed: {e}")
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{content_type_for_path(path)};base64,{encoded}"

# --- 共享文件夹辅助 ---

SHARED_MEDIA_EXTS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
    ".mp4", ".webm", ".mov", ".m4v", ".mkv",
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
}
SHARED_SCAN_MAX_ENTRIES = 8000
SHARED_FOLDERS_LOCK = Lock()

def shared_folders_load():
    try:
        with open(SHARED_FOLDERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    folders = data.get("folders")
    if not isinstance(folders, list):
        folders = []
    return {"folders": [f for f in folders if isinstance(f, dict)]}

def shared_folders_save(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    atomic_write_json(SHARED_FOLDERS_FILE, data, ensure_ascii=False, indent=2)

def shared_folder_by_id(folder_id):
    for entry in shared_folders_load().get("folders", []):
        if entry.get("id") == folder_id:
            return entry
    return None

def shared_folder_abs(entry):
    rel = (entry or {}).get("rel") or ""
    return os.path.normpath(os.path.join(BASE_DIR, rel))

def shared_resolve_register(path):
    raw = (path or "").strip().strip('"').strip("'")
    if not raw:
        raise HTTPException(status_code=400, detail="请提供文件夹路径")
    candidate = raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)
    abs_path = os.path.normpath(os.path.abspath(candidate))
    base = os.path.normpath(os.path.abspath(BASE_DIR))
    try:
        common = os.path.commonpath([abs_path, base])
    except ValueError:
        raise HTTPException(status_code=400, detail="只允许登记项目目录内的文件夹")
    if common != base:
        raise HTTPException(status_code=400, detail="只允许登记项目目录内的文件夹")
    if abs_path == base:
        raise HTTPException(status_code=400, detail="不能直接登记项目根目录,请选择子文件夹")
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=400, detail="文件夹不存在")
    rel = os.path.relpath(abs_path, base)
    return abs_path, rel

def shared_child_abs(folder_abs, rel):
    rel = (rel or "").replace("\\", "/").lstrip("/")
    abs_path = os.path.normpath(os.path.join(folder_abs, rel))
    base = os.path.normpath(os.path.abspath(folder_abs))
    try:
        common = os.path.commonpath([os.path.abspath(abs_path), base])
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    if common != base:
        raise HTTPException(status_code=400, detail="非法路径")
    return abs_path

def scan_shared_tree(folder_id, folder_abs, rel_prefix="", display="", counter=None):
    if counter is None:
        counter = {"n": 0}
    node = {
        "id": f"{folder_id}:{rel_prefix or '__root__'}",
        "name": display or os.path.basename(folder_abs) or folder_abs,
        "path": rel_prefix,
        "items": [],
        "children": [],
    }
    try:
        entries = sorted(os.scandir(folder_abs), key=lambda e: (not e.is_dir(), e.name.lower()))
    except OSError:
        return node
    for ent in entries:
        if counter["n"] >= SHARED_SCAN_MAX_ENTRIES:
            break
        if ent.name.startswith(".") or ent.name.startswith("._"):
            continue
        child_rel = f"{rel_prefix}/{ent.name}".lstrip("/")
        if ent.is_dir():
            child = scan_shared_tree(folder_id, ent.path, child_rel, ent.name, counter)
            if child["items"] or child["children"]:
                node["children"].append(child)
        elif ent.is_file():
            ext = os.path.splitext(ent.name)[1].lower()
            if ext not in SHARED_MEDIA_EXTS:
                continue
            counter["n"] += 1
            try:
                st = ent.stat()
                size = st.st_size
                mtime = int(st.st_mtime * 1000)
            except OSError:
                size = 0
                mtime = 0
            node["items"].append({
                "id": f"{folder_id}:{child_rel}",
                "name": ent.name,
                "url": f"/api/shared-folders/{folder_id}/file?path={urllib.parse.quote(child_rel)}",
                "kind": asset_library_media_kind(ent.name),
                "size": size,
                "lastModified": mtime,
                "relativePath": child_rel,
                "folderId": folder_id,
            })
    return node

# --- 本地素材管理辅助 ---

def _local_upload_kind_ext(filename, content_type):
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    video_exts = {".mp4", ".webm", ".mov", ".m4v", ".flv"}
    audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
    ext = os.path.splitext(filename or "")[1].lower()
    ct = (content_type or "").lower()
    if ext in video_exts or ct.startswith("video/"):
        if ext not in video_exts:
            ext = ".webm" if "webm" in ct else ".mov" if "quicktime" in ct else ".mp4"
        return "video", ext
    if ext in audio_exts or ct.startswith("audio/"):
        if ext not in audio_exts:
            ext = ".wav" if "wav" in ct else ".ogg" if "ogg" in ct else ".m4a" if "mp4" in ct else ".mp3"
        return "audio", ext
    if ext in image_exts or ct.startswith("image/"):
        if ext not in image_exts:
            ext = ".jpg" if "jpeg" in ct else ".webp" if "webp" in ct else ".gif" if "gif" in ct else ".png"
        return "image", ext
    return None, ext

def _local_upload_display_name(filename):
    base = os.path.basename(str(filename or ""))
    m = re.match(r"^up_[0-9a-f]{12}_(.+)$", base)
    return m.group(1) if m else base

def _local_upload_rel_path(value):
    text = str(value or "").replace("\\", "/").strip().lstrip("/")
    if not text:
        return ""
    norm = os.path.normpath(text).replace("\\", "/")
    if norm in {".", ""}:
        return ""
    if norm.startswith("../") or norm == ".." or os.path.isabs(norm):
        raise HTTPException(status_code=400, detail="非法路径")
    return norm

def _local_upload_abs(rel):
    rel_path = _local_upload_rel_path(rel)
    path = os.path.abspath(os.path.join(LOCAL_UPLOAD_DIR, rel_path))
    root = os.path.abspath(LOCAL_UPLOAD_DIR)
    try:
        common = os.path.commonpath([root, path])
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")
    if common != root:
        raise HTTPException(status_code=400, detail="非法路径")
    return rel_path, path

def _local_upload_safe_path(name):
    filename, path = _local_upload_abs(name)
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    return filename, path

def _local_upload_safe_folder(path_value):
    rel, path = _local_upload_abs(path_value)
    return rel, path

def _local_upload_safe_folder_name(name):
    cleaned = sanitize_asset_name(os.path.basename(str(name or "").strip()), "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    return cleaned[:60]

def _local_upload_safe_file_stem(name):
    raw = os.path.splitext(os.path.basename(str(name or "").strip()))[0]
    cleaned = sanitize_asset_name(raw, "")
    cleaned = re.sub(r"[\\/]+", "_", cleaned).strip(" ._")
    if not cleaned:
        raise HTTPException(status_code=400, detail="文件名称不能为空")
    return cleaned[:120]

def _local_upload_caption_path(filename):
    return os.path.splitext(os.path.join(LOCAL_UPLOAD_DIR, filename))[0] + ".txt"

def _read_local_upload_caption(filename):
    caption_path = _local_upload_caption_path(filename)
    if not os.path.isfile(caption_path):
        return "", ""
    try:
        with open(caption_path, "r", encoding="utf-8-sig") as f:
            text = f.read()
    except UnicodeDecodeError:
        with open(caption_path, "r", encoding="gb18030", errors="replace") as f:
            text = f.read()
    except OSError:
        return "", ""
    return text, os.path.basename(caption_path)

def _local_upload_item(filename):
    path = os.path.join(LOCAL_UPLOAD_DIR, filename)
    rel = _local_upload_rel_path(filename)
    try:
        stat = os.stat(path)
        size = stat.st_size
        created_at = stat.st_mtime
    except OSError:
        size = 0
        created_at = 0
    kind, _ = _local_upload_kind_ext(filename, "")
    item = {
        "id": rel,
        "file": rel,
        "name": _local_upload_display_name(rel),
        "url": f"/assets/library/_local/{urllib.parse.quote(rel, safe='/')}",
        "kind": kind or "image",
        "size": size,
        "created_at": created_at,
        "folder": os.path.dirname(rel).replace("\\", "/"),
        "sidecar_mtime": max((os.path.getmtime(p) for p in (_local_upload_caption_path(rel), _local_upload_classification_path(rel)) if os.path.isfile(p)), default=0),
    }
    if kind == "image":
        try:
            with Image.open(path) as img:
                item["natural_w"], item["natural_h"] = img.size
                item["width"], item["height"] = img.size
        except Exception:
            pass
        caption, caption_file = _read_local_upload_caption(filename)
        item["caption"] = caption
        item["caption_file"] = caption_file
        classification = _read_local_upload_classification(filename)
        if classification:
            item["classification"] = classification
    return item

def _local_upload_folder_node(path="", name="全部上传"):
    rel = _local_upload_rel_path(path)
    return {
        "id": rel or "__root__",
        "path": rel,
        "name": name if not rel else os.path.basename(rel),
        "items": [],
        "children": [],
    }

def _local_upload_tree_and_items():
    root_node = _local_upload_folder_node("", "全部上传")
    folder_map = {"": root_node}
    items = []
    for current, dirs, files in os.walk(LOCAL_UPLOAD_DIR):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".") and not d.startswith("._")], key=str.lower)
        rel_dir = os.path.relpath(current, LOCAL_UPLOAD_DIR).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""
        node = folder_map.get(rel_dir)
        if node is None:
            node = _local_upload_folder_node(rel_dir)
            folder_map[rel_dir] = node
        for dirname in dirs:
            child_rel = f"{rel_dir}/{dirname}".lstrip("/")
            child = _local_upload_folder_node(child_rel)
            folder_map[child_rel] = child
            node["children"].append(child)
        for name in sorted(files, key=str.lower):
            if name.startswith(".") or name.startswith("._"):
                continue
            rel_file = f"{rel_dir}/{name}".lstrip("/")
            kind, _ = _local_upload_kind_ext(name, "")
            if kind is None:
                continue
            item = _local_upload_item(rel_file)
            node["items"].append(item)
            items.append(item)
    def fill_counts(node):
        total = len(node.get("items") or [])
        for child in node.get("children") or []:
            total += fill_counts(child)
        node["count"] = total
        return total
    fill_counts(root_node)
    items.sort(key=lambda it: it.get("created_at") or 0, reverse=True)
    return root_node, items

_DOUBLE_EXT_RE = re.compile(r'(\.[A-Za-z0-9]{1,5})\1$', re.IGNORECASE)
_DOUBLE_EXT_MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif",
                     ".mp4", ".webm", ".mov", ".m4v", ".flv"}

def migrate_double_extension_uploads():
    if not os.path.isdir(LOCAL_UPLOAD_DIR):
        return
    renamed = 0
    for current, _dirs, files in os.walk(LOCAL_UPLOAD_DIR):
        for name in files:
            m = _DOUBLE_EXT_RE.search(name)
            if not m or m.group(1).lower() not in _DOUBLE_EXT_MEDIA:
                continue
            old_path = os.path.join(current, name)
            new_path = os.path.join(current, name[:-len(m.group(1))])
            if os.path.exists(new_path):
                continue
            try:
                os.rename(old_path, new_path)
            except OSError:
                continue
            renamed += 1
            old_base = os.path.splitext(old_path)[0]
            new_base = os.path.splitext(new_path)[0]
            for suffix in (".classification.json", ".txt"):
                src_side, dst_side = old_base + suffix, new_base + suffix
                if os.path.exists(src_side) and not os.path.exists(dst_side):
                    try:
                        os.rename(src_side, dst_side)
                    except OSError:
                        pass
    if renamed:
        print(f"修复双重扩展名素材: {renamed} 个")

# --- 画布资产辅助 ---

def canvas_assets_index():
    canvases = []
    items = []
    canvas_counts = {"all": 0, "smart": 0, "classic": 0}
    item_counts = {"all": 0, "smart": 0, "classic": 0}
    cleanup_expired_canvas_trash()
    for filename in os.listdir(CANVAS_DIR):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(CANVAS_DIR, filename), "r", encoding="utf-8") as f:
                canvas = json.load(f)
        except Exception:
            continue
        if canvas.get("deleted_at"):
            continue
        record = canvas_record(canvas)
        canvas_items = extract_canvas_assets(canvas)
        record["asset_count"] = len(canvas_items)
        canvases.append(record)
        items.extend(canvas_items)
        kind = record.get("kind") or "classic"
        canvas_counts["all"] += 1
        canvas_counts[kind] = canvas_counts.get(kind, 0) + 1
        item_counts["all"] += len(canvas_items)
        item_counts[kind] = item_counts.get(kind, 0) + len(canvas_items)
    canvases.sort(key=lambda item: (0 if item.get("pinned") else 1, -int(item.get("updated_at") or item.get("created_at") or 0)))
    items.sort(key=lambda item: int(item.get("canvas_updated_at") or item.get("created_at") or 0), reverse=True)
    categories = [
        {"id": "all", "name": "全部画布", "count": item_counts.get("all", 0), "canvas_count": canvas_counts.get("all", 0)},
        {"id": "smart", "name": "智能画布", "count": item_counts.get("smart", 0), "canvas_count": canvas_counts.get("smart", 0)},
        {"id": "classic", "name": "普通画布", "count": item_counts.get("classic", 0), "canvas_count": canvas_counts.get("classic", 0)},
    ]
    return {"categories": categories, "canvases": canvases, "items": items}

def extract_canvas_assets(canvas):
    """从画布 JSON 中提取所有素材 URL(节点图片/视频/音频)"""
    items = []
    seen = set()
    MEDIA_INPUT_EXT_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(?:\?|$)", re.I)
    def _extract(value, canvas):
        if isinstance(value, dict):
            for k, v in value.items():
                _extract(v, canvas)
        elif isinstance(value, list):
            for v in value:
                _extract(v, canvas)
        elif isinstance(value, str):
            text = value.strip()
            if not text:
                return
            m = MEDIA_INPUT_EXT_RE.search(text)
            if not m:
                return
            clean = text.split("?", 1)[0]
            if clean in seen:
                return
            seen.add(clean)
            raw = {}
            kind = "image"
            ext = m.group(1).lower()
            if ext in ("mp4", "webm", "mov", "m4v", "avi", "mkv"):
                kind = "video"
            elif ext in ("mp3", "wav", "m4a", "aac", "ogg", "flac"):
                kind = "audio"
            if text.startswith("/"):
                raw["url"] = text
            items.append({
                "url": text,
                "kind": kind,
                "canvas_id": canvas.get("id"),
                "canvas_title": canvas.get("title"),
                "canvas_updated_at": canvas.get("updated_at") or 0,
                "created_at": canvas.get("created_at") or 0,
                **raw,
            })
    for node in (canvas.get("nodes") or []):
        if isinstance(node, dict):
            data = node.get("data") or node.get("inputs") or node
            _extract(data, canvas)
    return items

# --- 提示词库辅助 ---

def normalize_prompt_category_id(category="custom"):
    category_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(category or "custom"))[:40] or "custom"
    return "custom" if category_id in {"mine", "my", "personal"} else category_id

def normalize_prompt_library_item(item):
    if not isinstance(item, dict):
        item = {}
    name = sanitize_asset_name(item.get("name") or "提示词", "提示词")
    positive = str(item.get("positive") or item.get("text") or "").strip()
    return {
        "id": re.sub(r"[^A-Za-z0-9_-]+", "_", str(item.get("id") or item.get("item_id") or f"tpl_{uuid.uuid4().hex[:12]}"))[:60],
        "name": name,
        "category": normalize_prompt_category_id(item.get("category") or "custom"),
        "scene": str(item.get("scene") or "").strip()[:500],
        "positive": positive,
        "negative": str(item.get("negative") or "").strip(),
        "thumbnail": str(item.get("thumbnail") or item.get("thumb") or "").strip()[:600],
        "params": item.get("params") if isinstance(item.get("params"), dict) else {},
        "created_at": int(item.get("created_at") or now_ms()),
        "updated_at": int(item.get("updated_at") or item.get("created_at") or now_ms()),
    }

def seed_system_prompt_library():
    return {
        "id": "system",
        "name": "系统提示词库",
        "type": "prompt",
        "items": [],
        "categories": defaultPromptTemplateCategories(),
    }

def default_prompt_libraries():
    return {
        "active_library_id": "system",
        "libraries": [seed_system_prompt_library()],
        "updated_at": now_ms(),
    }

# 提示词库内置分类：按题材/风格划分（2026-10-28 从「视角/分镜/角色/产品/光影」的用途维度改为题材维度，
# 与 style-presets、采集来的平台提示词对齐）。个人词库会剔除这些 id，只能落在自己的自定义分类里。
PROMPT_LIBRARY_BUILTIN_CATEGORIES = [
    {"id": "portrait", "name": "人像摄影"},
    {"id": "anime", "name": "动漫二次元"},
    {"id": "design", "name": "平面设计"},
    {"id": "illustration", "name": "插画艺术"},
    {"id": "scene", "name": "场景建筑"},
    {"id": "sci3d", "name": "3D 科幻"},
    {"id": "template", "name": "版式模板"},
    {"id": "misc", "name": "其他"},
    {"id": "custom", "name": "我的"},
]

def defaultPromptTemplateCategories():
    return [dict(category) for category in PROMPT_LIBRARY_BUILTIN_CATEGORIES]

def normalize_prompt_template_categories(*category_lists, include_defaults=True):
    normalized = []
    seen = set()
    def add_category(category):
        if not isinstance(category, dict):
            return
        cat_id = normalize_prompt_category_id(category.get("id") or category.get("name") or "custom")
        if cat_id in seen:
            return
        seen.add(cat_id)
        name = sanitize_asset_name(category.get("name") or cat_id, cat_id)
        normalized.append({"id": cat_id, "name": name})
    for categories in category_lists:
        if isinstance(categories, list):
            for category in categories:
                add_category(category)
    if include_defaults and not normalized:
        for category in defaultPromptTemplateCategories():
            add_category(category)
    return normalized

def normalize_prompt_libraries(data):
    if not isinstance(data, dict):
        data = default_prompt_libraries()
    raw_libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    raw_libraries = [lib for lib in raw_libraries if isinstance(lib, dict)]
    if not any(lib.get("id") == "system" for lib in raw_libraries):
        raw_libraries = [seed_system_prompt_library()] + raw_libraries
    libraries = []
    seen_lib_ids = set()
    for raw in raw_libraries:
        is_system = raw.get("id") == "system"
        if is_system:
            lib_id = "system"
        else:
            lib_id = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw.get("id") or f"lib_{uuid.uuid4().hex[:12]}"))[:60] or f"lib_{uuid.uuid4().hex[:12]}"
        if lib_id in seen_lib_ids:
            continue
        seen_lib_ids.add(lib_id)
        items = []
        seen_items = set()
        for raw_item in (raw.get("items") if isinstance(raw.get("items"), list) else []):
            if not isinstance(raw_item, dict):
                continue
            item = normalize_prompt_library_item(raw_item)
            item_id = item.get("id") or f"tpl_{uuid.uuid4().hex[:12]}"
            if item_id in seen_items:
                continue
            seen_items.add(item_id)
            items.append(item)
        default_name = "系统提示词库" if is_system else "提示词库"
        raw_categories = raw.get("categories") if isinstance(raw.get("categories"), list) else []
        if not is_system:
            builtin_ids = {category["id"] for category in PROMPT_LIBRARY_BUILTIN_CATEGORIES}
            raw_categories = [c for c in raw_categories if isinstance(c, dict) and normalize_prompt_category_id(c.get("id") or c.get("name") or "") not in builtin_ids]
        libraries.append({
            "id": lib_id,
            "name": sanitize_asset_name(raw.get("name") or default_name, default_name),
            "type": "prompt",
            "readonly": False,
            "system": is_system,
            "categories": normalize_prompt_template_categories(raw_categories, include_defaults=is_system),
            "items": items,
        })
    active = str(data.get("active_library_id") or "system")
    if not any(lib["id"] == active for lib in libraries):
        active = "system" if any(lib["id"] == "system" for lib in libraries) else (libraries[0]["id"] if libraries else "system")
    return {"active_library_id": active, "libraries": libraries, "updated_at": int(data.get("updated_at") or now_ms())}

def _system_prompt_libraries():
    # 系统内容由 routers.prompt_libraries 从已安装风格包提供；旧快照不再加载。
    return default_prompt_libraries()


def _account_prompt_libraries():
    path = account_prompt_libraries_path()
    if not os.path.isfile(path):
        return [], "system"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return [], "system"
    if not isinstance(data, dict):
        return [], "system"
    libraries = [
        lib for lib in (data.get("libraries") or [])
        if isinstance(lib, dict) and lib.get("id") != "system" and lib.get("system") is not True
    ]
    return libraries, str(data.get("active_library_id") or "system")

def load_prompt_libraries():
    try:
        personal, active = _account_prompt_libraries()
    except HTTPException:
        personal, active = [], "system"
    system = _system_prompt_libraries()
    merged = {
        "active_library_id": active,
        "libraries": (system.get("libraries") or []) + personal,
        "updated_at": now_ms(),
    }
    return normalize_prompt_libraries(merged)

def save_prompt_libraries(data):
    data = normalize_prompt_libraries(data)
    data["updated_at"] = now_ms()
    system = [lib for lib in data.get("libraries") or [] if lib.get("id") == "system" or lib.get("system") is True]
    personal = [lib for lib in data.get("libraries") or [] if lib not in system]
    if not system:
        system = _system_prompt_libraries().get("libraries") or []
    os.makedirs(os.path.dirname(PROMPT_LIBRARY_PATH), exist_ok=True)
    atomic_write_json(PROMPT_LIBRARY_PATH, {
        "active_library_id": "system",
        "libraries": system,
        "updated_at": data["updated_at"],
    }, ensure_ascii=False, indent=2)
    user_path = account_prompt_libraries_path()
    os.makedirs(os.path.dirname(user_path), exist_ok=True)
    atomic_write_json(user_path, {
        "active_library_id": data.get("active_library_id") or "system",
        "libraries": personal,
        "updated_at": data["updated_at"],
    }, ensure_ascii=False, indent=2)
    return data

def public_prompt_libraries(data=None):
    data = normalize_prompt_libraries(data or load_prompt_libraries())
    return {
        "active_library_id": data.get("active_library_id") or (data.get("libraries") or [{}])[0].get("id") or "system",
        "libraries": data.get("libraries") or [],
        "updated_at": data.get("updated_at") or now_ms(),
    }

def find_prompt_library(data, library_id=""):
    if not isinstance(data, dict):
        return None
    libraries = data.get("libraries") if isinstance(data.get("libraries"), list) else []
    library_id = str(library_id or data.get("active_library_id") or "").strip()
    return next((item for item in libraries if item.get("id") == library_id), None) or (libraries[0] if libraries else None)

# --- 路由接口 ---

# --- 认证路由 ---

# ---

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# 内置平台默认模型（按 provider_id 区分）
MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
JIMENG_DEFAULT_IMAGE_MODELS = ["5.0Pro", "5.0", "4.7", "4.6", "4.5", "4.1", "4.0", "3.1", "3.0"]
JIMENG_DEFAULT_VIDEO_MODELS = ["VideoGen-720p", "VideoGen-1080p", "VideoGen-4K"]
CODEX_DEFAULT_IMAGE_MODELS = ["gpt-image-2"]
GEMINI_CLI_DEFAULT_IMAGE_MODELS = ["imagen-3", "imagen-3-2k", "Nano-Banana", "$imagegen"]
RUNNINGHUB_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]

def builtin_default_models(provider_id: str):
    """返回内置平台的默认 image_models（当 provider 自定义为空时使用）"""
    pid = (provider_id or "").lower()
    if pid == "modelscope":
        return list(MODELSCOPE_DEFAULT_IMAGE_MODELS), [], []
    if pid == "jimeng":
        return list(JIMENG_DEFAULT_IMAGE_MODELS), [], list(JIMENG_DEFAULT_VIDEO_MODELS)
    if pid == "codex":
        return list(CODEX_DEFAULT_IMAGE_MODELS), [], []
    if pid == "gemini-cli":
        return list(GEMINI_CLI_DEFAULT_IMAGE_MODELS), [], []
    if pid == "runninghub":
        return list(RUNNINGHUB_DEFAULT_IMAGE_MODELS), [], []
    return [], [], []


@app.post("/api/config/update")
async def update_config(payload: ConfigUpdateRequest):
    """接收前端配置更新,同步到后端内存并写入 .env 文件"""
    global AI_API_KEY, MODELSCOPE_API_KEY, AI_BASE_URL

    env_updates = {}

    if payload.comfly_api_key:
        AI_API_KEY = payload.comfly_api_key
        env_updates["COMFLY_API_KEY"] = payload.comfly_api_key

    if payload.modelscope_api_key:
        MODELSCOPE_API_KEY = payload.modelscope_api_key
        env_updates["MODELSCOPE_API_KEY"] = payload.modelscope_api_key

    if payload.comfly_base_url:
        AI_BASE_URL = payload.comfly_base_url.rstrip("/")
        env_updates["COMFLY_BASE_URL"] = payload.comfly_base_url.rstrip("/")

    if env_updates:
        save_env_file(env_updates)
        print(f"已更新 .env 配置: {', '.join(env_updates.keys())}")

    return {"status": "ok"}

# --- 在线生图 (Infinite-Canvas unified style) ---

PROTOCOL_RUNNINGHUB = "runninghub"
PROTOCOL_VOLCENGINE = "volcengine"


# --- 画布管理 ---

# --- 画布生成日志辅助函数（移植自 Infinite-Canvas，用于 logs/delete 端点） ---

def collect_local_media_urls(value: Any) -> List[str]:
    """Collect local /assets and /output URLs from nested canvas log payloads."""
    urls: List[str] = []
    if isinstance(value, str):
        text = value.strip()
        if text.startswith(("/assets/", "/output/", "/api/storage-files/")):
            urls.append(text)
    elif isinstance(value, dict):
        for item in value.values():
            urls.extend(collect_local_media_urls(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            urls.extend(collect_local_media_urls(item))
    return urls


def local_media_path_from_url(url: str) -> Optional[str]:
    """Resolve a local media URL using the same one-to-one mapping as app mounts."""
    if not url:
        return None
    clean = urllib.parse.unquote(str(url).split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/api/storage-files/"):
        rest = clean[len("/api/storage-files/"):].lstrip("/")
        kind, _, rel = rest.partition("/")
        # storage_file_path() 已随 P0 迁移移除（无对应实现），此处安全降级
        _ = (kind, rel)
        return None
    if clean.startswith("/assets/"):
        root = ASSETS_DIR
        rel = clean[len("/assets/"):]
    elif clean.startswith("/output/"):
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    else:
        return None
    rel = rel.lstrip("/")
    if not rel:
        return None
    root_abs = os.path.abspath(root)
    path = os.path.abspath(os.path.join(root_abs, rel))
    try:
        return path if os.path.commonpath([root_abs, path]) == root_abs and os.path.exists(path) else None
    except ValueError:
        return None


def generated_media_path_from_url(url: str) -> Optional[str]:
    """Resolve a URL only when it points inside a generated-output directory."""
    try:
        path = local_media_path_from_url(url)
    except (HTTPException, OSError, ValueError):
        return None
    if not path or not os.path.isfile(path):
        return None
    path = os.path.realpath(path)
    for root in (OUTPUT_OUTPUT_DIR, OUTPUT_DIR):
        root_abs = os.path.realpath(root)
        try:
            if os.path.commonpath([root_abs, path]) == root_abs:
                return path
        except ValueError:
            continue
    return None


def json_references_media_path(value: Any, target_path: str) -> bool:
    """Return True when a JSON-compatible value references the local media file."""
    target = os.path.normcase(os.path.realpath(target_path))
    if isinstance(value, str):
        try:
            resolved = local_media_path_from_url(value.strip())
        except (HTTPException, OSError, ValueError):
            return False
        return bool(resolved and os.path.normcase(os.path.realpath(resolved)) == target)
    if isinstance(value, dict):
        return any(json_references_media_path(item, target) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(json_references_media_path(item, target) for item in value)
    return False


def persisted_json_references_media_path(target_path: str) -> bool:
    """Scan persisted user documents before deleting generated media."""
    candidates = [ASSET_LIBRARY_PATH]
    for root in (CANVAS_DIR, CONVERSATION_DIR):
        if os.path.isdir(root):
            for current, _, files in os.walk(root):
                candidates.extend(os.path.join(current, name) for name in files if name.lower().endswith(".json"))
    seen: set = set()
    for path in candidates:
        path = os.path.abspath(path)
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        try:
            with open(path, "r", encoding="utf-8-sig") as handle:
                value = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError):
            return True
        if json_references_media_path(value, target_path):
            return True
    return False


def prune_generation_history_for_media(paths: List[str]) -> int:
    """Remove history cards that would otherwise point at deleted media."""
    if not paths or not os.path.isfile(HISTORY_FILE):
        return 0
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                history = json.load(handle)
            if not isinstance(history, list):
                return 0
            kept = [
                record for record in history
                if not any(json_references_media_path(record, path) for path in paths)
            ]
            removed = len(history) - len(kept)
            if removed:
                atomic_write_json(HISTORY_FILE, kept, ensure_ascii=False, indent=4)
            return removed
    except (OSError, UnicodeError, json.JSONDecodeError):
        return 0


def smart_owned_result_items(images: List[Any], paths: List[str]) -> List[Any]:
    """Return generated results, including legacy results without the marker."""
    return [
        item for item in images
        if isinstance(item, dict)
        and item.get("loopInputPreview") is not True
        and (
            item.get("generatedResult") is True
            or any(json_references_media_path(item, path) for path in paths)
        )
    ]


def expand_canvas_generated_media_paths(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    """Include every generated result owned by a result node touched by the log."""
    expanded = list(paths)
    for node in list(canvas.get("nodes") or []):
        node_type = str(node.get("type") or "").strip().lower()
        images = list(node.get("images") or [])
        if node_type == "output":
            owned_items = images
        elif node_type == "smart-image":
            owned_items = smart_owned_result_items(images, paths)
        else:
            owned_items = []
        if not any(json_references_media_path(item, path) for item in owned_items for path in paths):
            continue
        for item in owned_items:
            for url in collect_local_media_urls(item):
                candidate = generated_media_path_from_url(url)
                if candidate and candidate not in expanded:
                    expanded.append(candidate)
    return expanded


def reset_canvas_result_nodes_for_media(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    """Clear generated media while preserving prompts, references, settings and links."""
    reset_ids: List[str] = []
    updated_nodes: List[Dict[str, Any]] = []
    for node in list(canvas.get("nodes") or []):
        node = dict(node)
        node_type = str(node.get("type") or "").strip().lower()
        changed = False
        if isinstance(node.get("generatedOutputs"), list):
            outputs = list(node.get("generatedOutputs") or [])
            kept_outputs = [
                item for item in outputs
                if not any(json_references_media_path(item, path) for path in paths)
            ]
            if len(kept_outputs) != len(outputs):
                node["generatedOutputs"] = kept_outputs
                changed = True
        if node_type in {"smart-image", "output"} and isinstance(node.get("images"), list):
            images = list(node.get("images") or [])
            if node_type == "smart-image":
                owned_items = smart_owned_result_items(images, paths)
            else:
                owned_items = images
            owns_target = any(
                json_references_media_path(item, path) for item in owned_items for path in paths
            )
            kept_images = [
                item for item in images
                if not (
                    owns_target
                    and item in owned_items
                    and any(json_references_media_path(item, path) for path in paths)
                )
            ]
            if len(kept_images) != len(images):
                node["images"] = kept_images
                changed = True
                if node_type == "output":
                    node["_pending"] = []
                    node["imageComparisons"] = {}
                if node_type == "smart-image":
                    node["pending"] = 0
                    node["running"] = False
                    node["queued"] = False
                    for key in (
                        "jimengPending", "pendingTasks", "runStartedAt", "runFinishedAt",
                        "runElapsedMs", "runTimerHidden", "outputKind", "w", "h",
                    ):
                        node.pop(key, None)
        elif node_type == "image" and any(json_references_media_path(node.get("url"), path) for path in paths):
            node["url"] = ""
            node["mediaKind"] = "image"
            node["name"] = "空白图片"
            changed = True
        if changed and node.get("id"):
            reset_ids.append(str(node["id"]))
        updated_nodes.append(node)

    if reset_ids:
        canvas["nodes"] = updated_nodes
    return reset_ids


def delete_media_preview_cache(path: str) -> int:
    """Delete derived previews for a source file before the source disappears."""
    try:
        stat = os.stat(path)
    except OSError:
        return 0
    source = os.path.realpath(path)
    removed = 0
    for width in range(0, 4097):
        keys = [hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}|jpg".encode("utf-8", "ignore")).hexdigest() + ".jpg"]
        if 64 <= width <= 2048:
            preview_key = hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")).hexdigest()
            keys.extend((preview_key + ".webp", preview_key + ".png"))
        for name in keys:
            cache_path = os.path.join(MEDIA_PREVIEW_DIR, name)
            try:
                if os.path.isfile(cache_path):
                    os.remove(cache_path)
                    removed += 1
            except OSError:
                pass
    return removed





# --- 资产库 API ---

@app.get("/api/projects")
async def get_projects():
    """返回项目列表（兼容新前端）"""
    return {"projects": [{"id": "default", "name": "默认项目", "icon": "folder", "color": "#3b82f6"}]}

@app.get("/api/canvases/{canvas_id}/meta")
async def get_canvas_meta(canvas_id: str):
    canvas = load_canvas(canvas_id)
    return {"meta": {"title": canvas.get("title"), "icon": canvas.get("icon"), "color": canvas.get("color"), "pinned": canvas.get("pinned", False)}}

@app.post("/api/canvases/{canvas_id}/meta")
async def update_canvas_meta(canvas_id: str, payload: CanvasMetaUpdate = None):
    """更新画布元数据（标题/图标/颜色等）"""
    canvas = load_canvas(canvas_id)
    if not payload:
        return {"meta": {}}
    if payload.title is not None:
        canvas["title"] = payload.title[:80]
    if payload.icon is not None:
        canvas["icon"] = payload.icon[:32]
    if payload.color is not None:
        canvas["color"] = payload.color.strip()
    if payload.pinned is not None:
        canvas["pinned"] = payload.pinned
    save_canvas(canvas)
    return {"meta": {"title": canvas.get("title"), "icon": canvas.get("icon"), "color": canvas.get("color")}}

@app.post("/api/canvases/{canvas_id}/touch")
async def touch_canvas(canvas_id: str):
    """更新画布最后打开时间"""
    canvas = load_canvas(canvas_id)
    canvas["updated_at"] = int(time.time())
    save_canvas(canvas)
    return {"touched": True}

class UserAssetSaveRequest(BaseModel):
    url: str = ""
    name: str = ""
    prompt: Optional[str] = None


# --- Output 下载 ---

import io

class DownloadZipRequest(BaseModel):
    urls: List[str]
    filename: str = "output.zip"


# --- GPT 对话 ---


# --- 历史记录 ---

class SaveHistoryRequest(BaseModel):
    prompt: str = ""
    images: List[str] = []
    videos: List[str] = []
    text: Optional[str] = None
    text_url: Optional[str] = None
    seed: Optional[int] = None
    prompt_id: Optional[str] = None
    type: str = "zimage"
    model: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    timestamp: Optional[float] = None
    genParams: Optional[Dict[str, Any]] = None  # 完整生成参数,用于载入提示词恢复
    original: Optional[str] = None  # 高清修复原图 URL,用于重启后仍能前后对比



def _url_to_output_path(url: str) -> Optional[str]:
    """把 /output/... URL 解析为本地绝对路径;不在 OUTPUT_DIR 内则返回 None"""
    if not url or not url.startswith("/output/"):
        return None
    rel = url[len("/output/"):].replace("\\", "/")
    if ".." in rel.split("/"):
        return None
    full = os.path.abspath(os.path.join(OUTPUT_DIR, rel))
    root = os.path.abspath(OUTPUT_DIR)
    if not full.startswith(root + os.sep) and full != root:
        return None
    return full




# --- 提示词预设(委托 preset_manager 模块)---

from core import preset_manager
from core.preset_manager import (
    load_preset_i18n, get_preset_bidir,
    get_tag_presets, save_tag_presets,
    get_style_presets, save_style_presets,
    get_all_presets,
)


# --- 智能提示词生成 ---
# Feature flag: 设为 True 使用新模块，False 回退旧版
USE_NEW_PROMPT_MODULE = True

if USE_NEW_PROMPT_MODULE:
    from prompt import generate as generate_smart_prompt
    from prompt import generate_script as generate_smart_script
    from prompt import load_config
    from prompt.core import call_llm as _sp_call_llm
else:
    from core.smart_prompt import generate_smart_prompt, load_config
    from core.smart_prompt import call_llm as _sp_call_llm

class SmartPromptRequest(BaseModel):
    prompt: str = ""
    config: Optional[Dict[str, Any]] = None
    # === Local ComfyUI workflow channel (added 2026-07-28) ===
    channel: Optional[str] = None
    comfyui_workflow: Optional[str] = None
    comfyui_model: Optional[str] = None
    fields: Optional[Dict[str, Any]] = None
    # === [2026-07-28] 全局 provider/model 覆盖 - 替代 preset 内 provider_id ===
    provider_id: Optional[str] = None
    # === [2026-08-13] 指定预设（如视频页 H3 预设），None = 走当前选中预设 ===
    preset_id: Optional[str] = None
    # === [2026-08-13] 多模态看图生成：base64 data URL 列表（如 data:image/jpeg;base64,...）===
    images: Optional[List[str]] = None



async def _smart_prompt_comfyui(req: SmartPromptRequest):
    """Local ComfyUI workflow channel (added 2026-07-28).

    Flow:
    1. Resolve req.comfyui_workflow (builtin path like "提示词/文生提示词.json")
    2. Load workflow JSON + sidecar .config.json
    3. Inject req.fields into node inputs based on config.json field mappings
    4. If req.comfyui_model provided, override llama_cpp_model_loader.model (and reset mmproj/chat_handler to None)
    5. POST to COMFYUI_ADDRESS/prompt; poll /history/{prompt_id}
    6. Parse ShowText|pysssss output, split positive/negative, return {success, prompt, negative, raw}
    """
    wf_rel = req.comfyui_workflow or "提示词/文生提示词.json"

    if not WORKFLOW_NAME_RE.match(wf_rel):
        raise HTTPException(status_code=400, detail=f"workflow name invalid: {wf_rel}")

    wf_path = os.path.join(WORKFLOW_DIR, *wf_rel.split("/"))
    if not os.path.exists(wf_path):
        raise HTTPException(status_code=404, detail=f"workflow not found: {wf_rel}")

    cfg_path = wf_path.replace(".json", ".config.json")
    cfg = {}
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        except Exception:
            cfg = {}

    with open(wf_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)

    # Inject req.fields into node inputs per .config.json mapping
    user_fields = req.fields or {}
    user_fields.setdefault("user_prompt", req.prompt)

    # [FIX 2026-07-28] 本地 ComfyUI 通道也要应用 art-canvas 选中的预设规则。
    # 之前 _smart_prompt_comfyui 完全不读预设，导致用户配置的 AI 规则（system_prompt / quality_tags /
    # negative_default）被忽略，本地 LLM 只按工作流自带的默认 system prompt 跑。
    # 这里把选中预设的规则注入到工作流的 system_prompt 输入，与 API 通道行为保持一致。
    try:
        from prompt import preset as _pst
        _sel_id = _pst.get_selected_preset_id()
        _preset = _pst.get_preset(_sel_id) if _sel_id else None
        if _preset:
            _rules = (_preset.get("system_prompt") or "").strip()
            _qt = (_preset.get("quality_tags") or "").strip()
            _neg = (_preset.get("negative_default") or "").strip()
            # 取工作流该字段当前的默认 system prompt 作为基底（保留"只输出英文SD prompt"等指令）
            _sp_field = next((f for f in cfg.get("fields", []) if f.get("id") == "system_prompt"), None)
            _base = ""
            if _sp_field:
                _nid = str(_sp_field.get("node", ""))
                _inp = _sp_field.get("input", "")
                if _nid and _inp:
                    _base = (workflow.get(_nid, {}).get("inputs", {}).get(_inp, "") or "")
            _parts = []
            if _base:
                _parts.append(_base)
            if _rules:
                _parts.append("【用户预设规则】\n" + _rules)
            if _qt:
                _parts.append("质量标签必须包含以下词（逗号分隔）：" + _qt)
            if _neg:
                _parts.append("负向提示词默认值：" + _neg)
            if _parts:
                user_fields["system_prompt"] = "\n\n".join(_parts)
    except Exception:
        # 预设注入失败不影响主流程
        pass

    for field in cfg.get("fields", []):
        fid = field.get("id")
        nid = str(field.get("node", ""))
        inp = field.get("input", "")
        if not fid or not nid or not inp:
            continue
        if fid not in user_fields:
            continue
        value = user_fields[fid]
        # type coercion
        if field.get("type") in ("number", "slider"):
            try:
                step = field.get("step", 1)
                if isinstance(step, str):
                    step = float(step) if "." in step else int(float(step))
                if isinstance(value, str):
                    value = float(value) if (isinstance(step, float) and step < 1) else int(float(value))
                elif isinstance(value, (int, float)) and isinstance(step, float) and step < 1:
                    value = float(value)
            except Exception:
                pass
        if nid not in workflow or not isinstance(workflow[nid], dict):
            continue
        workflow[nid].setdefault("inputs", {})[inp] = value

    # Override model: find llama_cpp_model_loader, set model field, reset mmproj+chat_handler to None
    if req.comfyui_model:
        for nid, node in workflow.items():
            if isinstance(node, dict) and node.get("class_type") == "llama_cpp_model_loader":
                node.setdefault("inputs", {})["model"] = req.comfyui_model
                # Reset mmproj+chat_handler to None to avoid stale VL config causing "Failed to load mtmd context"
                node["inputs"]["mmproj"] = "None"
                node["inputs"]["chat_handler"] = "None"
                break

    # Submit to ComfyUI
    target_backend = COMFYUI_ADDRESS
    p = {"prompt": workflow, "client_id": CLIENT_ID}
    post_data = json.dumps(p).encode("utf-8")
    try:
        post_req = urllib.request.Request(
            f"http://{target_backend}/prompt",
            data=post_data,
            headers={"Content-Type": "application/json"},
        )
        resp_body = urllib.request.urlopen(post_req, timeout=15).read()
        submit_result = json.loads(resp_body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"ComfyUI submit failed: HTTP {e.code}: {err_body[:500]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI connection failed: {e}")

    # Catch node_errors at submit time (ComfyUI returns 200 + node_errors on bad params)
    if isinstance(submit_result, dict) and submit_result.get("node_errors"):
        err_lines = []
        for nid, err in submit_result["node_errors"].items():
            for e_item in (err.get("errors") or [err]):
                msg = e_item.get("message") or e_item.get("exception_message") or str(e_item)
                details = e_item.get("details") or ""
                line = f"node {nid}: {msg}" + (f" ({details})" if details else "")
                err_lines.append(line)
        raise HTTPException(status_code=400, detail="ComfyUI node errors:\n" + "\n".join(err_lines))

    prompt_id = submit_result.get("prompt_id", "")
    if not prompt_id:
        raise HTTPException(status_code=502, detail=f"ComfyUI returned no prompt_id: {submit_result}")

    # Poll /history/{prompt_id}
    start_ts = time.monotonic()
    deadline = start_ts + 180  # 3 min timeout (local LLM inference)
    last_status = None
    while time.monotonic() < deadline:
        try:
            hist_resp = urllib.request.urlopen(
                f"http://{target_backend}/history/{prompt_id}", timeout=10
            )
            hist = json.loads(hist_resp.read())
            entry = hist.get(prompt_id) if isinstance(hist, dict) else None
            if entry:
                status_obj = entry.get("status", {})
                if status_obj.get("completed"):
                    outputs = entry.get("outputs", {})
                    text_pieces = []
                    for nid, out in outputs.items():
                        if not isinstance(out, dict):
                            continue
                        if "text" in out and isinstance(out["text"], list):
                            for t in out["text"]:
                                if isinstance(t, str):
                                    text_pieces.append(t)
                    raw_text = "\n".join(text_pieces).strip()
                    if not raw_text:
                        raise HTTPException(status_code=502, detail=f"ComfyUI returned but ShowText empty: outputs={outputs}")
                    positive, negative = _split_negative(raw_text)
                    return {
                        "success": True,
                        "prompt": positive,
                        "negative": negative,
                        "raw": raw_text,
                        "prompt_id": prompt_id,
                        "elapsed": round(time.monotonic() - start_ts, 2),
                    }
                last_status = status_obj.get("status_str", "") or status_obj.get("str", "")
                if status_obj.get("error") or last_status == "error":
                    err_msg = status_obj.get("error", last_status)
                    raise HTTPException(status_code=400, detail=f"ComfyUI execution error: {err_msg}")
        except HTTPException:
            raise
        except Exception as e:
            last_status = f"poll_err: {e}"
        time.sleep(1.0)

    raise HTTPException(status_code=504, detail=f"ComfyUI timeout (180s), last_status={last_status}")


def _split_negative(raw_text: str):
    """Split model output into (positive, negative).

    Supports:
    - "Negative prompt: ..." section
    - "[NEG] ... [END]" tags
    - Falls back: positive=raw_text, negative=""
    """
    import re as _re
    m = _re.search(r'(?im)^\s*negative\s*prompt\s*[:\uff1a]\s*(.+?)\s*$', raw_text, _re.DOTALL)
    if m:
        pos_part = raw_text[:m.start()].strip()
        neg_part = m.group(1).strip()
        pos_part = _re.sub(r'(?im)^\s*positive\s*prompt\s*[:\uff1a]?\s*', '', pos_part).strip()
        return pos_part, neg_part
    m = _re.search(r'\[NEG\](.*?)(?:\[END\]|$)', raw_text, _re.DOTALL)
    if m:
        pos_part = raw_text[:m.start()].strip()
        neg_part = m.group(1).strip()
        return pos_part, neg_part
    return raw_text.strip(), ""

# ══════════════════════════════════════════════════════════════════════
#  prompt 模块新路由 (/api/prompt-module/*)
#  与旧路由双轨并行，前端切 PromptModule.config({apiPrefix: '/api/prompt-module'}) 即可使用
# ══════════════════════════════════════════════════════════════════════
if USE_NEW_PROMPT_MODULE:
    from prompt import (
        generate as pm_generate,
        load_config as pm_load_config,
        list_presets as pm_list_presets,
        get_preset as pm_get_preset,
        create_preset as pm_create_preset,
        update_preset as pm_update_preset,
        delete_preset as pm_delete_preset,
        get_selected_preset_id as pm_get_selected_preset_id,
        set_selected_preset_id as pm_set_selected_preset_id,
        create_group as pm_create_group,
        delete_group as pm_delete_group,
        update_group as pm_update_group,
        reorder_groups as pm_reorder_groups,
    )

    @app.post("/api/prompt-module/generate")
    async def pm_generate_route(req: SmartPromptRequest):
        try:
            result = pm_generate(
                req.prompt,
                preset_id=req.preset_id,
                config_override=req.config,
                provider_id_override=req.provider_id,
                images=req.images,
            )
            return result
        except Exception as e:
            return {"success": False, "prompt": "", "negative": "", "raw": "", "error": str(e)}

    @app.post("/api/prompt-module/generate-multimodal")
    async def pm_generate_multimodal_route(
        prompt: str = Form(...),
        preset_id: str = Form(None),
        provider_id: str = Form(None),
        files: List[UploadFile] = File(None),
    ):
        """多模态看图生成提示词：直接上传参考图（最多 9 张），一次调用完成看图+生成。
        与 /api/prompt-module/generate 的区别：走 multipart 上传，图片转 base64 data URL 交给多模态模型。
        复用与「AI 提示词」相同的 provider 配置（provider_id 缺省自动选可用 provider）。"""
        try:
            images: List[str] = []
            if files:
                if len(files) > 9:
                    return {"success": False, "prompt": "", "negative": "", "raw": "", "error": "最多支持 9 张参考图"}
                for f in files:
                    content = await f.read()
                    mime = f.content_type or "image/jpeg"
                    if not (mime or "").startswith("image/"):
                        mime = "image/jpeg"
                    b64 = base64.b64encode(content).decode("ascii")
                    images.append(f"data:{mime};base64,{b64}")
            result = pm_generate(
                prompt,
                preset_id=preset_id,
                config_override=None,
                provider_id_override=provider_id,
                images=images or None,
            )
            return result
        except Exception as e:
            return {"success": False, "prompt": "", "negative": "", "raw": "", "error": str(e)}

    @app.post("/api/prompt-module/generate-script")
    async def pm_generate_script_route(
        story: str = Form(...),
        segment_count: int = Form(3),
        preset_id: str = Form(None),
        provider_id: str = Form(None),
        files: List[UploadFile] = File(None),
        seg_duration: List[str] = Form(None),
        aspect_ratio: str = Form(None),
    ):
        """导演台整条脚本生成：一次生成 N 个连贯片段的分镜提示词（人物保持一致）。
        支持可选参考图（最多 9 张），与 generate-multimodal 一样走 multipart 上传。
        seg_duration：可重复字段，每段一个目标时长（秒，3~15），不传则统一 5 秒。
        aspect_ratio：整条画面比例（如 16:9 / 9:16），提示 LLM 适配镜头节奏/构图。"""
        try:
            images: List[str] = []
            if files:
                if len(files) > 9:
                    return {"success": False, "subjects": [], "segments": [], "raw": "", "error": "最多支持 9 张参考图"}
                for f in files:
                    content = await f.read()
                    mime = f.content_type or "image/jpeg"
                    if not (mime or "").startswith("image/"):
                        mime = "image/jpeg"
                    b64 = base64.b64encode(content).decode("ascii")
                    images.append(f"data:{mime};base64,{b64}")
            # seg_duration 可能是多个值；如果只有一个值则按统一时长处理
            durs = list(seg_duration) if seg_duration else None
            return generate_smart_script(
                story,
                segment_count=segment_count,
                preset_id=preset_id or None,
                provider_id_override=provider_id or None,
                images=images or None,
                seg_durations=durs,
                aspect_ratio=aspect_ratio or None,
            )
        except Exception as e:
            return {"success": False, "subjects": [], "segments": [], "raw": "", "error": str(e)}

    @app.get("/api/prompt-module/presets")
    async def pm_list_presets_route():
        from prompt.preset import _read_index
        index = _read_index()
        return {"presets": pm_list_presets(), "groups": index.get("groups", [])}

    @app.post("/api/prompt-module/presets")
    async def pm_create_preset_route(payload: dict):
        saved = pm_create_preset(payload)
        return {"success": True, "preset": saved}

    @app.put("/api/prompt-module/presets/{preset_id}")
    async def pm_update_preset_route(preset_id: str, payload: dict):
        saved = pm_update_preset(preset_id, payload)
        return {"success": True, "preset": saved}

    @app.delete("/api/prompt-module/presets/{preset_id}")
    async def pm_delete_preset_route(preset_id: str):
        pm_delete_preset(preset_id)
        return {"success": True}

    @app.get("/api/prompt-module/selected-preset")
    async def pm_get_selected_route():
        return {"preset_id": pm_get_selected_preset_id()}

    @app.post("/api/prompt-module/selected-preset")
    async def pm_set_selected_route(payload: dict):
        pm_set_selected_preset_id(payload.get("preset_id", "default"))

    @app.post("/api/prompt-module/groups")
    async def pm_create_group_route(payload: dict):
        pm_create_group(payload.get("id", ""), payload.get("name", ""))
        return {"success": True}

    @app.delete("/api/prompt-module/groups/{group_id}")
    async def pm_delete_group_route(group_id: str):
        pm_delete_group(group_id)
        return {"success": True}

    @app.put("/api/prompt-module/groups/{group_id}")
    async def pm_update_group_route(group_id: str, payload: dict):
        pm_update_group(group_id, payload)
        return {"success": True}

    @app.post("/api/prompt-module/groups/reorder")
    async def pm_reorder_groups_route(payload: dict):
        pm_reorder_groups(payload.get("ids", []))
        return {"success": True}

# --- AI 生成提示词方案 ---
class AIGenPlanRequest(BaseModel):
    description: str


# --- 本地 ComfyUI 生图 ---

# 正在执行中的 ComfyUI 任务登记表(prompt_id -> backend/caller), 供 /api/generate/cancel 精确中断。
# 多槽化(2026-10-22): 旧版单槽只记最后一个 prompt_id, canvas 异步任务经 asyncio.to_thread
# 多线程并发时后注册的会覆盖先注册的, 且 cancel 无法按调用方隔离。现改为 prompt_id 主键 +
# caller 索引, 支持同用户多任务并发; cancel 按调用方取消自己的任务(全局唯一时宽松兜底,
# 兼容未带 token 的老客户端)。
_ACTIVE_COMFY_TASKS = {}
_ACTIVE_COMFY_LOCK = threading.Lock()

def _comfy_caller_key(req, token: str = "") -> str:
    """生成任务的调用方标识: 优先用户名(带 token), 其次 client_id, 最后匿名。"""
    username = None
    if token:
        try:
            username = get_username_by_token(token)
        except Exception:
            username = None
    if username:
        return username
    client_id = getattr(req, "client_id", None)
    if client_id:
        return "client:" + str(client_id)
    return "anon"

def _run_comfy_generate_sync(req: GenerateRequest, token: str = "") -> dict:
    """Execute a ComfyUI generate task synchronously. Returns result dict.
    Used by both /api/generate (backward compat) and async canvas-comfy-tasks."""
    global NEXT_TASK_ID
    prompt_id = None
    current_task = None
    target_backend = None
    username = require_valid_token(token)

    # 加载画布(如果提供了 canvas_id)
    canvas = None
    if req.canvas_id:
        try:
            canvas = load_canvas(req.canvas_id)
        except:
            pass  # 画布不存在或已删除,降级到原有行为

    with QUEUE_LOCK:
        task_id = NEXT_TASK_ID
        NEXT_TASK_ID += 1
        current_task = {"task_id": task_id, "client_id": req.client_id}
        QUEUE.append(current_task)

    try:
        required_images = []
        for node_id, node_inputs in req.params.items():
            if isinstance(node_inputs, dict) and "image" in node_inputs:
                image_name = node_inputs["image"]
                if isinstance(image_name, str) and image_name:
                    required_images.append(image_name)

        target_backend = get_best_backend(required_images)
        with LOAD_LOCK:
            BACKEND_LOCAL_LOAD[target_backend] += 1

        for image_name in required_images:
            need_sync = False
            try:
                check_url = f"http://{target_backend}/view?filename={urllib.parse.quote(image_name)}&type=input"
                resp = requests.get(check_url, stream=True, timeout=0.5)
                resp.close()
                if resp.status_code != 200:
                    need_sync = True
            except:
                need_sync = True

            if need_sync:
                image_content = None
                image_type = "image/png"
                for addr in COMFYUI_INSTANCES:
                    if addr == target_backend: continue
                    try:
                        src_url = f"http://{addr}/view?filename={urllib.parse.quote(image_name)}&type=input"
                        r = requests.get(src_url, timeout=5)
                        if r.status_code == 200:
                            image_content = r.content
                            image_type = r.headers.get("Content-Type", "image/png")
                            break
                    except: continue

                if image_content:
                    try:
                        files = {'image': (image_name, image_content, image_type)}
                        requests.post(f"http://{target_backend}/upload/image", files=files, timeout=10)
                    except Exception as e:
                        print(f"Sync upload failed: {e}")

        if req.workflow_data:
            workflow = req.workflow_data
        elif req.workflow_json:
            workflow_path = os.path.join(WORKFLOW_DIR, *req.workflow_json.split("/"))
            if not os.path.exists(workflow_path) and req.workflow_json in ("Z-Image.json", "text2image/z-image.json"):
                workflow_path = WORKFLOW_PATH
            if not os.path.exists(workflow_path):
                raise Exception(f"Workflow file not found: {req.workflow_json}")
            with open(workflow_path, 'r', encoding='utf-8') as f:
                workflow = json.load(f)
        else:
            raise Exception("缺少工作流数据,请提供 workflow_data 或 workflow_json")

        # UI 格式(顶层含 nodes 列表) → API 格式(节点字典)。转换器见 _ui_workflow_to_api_prompt。
        # 这样 /api/generate 不必关心调用方传的是哪种格式,后续 seed/CLIPTextEncode/EmptyLatent 注入逻辑都按 API 格式走。
        if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
            workflow = _ui_workflow_to_api_prompt(workflow)

        seed = random.randint(1, 10**15)

        if "23" in workflow and req.prompt:
            workflow["23"]["inputs"]["text"] = req.prompt
        if "144" in workflow:
            workflow["144"]["inputs"]["width"] = req.width
            workflow["144"]["inputs"]["height"] = req.height
        if "22" in workflow:
            workflow["22"]["inputs"]["seed"] = seed
        if "158" in workflow:
            workflow["158"]["inputs"]["noise_seed"] = seed
        for node_id in ["146", "181"]:
            if node_id in workflow and "inputs" in workflow[node_id] and "seed" in workflow[node_id]["inputs"]:
                workflow[node_id]["inputs"]["seed"] = seed
        if "184" in workflow and "inputs" in workflow["184"] and "seed" in workflow["184"]["inputs"]:
            workflow["184"]["inputs"]["seed"] = seed
        if "172" in workflow and "inputs" in workflow["172"] and "seed" in workflow["172"]["inputs"]:
            workflow["172"]["inputs"]["seed"] = seed % 4294967295
        if "14" in workflow and "inputs" in workflow["14"] and "seed" in workflow["14"]["inputs"]:
            workflow["14"]["inputs"]["seed"] = seed
        if "19" in workflow and "inputs" in workflow["19"] and "seed" in workflow["19"]["inputs"]:
            workflow["19"]["inputs"]["seed"] = seed

        # --- 通用 class_type 扫描补丁 (覆盖未硬编码的新工作流) ---
        # 先找 KSampler 正向 prompt 引用的 CLIPTextEncode 节点
        _positive_prompt_nodes = set()
        for nid, node in workflow.items():
            if not isinstance(node, dict):
                continue
            ct = str(node.get('class_type', ''))
            inp = node.get('inputs') or {}
            if ct in ('KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'):
                ref = inp.get('positive')
                if isinstance(ref, list) and len(ref) == 2:
                    _positive_prompt_nodes.add(str(ref[0]))
        for nid, node in workflow.items():
            if not isinstance(node, dict):
                continue
            ct = str(node.get('class_type', ''))
            inp = node.get('inputs')
            if not isinstance(inp, dict):
                continue
            # prompt: CLIPTextEncode — 正向 prompt 节点强制覆盖,其余只补空
            if ct == 'CLIPTextEncode' and 'text' in inp:
                if nid in _positive_prompt_nodes and req.prompt:
                    inp['text'] = req.prompt
                elif not inp['text'] and req.prompt:
                    inp['text'] = req.prompt
            # latent 尺寸: EmptyLatentImage / Empty.*Latent
            # krea2 的 EmptyLatent 尺寸由缩放后的原图(VAEEncode 的 source_latent)派生,
            # 若强制覆盖成主图自然尺寸会与 source_latent 形状不匹配,故对 krea2 跳过覆盖
            if ('EmptyLatent' in ct or 'EmptyFlux' in ct) and 'width' in inp and 'height' in inp:
                if req.type != 'krea2':
                    inp['width'] = req.width
                    inp['height'] = req.height
            # seed: KSampler / SamplerCustom 等
            if ct in ('KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'):
                if 'seed' in inp:
                    inp['seed'] = seed
                if 'noise_seed' in inp:
                    inp['noise_seed'] = seed
            # RandomNoise
            if ct == 'RandomNoise' and 'noise_seed' in inp:
                inp['noise_seed'] = seed

        for node_id, node_inputs in req.params.items():
            if not isinstance(node_inputs, dict):
                continue
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    workflow[node_id]["inputs"][input_name] = value
            elif "class_type" in node_inputs:
                # 前端动态注入的新节点（例如 MiniMax 多参考图 LoadImage）
                workflow[node_id] = {
                    "class_type": node_inputs.get("class_type"),
                    "inputs": dict(node_inputs.get("inputs", {}) or {}),
                    "_meta": node_inputs.get("_meta", {}) or {}
                }

        # 前端可能已提交到 ComfyUI 并拿到 prompt_id（用于 WebSocket 进度追踪），
        # 此时跳过重复提交，直接用该 prompt_id 轮询结果
        if req.prompt_id:
            prompt_id = req.prompt_id
            print(f'[Generate] 复用前端提交的 prompt_id: {prompt_id}')
        else:
            comfy_client_id = req.client_id or CLIENT_ID
            p = {"prompt": workflow, "client_id": comfy_client_id}
            if req.extra_pnginfo:
                # GJJ_MultiImageLoader 等节点通过 extra_pnginfo.workflow.nodes[].properties 读取 selected_images
                p["extra_data"] = {"extra_pnginfo": req.extra_pnginfo}
            data = json.dumps(p).encode('utf-8')
            try:
                post_req = urllib.request.Request(f"http://{target_backend}/prompt", data=data)
                resp_body = urllib.request.urlopen(post_req, timeout=10).read()
                submit_result = json.loads(resp_body)
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8')
                raise Exception(f"HTTP Error {e.code}: {error_body}")

            # ComfyUI 在节点类缺失/参数非法时,会以 HTTP 200 返回 prompt_id 同时附带 node_errors,
            # 若不显式拦截,后续历史里 status 仍可能是 "success"(因为多数节点并未真正执行),
            # 走到"未返回输出"兜底时排查非常困难。此处在提交阶段直接报错。
            if isinstance(submit_result, dict) and submit_result.get("node_errors"):
                err_lines = []
                for nid, err in submit_result["node_errors"].items():
                    for e_item in (err.get("errors") or [err]):
                        msg = e_item.get("message") or e_item.get("exception_message") or str(e_item)
                        details = e_item.get("details") or ""
                        line = f"节点 {nid}: {msg}" + (f" ({details})" if details else "")
                        err_lines.append(line)
                raise Exception("ComfyUI 提交失败:\n" + "\n".join(err_lines))

            prompt_id = submit_result['prompt_id']

        # 登记当前正在执行的 ComfyUI 任务, 供 /api/generate/cancel 按调用方精确中断
        with _ACTIVE_COMFY_LOCK:
            _ACTIVE_COMFY_TASKS[prompt_id] = {
                "backend": target_backend,
                "caller": _comfy_caller_key(req, token),
            }

        history_data = None
        poll_start = time.monotonic()

        # ── WebSocket 进度监听（仅异步任务使用）──
        ws_thread = None
        _ws_stop = threading.Event()
        _cached_task_id = getattr(req, '_cached_task_id', None)
        if _cached_task_id and _cached_task_id in CANVAS_TASKS:
            def _comfy_ws_worker():
                import websocket as ws_lib
                _rel_pid = None
                ws_url = f"ws://{target_backend}/ws?clientId={CLIENT_ID}"
                try:
                    sock = ws_lib.create_connection(ws_url, timeout=5)
                    while not _ws_stop.is_set():
                        sock.settimeout(1.0)
                        try:
                            raw = sock.recv()
                        except ws_lib.WebSocketTimeoutException:
                            continue
                        except Exception:
                            break
                        if isinstance(raw, bytes):
                            try:
                                raw_str = raw.decode('utf-8', errors='replace')
                            except:
                                continue
                        else:
                            raw_str = raw
                        if not raw_str.startswith('{'):
                            continue
                        try:
                            msg = json.loads(raw_str)
                        except json.JSONDecodeError:
                            continue
                        if msg.get('type') == 'status':
                            continue
                        data = msg.get('data') or {}
                        pid = data.get('prompt_id')
                        if pid:
                            _rel_pid = pid
                        if _rel_pid != prompt_id:
                            continue
                        if msg.get('type') == 'progress':
                            d = msg.get('data') or {}
                            val = d.get('value', 0)
                            mx = d.get('max', 100)
                            pct = round((val / max(mx, 1)) * 100)
                            with CANVAS_TASK_LOCK:
                                if _cached_task_id in CANVAS_TASKS:
                                    CANVAS_TASKS[_cached_task_id].update({
                                        'progress': pct,
                                        'progress_value': val,
                                        'progress_max': mx,
                                    })
                        elif msg.get('type') == 'executing':
                            node_val = data.get('node')
                            with CANVAS_TASK_LOCK:
                                if _cached_task_id in CANVAS_TASKS:
                                    if node_val is None:
                                        CANVAS_TASKS[_cached_task_id].update({
                                            'progress': 100,
                                            'progress_node': '完成',
                                        })
                                    else:
                                        CANVAS_TASKS[_cached_task_id]['progress_node'] = str(node_val)
                    sock.close()
                except Exception:
                    pass
            ws_thread = threading.Thread(target=_comfy_ws_worker, daemon=True)
            ws_thread.start()

        _poll_timeout = float(os.getenv("COMFY_POLL_TIMEOUT", "1800"))
        try:
            while True:
                try:
                    res = get_comfy_history(target_backend, prompt_id)
                    if prompt_id in res:
                        history_data = res[prompt_id]
                        # 等待执行真正结束(success/error),避免拿到运行中/刚提交时的空 outputs。
                        # status_str 为空(部分老版本无该字段)时维持原行为直接返回。
                        _st = (history_data.get("status") or {}).get("status_str", "") if isinstance(history_data, dict) else ""
                        if _st in ("", "success", "error"):
                            break
                except Exception:
                    pass
                elapsed = time.monotonic() - poll_start
                if elapsed > _poll_timeout:
                    print(f'[Generate] 轮询超时({int(elapsed)}s), prompt_id={prompt_id}')
                    break
                if elapsed > 60 and int(elapsed) % 60 < 1:
                    print(f'[Generate] 等待 ComfyUI 完成中… 已等待 {int(elapsed)}s, prompt_id={prompt_id}')
                time.sleep(0.5)
        finally:
            if ws_thread and ws_thread.is_alive():
                _ws_stop.set()
                ws_thread.join(timeout=2)

        local_urls = []
        audio_urls = []
        video_urls = []
        output_text = ""
        current_timestamp = time.time()
        if 'outputs' in history_data:
            for node_id in history_data['outputs']:
                node_output = history_data['outputs'][node_id]

                # Extract image outputs
                # 对于ps.json工作流,只收集节点#2的图像(主图像),跳过节点#5(遮罩)
                if 'images' in node_output:
                    # 如果是ps.json工作流,跳过节点#5的遮罩输出
                    if req.workflow_json == 'ps.json' and node_id == '5':
                        continue

                    images_list = node_output['images']
                    # 边界修复: ComfyUI SaveVideo 节点 outputs 在 'images' key 里 (含 animated=True/filename=*.mp4),
                    # 需识别后路由到 download_video 而不是 download_image (避免 mp4 被保存成 png)
                    # 返回 ('video', path) 或 ('image', path) 以便调用方分类追加
                    _video_exts = ('.mp4', '.webm', '.mov', '.mkv', '.avi')
                    def _dl_img(img_dict):
                        _path = f"/view?filename={img_dict['filename']}&subfolder={img_dict['subfolder']}&type={img_dict['type']}"
                        _fname = img_dict.get('filename', '')
                        # 视频文件走下载视频路径
                        if any(_fname.lower().endswith(ext) for ext in _video_exts) or node_output.get('animated'):
                            _pre = f"{req.type}_{int(current_timestamp)}_"
                            from urllib.parse import quote as _q
                            _vp = f"/view?filename={_q(_fname, safe='')}&subfolder={_q(img_dict.get('subfolder', ''), safe='')}&type={_q(img_dict.get('type', 'output'), safe='')}"
                            _lp = download_video(target_backend, _vp, prefix=_pre, canvas=canvas, username=username, feature=req.feature)
                            return ('video', _lp)
                        _pre = f"{req.type}_{int(current_timestamp)}_"
                        _lp = download_image(target_backend, _path, prefix=_pre, canvas=canvas, username=username, feature=req.feature)
                        if req.convert_to_jpg:
                            _lp = convert_output_to_jpg(_lp)
                        return ('image', _lp)
                    if len(images_list) > 1:
                        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(images_list), 4)) as _exe:
                            for kind, _lp in _exe.map(_dl_img, images_list):
                                if kind == 'video':
                                    video_urls.append(_lp)
                                local_urls.append(_lp)
                    else:
                        for img in images_list:
                            kind, _lp = _dl_img(img)
                            if kind == 'video':
                                video_urls.append(_lp)
                            local_urls.append(_lp)

                # Extract audio outputs (TTS)
                if 'audio' in node_output:
                    for aud in node_output['audio']:
                        comfy_url_path = f"/view?filename={aud['filename']}&subfolder={aud.get('subfolder', '')}&type={aud.get('type', 'temp')}"
                        # 使用自定义前缀或默认前缀
                        save_prefix = req.params.get('save_prefix', 'tts') if req.params else 'tts'
                        prefix = f"{save_prefix}_{int(current_timestamp)}_"
                        local_path = download_audio(target_backend, comfy_url_path, prefix=prefix, canvas=canvas, username=username, subfolder="tts")
                        audio_urls.append(local_path)

                # Extract video outputs (LTX23 / VHS_VideoCombine / SaveVideo 等)
                if 'videos' in node_output:
                    for vid in node_output['videos']:
                        vid_filename = vid.get('filename', '')
                        vid_subfolder = vid.get('subfolder', '')
                        vid_type = vid.get('type', 'output')
                        vid_format = vid.get('format', '')  # ComfyUI SaveVideo 会带 format 字段
                        # ComfyUI URL 路径拼接要 url-encode
                        from urllib.parse import quote
                        comfy_url_path = f"/view?filename={quote(vid_filename, safe='')}&subfolder={quote(vid_subfolder, safe='')}&type={quote(vid_type, safe='')}"
                        save_prefix = req.params.get('save_prefix', 'video') if req.params else 'video'
                        prefix = f"{save_prefix}_{int(current_timestamp)}_"
                        local_path = download_video(target_backend, comfy_url_path, prefix=prefix, canvas=canvas, username=username, feature=req.feature)
                        # 视频同时追加到 local_urls(画廊 card 按后缀判断 <video>) 和 video_urls(前端可明确识别)
                        local_urls.append(local_path)
                        video_urls.append(local_path)

                # Extract text output from ShowText and text-based nodes
                # 只有 promptgen 类型才保存文本输出(图像反推等)
                if not output_text and 'text' in node_output and req.type == 'promptgen':
                    tv = node_output['text']
                    if isinstance(tv, list) and tv:
                        output_text = '\n'.join([str(t) for t in tv])
                    elif isinstance(tv, str) and tv.strip():
                        output_text = tv

        # 只有 promptgen 类型才保存文本文件
        if output_text and req.type == 'promptgen':
            print(f"[TextOutput] Extracted text: {len(output_text)} chars")
            if canvas:
                canvas_output_dir = get_canvas_output_dir(canvas)
            elif username:
                canvas_output_dir, _ = get_user_output_dir(username)
            else:
                canvas_output_dir = OUTPUT_DIR
            os.makedirs(canvas_output_dir, exist_ok=True)
            text_filename = f"{req.type}_{int(current_timestamp)}_{uuid.uuid4().hex[:8]}.txt"
            text_filepath = os.path.join(canvas_output_dir, text_filename)
            try:
                with open(text_filepath, 'w', encoding='utf-8') as f:
                    f.write(output_text)
                text_url = build_output_url(canvas, text_filename, username)
                print(f"[TextOutput] Saved to: {text_filepath}")
            except Exception as e:
                print(f"[TextOutput] Failed to save text file: {e}")
                text_url = ""
        else:
            print("[TextOutput] WARNING: No text extracted from ComfyUI history")
            text_url = ""

        if not local_urls and not audio_urls and not output_text:
            comfy_error = ""
            status_str = ""
            out_nodes = []
            if isinstance(history_data, dict):
                status_info = history_data.get("status", {})
                if isinstance(status_info, dict):
                    status_str = status_info.get("status_str", "") or status_info.get("status", "")
                    # status_str == "error" 时,从 messages 提取真正的异常描述。
                    # execution_error 的 payload 在官方实现里是 dict(含 exception_type/exception_message),
                    # 但部分分支/版本可能为 list([type, message, ...]),两种都兼容。
                    if status_str == "error":
                        for msg in status_info.get("messages", []) or []:
                            if not (isinstance(msg, list) and len(msg) >= 2 and msg[0] == "execution_error"):
                                continue
                            payload = msg[1]
                            if isinstance(payload, dict):
                                exc_type = payload.get("exception_type", "") or "Error"
                                exc_msg = payload.get("exception_message", "") or payload.get("message", "")
                                comfy_error = f"{exc_type}: {exc_msg}".strip(": ")
                            elif isinstance(payload, list) and len(payload) >= 2:
                                exc_type = str(payload[0]) if payload[0] else "Error"
                                exc_msg = str(payload[1]) if payload[1] else ""
                                comfy_error = f"{exc_type}: {exc_msg}".strip(": ")
                            if comfy_error:
                                break
                    # 兜底:status 字典里直接带 error 字段的情况
                    if not comfy_error and status_info.get("error"):
                        comfy_error = str(status_info.get("error"))
                out_nodes = list(history_data.get("outputs", {}).keys())
                # 也扫描各节点输出里的 error 字段
                if not comfy_error:
                    for node_id, node_out in history_data.get("outputs", {}).items():
                        if isinstance(node_out, dict) and "error" in node_out:
                            comfy_error = f"节点 {node_id}: {node_out['error']}"
                            break
            # 打印完整 ComfyUI 响应用于调试
            print(f"[ComfyUI-Debug] history_data keys: {list(history_data.keys()) if isinstance(history_data, dict) else type(history_data)}")
            if isinstance(history_data, dict):
                print(f"[ComfyUI-Debug] status: {history_data.get('status', {})}")
                for nid, nout in history_data.get("outputs", {}).items():
                    print(f"[ComfyUI-Debug] node {nid} output: {json.dumps(nout, ensure_ascii=False)[:500]}")
            if comfy_error:
                raise Exception(f"ComfyUI 执行失败: {comfy_error}")
            # 没有任何媒体/文本产出: 区分"执行失败被吞"与"执行成功但无输出",便于定位
            detail = f"[status={status_str or '未知'}] 产出节点={out_nodes if out_nodes else '无'}"
            raise Exception(f"ComfyUI 未返回输出{detail};请检查工作流配置或确认模型已安装(详见后端 [ComfyUI-Debug] 日志)")

        result = {
            "prompt": req.prompt if req.prompt else "Detail Enhance",
            "images": local_urls,
            "audio": audio_urls,
            "text": output_text,
            "text_url": text_url,
            "seed": seed,
            "prompt_id": prompt_id,
            "timestamp": current_timestamp,
            "type": req.type,
            "user": username,
            "params": req.params,
            "videos": video_urls,
            "video_urls": video_urls
        }
        save_to_history(result)
        finish_chat_generation(getattr(req, "conversation_id", ""), getattr(req, "message_id", ""), local_urls)
        # Broadcast if there are images, audio OR text output
        # 但ps.json和ps_send.json工作流不广播,由前端自行处理
        if GLOBAL_LOOP and (local_urls or audio_urls or output_text) and req.workflow_json not in ('ps.json', 'ps_send.json'):
            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result), GLOBAL_LOOP)
        return result

    except Exception as e:
        finish_chat_generation(getattr(req, "conversation_id", ""), getattr(req, "message_id", ""), error=str(e))
        return {"images": [], "audio": [], "videos": [], "video_urls": [], "error": str(e)}
    finally:
        if prompt_id:
            with _ACTIVE_COMFY_LOCK:
                _ACTIVE_COMFY_TASKS.pop(prompt_id, None)
        if target_backend:
            with LOAD_LOCK:
                if BACKEND_LOCAL_LOAD.get(target_backend, 0) > 0:
                    BACKEND_LOCAL_LOAD[target_backend] -= 1
        if current_task:
            with QUEUE_LOCK:
                if current_task in QUEUE:
                    QUEUE.remove(current_task)


async def run_canvas_comfy_task(task_id: str, req: GenerateRequest, token: str = ""):
    """Background task runner for ComfyUI canvas tasks."""
    with CANVAS_TASK_LOCK:
        if task_id in CANVAS_TASKS:
            CANVAS_TASKS[task_id]["status"] = "running"
            CANVAS_TASKS[task_id]["updated_at"] = time.time()
    try:
        req._cached_task_id = task_id
        result = await asyncio.to_thread(_run_comfy_generate_sync, req, token)
        with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id].update({
                "status": "failed" if result.get("error") else "succeeded",
                "result": result,
                "error": result.get("error") or "",
                "updated_at": time.time(),
            })
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id].update({
                "status": "failed",
                "error": str(detail),
                "status_code": status_code,
                "updated_at": time.time(),
            })




@app.post("/api/generate")
def generate(req: GenerateRequest, request: Request, token: str = ""):
    return _run_comfy_generate_sync(req, request_auth_token(request, token))


@app.post("/api/generate/cancel")
def cancel_generate(token: str = ""):
    """真正中断正在执行的 ComfyUI 生成任务(释放显存/停止采样):
    1) POST /interrupt 中断当前执行中的任务;
    2) DELETE /queue 把该 prompt_id 从未开始的队列中移除(interrupt 只对执行中有效)。
    多槽化(2026-10-22): 按调用方取消自己的全部任务; 若调用方无任务且全局仅剩一个,
    宽松取消该任务(兼容未带 token 的老客户端单任务场景)。
    """
    with _ACTIVE_COMFY_LOCK:
        caller = "anon"
        if token:
            try:
                caller = get_username_by_token(token) or "anon"
            except Exception:
                caller = "anon"
        mine = [(pid, info) for pid, info in _ACTIVE_COMFY_TASKS.items()
                if info.get("caller") == caller]
        if not mine and len(_ACTIVE_COMFY_TASKS) == 1:
            mine = list(_ACTIVE_COMFY_TASKS.items())
        # 取消意图立即生效: 同一临界区内摘除登记, 连点取消第二次即返回无任务
        # (_run_comfy_generate_sync 的 finally 里 pop(prompt_id, None) 幂等兼容)
        for pid, _ in mine:
            _ACTIVE_COMFY_TASKS.pop(pid, None)
    if not mine:
        return {"success": False, "detail": "当前没有正在执行的 ComfyUI 生成任务"}
    notes = []
    cancelled = []
    for pid, info in mine:
        backend = info.get("backend")
        try:
            requests.post(f"http://{backend}/interrupt", timeout=3)
            notes.append("interrupt ok")
        except Exception as e:
            notes.append(f"interrupt fail: {e}")
        try:
            requests.delete(f"http://{backend}/queue", json={"delete": [pid]}, timeout=3)
            notes.append("queue-delete ok")
        except Exception as e:
            notes.append(f"queue-delete fail: {e}")
        cancelled.append(pid)
        print(f"[Generate] 用户终止: prompt_id={pid} backend={backend} caller={caller} ({'; '.join(notes)})")
    return {"success": True, "prompt_ids": cancelled, "prompt_id": cancelled[0], "detail": "; ".join(notes)}

# --- API 设置相关 API ---

# --- 智能画布分组导出模型 ---

class SmartCanvasGroupExportItem(BaseModel):
    kind: str = ""
    url: str = ""
    text: str = ""
    name: str = ""

class SmartCanvasGroupExportRequest(BaseModel):
    folder: str = ""
    group_name: str = "group"
    items: List[SmartCanvasGroupExportItem] = []

# --- 智能画布复制相关模型 ---

class CloudVideoUploadRequest(BaseModel):
    url: str = ""
    service: str = "auto"

class LocalImageImportRequest(BaseModel):
    path: str = ""
    paths: List[str] = Field(default_factory=list)

class RunningHubSubmitRequest(BaseModel):
    webappId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    instanceType: str = ""
    useWallet: bool = False

class RunningHubWorkflowSubmitRequest(BaseModel):
    workflowId: str = ""
    nodeInfoList: List[Dict[str, Any]] = []
    workflow: Any = None
    useWallet: bool = False

class RunningHubUploadAssetRequest(BaseModel):
    url: str = ""
    useWallet: bool = False

class RunningHubWorkflowConfigField(BaseModel):
    id: str = ""
    nodeId: str = ""
    fieldName: str = ""
    fieldValue: str = ""
    fieldType: str = "TEXT"
    label: str = ""
    enabled: bool = True
    sourceFromUpstream: bool = True
    group: str = ""
    note: str = ""
    options: List[str] = Field(default_factory=list)
    random_enabled: bool = False
    min: Any = ""
    max: Any = ""
    step: Any = ""
    imageOrder: int = 0
    required: bool = False

class RunningHubWorkflowConfig(BaseModel):
    workflowId: str = ""
    title: str = ""
    description: str = ""
    fields: List[RunningHubWorkflowConfigField] = Field(default_factory=list)
    workflowJson: Dict[str, Any] = Field(default_factory=dict)
    optionalImageMode: str = "prune-workflow"
    raw: Dict[str, Any] = Field(default_factory=dict)

class CanvasWorkflowExportRequest(BaseModel):
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    filename: str = "canvas-workflow.zip"
    include_resources: bool = True
    library_id: str = ""
    category_id: str = ""
    name: str = ""

# --- 即梦 CLI 请求模型 ---

class JimengHelpRequest(BaseModel):
    command: str = ""

class JimengQueryMediaRequest(BaseModel):
    submit_id: str = ""
    kind: str = "image"

class CodexHelpRequest(BaseModel):
    command: str = ""

class GeminiCliHelpRequest(BaseModel):
    command: str = ""

class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    api_key: Optional[str] = None
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    model_labels: Dict[str, str] = {}
    primary: bool = False
    enabled: bool = True

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""

async def fetch_models_from_upstream(base_url: str, api_key: str, refresh: bool = False, model: str = ""):
    """从 OpenAI 兼容 /v1/models 端点拉取模型"""
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")

    api_key = (api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    url = models_endpoint(base_url)
    if refresh:
        from urllib.parse import urlencode
        url += ("&" if "?" in url else "?") + urlencode({"refresh": "true", "model": model})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=f"上游 /v1/models 失败:{resp.text[:300]}")
            raw = resp.json()
            if is_cloudflare(api_root(base_url)):
                collected = model_items(raw, cloudflare=True)
                pages = int((raw.get("result_info") or {}).get("total_pages") or 1)
                for page in range(2, pages + 1):
                    next_resp = await client.get(url + f"&page={page}", headers={
                        "Authorization": f"Bearer {sanitize_api_key(api_key)}", "Accept": "application/json"})
                    next_resp.raise_for_status()
                    collected.extend(model_items(next_resp.json(), cloudflare=True))
                raw = {"data": collected}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败:{e}")

    items = model_items(raw)

    ids = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                ids.append(str(mid))

    ids = sorted(set(ids))

    from tools.webai_gateway import model_catalog
    capabilities = model_catalog(items)
    # 优先使用上游声明的类型，兼容没有类型的普通 OpenAI 平台。
    def classify(mid):
        explicit = capabilities.get(mid, {}).get("type")
        if explicit:
            return explicit
        lc = mid.lower()
        video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
        if any(k in lc for k in video_keys):
            return "video"
        image_keys = ["image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein"]
        if any(k in lc for k in image_keys):
            return "image"
        return "chat"

    grouped = {"image": [], "chat": [], "video": []}
    for mid in ids:
        grouped[classify(mid)].append(mid)

    return {
        "total": len(ids),
        "model_capabilities": capabilities,
        "image_models": grouped["image"],
        "chat_models": grouped["chat"],
        "video_models": grouped["video"],
        "all": ids
    }

# --- 即梦 CLI API ---

# --- OpenAI Codex CLI ---

# --- ComfyUI 设置相关 API ---

# 工作流名称校验正则
WORKFLOW_NAME_RE = re.compile(r'^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\.\-_\/ ]*\.json$')

# 内置工作流列表（根目录及已登记的分类目录，包含抠图工作流）
BUILTIN_WORKFLOW_DIRS = [BUILTIN_WORKFLOW_DIR, os.path.join(BUILTIN_WORKFLOW_DIR, "text2image"), os.path.join(BUILTIN_WORKFLOW_DIR, "提示词"), os.path.join(BUILTIN_WORKFLOW_DIR, "video"), os.path.join(BUILTIN_WORKFLOW_DIR, "cutout")]
BUILTIN_WORKFLOWS = set()
for _wd in BUILTIN_WORKFLOW_DIRS:
    if not os.path.isdir(_wd):
        continue
    for fn in os.listdir(_wd):
        if fn.endswith('.json') and not fn.endswith('.config.json') and os.path.isfile(os.path.join(_wd, fn)):
            rel = os.path.relpath(os.path.join(_wd, fn), BUILTIN_WORKFLOW_DIR).replace("\\", "/")
            BUILTIN_WORKFLOWS.add(rel)

def update_env_values(updates):
    """更新 .env 文件中的配置值"""
    env_path = API_ENV_FILE
    try:
        env_lines = []
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                env_lines = f.readlines()

        # 更新或添加配置
        for key, value in updates.items():
            found = False
            for i, line in enumerate(env_lines):
                if line.startswith(f"{key}="):
                    env_lines[i] = f"{key}={value}\n"
                    found = True
                    break

            if not found:
                env_lines.append(f"{key}={value}\n")

        os.makedirs(os.path.dirname(env_path), exist_ok=True)
        with open(env_path, 'w', encoding='utf-8') as f:
            f.writelines(env_lines)
    except Exception as e:
        print(f"Failed to update env file: {e}")
        raise

def workflow_path_from_name(name: str) -> str:
    """根据工作流名称获取文件路径,包含安全校验"""
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    # 防止路径遍历攻击
    path = os.path.abspath(os.path.join(WORKFLOW_DIR, *name.split("/")))
    workflow_root = os.path.abspath(WORKFLOW_DIR)
    if os.path.commonpath([workflow_root, path]) != workflow_root:
        raise HTTPException(status_code=400, detail="工作流名称包含非法路径")

    return path

def workflow_config_path(name: str) -> str:
    """获取工作流配置文件路径"""
    return workflow_path_from_name(name).replace(".json", ".config.json")

def is_builtin_workflow(name: str) -> bool:
    """判断是否为内置工作流(支持子目录相对路径,如 text2image/z-image.json)"""
    rel = os.path.normpath(name).replace("\\", "/")
    return rel in BUILTIN_WORKFLOWS

class ComfyUIInstancesUpdateRequest(BaseModel):
    instances: List[str] = []

# ---- ComfyUI 进程管理 (启动/停止) ----
_comfyui_process: Optional[subprocess.Popen] = None



_comfy_health_cache = None
_comfy_health_lock = asyncio.Lock()


async def get_comfyui_health() -> bool:
    """检查 ComfyUI 后端是否可达"""
    global _comfy_health_cache
    if not COMFYUI_INSTANCES:
        return False
    addr = COMFYUI_INSTANCES[0]
    # 父页面、对话页和多个访客复用一次短探测，避免重复连接 ComfyUI。
    async with _comfy_health_lock:
        if _comfy_health_cache and _comfy_health_cache[0] == addr and time.monotonic() < _comfy_health_cache[1]:
            return _comfy_health_cache[2]
        reachable = False
        try:
            async with httpx.AsyncClient(timeout=5.0, verify=COMFY_HTTP_SSL_CONTEXT, trust_env=False) as client:
                r = await client.get(f"http://{addr}/system_stats")
                reachable = r.status_code == 200
        except Exception:
            pass
        _comfy_health_cache = (addr, time.monotonic() + 3, reachable)
        return reachable



def _find_latest_comfyui_log() -> Optional[str]:
    """查找 logs/ 下最新的 comfyui-*.log"""
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    if not os.path.isdir(log_dir):
        return None
    logs = sorted(glob.glob(os.path.join(log_dir, "comfyui-*.log")), key=os.path.getmtime, reverse=True)
    return logs[0] if logs else None




# --- ComfyUI 代理端点(供前端在 non-local 模式下使用) ---

# object_info 缓存:避免每次请求都向 ComfyUI 拉全量数据(数据量大且响应慢)
_object_info_cache = {"data": None, "ts": 0}
_OBJECT_INFO_CACHE_TTL = 30  # 秒

# --- LoRA Manager 代理端点 ---


async def proxy_comfyui_view(filename: str = "", subfolder: str = "", type: str = "output", w: int = 0):
    """代理 ComfyUI /view,支持缩略图与流式透传

    性能要点(解决大图秒显问题):
    - w=0(默认):用 StreamingResponse 边下边传给浏览器,并加 immutable 缓存头
      (ComfyUI 输出 filename 是 hash 唯一标识,安全 long-cache)
    - w>0:先查 WebP 缓存,命中直接 FileResponse 秒出;未命中则下载原图 +
      PIL 缩放 + 写 WebP 缓存,后续同 (filename, w) 直接秒出
    """
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    if not filename:
        raise HTTPException(status_code=400, detail="缺少 filename")

    width = max(0, min(2048, int(w or 0)))
    params = {"filename": filename, "subfolder": subfolder, "type": type}
    url = f"http://{target}/view"

    # 视频文件短路：避免 PIL 打开 .mp4/.webm/.mov/.mkv/.gif 报错
    from urllib.parse import quote as _q
    ext = os.path.splitext(filename)[1].lower()
    if ext in ('.mp4', '.webm', '.mov', '.mkv', '.gif'):
        redirect_url = f"http://{target}/view?filename={_q(filename, safe='')}&subfolder={_q(subfolder, safe='')}&type={_q(type, safe='')}"
        return RedirectResponse(redirect_url, status_code=302)

    immutable_headers = {"Cache-Control": "public, max-age=2592000, immutable"}

    # === 缩略图分支:缓存命中秒出 ===
    if width > 0:
        cache_key = hashlib.sha1(
            f"comfyui|{target}|{type}|{subfolder}|{filename}|w={width}".encode("utf-8", "ignore")
        ).hexdigest()
        cache_dir = os.path.join(MEDIA_PREVIEW_DIR, "comfyui")
        webp_path = os.path.join(cache_dir, f"{cache_key}.webp")
        if os.path.exists(webp_path):
            headers = {**immutable_headers, "ETag": f'"{cache_key}"'}
            return FileResponse(webp_path, media_type="image/webp", headers=headers)

    # === 原图:302 重定向到 ComfyUI(浏览器直连,零代理开销) ===
    if width == 0:
        # 1536x2048 PNG 走代理流式传输 36s → 302 重定向直连 ComfyUI 3-5s(本地)
        from urllib.parse import quote
        redirect_url = f"http://{target}/view?filename={quote(filename, safe='')}&subfolder={quote(subfolder, safe='')}&type={quote(type, safe='')}"
        print(f"[comfyui-redirect] {filename[:40]}")
        return RedirectResponse(redirect_url, status_code=302)

    # === 缩略图:缓存未命中,下载 + 缩放 + 写 WebP 缓存 ===
    import time as _t
    _t_dl = _t.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"ComfyUI 返回 {resp.status_code}")
        _t_dl_cost = (_t.perf_counter() - _t_dl) * 1000

        _t_pil = _t.perf_counter()
        def _process_and_save():
            src = Image.open(io.BytesIO(resp.content))
            src = ImageOps.exif_transpose(src)
            has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
            if src.width > width:
                src.thumbnail((width, width), Image.BILINEAR)  # LANCZOS 最慢,BILINEAR 5-10x 更快
            out = src.convert("RGBA" if has_alpha else "RGB")
            os.makedirs(cache_dir, exist_ok=True)
            out.save(webp_path, format="WEBP", quality=88)

        await asyncio.to_thread(_process_and_save)
        _t_pil_cost = (_t.perf_counter() - _t_pil) * 1000
        print(f"[comfyui-thumb] dl={_t_dl_cost:.0f}ms pil={_t_pil_cost:.0f}ms {width}px {filename[:40]} ({len(resp.content)//1024}KB)")

        headers = {**immutable_headers, "ETag": f'"{cache_key}"'}
        return FileResponse(webp_path, media_type="image/webp", headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"生成 ComfyUI 缩略图失败: {str(e)}")






# --- 工作流管理 API ---

def _extract_workflow_meta(filepath):
    """从工作流 JSON 提取元数据：unet_name、model_folder、是否包含 UNETLoader"""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            wf = json.load(f)
    except Exception:
        return None
    unet_name = ""
    has_unet = False
    # 支持两种格式: API 格式({node_id: {class_type, inputs}}) 和 UI 格式({nodes: [...], links: [...]})
    # UI 格式下 class_type 在 nodes[].type, widgets_values 是数组,inputs 是元数据列表
    nodes_iter = None
    if isinstance(wf.get("nodes"), list):
        # UI 格式
        nodes_iter = ((n.get("id"), n) for n in wf["nodes"] if isinstance(n, dict))
    elif isinstance(wf, dict):
        # API 格式
        nodes_iter = ((nid, node) for nid, node in wf.items() if isinstance(node, dict))
    if nodes_iter is not None:
        for nid, node in nodes_iter:
            ct = node.get("class_type") or node.get("type") or ""
            if ct == "UNETLoader":
                # API: inputs.unet_name; UI: widgets_values[0]
                wv = node.get("widgets_values") or []
                inp = node.get("inputs") or {}
                if isinstance(inp, dict) and "unet_name" in inp:
                    unet_name = inp["unet_name"]
                elif wv:
                    unet_name = str(wv[0])
                if unet_name:
                    has_unet = True
                break
            if isinstance(ct, str) and "LoadDiffusionModel" in ct:
                wv = node.get("widgets_values") or []
                inp = node.get("inputs") or {}
                if isinstance(inp, dict) and "model_name" in inp:
                    unet_name = inp["model_name"]
                elif wv:
                    unet_name = str(wv[0])
                if unet_name:
                    has_unet = True
                break
    # 从 unet_name 提取文件夹前缀（第一个 \ 或 / 前的部分）
    model_folder = ""
    if unet_name:
        sep_idx = max(unet_name.find("\\"), unet_name.find("/"))
        if sep_idx > 0:
            model_folder = unet_name[:sep_idx]
    # model_folders 由 list_builtin_workflows 从 config.json 读后合并;此处先填空数组
    return {
        "unet_name": unet_name,
        "model_folder": model_folder,
        "model_folders": [],
        "has_unet": has_unet,
    }





# ==================== 海报设计 API ====================

POSTER_DATA_DIR = os.path.join(DATA_DIR)
POSTER_LAYOUT_THUMBS = os.path.join(STATIC_DIR, "images", "poster_layouts", "thumbnails")
POSTER_STYLE_THUMBS = os.path.join(STATIC_DIR, "images", "style_thumbnails")

# 100种布局名称
LAYOUT_NAMES = [
    None,
    "三分法构图","九宫格构图","黄金分割构图","对称构图","非对称构图",
    "均衡式构图","上下构图","前后构图","水平构图","垂直构图",
    "开放式构图","封闭式构图","满版构图","留白式构图","密集式构图",
    "疏朗式构图","疏密对比构图","单点构图","双点构图","多点构图",
    "S形构图","C形构图","Z形构图","V形构图","X形构图",
    "放射式构图","向心式构图","离心式构图","环绕式构图","框架式构图",
    "三角形构图","倒三角构图","圆形构图","椭圆形构图","方形构图",
    "矩形构图","菱形构图","十字构图","T形构图","L形构图",
    "单点聚焦构图","多点平衡构图","群组式构图","分组式构图","聚合式构图",
    "分散式构图","集中式构图","扩散式构图","层叠式构图","阶梯式构图",
    "重复式构图","渐变式构图","节奏式构图","韵律式构图","对比式构图",
    "呼应式构图","镜像式构图","轴线式构图","中轴构图","偏轴构图",
    "网格式构图","模块化构图","分栏式构图","分割式构图","区块式构图",
    "矩阵式构图","棋盘式构图","卡片式构图","拼贴式构图","蒙太奇构图",
    "引导线构图","透视构图","纵深构图","近大远小构图","前景构图",
    "中景构图","背景构图","层次构图","空间构图","深度构图",
    "斜线构图","曲线构图","折线构图","波浪线构图","交叉线构图",
    "平行线构图","重心构图","偏重心构图","视觉中心构图","视觉动线构图",
    "动势构图","静态构图","主次构图","开合构图","虚实构图",
    "明暗构图","色块构图","色彩对比构图","大小对比构图","动静对比构图"
]

LAYOUT_CATEGORIES = [
    {'id': '0', 'name': '🎬 电影/影视'},{'id': '1', 'name': '🎵 活动/音乐'},
    {'id': '2', 'name': '📦 产品发布'},{'id': '3', 'name': '🗺️ 旅游/目的地'},
    {'id': '4', 'name': '🎓 教育/学术'},{'id': '5', 'name': '💪 激励/励志'},
    {'id': '6', 'name': '📢 宣传/广告'},{'id': '7', 'name': '🎨 艺术/展览'}
]


def _load_layout_descriptions():
    path = os.path.join(POSTER_DATA_DIR, "layout_descriptions.json")
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def _load_poster_layouts():
    layouts = []
    descriptions = _load_layout_descriptions()
    thumb_dir = POSTER_LAYOUT_THUMBS
    thumb_files = []
    if os.path.exists(thumb_dir):
        thumb_files = sorted([f for f in os.listdir(thumb_dir) if f.endswith(('.jpg', '.jpeg'))])
    for filename in thumb_files:
        name = filename.replace('.jpg', '').replace('.jpeg', '')
        num = 0
        if name in descriptions:
            for idx, ln in enumerate(LAYOUT_NAMES):
                if ln == name:
                    num = idx
                    break
        else:
            try:
                num = int(name.replace('layout-', ''))
            except ValueError:
                continue
        if num < 1 or num >= len(LAYOUT_NAMES):
            continue
        category_idx = num % 8
        layout_name = LAYOUT_NAMES[num]
        layouts.append({
            'id': f'layout-{num}',
            'name': layout_name,
            'category': str(category_idx),
            'thumbnail': f'/static/images/poster_layouts/thumbnails/{filename}',
            'description': descriptions.get(layout_name, '')
        })
    return layouts


def _load_poster_styles():
    """海报风格与提示词库使用同一份已安装资产。"""
    from core.preset_manager import get_style_presets
    return [
        {'name': item.get('id') or item.get('name', ''),
         'name_cn': item.get('name', ''), 'prompt': item.get('prompt', ''),
         'thumbnail': item.get('thumbnail') or item.get('image') or ''}
        for category in get_style_presets().get('categories', [])
        for sub in category.get('subcategories', [])
        for item in sub.get('presets', [])
    ]


# ==================== TTS API 路由 ====================

TTS_VOICE_DIR = os.path.join(USER_DATA_DIR, "tts_voices")
CHARACTERS_DIR = os.path.join(TTS_VOICE_DIR, "characters")
VOICE_INDEX_FILE = os.path.join(TTS_VOICE_DIR, "voices.json")

TTS_WORKFLOW_DIR = os.path.join(WORKFLOW_DIR, "TTS")

# TTS 工作流模板映射
TTS_WORKFLOW_TEMPLATES = {
    "clone": "omnivoice-clone_workflow.json",
    "design": "omnivoice-design_workflow.json",
    "auto": "omnivoice-auto_workflow.json",
    "longform": "omnivoice-longform_workflow.json",
    "multi": "omnivoice-multi_workflow.json",
    "multi-2": "omnivoice-multi_workflow.json",
    "multi-3": "omnivoice-multi-3_workflow.json",
    "multi-4": "omnivoice-multi-4_workflow.json",
    "multi-5": "omnivoice-multi-5_workflow.json",
    "multi-6": "omnivoice-multi-6_workflow.json",
}

# 支持的音频格式
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'}

def _scan_character_folders() -> dict:
    """扫描当前账号的角色文件夹，自动识别音频文件"""
    voices = {}
    characters_dir = os.path.join(tts_voice_dir(), "characters")
    if not os.path.exists(characters_dir):
        return voices

    for folder_name in os.listdir(characters_dir):
        folder_path = os.path.join(characters_dir, folder_name)
        if not os.path.isdir(folder_path):
            continue
        
        # 读取 meta.json
        meta_file = os.path.join(folder_path, "meta.json")
        meta = {}
        if os.path.exists(meta_file):
            try:
                with open(meta_file, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
            except:
                pass
        
        # 自动扫描音频文件
        audio_files = []
        avatar_file = None
        for f in os.listdir(folder_path):
            ext = os.path.splitext(f)[1].lower()
            if ext in AUDIO_EXTENSIONS:
                audio_files.append(f)
            elif f.lower() in ('avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp'):
                avatar_file = f
        
        if audio_files:
            # 使用第一个音频文件
            audio_file = audio_files[0]
            display_name = meta.get('display_name', meta.get('name', folder_name))
            instruct = meta.get('instruct', '')
            category = meta.get('category', 'custom')
            
            # 构建相对于 TTS_VOICE_DIR 的文件路径
            rel_file_path = f'characters/{folder_name}/{audio_file}'
            
            voices[display_name] = {
                'file': rel_file_path,
                'folder': folder_name,
                'instruct': instruct,
                'category': category,
                'avatar': f'characters/{folder_name}/{avatar_file}' if avatar_file else None,
                'meta': meta
            }
    
    return voices

def _load_voice_index() -> dict:
    """加载音色库索引（兼容旧格式）"""
    # 优先扫描文件夹
    voices = _scan_character_folders()
    if voices:
        return voices
    
    # 回退到旧的 voices.json
    if not os.path.exists(os.path.join(tts_voice_dir(), "voices.json")):
        return {}
    try:
        with open(os.path.join(tts_voice_dir(), "voices.json"), 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def _save_voice_index(index: dict):
    """保存当前账号的音色库索引"""
    atomic_write_json(os.path.join(tts_voice_dir(), "voices.json"), index, ensure_ascii=False, indent=2)



# 缓存 animadex 角色数据
_animadex_cache = None
_animadex_cache_time = 0



# ==================== 播客文本质检 ====================
import re

def check_podcast_text(text, num_speakers=2, word_count=500):
    """检查播客文本质量,返回问题清单和自动修复后的文本"""
    issues = []
    auto_fixes = []
    lines = text.strip().split('\n')
    
    # 1. 检测非标准角色标签
    standard_pattern = re.compile(r'^\[Speaker_\d+\]:')
    name_pattern = re.compile(r'^\[([^\]]+)\]:')
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        match = name_pattern.match(line)
        if match:
            speaker = match.group(1)
            if not standard_pattern.match(line):
                issues.append(f"第{i+1}行: 角色标签 [{speaker}] 应为 [Speaker_X] 格式")
                # 自动修复：映射到标准格式
                auto_fixes.append(('fix_speaker', i, speaker))
    
    # 2. 检测括号描述
    bracket_pattern = re.compile(r'\([^)]{1,20}\)')
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        brackets = bracket_pattern.findall(line)
        if brackets:
            for b in brackets:
                # 排除正常的括号内容（如数字、网址）
                if not re.match(r'^\(\d+\)$', b) and 'http' not in b:
                    issues.append(f"第{i+1}行: 发现括号描述 {b}")
                    auto_fixes.append(('remove_bracket', i, b))
    
    # 3. 检测字数
    total_chars = sum(len(line) for line in lines if line.strip())
    if total_chars < word_count * 0.7:
        issues.append(f"字数过少: {total_chars}字 (目标{word_count}字)")
    elif total_chars > word_count * 1.3:
        issues.append(f"字数过多: {total_chars}字 (目标{word_count}字)")
    
    # 4. 检测空对话行
    for i, line in enumerate(lines):
        line = line.strip()
        if line and ']:' in line:
            content = line.split(']:', 1)[1].strip()
            if not content:
                issues.append(f"第{i+1}行: 角色标签后无内容")
                auto_fixes.append(('remove_empty', i, None))
    
    # 5. 检测连续同一角色
    last_speaker = None
    for i, line in enumerate(lines):
        line = line.strip()
        match = name_pattern.match(line)
        if match:
            speaker = match.group(1)
            if speaker == last_speaker:
                issues.append(f"第{i+1}行: 连续同一角色发言")
            last_speaker = speaker
    
    # 执行自动修复
    fixed_text = text
    if auto_fixes:
        fixed_lines = lines.copy()
        speaker_map = {}
        speaker_idx = 1
        
        for fix_type, line_idx, data in auto_fixes:
            if fix_type == 'fix_speaker':
                # 映射角色名到标准格式
                if data not in speaker_map:
                    if speaker_idx <= num_speakers:
                        speaker_map[data] = f'Speaker_{speaker_idx}'
                        speaker_idx += 1
                    else:
                        speaker_map[data] = f'Speaker_{num_speakers}'
                
                old_line = fixed_lines[line_idx]
                new_line = re.sub(r'^\[[^\]]+\]:', f'[{speaker_map[data]}]:', old_line)
                fixed_lines[line_idx] = new_line
            
            elif fix_type == 'remove_bracket':
                old_line = fixed_lines[line_idx]
                new_line = old_line.replace(data, '')
                new_line = re.sub(r'\s+', ' ', new_line).strip()
                fixed_lines[line_idx] = new_line
            
            elif fix_type == 'remove_empty':
                fixed_lines[line_idx] = ''
        
        fixed_text = '\n'.join(line for line in fixed_lines if line.strip())
    
    return {
        'issues': issues,
        'auto_fixed': len(auto_fixes) > 0,
        'fixed_text': fixed_text,
        'total_chars': total_chars,
        'needs_ai_fix': any('字数' in issue for issue in issues)
    }


def get_ai_fix_prompt(issues, text):
    """生成AI修正的提示词"""
    issues_text = '\n'.join(f'- {issue}' for issue in issues)
    return f"""请修正以下播客文本中的问题:

## 需要修正的问题
{issues_text}

## 原文
{text}

## 修正要求
1. 只修正上述问题,不要改变其他内容
2. 保持原有的对话风格和节奏
3. 角色标签必须用 [Speaker_1]: [Speaker_2]: 格式
4. 不要添加任何括号描述
5. 直接输出修正后的完整文本
"""


# ==================== AI 转播客 ====================
PODCAST_SYSTEM_PROMPT = """你是一位顶级播客内容制作人,擅长将文章转化为引人入胜的多人对话节目。

## 对话结构要求

### 开场(必须包含)
- 主持人用一句话吸引听众注意力(可以是问题、惊人事实、或悬念)
- 简要介绍本期话题和嘉宾

### 主体内容
- 将文章核心内容分解为 3-5 个话题点
- 每个话题由主持人引出,嘉宾展开讨论
- 使用自然的口语表达,避免书面语
- 适当加入:
  - 追问("这让我好奇..."、"能具体说说吗?")
  - 感叹("哇,这太有意思了!"、"原来如此!")
  - 总结("所以你的意思是..."、"换句话说...")
  - 类比("这就像..."、"打个比方...")
  - 个人经历("我之前遇到过类似的情况...")

### 结尾(必须包含)
- 总结核心观点
- 给听众一个行动建议或思考题
- 自然的结束语("感谢收听"、"下期见"等)

## 输出格式(严格遵守)

1. 角色标签必须使用: [Speaker_1]: [Speaker_2]: [Speaker_3]: 等格式
2. 不要使用人名作为标签(如 [董峥] [曾刚] 等都是错误的)
3. 不要在括号里加描述性文字(如 (回忆，语气轻快)、(声音沉稳) 等)
4. 如果需要表达语气,直接通过文字内容体现,不要加括号说明
5. 每句话直接是对话内容,不要有任何前缀或后缀说明

## 正确示例
[Speaker_1]: 大家好，欢迎来到今天的节目。
[Speaker_2]: 谢谢邀请，很高兴来到这里。
[Speaker_1]: 我们今天聊聊这个话题。

## 错误示例(不要这样写)
[主持人]: 大家好。(微笑)
[嘉宾]: (回忆) 当时我想...
[董峥]: 这个问题...

## 角色设定
- Speaker_1: 主持人,负责引导话题、提问、总结
- Speaker_2: 嘉宾,负责深入分析、提供见解
- Speaker_3: 另一位嘉宾(如果是3人以上)
"""




# ==================== 统一类型 API ====================









# Whisper ASR 模型缓存
_asr_pipeline = None


def _find_whisper_model_path():
    """在 ComfyUI audio_encoders 目录中查找已下载的 Whisper 模型"""
    # 从 .env 读取 ComfyUI 路径
    comfy_base = os.environ.get("COMFYUI_BASE_PATH", "")
    # COMFYUI_BASE_PATH 指向 models/loras,往上推到 ComfyUI 根目录
    if comfy_base:
        # H:\AI-Tools\ComfyUI-aio-V9.0\ComfyUI\models\loras -> H:\AI-Tools\ComfyUI-aio-V9.0\ComfyUI
        comfy_root = os.path.normpath(os.path.join(comfy_base, "..", ".."))
    else:
        # fallback: 从 COMFYUI_ADDRESS 推断
        comfy_root = os.path.normpath(os.path.join(os.getcwd(), ".."))

    audio_encoders_dir = os.path.join(comfy_root, "models", "audio_encoders")
    if not os.path.isdir(audio_encoders_dir):
        print(f"[ASR] audio_encoders 目录不存在: {audio_encoders_dir}")
        return None

    # 优先找 whisper-large-v3-turbo
    preferred = ["openai_whisper-large-v3-turbo", "openai_whisper-large-v3"]
    for name in preferred:
        path = os.path.join(audio_encoders_dir, name)
        if os.path.isdir(path):
            return path

    # 找任意 whisper 模型
    for entry in os.listdir(audio_encoders_dir):
        if "whisper" in entry.lower():
            path = os.path.join(audio_encoders_dir, entry)
            if os.path.isdir(path):
                return path

    print(f"[ASR] 未找到 Whisper 模型,请将模型放到: {audio_encoders_dir}")
    return None


def _get_asr_pipeline():
    """懒加载 Whisper ASR pipeline(单例,从 ComfyUI 路径加载)"""
    global _asr_pipeline
    if _asr_pipeline is not None:
        return _asr_pipeline

    model_path = _find_whisper_model_path()
    if not model_path:
        raise RuntimeError("未找到 Whisper 模型,请先在 ComfyUI 中加载一次 OmniVoice 工作流以触发模型下载")

    import torch
    from transformers import pipeline as hf_pipeline
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    _asr_pipeline = hf_pipeline(
        "automatic-speech-recognition",
        model=model_path,
        device=device,
        torch_dtype=dtype,
    )
    print(f"[ASR] Whisper 模型加载完成: {model_path} (device={device})")
    return _asr_pipeline





async def _tts_generate_inner(request: Request, token: str):
    """TTS 生成核心逻辑"""
    # 解析 multipart form data
    form = await request.form()
    text = form.get("text", "")
    mode = form.get("mode", "clone")

    # 调试日志
    username = get_username_by_token(token)
    print(f"[TTS] token={token[:10] if token else 'None'}..., username={username}, mode={mode}")
    instruct = form.get("instruct", "")
    ref_text = form.get("ref_text", "")
    speed = float(form.get("speed", 1.0))
    steps = int(form.get("steps", 32))
    guidance_scale = float(form.get("guidance_scale", 2.0))
    seed = int(form.get("seed", 0))
    language = form.get("language", "")
    audio_format = form.get("audio_format", "wav")
    sample_rate = int(form.get("sample_rate", 24000))
    t_shift = float(form.get("t_shift", 0.1))
    position_temperature = float(form.get("position_temperature", 5.0))
    class_temperature = float(form.get("class_temperature", 0.0))
    layer_penalty_factor = float(form.get("layer_penalty_factor", 5.0))
    duration_raw = form.get("duration")
    duration = float(duration_raw) if duration_raw else None
    denoise = str(form.get("denoise", "false")).lower() in ("true", "1", "yes")
    normalize = str(form.get("normalize", "false")).lower() in ("true", "1", "yes")
    preprocess = str(form.get("preprocess", "false")).lower() in ("true", "1", "yes")
    postprocess = str(form.get("postprocess", "false")).lower() in ("true", "1", "yes")
    save_prefix = form.get("save_prefix", "tts")
    # 多人对话参数
    num_speakers = int(form.get("num_speakers", 2))
    pause_between_speakers = float(form.get("pause_between_speakers", 0.3))

    username = get_username_by_token(token)

    # 校验模式
    if mode not in TTS_WORKFLOW_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"不支持的模式: {mode}")

    # 自动判断模式:clone 模式根据字数自动选择工作流
    actual_mode = mode
    if mode == "clone":
        text_length = len(text.strip())
        if text_length > 600:
            actual_mode = "longform"
            print(f"[TTS] 文本较长({text_length}字),自动切换到长文本模式")
        else:
            actual_mode = "clone"
            print(f"[TTS] 文本较短({text_length}字),使用声音克隆模式")
    else:
        actual_mode = mode

    # 如果 seed 为 0 (随机),生成一个固定 seed 确保音色一致
    if seed == 0:
        import random
        seed = random.randint(1, 999999999)
        print(f"[TTS] 使用随机 seed: {seed}")

    # 加载工作流模板
    # 多人对话模式:根据说话人数量选择对应模板
    if mode == "multi":
        workflow_key = f"multi-{num_speakers}"
        if workflow_key in TTS_WORKFLOW_TEMPLATES:
            workflow_name = TTS_WORKFLOW_TEMPLATES[workflow_key]
        else:
            # 默认使用 2 人模板
            workflow_name = TTS_WORKFLOW_TEMPLATES["multi-2"]
    else:
        workflow_name = TTS_WORKFLOW_TEMPLATES[actual_mode]

    workflow_path = os.path.join(TTS_WORKFLOW_DIR, workflow_name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail=f"工作流模板不存在: {workflow_name}")

    with open(workflow_path, 'r', encoding='utf-8') as f:
        workflow = json.load(f)

    # 上传参考音频到 ComfyUI(如果有)
    ref_audio_filename = ""
    ref_audio = form.get("ref_audio")
    if ref_audio and hasattr(ref_audio, 'read') and mode in ("clone", "longform"):
        content = await ref_audio.read()
        ref_audio_filename = f"tts_ref_{int(time.time())}_{ref_audio.filename or 'audio.wav'}"
        target = COMFYUI_ADDRESS
        if target:
            try:
                files_data = {'image': (ref_audio_filename, content, ref_audio.content_type or 'audio/wav')}
                requests.post(f"http://{target}/upload/image", files=files_data, timeout=10)
            except Exception as e:
                print(f"[TTS] 上传参考音频失败: {e}")

    # 多人对话:上传每个说话人的音频
    speaker_audio_filenames = {}
    if mode == "multi":
        target = COMFYUI_ADDRESS
        print(f"[TTS-Multi] num_speakers={num_speakers}, target={target}")
        for i in range(1, num_speakers + 1):
            spk_audio = form.get(f"speaker_{i}_audio")
            spk_ref_text = form.get(f"speaker_{i}_ref_text", "")
            spk_instruct = form.get(f"speaker_{i}_instruct", "")
            print(f"[TTS-Multi] speaker_{i}: audio={spk_audio}, type={type(spk_audio)}, has_read={hasattr(spk_audio, 'read') if spk_audio else False}")
            if spk_audio and hasattr(spk_audio, 'read'):
                content = await spk_audio.read()
                fname = f"tts_spk{i}_{int(time.time())}_{spk_audio.filename or 'audio.wav'}"
                speaker_audio_filenames[i] = {
                    "filename": fname,
                    "ref_text": spk_ref_text,
                    "instruct": spk_instruct,
                }
                print(f"[TTS-Multi] speaker_{i}: uploaded filename={fname}, size={len(content)} bytes")
                if target:
                    try:
                        files_data = {'image': (fname, content, spk_audio.content_type or 'audio/wav')}
                        resp = requests.post(f"http://{target}/upload/image", files=files_data, timeout=10)
                        print(f"[TTS-Multi] speaker_{i}: upload response={resp.status_code} {resp.text[:200]}")
                    except Exception as e:
                        print(f"[TTS-Multi] speaker_{i}: upload FAILED: {e}")
            else:
                speaker_audio_filenames[i] = {
                    "filename": "",
                    "ref_text": spk_ref_text,
                    "instruct": spk_instruct,
                }
                print(f"[TTS-Multi] speaker_{i}: NO AUDIO FILE")

    # 替换工作流中的变量
    # 查找关键节点并替换参数
    for node_id, node_content in workflow.items():
        if not isinstance(node_content, dict):
            continue
        inputs = node_content.get("inputs", {})
        class_type = node_content.get("class_type", "")

        # OmniVoice TTS 节点
        if class_type in ("OmniVoiceVoiceCloneTTS", "OmniVoiceLongformTTS"):
            inputs["text"] = text
            inputs["instruct"] = instruct
            inputs["speed"] = speed
            inputs["steps"] = steps
            inputs["guidance_scale"] = guidance_scale
            inputs["t_shift"] = t_shift
            inputs["position_temperature"] = position_temperature
            inputs["class_temperature"] = class_temperature
            inputs["layer_penalty_factor"] = layer_penalty_factor
            inputs["denoise"] = denoise
            inputs["preprocess_prompt"] = preprocess
            inputs["postprocess_output"] = postprocess
            inputs["seed"] = seed if seed > 0 else 0
            if duration is not None:
                inputs["duration"] = duration
            if mode in ("clone", "longform") and ref_text:
                inputs["ref_text"] = ref_text

        # OmniVoice VoiceDesign TTS 节点(智能配音)
        if class_type == "OmniVoiceVoiceDesignTTS":
            inputs["text"] = text
            # 智能配音模式:如果没有 instruct,使用默认值
            if mode == "design" and not instruct:
                inputs["voice_instruct"] = "female, moderate pitch"  # 默认:女声,中音调
            else:
                inputs["voice_instruct"] = instruct
            inputs["speed"] = speed
            inputs["steps"] = steps
            inputs["guidance_scale"] = guidance_scale
            inputs["t_shift"] = t_shift
            inputs["position_temperature"] = position_temperature
            inputs["class_temperature"] = class_temperature
            inputs["layer_penalty_factor"] = layer_penalty_factor
            inputs["denoise"] = denoise
            inputs["postprocess_output"] = postprocess
            inputs["seed"] = seed if seed > 0 else 0
            if duration is not None:
                inputs["duration"] = duration

        # OmniVoiceMultiSpeakerTTS 节点
        if class_type == "OmniVoiceMultiSpeakerTTS":
            inputs["text"] = text
            inputs["num_speakers"] = num_speakers
            inputs["speed"] = speed
            inputs["steps"] = steps
            inputs["guidance_scale"] = guidance_scale
            inputs["t_shift"] = t_shift
            inputs["position_temperature"] = position_temperature
            inputs["class_temperature"] = class_temperature
            inputs["layer_penalty_factor"] = layer_penalty_factor
            inputs["denoise"] = denoise
            inputs["preprocess_prompt"] = preprocess
            inputs["postprocess_output"] = postprocess
            inputs["seed"] = seed if seed > 0 else 0
            inputs["pause_between_speakers"] = pause_between_speakers
            if duration is not None:
                inputs["duration"] = duration
            # 说话人参数放在顶层(V2 风格,兼容修改后的节点)
            for i in range(1, num_speakers + 1):
                spk = speaker_audio_filenames.get(i, {})
                inputs[f"speaker_{i}_ref_text"] = spk.get("ref_text", "")
                inputs[f"speaker_{i}_instruct"] = spk.get("instruct", "")
            print(f"[TTS-Multi] MultiSpeakerTTS: text={text[:50]}..., num_speakers={num_speakers}")
            print(f"[TTS-Multi] speaker_audio_filenames={json.dumps({k: v['filename'] for k, v in speaker_audio_filenames.items()})}")

        # LoadAudio 节点(参考音频 - 单人模式)
        if class_type == "LoadAudio" and ref_audio_filename and node_id == "5":
            inputs["audio"] = ref_audio_filename

        # LoadAudio 节点(多人对话 - 说话人音频)
        if class_type == "LoadAudio" and mode == "multi":
            title = node_content.get("_meta", {}).get("title", "")
            matched = False
            for i in range(1, num_speakers + 1):
                if f"说话人{i}" in title and i in speaker_audio_filenames:
                    fname = speaker_audio_filenames[i].get("filename")
                    if fname:
                        inputs["audio"] = fname
                    matched = True
                    print(f"[TTS-Multi] LoadAudio node '{title}' (id={node_id}) -> speaker_{i} filename='{fname}'")
                    break
            if not matched:
                print(f"[TTS-Multi] LoadAudio node '{title}' (id={node_id}) NOT MATCHED")

    # 提交到 ComfyUI
    generate_req = GenerateRequest(
        prompt=text,
        workflow_data=workflow,
        params={
            "denoise": denoise,
            "normalize": normalize,
            "preprocess": preprocess,
            "postprocess": postprocess,
            "save_prefix": save_prefix,
            "mode": mode,
            "actual_mode": actual_mode,  # 实际使用的工作流模式
            "instruct": instruct,
            "duration": duration,
        },
        type="tts",
        client_id="",
    )

    result = generate(generate_req, token=token)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return result


# ==================== 素材库 API 路由 ====================

# --- 本地素材 API ---


# --- 提示词库 API ---


# --- 共享文件夹 API ---


# --- 服务静态文件(上传素材) ---


# --- 智能画布分组导出 API ---



# --- 画布工作流辅助函数 ---

def canvas_workflow_collect_resource_refs(value, found=None):
    if found is None:
        found = []
    if isinstance(value, dict):
        for item in value.values():
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, list):
        for item in value:
            canvas_workflow_collect_resource_refs(item, found)
    elif isinstance(value, str):
        text = value.strip()
        if (text.startswith("/assets/") or text.startswith("/output/")) and output_file_from_url(text):
            found.append(text)
    return found

def canvas_workflow_unique_archive_name(base, used):
    safe = sanitize_export_filename(base, "resource.bin")
    name, ext = os.path.splitext(safe)
    archive = safe
    idx = 2
    while archive in used:
        archive = f"{name}-{idx}{ext}"
        idx += 1
    used.add(archive)
    return archive

def canvas_workflow_replace_strings(value, mapping):
    if isinstance(value, dict):
        return {k: canvas_workflow_replace_strings(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [canvas_workflow_replace_strings(item, mapping) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value

def canvas_workflow_payload(nodes, connections, resources=None):
    return {
        "format": "infinite-canvas-workflow",
        "version": 1,
        "exported_at": now_ms(),
        "nodes": nodes or [],
        "connections": connections or [],
        "resources": resources or [],
    }

def build_canvas_workflow_archive(payload: CanvasWorkflowExportRequest) -> Tuple[bytes, Dict[str, Any]]:
    nodes_payload = payload.nodes or []
    connections_payload = payload.connections or []
    if not nodes_payload:
        raise HTTPException(status_code=400, detail="没有可导出的节点")
    buffer = BytesIO()
    resources = []
    used = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if payload.include_resources:
            for url in canvas_workflow_collect_resource_refs(nodes_payload):
                if any(item.get("url") == url for item in resources):
                    continue
                path = output_file_from_url(url)
                if not path or not os.path.isfile(path):
                    continue
                archive_name = canvas_workflow_unique_archive_name(os.path.basename(path), used)
                archive_path = f"resources/{archive_name}"
                zf.write(path, archive_path)
                resources.append({
                    "url": url,
                    "archive": archive_path,
                    "name": os.path.basename(path),
                    "size": os.path.getsize(path),
                })
        workflow = canvas_workflow_payload(nodes_payload, connections_payload, resources)
        zf.writestr("workflow.json", json.dumps(workflow, ensure_ascii=False, indent=2))
    buffer.seek(0)
    return buffer.getvalue(), {"resources": resources, "node_count": len(nodes_payload), "connection_count": len(connections_payload)}

# --- 媒体预览 API ---


# --- RunningHub API ---

# --- 画布工作流 API ---


# ============ Ideogram4 结构化 JSON 提示词生成 ============
IDEOGRAM4_JSON_SYSTEM_PROMPT = """你是 Ideogram4 结构化 JSON 提示词生成器。根据用户创意描述与目标画面比例，输出一个简洁、稳定、可直接传给 Ideogram4PromptBuilderKJ 的 JSON 对象。

## 输出要求

只输出单行 JSON，不要 markdown，不要解释，不要代码块。

必须输出以下结构：

{"aspect_ratio":"{{width}}:{{height}}","high_level_description":"...","style_description":{"aesthetics":"...","lighting":"...","medium":"...","photo":"...","art_style":"...","color_palette":["#RRGGBB","#RRGGBB","#RRGGBB"]},"compositional_deconstruction":{"background":"...","elements":[{"type":"obj","bbox":[y1,x1,y2,x2],"desc":"..."}]}}

## 字段规则

- `aspect_ratio`：固定使用用户提供的宽高比。
- `high_level_description`：一句完整英文图像描述，50词以内。
- `style_description`：基础风格信息，所有字段都必须存在。
  - `aesthetics`：3-6个英文关键词，例如 cinematic, warm, minimal, dreamy。
  - `lighting`：3-6个英文关键词，例如 soft light, golden hour, studio lighting。
  - `medium`：3-6个英文关键词，例如 photograph, digital art, illustration, 3D render。
  - `photo`：如果是摄影类，填写镜头、景深、胶片等关键词；非摄影类填空字符串 `""`。
  - `art_style`：如果是插画/绘画/3D类，填写艺术风格；摄影类填空字符串 `""`。
  - `color_palette`：3-5个大写十六进制颜色。
- `compositional_deconstruction.background`：用英文描述背景环境。
- `compositional_deconstruction.elements`：1-3个主要元素，每个元素必须有 `type`、`bbox`、`desc`。
- `bbox` 顺序固定为 `[y1,x1,y2,x2]`，基于目标画面宽高。坐标必须为整数。
- 不要输出超过 3 个元素。
- 不要使用单引号作为 JSON 字符串边界。
- 不要输出尾随逗号。
- 所有字符串必须合法 JSON 转义。
"""


class Ideogram4JsonRequest(BaseModel):
    prompt: str
    width: int = 1024
    height: int = 1024
    provider: str = ""
    model: str = ""




# === 随机源管理 API ===

# 导入随机源管理器
try:
    from core.random_source import get_manager
    random_manager = get_manager()
    print("[RandomSource] 随机源管理器已注册（数据懒加载，首次调用时解析）")
except Exception as e:
    print(f"[RandomSource] 加载失败: {e}")
    random_manager = None




# ================= 通用反推提示词模块 (Interrogator) =================
# 对外只暴露 image / mode / target_style / provider,屏蔽 ComfyUI 与多模态 API 细节。
# 文生图 / 图生图 / LoRA 标注 / 参考图分析 等任意功能均可复用 /api/interrogate。

INTERROGATE_WF = "提示词/图片反推-Qwen3提示词.json"   # ComfyUI 本地 Qwen3-VL 反推工作流
INTERROGATE_LOAD_NODE = "22"        # LoadImage 节点(参考图)
INTERROGATE_PROMPT_NODE = "20"      # Qwen3_VQA 节点(inputs.text 注入模式提示词)
INTERROGATE_OUTPUT_NODE = "19"      # ShowText 输出节点(同时 23.easy saveText 也保存)

_INTERROGATE_MODE_PROMPTS = {
    "tags": "用 Danbooru 英文标签描述这张图,逗号分隔,只输出标签,不要句子和解释。",
    "caption": "用一段英文描述这张图,包含主体、场景、光线、镜头与画风,只输出描述。",
    "vl": "作为提示词工程师,输出一段高质量英文 T2I 提示词,包含主体、细节、风格、光线、构图,只输出提示词。",
}


def _interrogate_prompt_for(mode, target_style, custom_rule=""):
    p = _INTERROGATE_MODE_PROMPTS.get(mode, _INTERROGATE_MODE_PROMPTS["caption"])
    # 用户自定义反推规则优先：完全接管"如何反推这张图"的指令（快速版）
    if custom_rule and custom_rule.strip():
        p = custom_rule.strip()
    if target_style:
        p += f"\n目标风格参考: {target_style}。"
    return p


def _ui_workflow_to_api_prompt(wf_ui):
    """把前端 UI 格式的 ComfyUI 工作流 JSON( nodes 列表 + links + groups )
    转换为 /prompt API 接受的格式( {node_id: {class_type, inputs}} )。

    转换规则:
      - class_type = node.type
      - inputs 合并 widgets_values(按 widget 字段顺序)与原 inputs(优先取非空值)
      - 忽略 inputs 列表中的元数据( label / widget / type / shape / link )
      - 处理 nodes[].inputs[] 里 shape:7(隐式输入)→ 不写进 API
    """
    nodes = wf_ui.get("nodes") or []
    out = {}
    # 1. 收集 links: link_id -> [from_node, from_slot]
    link_map = {}  # link_id -> (src_node_id, src_slot)
    for ln in wf_ui.get("links") or []:
        # 新格式: [id, src_node, src_slot, dst_node, dst_slot, type]
        if isinstance(ln, (list, tuple)) and len(ln) >= 5:
            link_map[ln[0]] = (str(ln[1]), ln[2])
    for n in nodes:
        nid = str(n.get("id"))
        ntype = n.get("type") or n.get("class_type")
        if not ntype:
            continue
        # 跳过纯注释/装饰节点（仅在工作流画布上显示，不参与执行）
        if ntype in ("MarkdownNote", "Note"):
            continue
        api_inputs = {}
        # 1) 处理显式 inputs 列表
        for inp in (n.get("inputs") or []):
            if not isinstance(inp, dict):
                continue
            iname = inp.get("name")
            if not iname:
                continue
            # 跳过 shape:7 (隐式输入) 和 link-only (这些由 links 数组管)
            # 但保留 widget 字段(它们的值在 widgets_values 中)
            if inp.get("shape") == 7:
                continue
            # 已有 link 引用 (新格式 inputs 列表里也直接含 link?)
            if "link" in inp and inp["link"] is not None:
                src = link_map.get(inp["link"])
                if src:
                    api_inputs[iname] = [src[0], src[1]]
                continue
            # widget 字段：值来自 widgets_values
            if "widget" in inp:
                continue
        # 2) widgets_values 按顺序填入 widget 字段
        #    widget 字段顺序来自 inputs[].name (按 inputs 列表里的 widget.name 排序)
        widget_fields = [inp["name"] for inp in (n.get("inputs") or [])
                        if isinstance(inp, dict) and inp.get("widget")]
        wv = n.get("widgets_values") or []
        for i, fname in enumerate(widget_fields):
            if i < len(wv):
                # 修复: Qwen3_VQA widgets_values[10] = "fixed" 不是合法值
                if ntype == "Qwen3_VQA" and fname == "attention" and wv[i] == "fixed":
                    api_inputs[fname] = "eager"
                else:
                    api_inputs[fname] = wv[i]
        # 3) 走一遍原 inputs 里的 link 字段 (某些节点 inputs 同时含 widget 标记 + link)
        #    如果还没填入,从 links 补
        #    边界情况: widget 填了空值(wv 丢失) 但 link 有效,应优先 link (链路指向其他节点输出)
        for inp in (n.get("inputs") or []):
            if not isinstance(inp, dict):
                continue
            iname = inp.get("name")
            if not iname:
                continue
            if "link" in inp and inp["link"] is not None:
                src = link_map.get(inp["link"])
                if src and (iname not in api_inputs or api_inputs.get(iname) in ("", None)):
                    api_inputs[iname] = [src[0], src[1]]
                continue
        out[nid] = {"class_type": ntype, "inputs": api_inputs}
    return out


async def _interrogate_via_comfyui(abs_path, mode, target_style, emit=None, custom_rule=""):
    """ComfyUI 路线:上传图 -> 注入反推工作流 -> 轮询 history -> 取 ShowText 文本。
    emit(pct, stage): 可选异步回调,用于实时上报真实进度(ComfyUI 采样进度来自 websocket)。"""
    if not COMFYUI_ADDRESS:
        raise RuntimeError("未配置 ComfyUI 地址")
    prompt_text = _interrogate_prompt_for(mode, target_style, custom_rule)
    wf_path = os.path.join(WORKFLOW_DIR, INTERROGATE_WF)
    if not os.path.exists(wf_path):
        raise RuntimeError(f"反推工作流不存在: {INTERROGATE_WF}")
    with open(wf_path, 'r', encoding='utf-8') as f:
        wf_ui = json.load(f)
    # 把前端 UI 格式工作流( nodes 列表 ) 转换为 ComfyUI /prompt API 格式
    # ( {node_id: {class_type, inputs}} )，包括 widgets_values → inputs、links → 节点引用
    wf = _ui_workflow_to_api_prompt(wf_ui)
    with open(abs_path, 'rb') as fb:
        content = fb.read()
    ctype = content_type_for_path(abs_path)
    up = await asyncio.to_thread(
        requests.post,
        f"http://{COMFYUI_ADDRESS}/upload/image",
        files={'image': ('interrogate.png', content, ctype)},
        timeout=30,
    )
    up.raise_for_status()
    up_data = up.json()
    filename = up_data.get('filename') or up_data.get('name')
    if not filename:
        raise RuntimeError("图片上传到 ComfyUI 失败")
    if emit:
        await emit(22, "图片已上传 ComfyUI,等待推理…")
    if INTERROGATE_LOAD_NODE in wf:
        wf[INTERROGATE_LOAD_NODE]["inputs"]["image"] = filename
    if INTERROGATE_PROMPT_NODE in wf:
        # Qwen3_VQA 节点 inputs.text 默认来自工作流 widgets_values[0]
        # (工作流作者写的中文"专业提示词工程师"系统提示词)
        # mode != "caption" 时,我们用 mode 派生的指令覆盖默认 prompt
        # mode == "caption" 时,保留工作流默认的优质中文反推 prompt
        # target_style 始终追加(在 caption 模式追加到工作流默认后)
        if mode == "caption":
            # 保留工作流内置 prompt,只追加 target_style
            if target_style and wf[INTERROGATE_PROMPT_NODE]["inputs"].get("text"):
                wf[INTERROGATE_PROMPT_NODE]["inputs"]["text"] += f"\n目标风格参考: {target_style}。"
        else:
            # tags / vl 模式:用 mode 派生 prompt 完全覆盖
            wf[INTERROGATE_PROMPT_NODE]["inputs"]["text"] = prompt_text
    pr = await asyncio.to_thread(
        requests.post,
        f"http://{COMFYUI_ADDRESS}/prompt",
        json={"prompt": wf, "client_id": CLIENT_ID},
        timeout=60,
    )
    if pr.status_code != 200:
        # 抓取 ComfyUI 返回的校验细节(含 node_errors / value_not_in_list 等),便于定位
        _detail = pr.text
        try:
            _detail = pr.json().get("error", {}).get("message") or _detail
        except Exception:
            pass
        raise RuntimeError(f"ComfyUI 提交被拒绝({pr.status_code}): {_detail[:600]}")
    prompt_id = pr.json().get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI 未返回 prompt_id")
    if emit:
        await emit(35, "已提交推理队列,模型推理中…")
    # 真实进度:监听 ComfyUI websocket 的 progress / executing 事件,映射到 35%~92%
    ws_task = None
    if emit:
        async def _ws_listen():
            try:
                ws_url = f"ws://{COMFYUI_ADDRESS}/ws?clientId={CLIENT_ID}"
                async with ws_client.connect(ws_url) as sock:
                    async for raw in sock:
                        try:
                            if isinstance(raw, bytes):
                                raw = raw.decode('utf-8', errors='replace')
                            msg = json.loads(raw)
                        except Exception:
                            continue
                        if msg.get('type') == 'status':
                            continue
                        data = msg.get('data') or {}
                        pid = data.get('prompt_id')
                        # 仅采纳本 prompt 的进度;无 prompt_id 的消息跳过,避免误用其他任务进度
                        if pid != prompt_id:
                            continue
                        if msg.get('type') == 'progress':
                            val = data.get('value', 0)
                            mx = data.get('max', 100)
                            pct = 35 + round((val / max(mx, 1)) * 57)
                            await emit(min(92, pct), "模型推理中…")
                        elif msg.get('type') == 'executing':
                            if data.get('node') is None:
                                await emit(92, "推理完成,读取结果…")
            except Exception:
                pass
        ws_task = asyncio.create_task(_ws_listen())
    poll_start = time.monotonic()
    history_data = None
    while True:
        res = await asyncio.to_thread(get_comfy_history, COMFYUI_ADDRESS, prompt_id)
        if prompt_id in res:
            history_data = res[prompt_id]
            break
        if time.monotonic() - poll_start > 300:
            raise RuntimeError("ComfyUI 反推超时")
        await asyncio.sleep(0.5)
    if ws_task:
        ws_task.cancel()
    if emit:
        await emit(96, "正在读取结果…")
    output_text = ""
    if isinstance(history_data, dict) and 'outputs' in history_data:
        for _nid, node_out in history_data['outputs'].items():
            if isinstance(node_out, dict) and 'text' in node_out:
                tv = node_out['text']
                # ComfyUI 输出可能是嵌套 list: [[["text1", "text2"]]] (节点输出列表 → slot 列表 → 文本列表)
                # 递归展平,把所有字符串元素拼起来
                def _flatten(v):
                    if isinstance(v, list):
                        for x in v:
                            yield from _flatten(x)
                    else:
                        yield v
                strings = [str(s) for s in _flatten(tv) if s is not None]
                output_text = '\n'.join(strings)
                break
    if not output_text:
        raise RuntimeError("ComfyUI 未返回文本输出")
    return output_text.strip()


async def _interrogate_via_vision(abs_path, mode, target_style, emit=None, provider_id=None, custom_rule=""):
    """多模态大模型 API 路线:复用已有的 caption_image_with_provider。
    provider_id 缺省时自动选一个已配 key 的可用 chat provider(与「AI 提示词」同一套 API)。"""
    prompt_text = _interrogate_prompt_for(mode, target_style, custom_rule)
    pid = provider_id or get_vision_provider_id()
    if emit:
        await emit(30, "正在调用多模态模型…")
    text, _model = await caption_image_with_provider(
        abs_path, prompt_text, pid, ""
    )
    return (text or "").strip()




# ─── P2 路由拆分接入（2026-10-22）────────────────────────────────────
# 注册顺序：auth → canvases → comfyui → jimeng → runninghub → tts → workflows → assets → config
# 接在全部定义之后：main.py 内剩余同名路由先注册、优先匹配，线上行为不变。
# 注意：变量名必须与 routers/ 文件 stem 一致，tests/test_route_inventory.py 的
#       静态分析依赖该约定统计已接入 router 的路由多重集。
#
# 脚本直跑兼容（2026-10-22 修复）：`python main.py` 时本模块名是 __main__，
# 而 routers/*.py 用 `import main as _main` 做惰性依赖。若不登记别名，会重新
# 执行一遍 main.py 生成第二个 'main' 模块（日志重复打印、路由重复注册），
# 且第二遍执行到本行时 routers 包仍半初始化 → AttributeError: no attribute 'routes'。
# 必须先于下面这行 import 执行。
# --- 翻译缓存 / 用户提示词词典（被 routers/translate.py、routers/prompt_dict.py 通过 _main 引用，需留在 main） ---
TRANSLATE_CONFIG_FILE = os.path.join(USER_DATA_DIR, "translate-config.json")

# 翻译结果缓存: key="text||direction" → {result, ts}
_TRANSLATE_CACHE = {}
_TRANSLATE_CACHE_MAX = 500
_TRANSLATE_CACHE_TTL = 3600  # 1 小时

def _translate_cache_key(text: str, direction: str) -> str:
    return f"{text}||{direction}"

def _translate_cache_get(text: str, direction: str):
    key = _translate_cache_key(text, direction)
    entry = _TRANSLATE_CACHE.get(key)
    if entry and (time.time() - entry["ts"]) < _TRANSLATE_CACHE_TTL:
        return entry["result"]
    return None

def _translate_cache_set(text: str, direction: str, result: str):
    key = _translate_cache_key(text, direction)
    # 满了就淘汰最老的
    if len(_TRANSLATE_CACHE) >= _TRANSLATE_CACHE_MAX:
        oldest_key = min(_TRANSLATE_CACHE, key=lambda k: _TRANSLATE_CACHE[k]["ts"])
        del _TRANSLATE_CACHE[oldest_key]
    _TRANSLATE_CACHE[key] = {"result": result, "ts": time.time()}

def load_translate_config():
    default = {
        "provider_type": "ai",
        "baidu_app_id": "",
        "baidu_secret_key": "",
        "ai_provider_id": "",
        "ai_model": "",
        "ai_prompt_template": "将以下提示词翻译成目标语言,保持提示词风格和意图,只输出翻译结果,不要任何解释:\n\n{text}",
        "source_lang": "zh",
        "target_lang": "en",
    }
    if os.path.exists(TRANSLATE_CONFIG_FILE):
        try:
            with open(TRANSLATE_CONFIG_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
                default.update(saved)
        except Exception:
            pass
    return default

def save_translate_config(cfg):
    os.makedirs(os.path.dirname(TRANSLATE_CONFIG_FILE), exist_ok=True)
    atomic_write_json(TRANSLATE_CONFIG_FILE, cfg, ensure_ascii=False, indent=2)


# --- 用户提示词字典 ---

USER_PROMPT_DICT_FILE = os.path.join(USER_DATA_DIR, "user-prompt-dict.json")

def load_user_prompt_dict() -> dict:
    path = user_prompt_dict_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"zh2en": {}, "en2zh": {}}

def save_user_prompt_dict(data: dict):
    path = user_prompt_dict_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    atomic_write_json(path, data, ensure_ascii=False, indent=2)

# --- online 生成公共模型/助手（被 routers/canvas_tasks.py 等通过 _main 引用，需留在 main） ---
async def build_online_image_result(payload: OnlineImageRequest, username: str = None, on_progress=None):
    provider_id = payload.provider_id or "comfly"
    prov = _resolve_image_provider(provider_id)
    model = selected_model(payload.model, (prov["image_models"] or [IMAGE_MODEL])[0])
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    mode = normalize_image_request_mode(payload.image_request_mode or prov.get("image_request_mode", "openai"))
    print(f"[online-image] provider={provider_id} model={model} size={payload.size} mode={mode}")
    if on_progress:
        on_progress({'source': 'local', 'stage': 'awaiting_provider', 'progress': None})
    try:
        image_data, raw = await generate_ai_image(payload.prompt, payload.size, payload.quality, model, refs, protocol=payload.protocol, provider_id=provider_id, provider=prov, image_request_mode=mode, generation_params=payload.generation_params, on_progress=on_progress)
        if on_progress:
            on_progress({'source': 'local', 'stage': 'saving', 'progress': None})
        # 落盘交给 media_paths：output/{owner}/{type}/{feature}/{date}/
        online_feature = (payload.feature or "").strip() or "online"
        local_url = await save_ai_image_to_output(image_data, prefix="online_", username=username, feature=online_feature)
        local_images = [local_url]
        for extra_image in raw.get("_webai_images", [])[1:]:
            local_images.append(await save_ai_image_to_output(extra_image, prefix="online_", username=username, feature=online_feature))
    except httpx.HTTPStatusError as exc:
        text = exc.response.text or ''
        friendly = None
        m = re.search(r"longest edge must be less than or equal to (\d+)", text)
        if m:
            limit = m.group(1)
            friendly = f"该模型不支持当前分辨率:最长边超过 {limit}px。请把图片分辨率调低(例如换到 2K 或更小),或更换支持高分辨率的模型。"
        elif "Invalid size" in text or "invalid_value" in text:
            friendly = f"该模型不支持当前尺寸:{payload.size}。请尝试更换分辨率或模型。"
        elif "queue is full" in text.lower():
            friendly = "生图排队已满，请稍后再试。"
        elif "rate limit" in text.lower() or "429" in text:
            friendly = "请求过于频繁,已被上游限流,请稍后再试。"
        elif "Authentication failed" in text or "valid ModelScope token" in text or "Unauthorized" in text or "invalid api key" in text.lower():
            friendly = "这把 API Key 被平台拒绝了。模型列表不校验 Key，请到「API 设置」重新复制 Access Token 并保存。"
        else:
            message = re.search(r'"message"\s*:\s*"([^"]+)"', text)
            if message:
                friendly = message.group(1)
        # ModelScope 任务查询 404 → 更友好的提示
        if exc.response.status_code == 404 and payload.provider_id in ("modelscope", "ms"):
            friendly = friendly or "ModelScope 模型接口未返回预期结果。请确认 API Key 有效，或尝试更换模型（部分模型可能不通过在线生图接口提供）。"
        raise HTTPException(status_code=502 if exc.response.status_code in (404, 502) else exc.response.status_code, detail=friendly or text) from exc
    except (httpx.RemoteProtocolError, httpx.ReadTimeout) as exc:
        raise HTTPException(status_code=502, detail="上游服务器连接异常或响应超时：模型生成耗时过长，请稍后重试或更换模型。") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败:{exc}") from exc
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        raise HTTPException(status_code=getattr(exc, "status_code", 500), detail=str(detail)) from exc
    return {
        "prompt": payload.prompt,
        "images": local_images,
        "timestamp": time.time() * 1000,
        "type": feature if feature else "online",
        "model": model,
        "provider_id": provider_id,
        "protocol": prov["protocol"],
        "params": {"model": model, "size": payload.size, "quality": payload.quality, "reference_images": refs, "provider_id": provider_id},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }








class ImageTaskQueryRequest(BaseModel):
    provider_id: str = ""
    task_id: str = ""
    model: str = ""

import sys as _sys
_sys.modules.setdefault("main", _sys.modules[__name__])

from routers import auth, canvases, comfyui, jimeng, runninghub, tts, workflows, assets, config
from routers import random_sources, wildcards
from routers import prompt_libraries, shared_folders
from routers import lora_manager, poster, translate, prompt_dict
from routers import chat, history, gallery, smart_prompt, angle, modelscope
from routers import presets, output_ops, canvas_tasks, cli_tools, lora_scan
from routers import asset_library, static_files, canvas_workflows, smart_canvas
from routers import ms_generate
from routers import canvas_comfy, proxy_download, workflows_legacy, animadex, characters, artists
from routers import media_ops, ideogram4, restart, interrogate
from routers import online_gen, output_zip, user_assets
from routers import training

app.include_router(auth)
app.include_router(canvases)
app.include_router(comfyui)
app.include_router(jimeng)
app.include_router(runninghub)
app.include_router(tts)
app.include_router(workflows)
app.include_router(assets)
app.include_router(config)
app.include_router(random_sources)
app.include_router(wildcards)
app.include_router(prompt_libraries)
app.include_router(shared_folders)
app.include_router(lora_manager)
app.include_router(poster)
app.include_router(translate)
app.include_router(prompt_dict)
app.include_router(chat)
app.include_router(history)
app.include_router(gallery)
app.include_router(smart_prompt)
app.include_router(angle)
app.include_router(modelscope)
app.include_router(presets)
app.include_router(output_ops)
app.include_router(canvas_tasks)
app.include_router(cli_tools)
app.include_router(lora_scan)
app.include_router(asset_library)
app.include_router(static_files)
app.include_router(canvas_workflows)
app.include_router(smart_canvas)
app.include_router(ms_generate)
app.include_router(canvas_comfy)
app.include_router(proxy_download)
app.include_router(workflows_legacy)
app.include_router(animadex)
app.include_router(characters)
app.include_router(artists)
app.include_router(media_ops)
app.include_router(ideogram4)
app.include_router(restart)
app.include_router(interrogate)
app.include_router(online_gen)
app.include_router(output_zip)
app.include_router(user_assets)
app.include_router(training)
from core import lan_sharing
app.include_router(lan_sharing.router)
from core.feature_access import router as feature_access_router
app.include_router(feature_access_router)

from core.generation_data import install as install_generation_data
install_generation_data(app)


if __name__ == "__main__":
    import uvicorn

    print("\n  Local:   http://127.0.0.1:7000")
    print("  局域网共享默认关闭，可在「设置 → 局域网共享」中开启。\n")

    uvicorn.run(app, host="127.0.0.1", port=7000)
