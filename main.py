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
import zipfile
from io import BytesIO
import requests
from typing import List, Dict, Any, Optional, Tuple
from threading import Lock
from contextlib import asynccontextmanager
import httpx
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
    _log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(_log_dir, exist_ok=True)
    with open(os.path.join(_log_dir, "startup_env.log"), "w", encoding="utf-8") as _f:
        _f.write("\n".join(_log_lines))
except Exception:
    pass  # 启动诊断日志失败不阻塞启动
# ──────────────────────────────────────────────────────

from PIL import Image, ImageOps
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Header, Request, Form, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse, RedirectResponse
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    global GLOBAL_LOOP
    GLOBAL_LOOP = asyncio.get_running_loop()
    # 启动时整理资产库
    try:
        await asyncio.to_thread(migrate_asset_library_into_dirs)
    except Exception as exc:
        print(f"资产库分组整理失败: {exc}")
    try:
        await asyncio.to_thread(migrate_double_extension_uploads)
    except Exception as exc:
        print(f"修复双重扩展名素材失败: {exc}")
    print("Application startup complete.")
    yield
    print("Application shutting down.")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

async def save_remote_video_to_output(url, prefix="video_"):
    """下载远程视频到 output 目录"""
    if not url:
        return ""
    if url.startswith("/output/") or url.startswith("/assets/"):
        return url
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.mp4"
    path = os.path.join(OUTPUT_DIR, filename)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = (response.headers.get("Content-Type") or "").lower()
            clean_path = urllib.parse.urlparse(url).path
            ext = os.path.splitext(clean_path)[1].lower()
            if ext in {".mp4", ".webm", ".mov"}:
                filename = filename[:-4] + ext
                path = os.path.join(OUTPUT_DIR, filename)
            elif "webm" in content_type:
                filename = filename[:-4] + ".webm"
                path = os.path.join(OUTPUT_DIR, filename)
            elif "quicktime" in content_type or "mov" in content_type:
                filename = filename[:-4] + ".mov"
                path = os.path.join(OUTPUT_DIR, filename)
            with open(path, "wb") as f:
                f.write(response.content)
            return f"/output/{filename}"
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
    dest = os.path.join(OUTPUT_DIR, filename)
    shutil.copyfile(path, dest)
    return f"/output/{filename}"

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
            return await save_remote_video_to_output(text, prefix="jimeng_video_")
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
WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "text2image", "z-image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
INPUT_DIR = os.path.join(BASE_DIR, "input")
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")
API_ENV_FILE = os.path.join(BASE_DIR, "API", ".env")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONVERSATION_DIR = os.path.join(DATA_DIR, "conversations")
CANVAS_DIR = os.path.join(DATA_DIR, "canvases")
GLOBAL_CONFIG_FILE = os.path.join(BASE_DIR, "global_config.json")
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
PROMPT_PRESETS_FILE = os.path.join(DATA_DIR, "prompt-presets.json")
STATIC_PROMPT_TEMPLATE_MD = os.path.join(STATIC_DIR, "system-prompts", "infinite-canvas-prompt-templates.md")
PROMPT_TEMPLATE_PATHS = [STATIC_PROMPT_TEMPLATE_MD]

# --- 素材库配置 ---
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_INPUT_DIR = os.path.join(ASSETS_DIR, "input")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
ASSET_LIBRARY_DIR = os.path.join(ASSETS_DIR, "library")
LOCAL_UPLOAD_DIR = os.path.join(ASSETS_DIR, "uploads")
ASSET_LIBRARY_PATH = os.path.join(DATA_DIR, "asset_library.json")
PROMPT_LIBRARY_PATH = os.path.join(DATA_DIR, "prompt_libraries.json")
SHARED_FOLDERS_FILE = os.path.join(DATA_DIR, "shared_folders.json")
MEDIA_PREVIEW_DIR = os.path.join(DATA_DIR, "media_previews")
LOCAL_IMAGE_IMPORT_MAX_BYTES = int(os.getenv("LOCAL_IMAGE_IMPORT_MAX_BYTES", str(50 * 1024 * 1024)))
LOCAL_IMAGE_IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
RUNNINGHUB_WORKFLOW_STORE_FILE = os.path.join(DATA_DIR, "runninghub_workflows.json")
SEED_UINT32_MAX = 4294967295

# === history.json 进程内缓存 ===
# 第一次 GET 时读盘并缓存,save_to_history 写盘时失效
# history.json 越大,这个优化收益越明显(从 N ms 读盘 + N ms json.load → 0)
_HISTORY_CACHE = None  # list[dict] or None
_HISTORY_LOCK = threading.Lock() if 'threading' in dir() else None
def _load_history_cached():
    global _HISTORY_CACHE
    if _HISTORY_CACHE is not None:
        return _HISTORY_CACHE
    data = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"读取历史文件失败: {e}")
            data = []
    _HISTORY_CACHE = data
    return _HISTORY_CACHE
def _invalidate_history_cache():
    global _HISTORY_CACHE
    _HISTORY_CACHE = None

# --- YAML 预设缓存 ---
_preset_cache = None
_preset_cache_mtime = 0

# API 提供商配置文件路径
API_PROVIDERS_FILE = os.path.join(BASE_DIR, "api_providers.json")

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
USERS_FILE = os.path.join(BASE_DIR, "data", "users.json")

def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def load_users():
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_users(users):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

def find_user_by_token(token):
    users = load_users()
    for username, data in users.items():
        if data.get("token") == token:
            return username, data
    return None, None

# --- 用户文件隔离辅助函数 ---

def get_username_by_token(token):
    """根据 token 获取用户名,返回 None 表示未登录"""
    if not token:
        return None
    username, user = find_user_by_token(token)
    return username

def is_admin_by_token(token):
    """根据 token 判断是否为管理员"""
    if not token:
        return False
    _, user = find_user_by_token(token)
    return bool(user and user.get("is_admin", False))

def validate_canvas_owner(canvas, token):
    """校验画布归属:管理员可操作所有画布,普通用户只能操作自己的画布"""
    is_admin = is_admin_by_token(token)
    if is_admin:
        return
    username = get_username_by_token(token)
    if not username or canvas.get("owner") != username:
        raise HTTPException(status_code=403, detail="无权操作此画布")

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

def load_api_providers():
    """从文件加载 API 提供商列表"""
    if not os.path.exists(API_PROVIDERS_FILE):
        return []
    try:
        with open(API_PROVIDERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []

def save_api_providers(providers):
    """保存 API 提供商列表到文件"""
    try:
        with open(API_PROVIDERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(providers, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Failed to save API providers: {e}")

def provider_key_env(provider_id):
    """生成提供商 API Key 的环境变量名"""
    return f"{provider_id.upper()}_API_KEY"

def normalize_provider(data):
    """规范化提供商数据"""
    return {
        "id": data.get("id", "").strip(),
        "name": data.get("name", "").strip(),
        "base_url": data.get("base_url", "").strip(),
        "protocol": data.get("protocol", "openai"),
        "image_models": data.get("image_models") or [],
        "chat_models": data.get("chat_models") or [],
        "video_models": data.get("video_models") or [],
        "primary": bool(data.get("primary", False)),
        "enabled": bool(data.get("enabled", True)),
    }

def public_provider(provider):
    """返回公开的提供商信息(隐藏 API Key)"""
    env_key = provider_key_env(provider["id"])
    has_key = bool(os.getenv(env_key, "") or read_api_env_value(env_key))
    key_preview = ''
    if has_key:
        raw = os.getenv(env_key, "") or read_api_env_value(env_key)
        key_preview = raw[:4] + '••••' + raw[-4:] if len(raw) > 8 else '••••••••'
    return {
        "id": provider["id"],
        "name": provider["name"],
        "base_url": provider["base_url"],
        "protocol": provider["protocol"],
        "image_models": provider["image_models"],
        "chat_models": provider["chat_models"],
        "video_models": provider.get("video_models") or [],
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
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "120"))
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

# Custom static files with no-cache headers for HTML files
from starlette.responses import Response
from starlette.staticfiles import StaticFiles as StarletteStaticFiles
from starlette.datastructures import Headers
import mimetypes

# 确保 .js 文件被正确识别为 application/javascript
mimetypes.add_type('application/javascript', '.js')

class NoCacheStaticFiles(StarletteStaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if hasattr(response, 'headers'):
            # Disable caching for all static files to ensure latest JS/CSS is loaded
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")

# 自定义 output 静态文件服务,支持子文件夹访问
from starlette.responses import FileResponse as StarletteFileResponse

@app.get("/output/{path:path}")
async def serve_output_file(path: str):
    """提供 output 目录下的文件访问,支持子文件夹"""
    # 安全检查:防止路径遍历攻击
    clean_path = path.replace("\\", "/")
    if ".." in clean_path or clean_path.startswith("/"):
        raise HTTPException(status_code=404, detail="File not found")

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
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
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
    }.get(ext, "application/octet-stream")

    is_media = ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif')
    if is_media:
        mtime = os.path.getmtime(full_path)
        import hashlib as _hl
        etag = _hl.md5(f"{full_path}:{int(mtime)}".encode()).hexdigest()
        cache_h = {
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
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
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = ""
    size: str = "1024x1024"
    quality: str = "medium"
    protocol: str = "openai"
    provider_id: str = ""
    reference_images: List[AIReference] = []

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

class MsGenerateRequest(BaseModel):
    prompt: str
    model: str = "black-forest-labs/FLUX.2-klein-9B"
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
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

def download_image(comfy_address, comfy_url_path, prefix="studio_", canvas=None, username=None, feature=""):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    date_folder = datetime.now().strftime("%Y-%m-%d")
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
    elif username and feature:
        user_dir, _ = get_user_output_dir(username)
        canvas_output_dir = os.path.join(user_dir, feature, date_folder)
    elif username:
        user_dir, _ = get_user_output_dir(username)
        canvas_output_dir = os.path.join(user_dir, date_folder)
    elif feature:
        canvas_output_dir = os.path.join(OUTPUT_DIR, feature, date_folder)
    else:
        canvas_output_dir = os.path.join(OUTPUT_DIR, date_folder)
    os.makedirs(canvas_output_dir, exist_ok=True)
    local_path = os.path.join(canvas_output_dir, filename)
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        subfolder_parts = []
        if feature:
            subfolder_parts.append(feature)
        subfolder_parts.append(date_folder)
        subfolder = "/".join(subfolder_parts)
        return build_output_url(canvas, filename, username, subfolder=subfolder)
    except Exception as e:
        print(f"下载图片失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url


def download_audio(comfy_address, comfy_url_path, prefix="tts_", canvas=None, username=None, subfolder=None):
    """从 ComfyUI 下载音频文件"""
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
    elif username:
        canvas_output_dir, _ = get_user_output_dir(username)
    else:
        canvas_output_dir = OUTPUT_DIR
    # TTS 音频存到子文件夹
    if subfolder:
        canvas_output_dir = os.path.join(canvas_output_dir, subfolder)
    os.makedirs(canvas_output_dir, exist_ok=True)
    local_path = os.path.join(canvas_output_dir, filename)
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        with urllib.request.urlopen(full_url) as response, open(local_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return build_output_url(canvas, filename, username, subfolder=subfolder)
    except Exception as e:
        print(f"下载音频失败: {e}")
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def save_to_history(record):
    with HISTORY_LOCK:
        history = []
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except: pass
        if "timestamp" not in record:
            record["timestamp"] = time.time()
        history.insert(0, record)
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(history[:5000], f, ensure_ascii=False, indent=4)
        # 写盘后失效缓存
        _invalidate_history_cache()

def get_comfy_history(comfy_address, prompt_id):
    try:
        with urllib.request.urlopen(f"http://{comfy_address}/history/{prompt_id}") as response:
            return json.loads(response.read())
    except Exception as e:
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
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(conversation, f, ensure_ascii=False, indent=2)

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

def list_conversations(user_id):
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
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)

def canvas_path(canvas_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", canvas_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的画布 ID")
    return os.path.join(CANVAS_DIR, f"{cleaned}.json")

def save_canvas(canvas):
    canvas["updated_at"] = now_ms()
    with CANVAS_LOCK:
        with open(canvas_path(canvas["id"]), 'w', encoding='utf-8') as f:
            json.dump(canvas, f, ensure_ascii=False, indent=2)

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
            base = base_url + "/v1" if not base_url.endswith("/v1") else base_url
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
    if len(model) > 120 or not re.fullmatch(r"[a-zA-Z0-9_.:/+-]+", model):
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

def output_file_from_url(url):
    if not url:
        return None

    clean_url = url.split("?")[0]

    if clean_url.startswith("/output/"):
        relative_path = clean_url[len("/output/"):]
        path = os.path.abspath(os.path.join(OUTPUT_DIR, relative_path))
        output_root = os.path.abspath(OUTPUT_DIR)
        if os.path.commonpath([output_root, path]) == output_root and os.path.exists(path):
            return path
        return None

    if clean_url.startswith("/assets/"):
        relative_path = clean_url[len("/assets/"):]
        path = os.path.abspath(os.path.join(INPUT_DIR, relative_path))
        input_root = os.path.abspath(INPUT_DIR)
        if os.path.commonpath([input_root, path]) == input_root and os.path.exists(path):
            return path
        return None

    return None

def content_type_for_path(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    return "image/png"

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

async def save_ai_image_to_output(image_data, prefix="online_", canvas=None, username=None):
    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
    elif username:
        canvas_output_dir, _ = get_user_output_dir(username)
    else:
        canvas_output_dir = OUTPUT_DIR
    os.makedirs(canvas_output_dir, exist_ok=True)

    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    path = os.path.join(canvas_output_dir, filename)
    if image_data["type"] == "b64":
        with open(path, "wb") as f:
            f.write(base64.b64decode(image_data["value"]))
        return build_output_url(canvas, filename, username)
    value = image_data["value"]
    if value.startswith("/output/"):
        return value
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
            return build_output_url(canvas, filename, username)
    except Exception as e:
        print(f"保存上游图片失败: {e}")
        return value

async def generate_ai_image(prompt, size, quality, model, reference_images=None, protocol="openai"):
    refs = [ref for ref in (reference_images or []) if ref.get("url")]

    quality_map = {
        "auto": "medium",
        "low": "low",
        "medium": "medium",
        "high": "high",
        "standard": "low",
        "hd": "high"
    }

    is_gemini_model = protocol == "gemini"

    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        if is_gemini_model:
            system_prompt = f"Generate an image with the following requirements. Size: {size}, Quality: {quality_map.get(quality, 'medium')}."
            if refs:
                gemini_content = [{"type": "text", "text": prompt}]
                for ref in refs[:4]:
                    data_url = reference_to_data_url(ref)
                    if data_url.startswith("data:"):
                        gemini_content.append({"type": "image_url", "image_url": {"url": data_url}})
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": gemini_content}
                ]
            else:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ]
            response = await client.post(
                f"{AI_BASE_URL}/v1/chat/completions",
                headers=api_headers(),
                json={
                    "model": model,
                    "messages": messages,
                },
            )
        elif refs:
            files = []
            opened = []
            try:
                for ref in refs[:4]:
                    path = output_file_from_url(ref.get("url", ""))
                    if not path:
                        continue
                    fh = open(path, "rb")
                    opened.append(fh)
                    files.append(("image", (os.path.basename(path), fh, content_type_for_path(path))))
                data = {
                    "model": model,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality_map.get(quality, "medium"),
                    "output_format": "png",
                    "n": "1"
                }
                response = await client.post(f"{AI_BASE_URL}/v1/images/edits", headers=api_headers(json_body=False), data=data, files=files)
            finally:
                for fh in opened:
                    fh.close()
        else:
            response = await client.post(
                f"{AI_BASE_URL}/v1/images/generations",
                headers=api_headers(),
                json={
                    "model": model,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality_map.get(quality, "medium"),
                    "output_format": "png",
                    "n": 1
                },
            )
        response.raise_for_status()
        try:
            raw = response.json()
        except Exception:
            raise HTTPException(status_code=502, detail=f"API 服务器返回无效响应: {response.text[:200]}")

        try:
            if is_gemini_model:
                return extract_image_from_chat(raw), raw
            return extract_image(raw), raw
        except HTTPException:
            task_id = extract_task_id(raw)
            if not task_id:
                raise
        task_result = await wait_for_image_task(client, task_id)
        return extract_image(task_result), task_result

def upstream_message_from_record(item):
    role = item.get("role")
    if role not in {"user", "assistant"} or item.get("type") == "image":
        return None
    refs = item.get("attachments") or []
    if refs and role == "user":
        content = [{"type": "text", "text": item.get("content", "")}]
        for ref in refs[:4]:
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

def output_file_from_url(url):
    if isinstance(url, dict):
        url = url.get("url", "")
    if not url or not (url.startswith("/output/") or url.startswith("/assets/")):
        return None
    clean = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/assets/"):
        root = ASSETS_DIR if os.path.isdir(ASSETS_DIR) else INPUT_DIR
        rel = clean[len("/assets/"):]
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
    if not os.path.exists(ASSET_LIBRARY_PATH):
        lib = default_asset_library()
        save_asset_library(lib)
        return lib
    try:
        with open(ASSET_LIBRARY_PATH, "r", encoding="utf-8") as f:
            lib = json.load(f)
    except Exception:
        lib = default_asset_library()
    return normalize_asset_library(lib)

def save_asset_library(lib):
    lib = normalize_asset_library(lib)
    sort_asset_library_items(lib)
    lib["updated_at"] = now_ms()
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(ASSET_LIBRARY_PATH, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)

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
    with open(RUNNINGHUB_WORKFLOW_STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)

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

def migrate_asset_library_into_dirs():
    try:
        lib = load_asset_library()
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
        save_asset_library(lib)

def get_primary_provider_id(providers=None):
    for p in (providers or load_api_providers()):
        if p.get("primary") and p.get("enabled", True):
            return p["id"]
    for p in load_api_providers():
        if p.get("enabled", True):
            return p["id"]
    return "comfly"

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
    with open(path, "w", encoding="utf-8") as f:
        json.dump(normalize_asset_classification(classification), f, ensure_ascii=False, indent=2)

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
    with open(SHARED_FOLDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

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
        "url": f"/assets/uploads/{urllib.parse.quote(rel, safe='/')}",
        "kind": kind or "image",
        "size": size,
        "created_at": created_at,
        "folder": os.path.dirname(rel).replace("\\", "/"),
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
    import copy
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

def defaultPromptTemplateCategories():
    return [
        {"id": "view", "name": "视角"},
        {"id": "storyboard", "name": "分镜"},
        {"id": "character", "name": "角色"},
        {"id": "product", "name": "产品"},
        {"id": "lighting", "name": "光影"},
        {"id": "custom", "name": "我的"},
    ]

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
            builtin_ids = {"view", "storyboard", "character", "product", "lighting", "custom"}
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

def load_prompt_libraries():
    if not os.path.exists(PROMPT_LIBRARY_PATH):
        data = default_prompt_libraries()
        return save_prompt_libraries(data)
    try:
        with open(PROMPT_LIBRARY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = default_prompt_libraries()
    if not isinstance(data, dict):
        data = default_prompt_libraries()
    normalized = normalize_prompt_libraries(data)
    if normalized.get("active_library_id") != data.get("active_library_id") or normalized.get("libraries") != data.get("libraries"):
        return save_prompt_libraries(normalized)
    return normalized

def save_prompt_libraries(data):
    data = normalize_prompt_libraries(data)
    data["updated_at"] = now_ms()
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PROMPT_LIBRARY_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
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

@app.post("/api/auth/register")
async def auth_register(payload: AuthRegisterRequest):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    users = load_users()
    if username in users:
        raise HTTPException(status_code=400, detail="该用户名已存在,请直接登录")
    is_admin = (username == SUPER_ADMIN_USERNAME)
    token = str(uuid.uuid4())
    users[username] = {
        "password": hash_password(payload.password),
        "is_admin": is_admin,
        "token": token,
        "created_at": time.time(),
    }
    save_users(users)
    return {"ok": True, "username": username, "is_admin": is_admin, "token": token}

@app.post("/api/auth/login")
async def auth_login(payload: AuthLoginRequest):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    users = load_users()
    user = users.get(username)
    if not user:
        raise HTTPException(status_code=400, detail="用户不存在,请先注册")
    if user["password"] != hash_password(payload.password):
        raise HTTPException(status_code=400, detail="密码错误")
    token = str(uuid.uuid4())
    users[username]["token"] = token
    save_users(users)
    return {"ok": True, "username": username, "is_admin": user["is_admin"], "token": token}

@app.get("/api/auth/me")
async def auth_me(token: str = ""):
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    return {"ok": True, "username": username, "is_admin": user["is_admin"]}

@app.post("/api/auth/logout")
async def auth_logout(payload: Optional[TokenRequest] = None):
    token = payload.token if payload else ""
    if not token:
        return {"ok": True}
    username, user = find_user_by_token(token)
    if user:
        users = load_users()
        if username in users:
            users[username]["token"] = ""
            save_users(users)
    return {"ok": True}

# ---

@app.get("/api/auth/admin/users")
async def admin_list_users(token: str = ""):
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    usernames = sorted(users.keys(), key=lambda x: (x != "admin", x))
    return {"users": [{"username": u, "is_admin": users[u].get("is_admin", False)} for u in usernames]}

@app.post("/api/auth/admin/reset-password")
async def admin_reset_password(payload: AdminResetPasswordRequest):
    if not payload.token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(payload.token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    if payload.username not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    users[payload.username]["password"] = hash_password(payload.new_password)
    save_users(users)
    return {"ok": True}

@app.post("/api/auth/admin/delete-user")
async def admin_delete_user(payload: AdminDeleteUserRequest):
    if not payload.token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(payload.token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    if payload.username not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    if payload.username == SUPER_ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="不能删除管理员账号")
    del users[payload.username]
    save_users(users)
    return {"ok": True}

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/api/view")
def view_image(filename: str, type: str = "input", subfolder: str = ""):
    for addr in COMFYUI_INSTANCES:
        try:
            url = f"http://{addr}/view"
            params = {"filename": filename, "type": type, "subfolder": subfolder}
            r = requests.get(url, params=params, timeout=1)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    raise HTTPException(status_code=404, detail="Image not found on any available backend")

@app.get("/api/download-output")
def download_output(url: str, name: str = ""):
    path = output_file_from_url(url)
    if not path:
        raise HTTPException(status_code=404, detail="文件不存在")
    filename = os.path.basename(name) if name else os.path.basename(path)
    return FileResponse(path, media_type=content_type_for_path(path), filename=filename)


@app.get("/api/open-output-folder")
async def open_output_folder(path: str = ""):
    """在资源管理器中打开 output 目录中的图片所在文件夹"""
    safe_path = os.path.normpath(path).lstrip("\\/").lstrip("/")
    full_path = os.path.join(OUTPUT_DIR, safe_path)
    folder = os.path.dirname(full_path) if os.path.isfile(full_path) else full_path
    if not os.path.exists(folder):
        raise HTTPException(status_code=404, detail=f"目录不存在: {folder}")
    try:
        if os.path.isfile(full_path):
            subprocess.Popen(["explorer", "/select,", full_path])
        else:
            subprocess.Popen(["explorer", folder])
        return {"ok": True, "path": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开文件夹失败: {str(e)}")


@app.get("/api/delete-output-file")
async def delete_output_file(path: str = ""):
    """删除 output 目录中的图片文件"""
    safe_path = os.path.normpath(path).lstrip("\\/").lstrip("/")
    full_path = os.path.join(OUTPUT_DIR, safe_path)
    output_root = os.path.abspath(OUTPUT_DIR)
    if not os.path.abspath(full_path).startswith(output_root):
        raise HTTPException(status_code=403, detail="不允许删除 output 目录之外")
    if not os.path.isfile(full_path):
        return {"ok": False, "error": "文件不存在", "path": full_path}
    try:
        os.remove(full_path)
        return {"ok": True, "path": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@app.get("/api/scan-output")
async def scan_output_folder(token: str = ""):
    """扫描当前登录用户的 rmbg output 目录下的图片"""
    username = get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="未登录")
    user_dir = get_user_dirname(username)
    scan_root = os.path.join(OUTPUT_DIR, user_dir, "抠图")
    if not os.path.isdir(scan_root):
        return {"images": []}
    images = []
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    for root, dirs, files in os.walk(scan_root):
        for f in sorted(files, reverse=True):
            ext = os.path.splitext(f)[1].lower()
            if ext in exts:
                rel = os.path.relpath(os.path.join(root, f), OUTPUT_DIR)
                url_path = "/output/" + rel.replace("\\", "/")
                mtime = os.path.getmtime(os.path.join(root, f))
                images.append({"url": url_path, "filename": f, "path": rel, "mtime": int(mtime * 1000)})
    images.sort(key=lambda x: x["mtime"], reverse=True)
    return {"images": images[:500]}


@app.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    uploaded_files = []
    files_content = []
    for file in files:
        content = await file.read()
        files_content.append((file, content))

    for file, content in files_content:
        success_count = 0
        last_result = None
        for addr in COMFYUI_INSTANCES:
            try:
                files_data = {'image': (file.filename, content, file.content_type)}
                response = requests.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception as e:
                print(f"Upload error for {addr}: {e}")

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}

@app.post("/api/ai/upload")
async def upload_ai_reference(files: List[UploadFile] = File(...), canvas_id: str = Form(None), token: str = Form("")):
    username = get_username_by_token(token)
    canvas = None
    if canvas_id:
        try:
            canvas = load_canvas(canvas_id)
        except:
            pass

    if canvas:
        canvas_output_dir = get_canvas_output_dir(canvas)
    elif username:
        canvas_output_dir, _ = get_user_output_dir(username)
    else:
        canvas_output_dir = OUTPUT_DIR
    os.makedirs(canvas_output_dir, exist_ok=True)

    uploaded = []
    for file in files:
        content = await file.read()
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
            content_type = (file.content_type or "").lower()
            ext = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".png"
        filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join(canvas_output_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        url_path = build_output_url(canvas, filename, username)
        uploaded.append({"url": url_path, "name": file.filename or filename})
    return {"files": uploaded}

@app.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    # 收集所有 provider 的聊天模型
    all_chat_providers = []
    providers = load_api_providers()
    for p in providers:
        if p.get("chat_models"):
            all_chat_providers.append({
                "id": p["id"],
                "name": p.get("name", p["id"]),
                "base_url": p.get("base_url", ""),
                "chat_models": p["chat_models"],
            })
    return {
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "has_api_key": bool(AI_API_KEY),
        "ms_chat_models": MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(MODELSCOPE_API_KEY),
        "chat_providers": all_chat_providers,
    }

@app.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS}

# --- ModelScope Token (从 env 读取,不再支持通过 UI 修改) ---

@app.get("/api/config/token")
async def get_global_token():
    # 优先读 env,回退到 global_config.json(兼容旧数据)
    if MODELSCOPE_API_KEY:
        return {"token": MODELSCOPE_API_KEY}
    if os.path.exists(GLOBAL_CONFIG_FILE):
        try:
            with open(GLOBAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return {"token": config.get("modelscope_token", "")}
        except:
            pass
    return {"token": ""}

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

# --- 在线生图 (COMFLY) ---

@app.post("/api/online-image")
async def online_image(payload: OnlineImageRequest, token: str = ""):
    username = get_username_by_token(token)
    model = selected_model(payload.model, IMAGE_MODEL)
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    try:
        image_data, raw = await generate_ai_image(payload.prompt, payload.size, payload.quality, model, refs, payload.protocol)
        local_url = await save_ai_image_to_output(image_data, prefix="online_", username=username)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游生图接口错误:{exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败:{exc}") from exc

    result = {
        "prompt": payload.prompt,
        "images": [local_url],
        "timestamp": time.time(),
        "type": "online",
        "user": username,
        "model": model,
        "params": {"model": model, "size": payload.size, "quality": payload.quality, "reference_images": refs},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }
    save_to_history(result)
    if GLOBAL_LOOP:
        asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result), GLOBAL_LOOP)
    return result

async def build_online_image_result(payload: OnlineImageRequest, username: str = None):
    provider_id = payload.provider_id or "comfly"
    provider = get_api_provider(provider_id)
    if provider:
        default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
        model = selected_model(payload.model, default_model)
    else:
        model = selected_model(payload.model, IMAGE_MODEL)
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    try:
        image_data, raw = await generate_ai_image(payload.prompt, payload.size, payload.quality, model, refs, payload.protocol)
        local_url = await save_ai_image_to_output(image_data, prefix="online_", username=username)
    except httpx.HTTPStatusError as exc:
        text = exc.response.text or ''
        friendly = None
        m = re.search(r"longest edge must be less than or equal to (\d+)", text)
        if m:
            limit = m.group(1)
            friendly = f"该模型不支持当前分辨率:最长边超过 {limit}px。请把图片分辨率调低(例如换到 2K 或更小),或更换支持高分辨率的模型。"
        elif "Invalid size" in text or "invalid_value" in text:
            friendly = f"该模型不支持当前尺寸:{payload.size}。请尝试更换分辨率或模型。"
        elif "rate limit" in text.lower() or "429" in text:
            friendly = "请求过于频繁,已被上游限流,请稍后再试。"
        elif "Unauthorized" in text or "401" in text:
            friendly = "API Key 无效或已过期,请到「API 设置」检查 Key。"
        raise HTTPException(status_code=exc.response.status_code, detail=friendly or text) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败:{exc}") from exc
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        raise HTTPException(status_code=getattr(exc, "status_code", 500), detail=str(detail)) from exc
    return {
        "prompt": payload.prompt,
        "images": [local_url],
        "timestamp": time.time(),
        "type": "online",
        "model": model,
        "params": {"model": model, "size": payload.size, "quality": payload.quality, "reference_images": refs},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }

async def run_canvas_image_task(task_id: str, payload: OnlineImageRequest, username: str = None):
    with CANVAS_TASK_LOCK:
        if task_id in CANVAS_TASKS:
            CANVAS_TASKS[task_id]["status"] = "running"
            CANVAS_TASKS[task_id]["updated_at"] = time.time()
    try:
        result = await build_online_image_result(payload, username=username)
        with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id].update({
                "status": "succeeded",
                "result": result,
                "error": "",
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

@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: OnlineImageRequest, token: str = ""):
    task_id = f"canvas_img_{uuid.uuid4().hex}"
    username = get_username_by_token(token)
    with CANVAS_TASK_LOCK:
        CANVAS_TASKS[task_id] = {
            "id": task_id,
            "type": "online-image",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
        }
    asyncio.create_task(run_canvas_image_task(task_id, payload, username=username))
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    with CANVAS_TASK_LOCK:
        task = dict(CANVAS_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在,可能服务已重启或任务已过期")
    return task

# --- Canvas LLM ---

@app.post("/api/canvas-llm")
async def canvas_llm(payload: CanvasLLMRequest):
    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    upstream_messages = [{"role": "system", "content": payload.system_prompt or SYSTEM_PROMPT}]
    for item in payload.messages[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    upstream_messages.append({"role": "user", "content": payload.message})
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json={"model": model, "messages": upstream_messages},
            )
            response.raise_for_status()
            if not response.content:
                raise HTTPException(status_code=502, detail="上游接口返回了空响应")
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误:{exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败:{exc}") from exc
    text = text_from_chat_response(raw).strip() or "接口返回了空回复。"
    return {"text": text, "model": model, "raw_usage": raw.get("usage") if isinstance(raw, dict) else None}

# --- 对话管理 ---

@app.get("/api/conversations")
async def conversations(request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"user_id": user_id, "conversations": list_conversations(user_id)}

@app.post("/api/conversations")
async def create_conversation(payload: ConversationCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": new_conversation(user_id, payload.title)}

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": load_conversation(user_id, conversation_id)}

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    path = conversation_path(user_id, conversation_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

# --- 画布管理 ---

@app.get("/api/canvases")
async def canvases(token: str = ""):
    username, user = find_user_by_token(token)
    is_admin = bool(user and user.get("is_admin", False)) if user else False
    if not is_admin and not username:
        return {"canvases": []}
    owner_filter = None if is_admin else username
    return {"canvases": list_canvases(owner_filter=owner_filter)}

@app.get("/api/canvases/trash")
async def trashed_canvases(token: str = ""):
    username, user = find_user_by_token(token)
    is_admin = bool(user and user.get("is_admin", False)) if user else False
    if not is_admin and not username:
        return {"canvases": [], "retention_days": 30}
    owner_filter = None if is_admin else username
    return {"canvases": list_deleted_canvases(owner_filter=owner_filter), "retention_days": 30}

@app.post("/api/canvases")
async def create_canvas(payload: CanvasCreateRequest, token: str = ""):
    username = get_username_by_token(token)
    canvas = new_canvas(payload.title, payload.icon, owner=username)
    canvas["kind"] = payload.kind or "classic"
    save_canvas(canvas)
    return {"canvas": canvas}

@app.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str, token: str = ""):
    canvas = load_canvas(canvas_id)
    validate_canvas_owner(canvas, token)
    return {"canvas": canvas}

@app.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: CanvasSaveRequest, token: str = ""):
    canvas = load_canvas(canvas_id)
    validate_canvas_owner(canvas, token)
    canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
    canvas["icon"] = (payload.icon or canvas.get("icon") or "layers")[:32]
    canvas["nodes"] = payload.nodes
    canvas["connections"] = payload.connections
    canvas["viewport"] = payload.viewport
    save_canvas(canvas)
    return {"canvas": canvas}

@app.delete("/api/canvases/{canvas_id}")
async def delete_canvas(canvas_id: str, token: str = ""):
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    if not canvas.get("deleted_at"):
        canvas["deleted_at"] = now_ms()
        save_canvas(canvas)
    return {"ok": True}

@app.post("/api/canvases/{canvas_id}/restore")
async def restore_canvas(canvas_id: str, token: str = ""):
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    if canvas.get("deleted_at"):
        canvas.pop("deleted_at", None)
        save_canvas(canvas)
    return {"canvas": canvas}

@app.delete("/api/canvases/{canvas_id}/purge")
async def purge_canvas(canvas_id: str, token: str = ""):
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    path = canvas_path(canvas_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

@app.get("/api/canvases/{canvas_id}/files")
async def list_canvas_files(canvas_id: str):
    canvas = load_canvas(canvas_id)
    canvas_output_dir = get_canvas_output_dir(canvas)
    if not os.path.exists(canvas_output_dir):
        return {"files": []}

    files = []
    try:
        for filename in sorted(os.listdir(canvas_output_dir), key=lambda f: os.path.getmtime(os.path.join(canvas_output_dir, f)), reverse=True):
            filepath = os.path.join(canvas_output_dir, filename)
            if os.path.isfile(filepath):
                stat = os.stat(filepath)
                files.append({
                    "name": filename,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "url": f"/output/{canvas['output_folder']}/{filename}"
                })
    except Exception as e:
        print(f"读取画布文件列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}

# --- 资产库 API ---

@app.post("/api/canvases/{canvas_id}/asset-folder")
async def create_asset_folder(canvas_id: str):
    """创建或确认画布资产文件夹存在"""
    canvas = load_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)
    folder_name = canvas.get("output_folder", "")
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    path = f"/assets/{owner}/{folder_name}" if owner and folder_name else (f"/assets/{folder_name}" if folder_name else "/assets")
    return {"folder": folder_name, "path": path}

@app.get("/api/canvases/{canvas_id}/assets")
async def list_assets(canvas_id: str):
    """获取画布资产文件列表(含用户级资产,互通在线生图保存的文件)"""
    canvas = load_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)

    seen = set()
    files = []

    def collect_from(dir_path, url_builder):
        if not os.path.exists(dir_path):
            return
        for filename in sorted(os.listdir(dir_path), key=lambda f: os.path.getmtime(os.path.join(dir_path, f)), reverse=True):
            filepath = os.path.join(dir_path, filename)
            if os.path.isfile(filepath) and filename not in seen:
                seen.add(filename)
                stat = os.stat(filepath)
                ext = os.path.splitext(filename)[1].lower()
                files.append({
                    "name": filename,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "url": url_builder(filename),
                    "type": "image" if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"] else "video" if ext in [".mp4", ".webm", ".mov", ".avi", ".mkv"] else "audio" if ext in [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"] else "text" if ext == ".txt" else "other"
                })

    try:
        # 1. 画布专属资产文件夹
        collect_from(asset_dir, lambda fn: build_asset_url(canvas, fn))

        # 2. 用户级资产文件夹(在线生图等保存的资产),使其互通
        owner = canvas.get("owner", "")
        if owner:
            user_dirname = get_user_dirname(owner)
            user_asset_dir = os.path.join(INPUT_DIR, user_dirname)
            collect_from(user_asset_dir, lambda fn: f"/assets/{user_dirname}/{fn}")

        # 按修改时间倒序
        files.sort(key=lambda f: f["modified"], reverse=True)
    except Exception as e:
        print(f"读取资产文件列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}

@app.post("/api/canvases/{canvas_id}/assets/upload")
async def upload_assets(canvas_id: str, files: List[UploadFile] = File(...)):
    """上传图片到画布资产文件夹"""
    canvas = load_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)

    uploaded = []
    for file in files:
        content = await file.read()
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        allowed_exts = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"]
        if ext not in allowed_exts:
            ext = ".bin"
        filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join(asset_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        url_path = build_asset_url(canvas, filename)
        uploaded.append({"url": url_path, "name": file.filename or filename})
    return {"files": uploaded}

@app.post("/api/canvases/{canvas_id}/assets/copy-from-canvas")
async def copy_asset_from_canvas(canvas_id: str, payload: dict = None):
    """从画布的 Output 节点复制图片到资产文件夹"""
    canvas = load_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)

    urls = (payload or {}).get("urls", [])
    copied = []
    for url in urls:
        if not url or not url.startswith("/output/"):
            continue
        clean_url = url.split("?")[0]
        relative = clean_url[len("/output/"):]
        source_path = os.path.join(OUTPUT_DIR, relative)
        if not os.path.exists(source_path):
            continue
        ext = os.path.splitext(relative)[1].lower() or ".png"
        filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
        dest_path = os.path.join(asset_dir, filename)
        try:
            import shutil
            shutil.copy2(source_path, dest_path)
            url_path = build_asset_url(canvas, filename)
            copied.append({"url": url_path, "name": filename, "original": url})
        except Exception as e:
            print(f"复制资产失败: {e}")
    return {"files": copied}

@app.post("/api/canvases/{canvas_id}/assets/delete")
async def delete_asset(canvas_id: str, payload: dict = None):
    """删除资产文件夹中的指定文件"""
    canvas = load_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    filename = (payload or {}).get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="缺少文件名")
    safe_name = os.path.basename(filename.replace("\\", "/"))
    filepath = os.path.join(asset_dir, safe_name)
    if not filepath.startswith(os.path.abspath(asset_dir)):
        raise HTTPException(status_code=400, detail="无效的文件名")
    if os.path.exists(filepath) and os.path.isfile(filepath):
        os.remove(filepath)
        return {"ok": True}
    raise HTTPException(status_code=404, detail="文件不存在")

class UserAssetSaveRequest(BaseModel):
    url: str = ""
    name: str = ""

@app.post("/api/user/assets/save-from-url")
async def save_user_asset_from_url(payload: UserAssetSaveRequest, token: str = "", request: Request = None):
    """保存在线图片到用户级别的资产文件夹 input/{username}/"""
    username = get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")

    asset_dir, dirname = get_user_input_dir(username)
    os.makedirs(asset_dir, exist_ok=True)

    download_url = payload.url
    if download_url.startswith("/"):
        base = str(request.base_url).rstrip("/")
        download_url = base + download_url

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(download_url)
            response.raise_for_status()
            content = response.content
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"下载图片失败: {str(e)}")

    ext = ".png"
    content_type = ""
    for key, val in response.headers.items():
        if key.lower() == "content-type":
            content_type = val
            break
    if "jpeg" in content_type or "jpg" in content_type:
        ext = ".jpg"
    elif "webp" in content_type:
        ext = ".webp"
    elif "gif" in content_type:
        ext = ".gif"

    filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(asset_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    url_path = f"/assets/{dirname}/{filename}"
    return {"url": url_path, "name": payload.name or filename}

@app.get("/api/user/assets")
async def list_user_assets(token: str = ""):
    """列出用户级资产文件夹 input/{username}/ 中的图片文件(包括画布资产子目录中的图片)"""
    username = get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")

    asset_dir, dirname = get_user_input_dir(username)
    if not os.path.exists(asset_dir):
        return {"files": []}

    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    files = []
    try:
        for filename in sorted(os.listdir(asset_dir), key=lambda f: os.path.getmtime(os.path.join(asset_dir, f)), reverse=True):
            filepath = os.path.join(asset_dir, filename)
            if os.path.isfile(filepath):
                ext = os.path.splitext(filename)[1].lower()
                if ext in image_exts:
                    stat = os.stat(filepath)
                    files.append({
                        "name": filename,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "url": f"/assets/{dirname}/{filename}",
                        "type": "image"
                    })
        # 同时扫描画布资产子目录 input/{username}/{canvas_folder}/
        for item in sorted(os.listdir(asset_dir), reverse=True):
            subdir = os.path.join(asset_dir, item)
            if not os.path.isdir(subdir):
                continue
            for filename in sorted(os.listdir(subdir), key=lambda f: os.path.getmtime(os.path.join(subdir, f)), reverse=True):
                filepath = os.path.join(subdir, filename)
                if os.path.isfile(filepath):
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in image_exts:
                        stat = os.stat(filepath)
                        files.append({
                            "name": filename,
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                            "url": f"/assets/{dirname}/{item}/{filename}",
                            "type": "image"
                        })
    except Exception as e:
        print(f"读取用户资产列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}

# --- Output 下载 ---

from fastapi.responses import StreamingResponse
import zipfile
import io

class DownloadZipRequest(BaseModel):
    urls: List[str]
    filename: str = "output.zip"

@app.post("/api/download-output-zip")
async def download_output_zip(payload: DownloadZipRequest):
    """下载 Output 节点图片为 ZIP"""
    if not payload.urls:
        raise HTTPException(status_code=400, detail="没有可下载的图片")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i, url in enumerate(payload.urls):
            try:
                # 处理本地路径
                if url.startswith('/assets/') or url.startswith('/output/'):
                    local_path = url.lstrip('/')
                    if os.path.isfile(local_path):
                        zf.write(local_path, f"image_{i+1}_{os.path.basename(local_path)}")
                        continue

                # 处理远程 URL
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, timeout=10.0)
                    if resp.status_code == 200:
                        ext = url.split('.')[-1].split('?')[0] or 'png'
                        zf.writestr(f"image_{i+1}.{ext}", resp.content)
            except Exception as e:
                print(f"Download failed for {url}: {e}")
                continue

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={payload.filename}"}
    )

# --- GPT 对话 ---

@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request, x_user_id: str = Header(default=""), token: str = ""):
    username = get_username_by_token(token)
    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    if payload.mode == "image":
        model = selected_model(payload.image_model or payload.model, IMAGE_MODEL)
        try:
            image_data, raw = await generate_ai_image(payload.message, payload.size, payload.quality, model, refs)
            local_url = await save_ai_image_to_output(image_data, prefix="chat_", username=username)
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游生图接口错误:{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游生图接口失败:{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": payload.message,
            "image_url": local_url,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }
    else:
        chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
        history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
        upstream_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for item in history:
            msg = upstream_message_from_record(item)
            if msg:
                upstream_messages.append(msg)
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                response = await client.post(
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages},
                )
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误:{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游接口失败:{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text_from_chat_response(raw).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)
    return {"conversation": conversation, "message": assistant_message}

@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    if payload.mode == "image":
        raise HTTPException(status_code=400, detail="图片模式请使用 /api/chat")

    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
    upstream_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history:
        msg = upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)

    async def stream():
        content_parts = []
        raw_usage = None
        yield sse_event({"type": "meta", "conversation": conversation})
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages, "stream": True},
                ) as response:
                    if response.status_code >= 400:
                        detail = await response.aread()
                        yield sse_event({"type": "error", "detail": f"上游接口错误:{detail.decode('utf-8', errors='ignore')}"})
                        return
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if line == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(chunk, dict) and chunk.get("usage"):
                            raw_usage = chunk.get("usage")
                        delta = text_delta_from_chat_chunk(chunk)
                        if delta:
                            content_parts.append(delta)
                            yield sse_event({"type": "delta", "delta": delta})
        except httpx.HTTPError as exc:
            yield sse_event({"type": "error", "detail": f"请求上游接口失败:{exc}"})
            return

        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": "".join(content_parts).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_usage,
        }
        conversation["messages"].append(assistant_message)
        conversation["updated_at"] = now_ms()
        save_conversation(user_id, conversation)
        yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

    return StreamingResponse(stream(), media_type="text/event-stream")

# --- 历史记录 ---

class SaveHistoryRequest(BaseModel):
    prompt: str = ""
    images: List[str] = []
    text: Optional[str] = None
    text_url: Optional[str] = None
    seed: Optional[int] = None
    prompt_id: Optional[str] = None
    type: str = "zimage"
    model: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    timestamp: Optional[float] = None
    genParams: Optional[Dict[str, Any]] = None  # 完整生成参数,用于载入提示词恢复

@app.post("/api/history/save")
async def save_history(req: SaveHistoryRequest, token: str = ""):
    username = get_username_by_token(token)
    record = {
        "prompt": req.prompt,
        "images": req.images,
        "type": req.type,
        "timestamp": req.timestamp or time.time(),
        "user": username
    }
    if req.text:
        record["text"] = req.text
    if req.text_url:
        record["text_url"] = req.text_url
    if req.seed is not None:
        record["seed"] = req.seed
    if req.prompt_id:
        record["prompt_id"] = req.prompt_id
    if req.model:
        record["model"] = req.model
    if req.params:
        record["params"] = req.params

    # 下载直连模式的 ComfyUI 图片到用户目录
    if username:
        user_dir, user_dirname = get_user_output_dir(username)
        new_images = []
        for img_url in (req.images or []):
            if img_url.startswith("/output/") or img_url.startswith("/assets/"):
                new_images.append(img_url)
            elif img_url.startswith("http://127.0.0.1:8188/view"):
                # 直连模式图片:从 ComfyUI 下载到用户目录
                try:
                    import urllib.request, shutil
                    filename = f"{req.type}_{int(time.time())}_{uuid.uuid4().hex[:8]}.png"
                    local_path = os.path.join(user_dir, filename)
                    with urllib.request.urlopen(img_url, timeout=30) as resp, open(local_path, 'wb') as out:
                        shutil.copyfileobj(resp, out)
                    new_images.append(f"/output/{user_dirname}/{filename}")
                except Exception as e:
                    print(f"下载直连图片到用户目录失败: {e}")
                    new_images.append(img_url)
            else:
                new_images.append(img_url)
        record["images"] = new_images

    # 确保 user 字段不被前端数据覆盖
    record["user"] = username
    if req.genParams:
        record["genParams"] = req.genParams
    save_to_history(record)
    return {"success": True, "timestamp": record["timestamp"]}

@app.get("/api/history")
async def get_history_api(type: str = None, token: str = "", page: int = None, page_size: int = 15, q: str = None):
    username = get_username_by_token(token)
    # 优先走进程内缓存,history.json 越大收益越明显
    if _HISTORY_CACHE is not None:
        data = list(_HISTORY_CACHE)  # 拷贝避免污染缓存
    elif os.path.exists(HISTORY_FILE):
        try:
            data = _load_history_cached()
            data = list(data)
        except Exception as e:
            print(f"读取历史文件失败: {e}")
            data = [] if page is None else {"items": [], "total": 0, "page": 0, "pageSize": page_size, "hasMore": False}
    else:
        data = [] if page is None else {"items": [], "total": 0, "page": 0, "pageSize": page_size, "hasMore": False}
    # 当 data 还是 list 时,继续走过滤逻辑
    if isinstance(data, list):
        if type:
            types = [t.strip() for t in type.split(',')]
            data = [item for item in data if item.get("type", "zimage") in types]
        # 按用户过滤
        if username:
            data = [item for item in data if item.get("user") == username]
        # Support image, text and audio outputs: keep records with images OR text OR audio
        data = [item for item in data if item.get("images") or item.get("text") or item.get("audio")]

        # 服务端搜索:按 prompt / model / text 关键词过滤
        # 英文整词匹配(\b),中文/非ASCII子串匹配
        if q:
            import re as _re
            tokens = [w for w in q.lower().split() if w]
            ascii_words = [_re.escape(w) for w in tokens if w.isascii()]
            cjk_words = [w for w in tokens if not w.isascii()]
            pat = _re.compile(r'\b(?:' + '|'.join(ascii_words) + r')\b') if ascii_words else None
            def _match(item):
                txt = ((item.get('prompt', '') or '') + ' ' + (item.get('model', '') or '') + ' ' + (item.get('text', '') or '')).lower()
                if pat and pat.search(txt):
                    return True
                for w in cjk_words:
                    if w in txt:
                        return True
                return False
            data = [item for item in data if _match(item)]

        def sort_key(item):
            ts = item.get("timestamp", 0)
            if isinstance(ts, (int, float)):
                return float(ts)
            return 0

        data.sort(key=sort_key, reverse=True)

        # === 分页(可选,向后兼容)===
        # 调用方传 ?page=N&page_size=M → 返回 {items,total,page,pageSize,hasMore}
        # 调用方不传 page → 保持旧行为,直接返回数组(不破坏老客户端)
        if page is not None and page >= 0 and page_size > 0:
            total = len(data)
            start = page * page_size
            items = data[start:start + page_size]
            return {
                "items": items,
                "total": total,
                "page": page,
                "pageSize": page_size,
                "hasMore": start + len(items) < total
            }
        return data
    return data

@app.get("/api/queue_status")
async def get_queue_status(client_id: str):
    with QUEUE_LOCK:
        total = len(QUEUE)
        positions = [i + 1 for i, t in enumerate(QUEUE) if t["client_id"] == client_id]
        position = positions[0] if positions else 0
    return {"total": total, "position": position}

@app.post("/api/history/delete")
async def delete_history(req: DeleteHistoryRequest, token: str = ""):
    username = get_username_by_token(token)
    is_admin = is_admin_by_token(token)
    if not os.path.exists(HISTORY_FILE):
        return {"success": False, "message": "History file not found"}
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
            target_record = None
            new_history = []
            for item in history:
                is_match = False
                item_ts = item.get("timestamp", 0)
                if isinstance(req.timestamp, (int, float)) and isinstance(item_ts, (int, float)):
                    if abs(float(item_ts) - float(req.timestamp)) < 0.001:
                        is_match = True
                elif str(item_ts) == str(req.timestamp):
                    is_match = True
                if is_match:
                    target_record = item
                else:
                    new_history.append(item)
            if target_record:
                # 检查权限:只能删除自己的记录,或管理员可删任意
                if username and not is_admin and target_record.get("user") and target_record.get("user") != username:
                    return {"success": False, "message": "无权删除其他用户的历史记录"}
                with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                    json.dump(new_history, f, ensure_ascii=False, indent=4)

        if target_record:
            # 删除图片文件
            for img_url in target_record.get("images", []):
                file_path = _url_to_output_path(img_url)
                if not file_path:
                    continue
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete file {file_path}: {e}")
                else:
                    print(f"File not found (skipping): {file_path}")
            # 删除音频文件
            for audio_url in target_record.get("audio", []):
                file_path = _url_to_output_path(audio_url)
                if not file_path:
                    continue
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete audio file {file_path}: {e}")
                else:
                    print(f"Audio file not found (skipping): {file_path}")
            return {"success": True}
        else:
            return {"success": False, "message": "Record not found"}
    except Exception as e:
        print(f"Delete history error: {e}")
        return {"success": False, "message": str(e)}


class DeleteImageRequest(BaseModel):
    timestamp: float
    image_url: str

@app.post("/api/history/delete-image")
async def delete_single_image(req: DeleteImageRequest, token: str = ""):
    """从历史记录中删除单张图片(多图组合场景)"""
    username = get_username_by_token(token)
    if not os.path.exists(HISTORY_FILE):
        return {"success": False, "message": "History file not found"}
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
            target_record = None
            for item in history:
                item_ts = item.get("timestamp", 0)
                if abs(float(item_ts) - float(req.timestamp)) < 0.001:
                    target_record = item
                    break
            if not target_record:
                return {"success": False, "message": "Record not found"}
            if username and not is_admin_by_token(token) and target_record.get("user") and target_record.get("user") != username:
                return {"success": False, "message": "无权操作"}
            images = target_record.get("images", [])
            if req.image_url not in images:
                return {"success": False, "message": "Image not in record"}
            # 删除本地文件
            file_path = _url_to_output_path(req.image_url)
            if file_path and os.path.exists(file_path):
                try: os.remove(file_path)
                except: pass
            # 从记录中移除
            images.remove(req.image_url)
            if not images:
                # 图片全部删完,删除整条记录
                history = [h for h in history if abs(float(h.get("timestamp", 0)) - float(req.timestamp)) >= 0.001]
            with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(history[:5000], f, ensure_ascii=False, indent=4)
            _invalidate_history_cache()
            return {"success": True, "remaining": len(images)}
    except Exception as e:
        return {"success": False, "message": str(e)}


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


@app.post("/api/gallery/purge-orphans")
async def purge_orphan_records(token: str = "", dry_run: bool = False):
    """
    扫描 history.json,找出 images[] 指向不存在的孤儿记录:
      - 所有图片都缺失 → 整条删除
      - 部分图片缺失 → 修剪 images[],仅保留仍存在的图片
    仅管理员可调用。dry_run=True 时只统计不写盘。
    """
    username = get_username_by_token(token)
    is_admin = is_admin_by_token(token)
    if not is_admin:
        return {"success": False, "message": "需要管理员权限"}

    if not os.path.exists(HISTORY_FILE):
        return {"success": True, "removed": 0, "trimmed": 0, "scanned": 0}

    try:
        with HISTORY_LOCK:
            data = _load_history_cached()
            data = [dict(item) for item in data]  # 拷贝,避免污染缓存

            removed_records = []   # 整条删除
            trimmed_records = []   # 修剪 images[]
            scanned = 0

            new_history = []
            for item in data:
                images = item.get("images") or []
                if not images:
                    new_history.append(item)
                    continue
                scanned += 1
                kept_imgs = []
                missing = []
                for img in images:
                    p = _url_to_output_path(img) if isinstance(img, str) else None
                    if p and os.path.isfile(p):
                        kept_imgs.append(img)
                    else:
                        missing.append(img)
                if not kept_imgs:
                    # 所有图片都缺失 → 整条删除
                    removed_records.append({
                        "timestamp": item.get("timestamp"),
                        "user": item.get("user"),
                        "model": item.get("model"),
                        "missing": missing,
                    })
                    # 不加入 new_history
                elif missing:
                    # 部分缺失 → 修剪
                    new_history.append({**item, "images": kept_imgs})
                    trimmed_records.append({
                        "timestamp": item.get("timestamp"),
                        "user": item.get("user"),
                        "kept": len(kept_imgs),
                        "missing": missing,
                    })
                else:
                    new_history.append(item)

            if not dry_run and (removed_records or trimmed_records):
                with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                    json.dump(new_history, f, ensure_ascii=False, indent=4)
                _invalidate_history_cache()

        return {
            "success": True,
            "dry_run": dry_run,
            "scanned": scanned,
            "removed": len(removed_records),
            "trimmed": len(trimmed_records),
            "removed_records": removed_records[:20],   # 最多返回 20 条详情
            "trimmed_records": trimmed_records[:20],
        }
    except Exception as e:
        print(f"Purge orphans error: {e}")
        return {"success": False, "message": str(e)}


@app.get("/api/gallery/scan-new")
async def scan_new_images(type: str = "", token: str = ""):
    """扫描用户 output 文件夹,找出还没入库的图片,自动创建历史记录"""
    username = get_username_by_token(token)
    if not username:
        return {"success": False, "message": "未登录"}

    user_dirname = get_user_dirname(username)
    user_output = os.path.join(OUTPUT_DIR, user_dirname)
    if not os.path.isdir(user_output):
        return {"success": True, "imported": 0}

    # 收集已入库的图片 URL
    existing_images = set()
    with HISTORY_LOCK:
        try:
            data = _load_history_cached()
            for item in data:
                for img in (item.get("images") or []):
                    existing_images.add(img)
        except: pass

    IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}

    def extract_prompt_from_png(fpath):
        """从 ComfyUI PNG 元数据提取正面 prompt + genParams,直接匹配工具参数"""
        import struct as _struct, json as _json
        def _read_workflow(fpath):
            with open(fpath, 'rb') as f:
                data = f.read(1024 * 1024)
            idx = data.find(b'prompt')
            if idx < 0: return None
            chunk_start = idx - 8
            if chunk_start < 0: return None
            length = _struct.unpack('>I', data[chunk_start:chunk_start+4])[0]
            chunk_data = data[chunk_start+8:chunk_start+8+length]
            marker = b'prompt\x00'
            pidx = chunk_data.find(marker)
            if pidx < 0: return None
            raw = chunk_data[pidx+len(marker):].decode('utf-8', errors='ignore').rstrip('\x00').strip()
            return _json.loads(raw)

        def _resolve(node_id, wf, depth=0):
            """追踪引用链拿到文本"""
            if depth > 8: return ''
            nid = str(node_id)
            node = wf.get(nid)
            if not isinstance(node, dict): return ''
            inputs = node.get('inputs', {})
            ct = node.get('class_type', '')
            # CLIPTextEncode → text
            if ct.startswith('CLIPTextEncode'):
                t = inputs.get('text', '')
                if isinstance(t, str) and t.strip(): return t.strip()
                if isinstance(t, list) and len(t) == 2: return _resolve(t[0], wf, depth+1)
                return ''
            # 自定义节点 → 常见文本字段
            for k in ('character_tags', 'text', 'prompt', 'opt_prompt'):
                v = inputs.get(k, '')
                if isinstance(v, str) and v.strip(): return v.strip()
            # 递归引用
            for v in inputs.values():
                if isinstance(v, list) and len(v) == 2:
                    r = _resolve(v[0], wf, depth+1)
                    if r: return r
            return ''

        try:
            wf = _read_workflow(fpath)
            if not wf: return '', {}

            prompt_text = ''
            seed = None
            width = height = None
            batch = 1
            loras = []
            is_anima = False

            for nid, node in wf.items():
                if not isinstance(node, dict): continue
                ct = node.get('class_type', '')
                inp = node.get('inputs', {})

                # 识别工作流类型
                if ct == 'AnimaCharacterTagSelector':
                    is_anima = True

                # 采样器 → seed + positive prompt
                if ct in ('KSampler', 'KSamplerAdvanced') and 'positive' in inp:
                    ref = inp['positive']
                    if isinstance(ref, list) and len(ref) == 2:
                        prompt_text = _resolve(ref[0], wf)
                    seed = inp.get('seed') or inp.get('noise_seed')

                # CFGGuider → positive prompt
                elif ct == 'CFGGuider' and 'positive' in inp:
                    ref = inp['positive']
                    if isinstance(ref, list) and len(ref) == 2:
                        prompt_text = _resolve(ref[0], wf)

                # RandomNoise → seed
                elif ct == 'RandomNoise':
                    seed = inp.get('noise_seed')

                # Latent → 尺寸 + batch
                elif ct in ('EmptyLatentImage',) or 'EmptyFlux' in ct:
                    width = inp.get('width')
                    height = inp.get('height')
                    bs = inp.get('batch_size')
                    if isinstance(bs, int) and bs > 0: batch = bs

                # LoRA
                elif 'LoraLoader' in ct:
                    name = inp.get('lora_name', '')
                    strength = float(inp.get('strength_model', 1.0))
                    if name:
                        loras.append({'name': name, 'strength': strength})

            # 从尺寸推算 ratio + resolution
            ratio_w, ratio_h, resolution = 9, 16, 1
            if width and height:
                from math import gcd
                g = gcd(width, height)
                rw, rh = width // g, height // g
                # 标准化到常见比例
                _known = {(1,1),(4,3),(3,4),(16,9),(9,16),(3,2),(2,3)}
                if (rw, rh) not in _known:
                    rw, rh = min(_known, key=lambda k: abs(k[0]/k[1] - rw/rh))
                ratio_w, ratio_h = rw, rh
                resolution = 2 if max(width, height) > 1200 else 1

            gen_params = {
                'workflow': 'text2image/anima.json' if is_anima else 'text2image/z-image.json',
                'ratioW': ratio_w, 'ratioH': ratio_h,
                'resolution': resolution,
                'batchCount': batch,
                'loras': loras,
            }
            if seed is not None: gen_params['seed'] = seed
            if width: gen_params['width'] = width
            if height: gen_params['height'] = height

            return prompt_text, gen_params
        except:
            return '', {}

    new_records = []

    # 遍历 output/{user}/{feature}/{date}/ 目录
    for feature_dir in os.listdir(user_output):
        feature_path = os.path.join(user_output, feature_dir)
        if not os.path.isdir(feature_path):
            continue
        # 按 type 过滤
        if type:
            types = [t.strip() for t in type.split(',')]
            if feature_dir not in types:
                continue
        for date_dir in os.listdir(feature_path):
            date_path = os.path.join(feature_path, date_dir)
            if not os.path.isdir(date_path):
                continue
            for fname in os.listdir(date_path):
                ext = os.path.splitext(fname)[1].lower()
                if ext not in IMAGE_EXTS:
                    continue
                img_url = f"/output/{user_dirname}/{feature_dir}/{date_dir}/{fname}"
                if img_url in existing_images:
                    continue
                # 新图片:创建记录
                fpath = os.path.join(date_path, fname)
                try:
                    mtime = os.path.getmtime(fpath)
                except:
                    mtime = time.time()
                # 尝试从 PNG 元数据提取 prompt 和参数
                prompt_text = ''
                gen_params = {}
                if ext == '.png':
                    prompt_text, gen_params = extract_prompt_from_png(fpath)
                record = {
                    "prompt": prompt_text or f"[自动导入] {feature_dir}",
                    "images": [img_url],
                    "type": feature_dir,
                    "timestamp": mtime * 1000,
                    "user": username,
                    "model": feature_dir.upper(),
                    "auto_imported": True
                }
                if gen_params:
                    record['genParams'] = gen_params
                new_records.append(record)
                existing_images.add(img_url)

    # 批量写入新记录
    updated_old = 0
    with HISTORY_LOCK:
        try:
            data = _load_history_cached()
            data = list(data)
        except:
            data = []
        # 更新旧的自动导入记录(prompt 还是 [自动导入] 的)
        for item in data:
            if not item.get('auto_imported'):
                continue
            if not item.get('prompt', '').startswith('[自动导入]'):
                continue
            images = item.get('images', [])
            if not images:
                continue
            img_url = images[0]
            if not img_url.startswith('/output/'):
                continue
            fpath = _url_to_output_path(img_url)
            if not fpath or not os.path.isfile(fpath):
                continue
            ext = os.path.splitext(fpath)[1].lower()
            if ext != '.png':
                continue
            prompt_text, gen_params = extract_prompt_from_png(fpath)
            if prompt_text:
                item['prompt'] = prompt_text
                updated_old += 1
            if gen_params:
                item['genParams'] = gen_params
        for rec in new_records:
            data.insert(0, rec)
        data.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(data[:5000], f, ensure_ascii=False, indent=4)
        _invalidate_history_cache()

    return {"success": True, "imported": len(new_records), "updated": updated_old}


# --- 提示词预设(委托 preset_manager 模块)---

import preset_manager
from preset_manager import (
    load_preset_i18n, get_preset_bidir,
    get_tag_presets, save_tag_presets,
    get_style_presets, save_style_presets,
    get_all_presets,
)

@app.get("/api/preset-i18n")
def api_preset_i18n():
    """返回预设中文名映射表(兼容旧接口)"""
    return load_preset_i18n()

STYLE_I18N_FILE = os.path.join(DATA_DIR, "style-i18n.json")

@app.get("/api/style-i18n")
def api_style_i18n():
    """返回风格预设中文名映射表"""
    if os.path.exists(STYLE_I18N_FILE):
        try:
            with open(STYLE_I18N_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"categories": {}, "subcategories": {}, "presets": {}}

@app.get("/api/preset-bidir")
def api_preset_bidir():
    """返回 {id_to_name, name_to_id}(兼容旧接口)"""
    id_to_name, name_to_id = get_preset_bidir()
    return {"id_to_name": id_to_name, "name_to_id": name_to_id}

@app.get("/api/reload-presets")
async def api_reload_presets():
    """强制刷新预设缓存并返回最新数据"""
    preset_manager._cache.invalidate()
    return get_all_presets()

@app.get("/api/prompt-presets")
async def get_prompt_presets():
    """获取标签预设(兼容旧接口,YAML 优先回退 JSON)"""
    return get_tag_presets()

@app.post("/api/prompt-presets")
async def api_save_prompt_presets(data: dict):
    """保存标签预设"""
    ok = save_tag_presets(data)
    return {"success": ok}

@app.get("/api/style-presets")
async def api_get_style_presets():
    """获取风格预设(完整提示词)"""
    return get_style_presets()

@app.post("/api/style-presets")
async def api_save_style_presets(data: dict):
    """保存风格预设"""
    ok = save_style_presets(data)
    return {"success": ok}


@app.post("/api/import/fooocus-styles")
async def api_import_fooocus_styles(payload: dict = None):
    """
    一键导入 Fooocus 官方风格包到 style-presets.json

    Body 参数:
      - sources: List[str]  要导入的源 key,默认全部
        可选: fooocus, sai, diva, marc_k3nt3l, twri, mre
      - dry_run: bool       预览模式,不写文件
      - skip_thumbs: bool   不下载缩略图
    """
    payload = payload or {}
    try:
        from tools.fooocus_importer import import_fooocus_styles
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"fooocus_importer 加载失败: {e}")

    sources = payload.get("sources")  # None=全部
    dry_run = bool(payload.get("dry_run", False))
    skip_thumbs = bool(payload.get("skip_thumbs", False))

    try:
        result = import_fooocus_styles(
            sources=sources,
            dry_run=dry_run,
            skip_thumbs=skip_thumbs,
        )
        return result
    except Exception as e:
        log.exception(f"Fooocus 导入失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/all-presets")
async def api_get_all_presets():
    """获取所有预设(标签 + 风格),统一输出"""
    return get_all_presets()

@app.get("/api/thumbnails/{filename}")
async def api_get_thumbnail(filename: str):
    """获取风格预设缩略图"""
    import re
    # 安全校验:只允许字母数字下划线和点
    if not re.match(r'^[a-zA-Z0-9_.-]+$', filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    thumb_path = os.path.join(DATA_DIR, "thumbnails", filename)
    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    # 根据扩展名返回正确的 content-type
    ext = os.path.splitext(filename)[1].lower()
    content_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")
    stat = os.stat(thumb_path)
    etag = _etag_for(thumb_path, stat)
    return FileResponse(thumb_path, media_type=content_type, headers={
        "Cache-Control": "public, max-age=2592000, immutable",
        "ETag": f'"{etag}"',
    })

# --- 智能提示词生成 ---

from smart_prompt import generate_smart_prompt, load_config
import smart_tts as smart_tts_module
from smart_prompt import call_llm as _sp_call_llm

class SmartPromptRequest(BaseModel):
    prompt: str
    config: Optional[Dict[str, Any]] = None

@app.get("/api/smart-prompt/config")
async def get_smart_prompt_config():
    """获取智能提示词的 provider 选择"""
    config_file = os.path.join(BASE_DIR, "data", "smart-prompt-config.json")
    try:
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return {"provider_id": data.get("provider_id", "")}
    except Exception:
        pass
    return {"provider_id": ""}

@app.post("/api/smart-prompt/config")
async def save_smart_prompt_config(payload: dict):
    """保存智能提示词的 provider 选择"""
    config_file = os.path.join(BASE_DIR, "data", "smart-prompt-config.json")
    os.makedirs(os.path.dirname(config_file), exist_ok=True)
    data = {}
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
    data["provider_id"] = payload.get("provider_id", "")
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return {"success": True}

# === 提示词预设 CRUD ===
SMART_PRESETS_DIR = os.path.join(BASE_DIR, "data", "smart-prompt-presets")
os.makedirs(SMART_PRESETS_DIR, exist_ok=True)

def load_presets():
    presets = []
    if os.path.exists(SMART_PRESETS_DIR):
        for f in sorted(os.listdir(SMART_PRESETS_DIR)):
            if f.endswith('.json'):
                try:
                    with open(os.path.join(SMART_PRESETS_DIR, f), 'r', encoding='utf-8') as fh:
                        presets.append(json.load(fh))
                except Exception:
                    pass
    return presets

def save_preset(preset):
    pid = preset.get('id', '')
    if not pid:
        pid = 'preset-' + uuid.uuid4().hex[:8]
        preset['id'] = pid
    path = os.path.join(SMART_PRESETS_DIR, f'{pid}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)
    return preset

@app.get("/api/smart-prompt/presets")
async def list_presets():
    return {"presets": load_presets()}

@app.post("/api/smart-prompt/presets")
async def create_preset(payload: dict):
    preset = {
        "id": payload.get('id', ''),
        "name": payload.get('name', '新预设'),
        "description": payload.get('description', ''),
        "provider_id": payload.get('provider_id', ''),
        "system_prompt": payload.get('system_prompt', ''),
        "temperature": payload.get('temperature', 0.3),
        "max_tokens": payload.get('max_tokens', 1024),
        "quality_tags": payload.get('quality_tags', 'masterpiece, best quality, ultra detailed, highres'),
        "negative_default": payload.get('negative_default', 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry'),
        "output_format": payload.get('output_format', 'tag_only'),
        "is_default": payload.get('is_default', False),
        "created_at": payload.get('created_at', ''),
    }
    saved = save_preset(preset)
    return {"success": True, "preset": saved}

@app.put("/api/smart-prompt/presets/{preset_id}")
async def update_preset(preset_id: str, payload: dict):
    payload['id'] = preset_id
    saved = save_preset(payload)
    return {"success": True, "preset": saved}

@app.delete("/api/smart-prompt/presets/{preset_id}")
async def delete_preset(preset_id: str):
    path = os.path.join(SMART_PRESETS_DIR, f'{preset_id}.json')
    if os.path.exists(path):
        os.remove(path)
    return {"success": True}

# === 提示词预设选择(文生图用) ===
SMART_PRESET_SELECT_FILE = os.path.join(BASE_DIR, "data", "smart-prompt-config.json")

@app.get("/api/smart-prompt/selected-preset")
async def get_selected_preset():
    try:
        if os.path.exists(SMART_PRESET_SELECT_FILE):
            with open(SMART_PRESET_SELECT_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return {"preset_id": data.get('preset_id', 'default')}
    except Exception:
        pass
    return {"preset_id": "default"}

@app.post("/api/smart-prompt/selected-preset")
async def set_selected_preset(payload: dict):
    os.makedirs(os.path.dirname(SMART_PRESET_SELECT_FILE), exist_ok=True)
    data = {}
    if os.path.exists(SMART_PRESET_SELECT_FILE):
        try:
            with open(SMART_PRESET_SELECT_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
    data['preset_id'] = payload.get('preset_id', 'default')
    with open(SMART_PRESET_SELECT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return {"success": True}

@app.post("/api/smart-prompt")
async def smart_prompt(req: SmartPromptRequest):
    """智能提示词生成:中文描述 → Anima 标签"""
    try:
        # 加载当前选中的预设
        preset_id = 'default'
        try:
            if os.path.exists(SMART_PRESET_SELECT_FILE):
                with open(SMART_PRESET_SELECT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    preset_id = data.get('preset_id', 'default')
        except Exception:
            pass
        # 查找预设
        preset = None
        for p in load_presets():
            if p.get('id') == preset_id:
                preset = p
                break
        # 加载 AI 配置
        config = load_config()
        if req.config:
            config.update(req.config)
        # 用预设覆盖参数
        if preset:
            if preset.get('provider_id'):
                config['_preset_provider'] = preset['provider_id']
            if preset.get('temperature') is not None:
                config['temperature'] = preset['temperature']
            if preset.get('max_tokens') is not None:
                config['max_tokens'] = preset['max_tokens']
        result = generate_smart_prompt(req.prompt, config, preset)
        return result
    except Exception as e:
        return {"success": False, "prompt": "", "negative": "", "raw": "", "error": str(e)}

# --- AI 生成提示词方案 ---
class AIGenPlanRequest(BaseModel):
    description: str

@app.post("/api/random-plan/ai-generate")
async def ai_generate_random_plan(req: AIGenPlanRequest):
    """用 LLM 根据自然语言描述生成提示词方案结构 (角色 / 画师 / 预设)"""
    try:
        config = load_config()
        if not config.get('api_key'):
            return {"success": False, "error": "未配置 API Key，请先在设置中配置 LLM API"}

        sys_prompt = (
            "你是一个 AI 绘画提示词方案生成助手。用户会用自然语言描述他想要的方案主题，你需要输出一个 JSON 对象。\n"
            "JSON 结构：\n"
            "{\n"
            '  "name": string,            // 方案名（简洁中文）\n'
            '  "characters": string[],    // 角色 tag 数组（英文，如 "nahida (genshin impact)"）\n'
            '  "artists": string[],       // 画师 tag 数组（英文，如 "wlop", \"ask\"）\n'
            '  "presets": string[],       // 预设词数组（英文画质 / 风格 tag，如 \"masterpiece, best quality\", \"detailed background\"）\n'
            '  "fixedPrompt": string      // 固定提示词（可选，其他需要每次都附加的词）\n'
            "}\n\n"
            "要求：\n"
            "1. 只输出 JSON，不要 markdown 代码块标记，不要任何解释文字\n"
            "2. 角色 / 画师都用英文 tag（与 stable diffusion 模型兼容）\n"
            "3. 角色至少给 1 个，如果用户描述的是原创 / 通用主题，可留空数组\n"
            "4. 画师给 1-3 个，符合主题风格\n"
            "5. 预设给 2-5 个常用画质 / 风格 tag\n"
            "6. 如果用户描述不明确，自行发挥创意填充合理内容\n"
        )

        raw = _sp_call_llm(req.description.strip(), sys_prompt, config)
        if isinstance(raw, str) and raw.startswith('ERROR'):
            return {"success": False, "error": raw}

        # 尝试解析 JSON（容错：去掉可能的 markdown 标记）
        import re as _re
        cleaned = raw.strip()
        # 去掉 ```json ... ``` 包裹
        m = _re.search(r'```(?:json)?\s*(.*?)```', cleaned, _re.DOTALL)
        if m:
            cleaned = m.group(1).strip()
        # 尝试截取第一个 { 到最后一个 }
        s = cleaned.find('{')
        e = cleaned.rfind('}')
        if s >= 0 and e > s:
            cleaned = cleaned[s:e+1]

        data = json.loads(cleaned)
        # 字段兼容性保证
        plan = {
            'name': str(data.get('name') or 'AI 方案')[:30],
            'characters': list(data.get('characters') or []),
            'artists': list(data.get('artists') or []),
            'presets': list(data.get('presets') or []),
            'fixedPrompt': str(data.get('fixedPrompt') or ''),
        }
        return {"success": True, "plan": plan, "raw": raw}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"AI 输出 JSON 解析失败: {e}", "raw": raw if 'raw' in dir() else ''}
    except Exception as e:
        return {"success": False, "error": str(e)}

# --- 智能 TTS 文本精修 ---
class SmartTTSRequest(BaseModel):
    text: str = ""
    config: Optional[Dict[str, Any]] = None

@app.post("/api/smart-tts")
async def smart_tts_enhance(req: SmartTTSRequest):
    """智能 TTS 文本精修"""
    try:
        config = load_config()
        if req.config:
            config.update(req.config)
        if not config.get('api_key'):
            return {"success": False, "enhanced_text": "", "suggested_params": {}, "changes": [], "raw": "", "error": "未配置 API Key"}
        result = smart_tts_module.generate_smart_tts(req.text, config)
        return result
    except Exception as e:
        return {"success": False, "enhanced_text": "", "suggested_params": {}, "changes": [], "raw": "", "error": str(e)}

# --- 翻译模型 ---
TRANSLATE_CONFIG_FILE = os.path.join(BASE_DIR, "data", "translate-config.json")

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
    with open(TRANSLATE_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

@app.get("/api/translate/config")
async def get_translate_config():
    cfg = load_translate_config()
    # 安全返回:隐藏 secret_key 中间部分
    safe = dict(cfg)
    if safe.get("baidu_secret_key"):
        sk = safe["baidu_secret_key"]
        safe["baidu_secret_key_preview"] = sk[:3] + "***" + sk[-3:] if len(sk) > 6 else "***"
    else:
        safe["baidu_secret_key_preview"] = ""
    return safe

@app.post("/api/translate/config")
async def save_translate_config_api(payload: dict):
    cfg = load_translate_config()
    for key in ["provider_type", "baidu_app_id", "baidu_secret_key", "ai_provider_id", "ai_model", "ai_prompt_template", "source_lang", "target_lang"]:
        if key in payload:
            cfg[key] = payload[key]
    save_translate_config(cfg)
    return {"success": True}

async def translate_with_baidu(text: str, from_lang: str, to_lang: str, app_id: str, secret_key: str) -> str:
    """百度通用翻译 API"""
    salt = str(int(time.time() * 1000))
    sign_str = app_id + text + salt + secret_key
    sign = hashlib.md5(sign_str.encode('utf-8')).hexdigest()
    lang_map = {"zh": "zh", "en": "en", "ja": "jp", "ko": "kor", "fr": "fra", "de": "de", "ru": "ru", "es": "spa", "pt": "pt", "it": "it", "ar": "ara", "th": "th", "vi": "vie"}
    from_lang_baidu = lang_map.get(from_lang, from_lang)
    to_lang_baidu = lang_map.get(to_lang, to_lang)
    params = urllib.parse.urlencode({
        "q": text, "from": from_lang_baidu, "to": to_lang_baidu,
        "appid": app_id, "salt": salt, "sign": sign
    })
    url = f"https://fanyi-api.baidu.com/api/trans/vip/translate?{params}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        data = resp.json()
    if "error_code" in data:
        raise Exception(f"百度翻译错误 ({data['error_code']}): {data.get('error_msg', '')}")
    results = data.get("trans_result", [])
    return "\n".join(r.get("dst", "") for r in results)

async def translate_with_ai(text: str, from_lang: str, to_lang: str, provider_id: str, model: str, template: str) -> str:
    """用 AI 模型翻译"""
    providers = load_api_providers()
    provider = next((p for p in providers if p.get("id") == provider_id), None)
    if not provider:
        raise Exception(f"未找到 provider: {provider_id}")
    base_url = (provider.get("base_url") or "").strip()
    if not base_url:
        raise Exception("provider 未配置 base_url")
    # 读取 API Key
    env_key = f"{provider_id.upper()}_API_KEY"
    api_key = os.environ.get(env_key, "").strip()
    if not api_key:
        try:
            api_env = os.path.join(BASE_DIR, "API", ".env")
            if os.path.exists(api_env):
                with open(api_env, 'r', encoding='utf-8-sig') as f:
                    for line in f.read().splitlines():
                        line = line.strip()
                        if not line or line.startswith('#') or '=' not in line:
                            continue
                        k, v = line.split('=', 1)
                        if k.strip().upper() == env_key.upper():
                            api_key = v.strip().strip('"').strip("'")
                            break
        except Exception:
            pass
    if not api_key:
        raise Exception("未配置 API Key")
    if not model:
        chat_models = provider.get("chat_models") or []
        model = chat_models[0] if chat_models else "gpt-4o-mini"
    lang_names = {"zh": "中文", "en": "英文", "ja": "日文", "ko": "韩文", "fr": "法文", "de": "德文", "ru": "俄文", "es": "西班牙文", "pt": "葡萄牙文", "ar": "阿拉伯文", "th": "泰文", "vi": "越南文"}
    from_name = lang_names.get(from_lang, from_lang)
    to_name = lang_names.get(to_lang, to_lang)
    # 构建翻译 prompt,明确指定源语言和目标语言
    prompt = f"将以下{from_name}文本翻译成{to_name},只输出翻译结果,不要任何解释:\n\n{text}"
    if base_url.endswith('/v1'):
        url = f"{base_url}/chat/completions"
    else:
        url = f"{base_url}/v1/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {sanitize_api_key(api_key)}"}
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2048,
        "stream": False
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code >= 400:
            raise Exception(f"AI API 错误 ({resp.status_code}): {resp.text[:200]}")
        data = resp.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

@app.post("/api/translate")
async def translate_text(payload: dict):
    text = (payload.get("text") or "").strip()
    direction = payload.get("direction", "zh2en")
    if not text:
        return {"success": False, "error": "请输入要翻译的文本"}
    cfg = load_translate_config()
    # 解析方向:zh2en, en2ja, zh2fr 等
    lang_map = {
        'zh': '中文', 'en': '英语', 'ja': '日语', 'ko': '韩语',
        'fr': '法语', 'de': '德语', 'es': '西班牙语', 'pt': '葡萄牙语',
        'ru': '俄语', 'ar': '阿拉伯语', 'th': '泰语', 'vi': '越南语'
    }
    parts = direction.split('2')
    if len(parts) == 2 and parts[0] in lang_map and parts[1] in lang_map:
        from_lang, to_lang = parts[0], parts[1]
    elif direction == 'zh2en':
        from_lang, to_lang = cfg.get('source_lang', 'zh'), cfg.get('target_lang', 'en')
    else:
        from_lang, to_lang = 'zh', 'en'
    provider_type = cfg.get("provider_type", "ai")
    try:
        if provider_type == "baidu":
            app_id = cfg.get("baidu_app_id", "")
            secret_key = cfg.get("baidu_secret_key", "")
            if not app_id or not secret_key:
                return {"success": False, "error": "未配置百度翻译 App ID 或 Secret Key"}
            result = await translate_with_baidu(text, from_lang, to_lang, app_id, secret_key)
        else:
            ai_pid = cfg.get("ai_provider_id", "")
            if not ai_pid:
                return {"success": False, "error": "未选择 AI 翻译模型"}
            result = await translate_with_ai(
                text, from_lang, to_lang, ai_pid,
                cfg.get("ai_model", ""),
                cfg.get("ai_prompt_template", "将以下提示词翻译成目标语言,只输出翻译结果:\n\n{text}")
            )
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/translate/test")
async def test_translate():
    cfg = load_translate_config()
    test_text = "一只粉色头发的女孩在夕阳下的海滩上微笑,穿着白色连衣裙"
    try:
        if cfg.get("provider_type") == "baidu":
            app_id = cfg.get("baidu_app_id", "")
            sk = cfg.get("baidu_secret_key", "")
            if not app_id or not sk:
                return {"success": False, "error": "未配置百度翻译 App ID 或 Secret Key"}
            result = await translate_with_baidu(test_text, "zh", "en", app_id, sk)
        else:
            ai_pid = cfg.get("ai_provider_id", "")
            if not ai_pid:
                return {"success": False, "error": "未选择 AI 翻译模型"}
            result = await translate_with_ai(
                test_text, "zh", "en", ai_pid,
                cfg.get("ai_model", ""),
                cfg.get("ai_prompt_template", "将以下提示词翻译成目标语言,只输出翻译结果:\n\n{text}")
            )
        return {"success": True, "result": result, "test_input": test_text}
    except Exception as e:
        return {"success": False, "error": str(e)}

# --- 用户提示词字典 ---

USER_PROMPT_DICT_FILE = os.path.join(BASE_DIR, "data", "user-prompt-dict.json")

def load_user_prompt_dict() -> dict:
    if os.path.exists(USER_PROMPT_DICT_FILE):
        try:
            with open(USER_PROMPT_DICT_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"zh2en": {}, "en2zh": {}}

def save_user_prompt_dict(data: dict):
    os.makedirs(os.path.dirname(USER_PROMPT_DICT_FILE), exist_ok=True)
    with open(USER_PROMPT_DICT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.get("/api/prompt-dict")
async def get_prompt_dict():
    return {"success": True, "dict": load_user_prompt_dict()}

@app.post("/api/prompt-dict/learn")
async def learn_prompt_dict(payload: dict):
    """自动学习:将翻译结果的词条对写入用户字典"""
    entries = payload.get("entries", {})
    if not entries:
        return {"success": False, "error": "无词条数据"}
    user_dict = load_user_prompt_dict()
    added = 0
    skipped = 0
    for direction in ["zh2en", "en2zh"]:
        pairs = entries.get(direction, {})
        if not pairs:
            continue
        if direction not in user_dict:
            user_dict[direction] = {}
        for src, tgt in pairs.items():
            src = src.strip()
            tgt = tgt.strip()
            if not src or not tgt:
                skipped += 1
                continue
            if src in user_dict[direction]:
                skipped += 1
                continue
            user_dict[direction][src] = tgt
            added += 1
    save_user_prompt_dict(user_dict)
    return {"success": True, "added": added, "skipped": skipped}

# --- ModelScope 角度控制 ---

@app.post("/api/angle/poll_status")
async def poll_angle_cloud(req: CloudPollRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = sanitize_api_key((req.api_key or MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    task_id = req.task_id
    print(f"Resuming polling for Angle Task: {task_id}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    file_path = os.path.join(OUTPUT_DIR, filename)
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = f"/output/{filename}"
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": f"Resumed {task_id}", "images": [local_path], "type": "angle"}
                        save_to_history(record)
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        return {"url": local_path}

                    elif status == "FAILED":
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise Exception(f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    print(f"Angle polling error: {loop_e}")
                    continue

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except Exception as e:
        print(f"Angle polling error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/angle/generate")
async def generate_angle_cloud(req: CloudGenRequest, token: str = ""):
    username = get_username_by_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = sanitize_api_key((req.api_key or MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": "Qwen/Qwen-Image-Edit-2511",
        "prompt": req.prompt.strip(),
        "image_url": req.image_urls
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(f"{base_url}v1/images/generations", headers=headers, json=payload)
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"Angle Task submitted, ID: {task_id}")

            for i in range(300):
                await asyncio.sleep(0.5)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    if username:
                                        user_dir, _ = get_user_output_dir(username)
                                        file_path = os.path.join(user_dir, filename)
                                        local_path = build_output_url(None, filename, username)
                                    else:
                                        file_path = os.path.join(OUTPUT_DIR, filename)
                                        local_path = f"/output/{filename}"
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "angle"}
                        save_to_history(record)
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        if GLOBAL_LOOP:
                            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(record), GLOBAL_LOOP)
                        return {"url": local_path, "task_id": task_id}

                    elif status == "FAILED":
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise Exception(f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    print(f"Angle polling error: {loop_e}")
                    continue

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Angle generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# --- ModelScope Z-Image 云端生图 ---

@app.post("/generate")
async def generate_cloud(req: CloudGenRequest, token: str = ""):
    username = get_username_by_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = sanitize_api_key((req.api_key or MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": req.prompt.strip(),
        "size": req.resolution,
        "n": 1
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers={**headers, "X-ModelScope-Async-Mode": "true"},
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"Z-Image Task submitted, ID: {task_id}")

            for i in range(200):
                await asyncio.sleep(0.8)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if i % 5 == 0:
                        print(f"Task {task_id} status check {i}: {status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_{int(time.time())}.png"
                                    if username:
                                        user_dir, _ = get_user_output_dir(username)
                                        file_path = os.path.join(user_dir, filename)
                                        local_path = build_output_url(None, filename, username)
                                    else:
                                        file_path = os.path.join(OUTPUT_DIR, filename)
                                        local_path = f"/output/{filename}"
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                else:
                                    local_path = img_url
                        except Exception as dl_e:
                            print(f"Download error: {dl_e}")
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "cloud"}
                        save_to_history(record)
                        try:
                            await manager.broadcast_new_image(record)
                        except Exception:
                            pass
                        return {"url": local_path}

                    elif status == "FAILED":
                        raise Exception(f"ModelScope task failed: {data}")

                except Exception as loop_e:
                    print(f"Polling error (retrying): {loop_e}")
                    continue

            raise Exception("Cloud generation timeout")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Cloud generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# --- ModelScope 通用图片生成(支持图生图) ---

@app.post("/api/ms/generate")
async def ms_generate(req: MsGenerateRequest, token: str = ""):
    username = get_username_by_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = sanitize_api_key(MODELSCOPE_API_KEY.strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 MODELSCOPE_API_KEY,请在 API/.env 中填写。")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": req.model,
        "prompt": req.prompt.strip(),
    }
    if req.width and req.height:
        payload["width"] = req.width
        payload["height"] = req.height
    if req.image_urls:
        payload["image_url"] = req.image_urls
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers=headers,
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"MS Generate Task submitted ({req.model}), ID: {task_id}")

            TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

            for i in range(300):
                await asyncio.sleep(0.5)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")
                    print(f"MS Task {task_id} poll {i}: status={status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                    if username:
                                        user_dir, _ = get_user_output_dir(username)
                                        file_path = os.path.join(user_dir, filename)
                                        local_path = build_output_url(None, filename, username)
                                    else:
                                        file_path = os.path.join(OUTPUT_DIR, filename)
                                        local_path = f"/output/{filename}"
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {
                            "timestamp": time.time(),
                            "prompt": req.prompt,
                            "images": [local_path],
                            "type": "klein",
                            "model": req.model,
                        }
                        save_to_history(record)
                        if GLOBAL_LOOP:
                            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(record), GLOBAL_LOOP)
                        return {"url": local_path, "task_id": task_id}

                    elif status in TERMINAL_FAILED_STATUSES:
                        error_info = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                        raise HTTPException(status_code=502, detail=f"MS task {status}: {error_info}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    print(f"MS polling error: {loop_e}")
                    continue

            raise HTTPException(status_code=504, detail="MS 生图超时")

    except HTTPException:
        raise
    except Exception as e:
        print(f"MS generate error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# --- 本地 ComfyUI 生图 ---

@app.post("/api/generate")
def generate(req: GenerateRequest, token: str = ""):
    global NEXT_TASK_ID
    current_task = None
    target_backend = None
    username = get_username_by_token(token)

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
            if ('EmptyLatent' in ct or 'EmptyFlux' in ct) and 'width' in inp and 'height' in inp:
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
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    workflow[node_id]["inputs"][input_name] = value

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

        history_data = None
        poll_start = time.monotonic()
        while True:  # 无硬性超时限制，等待 ComfyUI 自行完成
            try:
                res = get_comfy_history(target_backend, prompt_id)
                if prompt_id in res:
                    history_data = res[prompt_id]
                    break
            except Exception:
                pass
            elapsed = time.monotonic() - poll_start
            # 长任务日志：超过 60s 后每 60s 打一次进度
            if elapsed > 60 and int(elapsed) % 60 < 1:
                print(f'[Generate] 等待 ComfyUI 完成中… 已等待 {int(elapsed)}s, prompt_id={prompt_id}')
            time.sleep(0.5)

        local_urls = []
        audio_urls = []
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

                    for img in node_output['images']:
                        comfy_url_path = f"/view?filename={img['filename']}&subfolder={img['subfolder']}&type={img['type']}"
                        prefix = f"{req.type}_{int(current_timestamp)}_"
                        local_path = download_image(target_backend, comfy_url_path, prefix=prefix, canvas=canvas, username=username, feature=req.feature)
                        if req.convert_to_jpg:
                            local_path = convert_output_to_jpg(local_path)
                        local_urls.append(local_path)

                # Extract audio outputs (TTS)
                if 'audio' in node_output:
                    for aud in node_output['audio']:
                        comfy_url_path = f"/view?filename={aud['filename']}&subfolder={aud.get('subfolder', '')}&type={aud.get('type', 'temp')}"
                        # 使用自定义前缀或默认前缀
                        save_prefix = req.params.get('save_prefix', 'tts') if req.params else 'tts'
                        prefix = f"{save_prefix}_{int(current_timestamp)}_"
                        local_path = download_audio(target_backend, comfy_url_path, prefix=prefix, canvas=canvas, username=username, subfolder="tts")
                        audio_urls.append(local_path)

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
            print(f"[TextOutput] WARNING: No text extracted from ComfyUI history")
            text_url = ""

        if not local_urls and not audio_urls and not output_text:
            comfy_error = ""
            if isinstance(history_data, dict):
                status_info = history_data.get("status", {})
                if isinstance(status_info, dict):
                    # status_str 是工作流执行状态 ("success" / "error" 等),不是错误信息;
                    # 仅当 status_str == "error" 时,才从 messages 中提取真正的异常描述
                    if status_info.get("status_str") == "error":
                        for msg in status_info.get("messages", []) or []:
                            if isinstance(msg, list) and len(msg) >= 2 and msg[0] == "execution_error" and isinstance(msg[1], dict):
                                exc_type = msg[1].get("exception_type", "") or "Error"
                                exc_msg = msg[1].get("exception_message", "") or msg[1].get("message", "")
                                comfy_error = f"{exc_type}: {exc_msg}".strip(": ")
                                break
                    # 兜底:status 字典里直接带 error 字段的情况
                    if not comfy_error and status_info.get("error"):
                        comfy_error = str(status_info.get("error"))
                if not comfy_error:
                    for node_id, node_out in history_data.get("outputs", {}).items():
                        if isinstance(node_out, dict) and "error" in node_out:
                            comfy_error = str(node_out["error"])
                            break
            # 打印完整 ComfyUI 响应用于调试
            print(f"[ComfyUI-Debug] history_data keys: {list(history_data.keys()) if isinstance(history_data, dict) else type(history_data)}")
            if isinstance(history_data, dict):
                print(f"[ComfyUI-Debug] status: {history_data.get('status', {})}")
                for nid, nout in history_data.get("outputs", {}).items():
                    print(f"[ComfyUI-Debug] node {nid} output: {json.dumps(nout, ensure_ascii=False)[:500]}")
            if comfy_error:
                raise Exception(f"ComfyUI 执行失败: {comfy_error}")
            raise Exception("ComfyUI 未返回输出,请检查工作流配置或确认模型已安装")

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
            "params": req.params
        }
        save_to_history(result)
        # Broadcast if there are images, audio OR text output
        # 但ps.json和ps_send.json工作流不广播,由前端自行处理
        if GLOBAL_LOOP and (local_urls or audio_urls or output_text) and req.workflow_json not in ('ps.json', 'ps_send.json'):
            asyncio.run_coroutine_threadsafe(manager.broadcast_new_image(result), GLOBAL_LOOP)
        return result

    except Exception as e:
        return {"images": [], "audio": [], "error": str(e)}
    finally:
        if target_backend:
            with LOAD_LOCK:
                if BACKEND_LOCAL_LOAD.get(target_backend, 0) > 0:
                    BACKEND_LOCAL_LOAD[target_backend] -= 1
        if current_task:
            with QUEUE_LOCK:
                if current_task in QUEUE:
                    QUEUE.remove(current_task)

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

class ApiProviderPayload(BaseModel):
    id: str = ""
    name: str = ""
    base_url: str = ""
    protocol: str = "openai"
    api_key: Optional[str] = None
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    primary: bool = False
    enabled: bool = True

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""

@app.get("/api/providers")
async def api_providers():
    """获取 API 提供商列表"""
    return {"providers": [public_provider(p) for p in load_api_providers()]}

@app.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    """保存 API 提供商列表"""
    providers = []
    env_updates = {}

    # 收集 primary 标记
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]

    for item in payload:
        provider = normalize_provider(item.dict(exclude={"api_key"}))

        # 检查 ID 重复
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复:{provider['id']}")

        providers.append(provider)

        # 收集 API Key
        if item.api_key is not None:
            env_updates[provider_key_env(provider["id"])] = item.api_key.strip()

        # 收集其他配置
        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
            env_updates["IMAGE_MODELS"] = ",".join(provider["image_models"])
            env_updates["CHAT_MODELS"] = ",".join(provider["chat_models"])
            env_updates["VIDEO_MODELS"] = ",".join(provider.get("video_models") or [])

        if provider["id"] == "modelscope":
            env_updates["MODELSCOPE_CHAT_MODELS"] = ",".join(provider["chat_models"])

    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")

    # 强制最多一个 primary(取最后被标记的)
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)

    save_api_providers(providers)

    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()  # 立即同步环境变量

    return {"providers": [public_provider(p) for p in providers]}

@app.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    """测试请求地址是否可用:调用上游 /v1/models"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")

    api_key = (payload.api_key or "").strip()
    # 检测预览/掩码串（含 • … 等），视为空值，走 .env 兜底
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = read_api_env_value(provider_key_env(payload.provider_id))

    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })

        if resp.status_code >= 400:
            return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}

        data = resp.json() if resp.text else {}
        items = (data.get("data") if isinstance(data, dict) else None) or []

        # 抽取模型 ID
        ids = []
        for it in items:
            if isinstance(it, str):
                ids.append(it)
            elif isinstance(it, dict):
                mid = it.get("id") or it.get("name") or it.get("model")
                if mid:
                    ids.append(str(mid))

        ids = sorted(set(ids))

        # 关键字分类
        def classify(mid):
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
            "ok": True,
            "status": resp.status_code,
            "model_count": len(ids),
            "image_models": grouped["image"],
            "chat_models": grouped["chat"],
            "video_models": grouped["video"],
            "all": ids
        }
    except httpx.HTTPError as e:
        return {"ok": False, "status": 0, "message": str(e)[:300]}

@app.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    """验证异步协议:用假 task_id 请求 GET /v1/tasks/{fake_id}"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    api_key = (payload.api_key or "").strip()
    # 检测预览/掩码串（含 • … 等），视为空值，走 .env 兜底
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = read_api_env_value(provider_key_env(payload.provider_id))

    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })

        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]

        sc = resp.status_code
        err_msg = ""
        if isinstance(body, dict):
            err = body.get("error") or {}
            if isinstance(err, dict):
                err_msg = str(err.get("message") or "").lower()
            else:
                err_msg = str(err).lower()

        # 判断结果
        if sc == 400 and "invalid task id" in err_msg:
            return {"ok": True, "status_code": sc, "message": "异步任务端点可用,API Key 已通过认证", "raw": body}

        if sc in (401, 403):
            return {"ok": False, "status_code": sc, "message": "API Key 无效或无权限", "raw": body}

        if sc == 404:
            return {"ok": False, "status_code": sc, "message": "平台不支持 /v1/tasks/ 端点,可能不是 APIMart 异步协议", "raw": body}

        if 400 <= sc < 500:
            return {"ok": None, "status_code": sc, "message": f"端点返回 {sc},请查看原始响应判断", "raw": body}

        if sc < 300:
            return {"ok": True, "status_code": sc, "message": f"端点返回 {sc}(意外成功)", "raw": body}

        return {"ok": False, "status_code": sc, "message": f"服务端错误 {sc}", "raw": body}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])

async def fetch_models_from_upstream(base_url: str, api_key: str):
    """从 OpenAI 兼容 /v1/models 端点拉取模型"""
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")

    api_key = (api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=f"上游 /v1/models 失败:{resp.text[:300]}")
            raw = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败:{e}")

    # 兼容多种返回结构
    items = raw.get("data") if isinstance(raw, dict) else None
    if not items and isinstance(raw, dict):
        items = raw.get("models") or raw.get("list") or []
    if not isinstance(items, list):
        items = []

    ids = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                ids.append(str(mid))

    ids = sorted(set(ids))

    # 分类规则
    def classify(mid):
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
        "image_models": grouped["image"],
        "chat_models": grouped["chat"],
        "video_models": grouped["video"],
        "all": ids
    }

@app.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    """按页面当前表单值拉取模型"""
    api_key = (payload.api_key or "").strip()
    # 检测预览/掩码串（含 • … 等），视为空值，走 .env 兜底
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = read_api_env_value(provider_key_env(payload.provider_id))
    return await fetch_models_from_upstream(payload.base_url, api_key)

@app.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    """从已保存的上游接口拉取模型列表"""
    provider = get_api_provider_exact(provider_id)
    api_key = read_api_env_value(provider_key_env(provider["id"]))
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key)

# --- 即梦 CLI API ---

@app.get("/api/jimeng/status")
async def jimeng_status():
    exe = jimeng_cli_executable()
    if not exe:
        return {"installed": False, "logged_in": False, "message": "未找到 dreamina CLI"}
    version, version_text = await jimeng_cli_version()
    version_str = ".".join(str(part) for part in version) if version else None
    version_ok = version >= JIMENG_MIN_CLI_VERSION if version else None
    min_version_str = ".".join(str(part) for part in JIMENG_MIN_CLI_VERSION)
    try:
        raw = await run_jimeng_cli(["user_credit"], timeout=30)
        return {
            "installed": True,
            "logged_in": True,
            "raw": raw,
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }
    except HTTPException as exc:
        return {
            "installed": True,
            "logged_in": False,
            "message": str(exc.detail),
            "cli_version": version_str,
            "version_ok": version_ok,
            "min_version": min_version_str,
        }

@app.get("/api/jimeng/credit")
async def jimeng_credit():
    raw = await run_jimeng_cli(["user_credit"], timeout=30)
    return {"success": True, "raw": raw}

@app.post("/api/jimeng/logout")
async def jimeng_logout():
    raw = await run_jimeng_cli(["logout"], timeout=30)
    return {"success": True, "raw": raw}

@app.post("/api/jimeng/login/start")
async def jimeng_login_start():
    old_proc = JIMENG_LOGIN_SESSION.get("proc")
    if old_proc and getattr(old_proc, "returncode", None) is None:
        try:
            old_proc.terminate()
        except Exception:
            pass
    exe = jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 dreamina CLI")
    JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
    args = ["login", "--headless"]
    command = jimeng_command(args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI:{exe}") from exc
    JIMENG_LOGIN_SESSION["proc"] = proc
    asyncio.create_task(jimeng_login_reader(proc))
    await asyncio.sleep(2)
    text = jimeng_login_text()
    if proc.returncode not in (None, 0) and ("unknown" in text.lower() or "no such option" in text.lower()):
        JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
        proc = await asyncio.create_subprocess_exec(
            *jimeng_command(["login", "--debug"], exe),
            cwd=BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        JIMENG_LOGIN_SESSION["proc"] = proc
        asyncio.create_task(jimeng_login_reader(proc))
        await asyncio.sleep(2)
        text = jimeng_login_text()
    return {
        "success": True,
        "running": JIMENG_LOGIN_SESSION.get("proc") is not None and JIMENG_LOGIN_SESSION["proc"].returncode is None,
        "text": text,
        "qr_url": jimeng_login_qr_from_text(text),
        "started_at": JIMENG_LOGIN_SESSION.get("started_at") or 0,
    }

@app.get("/api/jimeng/login/status")
async def jimeng_login_status():
    proc = JIMENG_LOGIN_SESSION.get("proc")
    text = jimeng_login_text()
    running = proc is not None and getattr(proc, "returncode", None) is None
    logged_in = False
    credit_raw = None
    if not running:
        try:
            credit_raw = await run_jimeng_cli(["user_credit"], timeout=20)
            logged_in = True
        except HTTPException:
            logged_in = False
    return {
        "success": True,
        "running": running,
        "logged_in": logged_in,
        "text": text,
        "qr_url": jimeng_login_qr_from_text(text),
        "raw": credit_raw,
    }

@app.post("/api/jimeng/help")
async def jimeng_help(payload: JimengHelpRequest):
    command = str(payload.command or "").strip()
    allowed = {"", "login", "logout", "user_credit", "text2image", "image2image", "image_upscale", "text2video", "image2video", "multimodal2video", "frames2video", "multiframe2video", "list_task", "query_result"}
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不支持的帮助命令")
    args = [command, "-h"] if command else ["-h"]
    raw = await run_jimeng_cli(args, timeout=30, raw_text=True)
    text = raw.get("_stdout") or ""
    if raw.get("_stderr"):
        text = f"{text}\n{raw.get('_stderr')}".strip()
    return {"success": True, "command": command, "text": text, "raw": raw}

@app.post("/api/jimeng/query-media")
async def jimeng_query_media(payload: JimengQueryMediaRequest):
    """按 submit_id 续查即梦任务:出图返回 succeeded+urls;仍排队返回 pending+queue_info;失败返回 failed。"""
    submit_id = str(payload.submit_id or "").strip()
    if not submit_id:
        raise HTTPException(status_code=400, detail="缺少 submit_id")
    kind = str(payload.kind or "image").strip().lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    queried = await jimeng_query_result(submit_id, kind)
    try:
        urls = await jimeng_store_outputs(queried, kind, allow_query=False)
        return {"status": "succeeded", "submit_id": submit_id, "kind": kind, "urls": urls}
    except JimengPendingError as exc:
        return {"status": "pending", "submit_id": submit_id, "kind": kind, "queue_info": exc.queue_info, "message": jimeng_pending_payload(exc)["message"]}
    except HTTPException as exc:
        return {"status": "failed", "submit_id": submit_id, "kind": kind, "error": str(getattr(exc, "detail", "") or exc)}

# --- ComfyUI 设置相关 API ---

# 工作流名称校验正则
WORKFLOW_NAME_RE = re.compile(r'^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\.\-_\/ ]*\.json$')

# 内置工作流列表(workflows/ 根级 + text2image/ 子目录下的文生图生成器)
BUILTIN_WORKFLOW_DIRS = [WORKFLOW_DIR, os.path.join(WORKFLOW_DIR, "text2image")]
BUILTIN_WORKFLOWS = set()
for _wd in BUILTIN_WORKFLOW_DIRS:
    if not os.path.isdir(_wd):
        continue
    for fn in os.listdir(_wd):
        if fn.endswith('.json') and not fn.endswith('.config.json') and os.path.isfile(os.path.join(_wd, fn)):
            rel = os.path.relpath(os.path.join(_wd, fn), WORKFLOW_DIR).replace("\\", "/")
            BUILTIN_WORKFLOWS.add(rel)

def update_env_values(updates):
    """更新 .env 文件中的配置值"""
    env_path = os.path.join(os.path.dirname(__file__), "API", ".env")
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

@app.get("/api/comfyui/instances")
async def get_comfyui_instances():
    """获取 ComfyUI 实例列表"""
    return {"instances": COMFYUI_INSTANCES.copy(), "basePath": COMFYUI_BASE_PATH or ""}

@app.put("/api/comfyui/base-path")
async def update_comfyui_base_path(req: dict):
    """更新 ComfyUI 基础路径"""
    global COMFYUI_BASE_PATH
    path = str(req.get("path", "")).strip().rstrip("\\").rstrip("/")
    if path and not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"路径不存在:{path}")
    try:
        update_env_values({"COMFYUI_BASE_PATH": path})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败:{e}")
    COMFYUI_BASE_PATH = path
    return {"basePath": COMFYUI_BASE_PATH}

@app.put("/api/comfyui/instances")
async def update_comfyui_instances(req: ComfyUIInstancesUpdateRequest):
    """更新 ComfyUI 实例列表"""
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD

    # 清洗实例地址
    cleaned = []
    for item in req.instances:
        s = str(item or "").strip()
        if not s:
            continue
        # 去除 http(s):// 前缀
        s = re.sub(r"^https?://", "", s)
        # 去除尾部斜杠
        s = s.rstrip("/")
        # 校验格式:host:port
        if ":" not in s:
            raise HTTPException(status_code=400, detail=f"地址缺少端口号:{item}(应为 host:port,例如 127.0.0.1:8188)")
        host, _, port = s.rpartition(":")
        if not host or not port.isdigit():
            raise HTTPException(status_code=400, detail=f"地址不合法:{item}(应为 host:port,例如 127.0.0.1:8188)")
        # 去重
        if s in cleaned:
            continue
        cleaned.append(s)

    if not cleaned:
        raise HTTPException(status_code=400, detail="至少需要一个 ComfyUI 实例地址")

    # 保存到 .env 文件
    try:
        update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置文件失败:{e}")

    # 更新全局变量
    COMFYUI_INSTANCES = cleaned
    COMFYUI_ADDRESS = cleaned[0]
    new_load = {addr: 0 for addr in cleaned}
    # 保留已有的负载计数
    for addr, n in BACKEND_LOCAL_LOAD.items():
        if addr in new_load:
            new_load[addr] = n
    BACKEND_LOCAL_LOAD = new_load

    return {"instances": COMFYUI_INSTANCES.copy()}

# ---- ComfyUI 进程管理 (启动/停止) ----
_comfyui_process: Optional[subprocess.Popen] = None

@app.post("/api/comfyui/start")
async def start_comfyui_process():
    """启动 ComfyUI 后端进程"""
    global _comfyui_process

    # 检查是否已在运行
    if await get_comfyui_health():
        if _comfyui_process is not None and _comfyui_process.poll() is None:
            return {"status": "already_running", "pid": _comfyui_process.pid}
        return {"status": "already_running", "note": "ComfyUI 后端已达"}

    base_path = COMFYUI_BASE_PATH or ""
    if not base_path or not os.path.isdir(base_path):
        # 尝试从 env 推断
        base_path = os.environ.get("COMFYUI_BASE_PATH", "").rstrip("\\")
        if not base_path or not os.path.isdir(base_path):
            raise HTTPException(status_code=400, detail="未配置 ComfyUI 路径，请先在设置-路径中配置")

    if not os.path.isfile(os.path.join(base_path, "main.py")):
        # 也许 base_path 是 AIO 根目录，main.py 在 ComfyUI/ 下
        if os.path.isfile(os.path.join(base_path, "ComfyUI", "main.py")):
            base_path = os.path.join(base_path, "ComfyUI")
        else:
            raise HTTPException(status_code=400, detail=f"ComfyUI 主程序不存在: {os.path.join(base_path, 'main.py')}")

    main_py = os.path.join(base_path, "main.py")

    # 查找 Python 可执行文件
    parent = os.path.dirname(base_path)
    candidates = [
        os.path.join(parent, "python", "python.exe"),
        os.path.join(base_path, "..", "..", "python", "python.exe"),
    ]
    python_exe = ""
    for c in candidates:
        resolved = os.path.abspath(c)
        if os.path.isfile(resolved):
            python_exe = resolved
            break
    if not python_exe:
        # 系统 PATH 中的 python
        import shutil
        python_exe = shutil.which("python") or shutil.which("python3") or "python"

    cmd = [
        python_exe, "-s", main_py,
        "--windows-standalone-build",
        "--fast", "fp16_accumulation",
        "--disable-xformers",
        "--listen",
    ]

    # 日志文件: logs/comfyui-YYYYMMDD-HHMMSS.log
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_name = time.strftime("comfyui-%Y%m%d-%H%M%S.log")
    log_path = os.path.join(log_dir, log_name)
    log_fh = open(log_path, "ab", buffering=0)

    print(f"启动 ComfyUI: {' '.join(cmd)}")
    print(f"  日志: {log_path}")
    try:
        _comfyui_process = subprocess.Popen(
            cmd,
            cwd=base_path,
            stdout=log_fh,
            stderr=log_fh,
        )
        return {"status": "started", "pid": _comfyui_process.pid, "log": log_path}
    except Exception as e:
        print(f"启动 ComfyUI 失败: {e}")
        log_fh.close()
        raise HTTPException(status_code=500, detail=f"启动失败: {e}")


@app.post("/api/comfyui/stop")
async def stop_comfyui_process():
    """停止 ComfyUI 后端进程"""
    global _comfyui_process

    killed = []
    if _comfyui_process is not None and _comfyui_process.poll() is None:
        try:
            _comfyui_process.terminate()
            _comfyui_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _comfyui_process.kill()
            _comfyui_process.wait()
        killed.append(f"proc:{_comfyui_process.pid}")
        _comfyui_process = None

    # 也尝试通过端口 kill 残留进程（如果配置了实例地址）
    for addr in COMFYUI_INSTANCES:
        try:
            host_part, _, port_part = addr.rpartition(":")
            port = int(port_part)
            try:
                import psutil
                for conn in psutil.net_connections():
                    if conn.laddr.port == port and conn.status == "LISTEN":
                        try:
                            p = psutil.Process(conn.pid)
                            p.terminate()
                            p.wait(timeout=5)
                            killed.append(f"port:{port} pid:{conn.pid}")
                        except:
                            pass
            except ImportError:
                pass
        except:
            pass

    if killed:
        return {"status": "stopped", "details": killed}
    return {"status": "not_running"}


async def get_comfyui_health() -> bool:
    """检查 ComfyUI 后端是否可达"""
    if not COMFYUI_INSTANCES:
        return False
    addr = COMFYUI_INSTANCES[0]
    url = f"http://{addr}/system_stats"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
            return r.status_code == 200
    except:
        return False


@app.get("/api/comfyui/process-status")
async def get_comfyui_status():
    """获取 ComfyUI 进程状态"""
    running = _comfyui_process is not None and _comfyui_process.poll() is None
    reachable = await get_comfyui_health()

    return {
        "running": running,
        "pid": _comfyui_process.pid if running else None,
        "reachable": reachable,
    }


def _find_latest_comfyui_log() -> Optional[str]:
    """查找 logs/ 下最新的 comfyui-*.log"""
    log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    if not os.path.isdir(log_dir):
        return None
    logs = sorted(glob.glob(os.path.join(log_dir, "comfyui-*.log")), key=os.path.getmtime, reverse=True)
    return logs[0] if logs else None


@app.get("/api/comfyui/log-tail")
async def get_comfyui_log_tail(lines: int = 80, max_bytes: int = 200_000):
    """读取 ComfyUI 日志最后 N 行。max_bytes 限制读取大小，避免巨文件。"""
    log_path = _find_latest_comfyui_log()
    if not log_path or not os.path.isfile(log_path):
        return {"path": None, "content": "(暂无日志)"}
    try:
        size = os.path.getsize(log_path)
        with open(log_path, "rb") as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
            data = f.read()
        # 容错解码: ComfyUI 的中文在 Windows 可能是 cp936/utf-8 混合
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                text = data.decode(enc, errors="replace")
                break
            except:
                continue
        else:
            text = data.decode("utf-8", errors="replace")
        # 只保留最后 lines 行
        all_lines = text.splitlines()
        tail = "\n".join(all_lines[-lines:]) if lines > 0 else text
        return {
            "path": log_path,
            "size": size,
            "content": tail,
        }
    except Exception as e:
        return {"path": log_path, "content": f"读取失败: {e}"}


@app.post("/api/comfyui/log-clear")
async def clear_comfyui_log():
    """清空当前 ComfyUI 日志（截断到 0）"""
    log_path = _find_latest_comfyui_log()
    if not log_path or not os.path.isfile(log_path):
        return {"status": "no_log"}
    try:
        with open(log_path, "wb") as f:
            pass
        return {"status": "cleared", "path": log_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清空失败: {e}")


# --- ComfyUI 代理端点(供前端在 non-local 模式下使用) ---

# object_info 缓存:避免每次请求都向 ComfyUI 拉全量数据(数据量大且响应慢)
_object_info_cache = {"data": None, "ts": 0}
_OBJECT_INFO_CACHE_TTL = 30  # 秒

@app.get("/api/comfyui/object_info")
@app.get("/api/comfyui/object_info/{node_type:path}")
async def proxy_comfyui_object_info(node_type: str = None):
    """代理获取 ComfyUI 节点信息(含模型列表等),支持按节点类型查询"""
    import time
    now = time.time()
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        # 无 node_type 时使用缓存
        if node_type is None and _object_info_cache["data"] and (now - _object_info_cache["ts"] < _OBJECT_INFO_CACHE_TTL):
            return Response(content=_object_info_cache["data"], media_type="application/json")
        base = f"http://{target}/object_info"
        url = f"{base}/{node_type}" if node_type else base
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url)
        if node_type is None:
            _object_info_cache["data"] = resp.content
            _object_info_cache["ts"] = now
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI object_info 请求失败: {str(e)}")

@app.get("/api/comfyui/loras")
async def list_comfyui_loras():
    """从 ComfyUI 获取可用 LoRA 列表(查询 LoraLoader 和 LoraLoaderModelOnly 节点)"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    all_loras = set()
    node_types = ["LoraLoaderModelOnly", "LoraLoader"]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for node_type in node_types:
                try:
                    url = f"http://{target}/object_info/{node_type}"
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    node_info = data.get(node_type, data)
                    input_params = node_info.get("input", {}).get("required", {})
                    lora_field = input_params.get("lora_name", None)
                    if lora_field and isinstance(lora_field, list) and len(lora_field) > 0:
                        loras = lora_field[0] if isinstance(lora_field[0], list) else []
                        all_loras.update(loras)
                except Exception:
                    continue
        return {"loras": sorted(all_loras)}
    except Exception as e:
        import traceback as _tb
        _tb.print_exc()
        raise HTTPException(status_code=502, detail=f"获取 LoRA 列表失败: {str(e)}")

import socket as _sock
@app.get("/api/_dbug")
async def _dbug():
    import traceback as _tb_
    r = {}
    # 0) COMFYUI_ADDRESS 的真面目
    r["address_repr"] = repr(COMFYUI_ADDRESS)
    # 1) 原生 socket
    try:
        s = _sock.create_connection(("127.0.0.1", 8188), timeout=5); s.close()
        r["raw"] = "OK"
    except Exception as e:
        r["raw"] = f"{type(e).__name__}: {e}"; r["raw_tb"] = _tb_.format_exc()
    # 2) httpx GET system_stats
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.get(f"http://{COMFYUI_ADDRESS}/system_stats")
        r["httpx_get"] = f"OK {resp.status_code}"
    except Exception as e:
        r["httpx_get"] = f"{type(e).__name__}: {e}"; r["httpx_get_tb"] = _tb_.format_exc()
    # 3) httpx POST prompt (同生成)
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.post(f"http://{COMFYUI_ADDRESS}/prompt", json={"prompt":{},"client_id":"_dbug"})
        r["httpx_post"] = f"OK {resp.status_code}"
    except Exception as e:
        r["httpx_post"] = f"{type(e).__name__}: {e}"; r["httpx_post_tb"] = _tb_.format_exc()
    return r

@app.get("/api/loras/scan")
async def scan_lora_folder(subfolder: str = ""):
    """直接扫描本地 LoRA 文件夹获取完整列表(不依赖 ComfyUI 节点枚举)"""
    if not COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    # 兼容两种路径:ComfyUI 根目录 或 已经是 loras 文件夹
    normalized = COMFYUI_BASE_PATH.lower().replace("\\", "/").rstrip("/")
    if normalized.endswith("/models/loras"):
        lora_dir = COMFYUI_BASE_PATH
    else:
        lora_dir = os.path.join(COMFYUI_BASE_PATH, "models", "loras")
    if subfolder:
        lora_dir = os.path.join(lora_dir, subfolder)
    if not os.path.isdir(lora_dir):
        return {"loras": [], "error": f"目录不存在: {lora_dir}"}
    extensions = {".safetensors", ".pt", ".pth", ".ckpt", ".bin"}
    loras = []
    previews = {}  # rel_path -> preview_url
    # entries: 每条 LoRA 的完整信息(含 modelRoot / versionLabel,用于前端版本合并)
    entries = []

    # 版本号识别:剥掉文件 basename 末尾的「下划线或连字符」接版本号,剩余部分即"模型根名"
    # 覆盖:xxx_v1 / xxx-v11 / xxx_v0.1 / xxx-v2.3
    import re as _re
    _VERSION_TAIL_RE = _re.compile(r'[-_][vV](\d+(?:\.\d+)*)$')

    def _split_model_root(base_name: str):
        m = _VERSION_TAIL_RE.search(base_name)
        if m:
            return base_name[: m.start()], m.group(0).lstrip('_-')  # 根名 + 标签如 v11
        return base_name, ''

    for root, dirs, files in os.walk(lora_dir):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in extensions:
                # 计算相对于 loras 目录的路径
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, lora_dir)
                # 统一用反斜杠(ComfyUI 格式)
                rel_path_bs = rel_path.replace("/", "\\")
                loras.append(rel_path_bs)
                # 检查是否有预览(同名的图片或视频)
                # 视频后缀也作为"预览"返回,对齐 ComfyUI-Lora-Manager 的 find_preview_file 行为
                base = os.path.splitext(full_path)[0]
                # 顺序:长后缀优先(.preview.png 优先于 .png),视频后缀与图片后缀混排
                for preview_ext in [
                    ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                    ".preview.mp4", ".preview.webm",
                    ".png", ".jpg", ".jpeg", ".webp",
                    ".mp4", ".webm", ".gif"
                ]:
                    preview_path = base + preview_ext
                    if os.path.isfile(preview_path):
                        # 返回相对于 ComfyUI 根目录的路径
                        preview_rel = os.path.relpath(preview_path, COMFYUI_BASE_PATH).replace("\\", "/")
                        previews[rel_path_bs] = f"/api/loras/preview?path={preview_rel}"
                        break
                # 拆分 modelRoot + versionLabel,用于前端合并多版本
                file_stem = os.path.splitext(f)[0]
                model_root, version_label = _split_model_root(file_stem)
                entries.append({
                    "name": rel_path_bs,
                    "modelRoot": model_root,
                    "versionLabel": version_label,
                })
    return {
        "loras": sorted(loras),
        "count": len(loras),
        "path": lora_dir,
        "previews": previews,
        "entries": entries,  # 含 modelRoot/versionLabel,供前端版本合并
    }

@app.get("/api/loras/preview")
async def get_lora_preview(path: str, request: Request):
    """获取 LoRA 预览图"""
    if not COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    # 安全校验:防止路径遍历
    if ".." in path:
        raise HTTPException(status_code=400, detail="无效路径")
    full_path = os.path.join(COMFYUI_BASE_PATH, path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="预览图不存在")
    # ETag + Last-Modified 走条件请求,重复访问秒返 304
    try:
        st = os.stat(full_path)
        mtime_ts = int(st.st_mtime)
        size = st.st_size
        etag = f'W/"lora-{mtime_ts}-{size}"'
        last_modified = datetime.fromtimestamp(mtime_ts, tz=timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
    except OSError:
        etag = None
        last_modified = None
    if etag and request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=604800, immutable"})
    if last_modified and request.headers.get('if-modified-since') == last_modified:
        return Response(status_code=304, headers={"Last-Modified": last_modified, "Cache-Control": "public, max-age=604800, immutable"})
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"
    }.get(ext, "image/png")
    # 视频走分块传输 + 接受 Range 请求,便于 <video> 拖动进度
    resp = FileResponse(
        full_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
            "Accept-Ranges": "bytes",
        }
    )
    if etag: resp.headers["ETag"] = etag
    if last_modified: resp.headers["Last-Modified"] = last_modified
    return resp

# --- LoRA Manager 代理端点 ---

@app.get("/api/lora-manager/loras")
async def proxy_lora_manager_list():
    """代理 LoRA Manager 的 LoRA 列表,自动遍历所有分页返回完整数据(含 tags、civitai 元数据)"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        all_items = []
        page = 1
        total_pages = 1
        async with httpx.AsyncClient(timeout=60) as client:
            while page <= total_pages and page <= 30:  # 最多 30 页 = 3000 个 LoRA
                url = f"http://{target}/api/lm/loras/list?page={page}&page_size=100"
                resp = await client.get(url)
                if resp.status_code != 200:
                    return {"items": all_items, "total": len(all_items), "error": f"LoRA Manager 返回 {resp.status_code}"}
                data = resp.json()
                items = data.get("items", [])
                all_items.extend(items)
                total_pages = data.get("total_pages", 1)
                if not items:
                    break
                page += 1
        return {"items": all_items, "total": len(all_items), "page": 1, "page_size": len(all_items), "total_pages": 1}
    except Exception as e:
        return {"items": [], "error": str(e)}


@app.post("/api/lora-manager/fetch-all-civitai")
async def proxy_lora_manager_fetch_all_civitai():
    """触发 LoRA Manager 批量从 civitai 拉取元数据(用于补全 tags)"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/fetch-all-civitai"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={})
        return Response(content=resp.content, media_type="application/json", status_code=resp.status_code)
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/lora-manager/tags-stats")
async def proxy_lora_manager_tags_stats():
    """统计 LoRA Manager 中各 tag 大类的 LoRA 数量"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        all_items = []
        page = 1
        total_pages = 1
        async with httpx.AsyncClient(timeout=60) as client:
            while page <= total_pages and page <= 30:
                url = f"http://{target}/api/lm/loras/list?page={page}&page_size=100"
                resp = await client.get(url)
                if resp.status_code != 200:
                    return {"tags": {}, "total": 0, "error": f"LoRA Manager 返回 {resp.status_code}"}
                data = resp.json()
                items = data.get("items", [])
                all_items.extend(items)
                total_pages = data.get("total_pages", 1)
                if not items:
                    break
                page += 1
        # 统计每个 tag 的 LoRA 数量
        tag_count = {}
        for it in all_items:
            for t in (it.get("tags") or []):
                if isinstance(t, str):
                    tag_count[t] = tag_count.get(t, 0) + 1
        # 排序返回 top 200
        top_tags = sorted(tag_count.items(), key=lambda x: -x[1])[:200]
        return {"tags": dict(top_tags), "total_loras": len(all_items), "tagged_loras": sum(1 for it in all_items if it.get("tags"))}
    except Exception as e:
        return {"tags": {}, "total": 0, "error": str(e)}

@app.get("/api/lora-manager/preview")
async def proxy_lora_manager_preview(name: str):
    """获取 LoRA 封面图"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/preview-url"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            data = resp.json()
            preview_url = data.get("url", "")
            if preview_url:
                # 如果是相对路径,拼上 ComfyUI 地址
                if preview_url.startswith("/"):
                    preview_url = f"http://{target}{preview_url}"
                return {"url": preview_url}
        return {"url": ""}
    except Exception as e:
        return {"url": "", "error": str(e)}

@app.get("/api/lora-manager/proxy-preview")
async def proxy_lora_manager_preview_proxy(url: str):
    """代理 LoRA Manager 的预览图请求(转发到 ComfyUI)"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        # url 是相对路径如 /api/lm/previews?path=...
        full_url = f"http://{target}{url}" if url.startswith("/") else url
        # 生成 ETag 基于 URL
        etag = hashlib.md5(full_url.encode()).hexdigest()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(full_url)
        if resp.status_code == 200:
            ct = resp.headers.get("content-type", "image/jpeg")
            return Response(
                content=resp.content,
                media_type=ct,
                headers={
                    "Cache-Control": "public, max-age=604800, immutable",
                    "ETag": f'"{etag}"',
                }
            )
        raise HTTPException(status_code=resp.status_code, detail="预览图获取失败")
    except httpx.HTTPStatusError:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"代理预览图失败: {str(e)}")

@app.get("/api/lora-manager/metadata")
async def proxy_lora_manager_metadata(name: str):
    """获取 LoRA 元数据(触发词、基础模型、描述等)"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/metadata"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/json")
        return {"metadata": {}}
    except Exception as e:
        return {"metadata": {}, "error": str(e)}

@app.get("/api/lora-manager/trigger-words")
async def proxy_lora_manager_trigger_words(name: str):
    """获取 LoRA 触发词"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/get-trigger-words"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/json")
        return {"triggerWords": []}
    except Exception as e:
        return {"triggerWords": [], "error": str(e)}

@app.get("/api/comfyui/history/{prompt_id}")
async def proxy_comfyui_history(prompt_id: str):
    """代理获取 ComfyUI 任务历史"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/history/{prompt_id}"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI history 请求失败: {str(e)}")

@app.get("/api/comfyui/queue")
async def proxy_comfyui_queue():
    """代理获取 ComfyUI 队列状态（用于前端进度轮询）"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/queue"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI queue 请求失败: {str(e)}")

@app.post("/api/comfyui/prompt")
async def proxy_comfyui_prompt(request: Request):
    """代理提交 ComfyUI 任务"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        body = await request.body()
        url = f"http://{target}/prompt"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, content=body, headers={"Content-Type": "application/json"})
        return Response(content=resp.content, media_type="application/json", status_code=resp.status_code)
    except Exception as e:
        import traceback as _tb
        _tb.print_exc()
        raise HTTPException(status_code=502, detail=f"ComfyUI prompt 请求失败: {str(e)}")

@app.get("/api/comfyui/view")
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


@app.get("/api/comfyui/open-folder")
async def open_comfyui_folder(filename: str = "", subfolder: str = "", type: str = "output"):
    """在资源管理器中打开图片所在文件夹"""
    if not COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    type_map = {"output": "output", "temp": "temp", "input": "input"}
    sub_dir = type_map.get(type, "output")
    folder_path = os.path.join(COMFYUI_BASE_PATH, sub_dir, subfolder or "")
    file_path = os.path.join(folder_path, filename) if filename else folder_path
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=404, detail=f"目录不存在: {folder_path}")
    try:
        if filename and os.path.exists(file_path):
            subprocess.Popen(["explorer", "/select,", file_path])
        else:
            subprocess.Popen(["explorer", folder_path])
        return {"ok": True, "path": file_path if filename else folder_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开文件夹失败: {str(e)}")


@app.get("/api/proxy-download-to-output")
async def proxy_download_to_output(url: str = "", token: str = "", feature: str = "云端图片"):
    """
    将任意远程 URL(ModelScope 等云端临时链接)下载到用户 output 目录
    解决云端 URL 在 5-60 分钟后失效导致缩略图变成"图片已删除"的问题
    """
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url 参数")
    # 安全:只允许 http/https
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="只支持 http/https URL")

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"下载远程图片失败 HTTP {resp.status_code}")

        content = resp.content
        # 从 URL/Content-Type 推断扩展名
        ext = ".png"
        ct = resp.headers.get("content-type", "").lower()
        if "jpeg" in ct or "jpg" in ct:
            ext = ".jpg"
        elif "webp" in ct:
            ext = ".webp"
        elif "png" not in ct:
            # 从 URL 路径猜扩展名
            from urllib.parse import urlparse
            path = urlparse(url).path
            if "." in path:
                e = os.path.splitext(path)[1].lower()
                if e in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                    ext = e

        now = time.localtime()
        username = get_username_by_token(token)
        date_str = f"{now.tm_year:04d}-{now.tm_mon:02d}-{now.tm_mday:02d}"
        if username:
            user_dir = get_user_dirname(username)
            date_path = f"{user_dir}/{feature}/{date_str}"
        else:
            date_path = f"{feature}/{date_str}"
        save_dir = os.path.join(OUTPUT_DIR, date_path)
        os.makedirs(save_dir, exist_ok=True)
        local_name = f"cloud_{uuid.uuid4().hex[:10]}{ext}"
        local_path = os.path.join(save_dir, local_name)
        with open(local_path, "wb") as f:
            f.write(content)

        return {"url": f"/output/{date_path}/{local_name}", "path": local_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"下载远程图片失败: {str(e)}")


@app.get("/api/comfyui/save-to-output")
async def save_comfyui_to_output(filename: str = "", subfolder: str = "", type: str = "output", token: str = "", feature: str = "其他"):
    """将 ComfyUI 的图片保存到用户 output 目录,返回本地 URL

    性能优化(解决 47s 慢问题):
    - 用 client.stream() 边下边写盘,避免内存中转大图(1-2MB 一次性加载)
    - timeout 60s(原 15s 太短,ComfyUI 慢时容易超时)
    """
    import time as _t
    _t_start = _t.perf_counter()
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")

    try:
        # 从 ComfyUI 流式下载到磁盘
        params = {"filename": filename, "subfolder": subfolder, "type": type}
        url = f"http://{target}/view"

        # 存到用户文件夹: output/{user}/{feature}/YYYY-MM-DD/
        ext = os.path.splitext(filename)[1] or ".png"
        now = time.localtime()
        username = get_username_by_token(token)
        date_str = f"{now.tm_year:04d}-{now.tm_mon:02d}-{now.tm_mday:02d}"
        if username:
            user_dir = get_user_dirname(username)
            date_path = f"{user_dir}/{feature}/{date_str}"
        else:
            date_path = f"{feature}/{date_str}"
        save_dir = os.path.join(OUTPUT_DIR, date_path)
        os.makedirs(save_dir, exist_ok=True)
        local_name = f"{feature}_{uuid.uuid4().hex[:10]}{ext}"
        local_path = os.path.join(save_dir, local_name)

        _t_dl = _t.perf_counter()
        bytes_written = 0
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("GET", url, params=params) as resp:
                if resp.status_code != 200:
                    raise HTTPException(status_code=502, detail="从 ComfyUI 获取图片失败")
                with open(local_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(64 * 1024):
                        f.write(chunk)
                        bytes_written += len(chunk)
        _t_dl_cost = (_t.perf_counter() - _t_dl) * 1000
        _t_total = (_t.perf_counter() - _t_start) * 1000
        print(f"[comfyui-save] dl={_t_dl_cost:.0f}ms total={_t_total:.0f}ms bytes={bytes_written//1024}KB {filename[:40]}")



        # === 预生成 WebP 缩略图(与 /api/media-preview 共用缓存,刷新秒出) ===
        async def _prewarm_thumb():
            try:
                from PIL import Image, ImageOps
                def _gen():
                    # 用 media_preview_cache_paths 生成与画廊一致的缓存
                    os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
                    for w_target in (512, 768):
                        webp_path, _ = media_preview_cache_paths(local_path, w_target)
                        if os.path.exists(webp_path):
                            continue
                        with Image.open(local_path) as src:
                            src = ImageOps.exif_transpose(src)
                            has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
                            if src.width > w_target:
                                src.thumbnail((w_target, w_target), Image.BILINEAR)
                            out = src.convert("RGBA" if has_alpha else "RGB")
                            out.save(webp_path, format="WEBP", quality=88)
                    print(f"[comfyui-thumb-prewarm] ok {filename[:40]}")
                await asyncio.to_thread(_gen)
            except Exception as e:
                print(f"[comfyui-thumb-prewarm] failed {filename[:40]}: {e}")
        asyncio.create_task(_prewarm_thumb())

        return {"url": f"/output/{date_path}/{local_name}", "path": local_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存图片失败: {str(e)}")


@app.get("/api/comfyui/system_stats")
async def proxy_comfyui_system_stats():
    """代理检查 ComfyUI 服务器状态"""
    target = COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/system_stats"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI 连接失败: {str(e)}")

@app.post("/api/comfyui/upload/image")
async def proxy_comfyui_upload_image(file: UploadFile = File(...)):
    """代理上传图片到 ComfyUI(兼容前端 apiFetch 模式)"""
    content = await file.read()
    result = None
    for addr in COMFYUI_INSTANCES:
        try:
            files_data = {'image': (file.filename or f"upload_{int(time.time())}.png", content, file.content_type or "image/png")}
            resp = requests.post(f"http://{addr}/upload/image", files=files_data, timeout=10)
            if resp.status_code == 200 and result is None:
                result = resp.json()
        except Exception as e:
            print(f"[ComfyUI Proxy] Upload to {addr} failed: {e}")
    if result:
        return result
    raise HTTPException(status_code=502, detail="所有 ComfyUI 实例上传均失败")

@app.websocket("/api/comfyui/ws")
async def proxy_comfyui_ws(websocket: WebSocket, client_id: str = None):
    """代理 ComfyUI WebSocket,让前端通过后端获取实时进度"""
    await websocket.accept()
    target = COMFYUI_ADDRESS
    if not target:
        await websocket.send_json({"type": "error", "message": "未配置 ComfyUI 地址"})
        await websocket.close()
        return

    cid = client_id or str(uuid.uuid4())
    comfy_ws = None
    try:
        comfy_ws = await ws_client.connect(f"ws://{target}/ws?clientId={cid}")

        async def forward_to_frontend():
            try:
                async for message in comfy_ws:
                    if isinstance(message, str):
                        await websocket.send_text(message)
                    else:
                        await websocket.send_bytes(message)
            except Exception:
                pass

        async def forward_to_comfy():
            try:
                while True:
                    data = await websocket.receive_text()
                    await comfy_ws.send(data)
            except WebSocketDisconnect:
                pass
            except Exception:
                pass

        await asyncio.gather(forward_to_frontend(), forward_to_comfy())
    except Exception as e:
        print(f"[ComfyUI WS Proxy] 连接错误: {e}")
    finally:
        if comfy_ws:
            try:
                await comfy_ws.close()
            except Exception:
                pass

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
    for nid, node in wf.items():
        if not isinstance(node, dict) or not node.get("inputs"):
            continue
        ct = node.get("class_type", "")
        if ct == "UNETLoader" and "unet_name" in node["inputs"]:
            unet_name = node["inputs"]["unet_name"]
            has_unet = True
            break
        if isinstance(ct, str) and "LoadDiffusionModel" in ct and "model_name" in node["inputs"]:
            unet_name = node["inputs"]["model_name"]
            has_unet = True
            break
    # 从 unet_name 提取文件夹前缀（第一个 \ 或 / 前的部分）
    model_folder = ""
    if unet_name:
        sep_idx = max(unet_name.find("\\"), unet_name.find("/"))
        if sep_idx > 0:
            model_folder = unet_name[:sep_idx]
    return {
        "unet_name": unet_name,
        "model_folder": model_folder,
        "has_unet": has_unet,
    }


@app.get("/api/workflows/builtin")
async def list_builtin_workflows():
    """列出所有内置工作流及元数据（含模型文件夹前缀）"""
    if not os.path.isdir(WORKFLOW_DIR):
        return {"workflows": []}
    items = []
    for rel in sorted(BUILTIN_WORKFLOWS):
        filepath = os.path.join(WORKFLOW_DIR, *rel.split("/"))
        if not os.path.isfile(filepath):
            continue
        meta = _extract_workflow_meta(filepath)
        # 读取 config.json
        cfg = {}
        cfg_path = filepath.replace(".json", ".config.json")
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            except Exception:
                cfg = {}
        title = cfg.get("title") or os.path.basename(rel).replace(".json", "")
        items.append({
            "name": rel,
            "title": title,
            "builtin": True,
            "has_unet": meta and meta.get("has_unet"),
            "model_folder": (meta and meta.get("model_folder")) or "",
            "unet_name": (meta and meta.get("unet_name")) or "",
        })
    return {"workflows": items}


@app.get("/api/workflows")
async def list_workflows():
    """获取工作流列表"""
    if not os.path.isdir(WORKFLOW_DIR):
        return {"workflows": []}

    items = []
    for root, dirs, files in os.walk(WORKFLOW_DIR):
        # 只遍历特定目录
        if os.path.abspath(root) == os.path.abspath(WORKFLOW_DIR):
            dirs[:] = [d for d in dirs if d in {"custom", "自定义"}]  # 允许遍历自定义工作流目录

        for fn in sorted(files):
            if not fn.endswith(".json") or fn.endswith(".config.json"):
                continue

            rel = os.path.relpath(os.path.join(root, fn), WORKFLOW_DIR).replace("\\", "/")

            # 跳过内置工作流
            if is_builtin_workflow(rel):
                continue

            # 读取配置
            cfg = {}
            cfg_path = workflow_config_path(rel)
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}

            items.append({
                "name": rel,
                "title": cfg.get("title") or fn.replace(".json", ""),
                "builtin": False,
                "field_count": len(cfg.get("fields") or [])
            })

    # 排序
    items.sort(key=lambda item: item["title"])
    return {"workflows": items}

@app.get("/api/workflows/{name:path}")
async def get_workflow(name: str):
    """获取单个工作流详情"""
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    # 读取工作流
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)

    # 读取配置
    cfg = {"title": name.replace(".json", ""), "fields": []}
    cfg_path = workflow_config_path(name)
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or cfg
        except Exception:
            pass

    return {
        "name": name,
        "workflow": workflow,
        "config": cfg,
        "builtin": is_builtin_workflow(name)
    }

@app.post("/api/workflows")
async def create_workflow(req: Request):
    """创建新工作流"""
    try:
        body = await req.json()
        name = os.path.basename(body.get('name', 'workflow.json').strip())
        workflow_data = body.get('workflow', {})

        if not name.endswith('.json'):
            name = name + '.json'

        if not WORKFLOW_NAME_RE.match(name):
            raise HTTPException(status_code=400, detail="工作流名称不合法,请使用中文/英文/数字/_-.")

        if not isinstance(workflow_data, dict) or not workflow_data:
            raise HTTPException(status_code=400, detail="工作流 JSON 为空")

        # 校验是否为有效的 ComfyUI API 格式
        sample = next(iter(workflow_data.values()), None)
        if not isinstance(sample, dict) or "class_type" not in sample:
            raise HTTPException(status_code=400, detail="不是有效的 ComfyUI API 工作流 JSON(需包含 class_type)")

        # 保存到自定义工作流目录
        custom_dir = os.path.join(WORKFLOW_DIR, "custom")
        os.makedirs(custom_dir, exist_ok=True)
        stored_name = f"custom/{name}"
        path = workflow_path_from_name(stored_name)

        with open(path, "w", encoding="utf-8") as f:
            json.dump(workflow_data, f, ensure_ascii=False, indent=2)

        return {"name": stored_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建工作流失败: {str(e)}")

@app.put("/api/workflows/{name:path}/config")
async def update_workflow_config(name: str, req: Request):
    """更新工作流配置"""
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    try:
        body = await req.json()
        cfg_path = workflow_config_path(name)

        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)

        return {"config": body}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新配置失败: {str(e)}")

@app.delete("/api/workflows/{name:path}")
async def delete_workflow(name: str):
    """删除工作流"""
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    # 内置工作流不可删除
    if is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流不可删除")

    workflow_path = workflow_path_from_name(name)
    cfg_path = workflow_config_path(name)

    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    try:
        os.remove(workflow_path)
        if os.path.exists(cfg_path):
            os.remove(cfg_path)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除工作流失败: {str(e)}")

@app.post("/api/workflows/{workflow_name:path}/run")
def run_workflow(workflow_name: str, payload: WorkflowRunRequest, token: str = ""):
    """运行工作流(使用 generate 函数)"""
    try:
        # 校验工作流名称
        if not WORKFLOW_NAME_RE.match(workflow_name):
            raise HTTPException(status_code=400, detail="工作流名称不合法")

        workflow_path = workflow_path_from_name(workflow_name)
        if not os.path.exists(workflow_path):
            raise HTTPException(status_code=404, detail="工作流不存在")

        # 根据 config 的字段把值映射成 params 节点覆盖
        params: Dict[str, Dict[str, Any]] = {}
        for field in payload.config.fields:
            if not field.node or not field.input:
                continue
            if field.id in payload.fields:
                value = payload.fields[field.id]
                # 类型转换
                if field.type in ("number", "slider"):
                    try:
                        value = float(value) if (field.step and field.step < 1) else int(float(value))
                    except Exception:
                        pass
                elif field.type == "boolean":
                    value = bool(value)
                elif field.type == "dropdown":
                    # 下拉值如果看起来是数字,自动转成 int/float
                    if isinstance(value, str):
                        s = value.strip()
                        try:
                            if s and ('.' in s or 'e' in s.lower()):
                                value = float(s)
                            elif s and s.lstrip('-').isdigit():
                                value = int(s)
                        except (ValueError, TypeError):
                            pass
                elif field.type == "image":
                    # 图片字段:值已经是 ComfyUI 图片文件名
                    pass
                params.setdefault(field.node, {})[field.input] = value

        # 调用 generate 函数
        generate_req = GenerateRequest(
            prompt="",
            workflow_json=workflow_name,
            params=params,
            type="workflow",
            client_id=payload.client_id or CLIENT_ID,
        )

        # 调用同步的 generate 函数
        result = generate(generate_req, token=token)

        if result.get("error"):
            raise HTTPException(status_code=500, detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"运行工作流失败: {str(e)}")


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
    styles_file = os.path.join(POSTER_DATA_DIR, "fooocus_styles.json")
    if not os.path.exists(styles_file):
        return []
    with open(styles_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    styles = []
    for item in data:
        thumb_url = item.get('thumbnail', '')
        local_path = ''
        if thumb_url:
            url_filename = thumb_url.split('/')[-1]
            local_path = f'/static/images/style_thumbnails/{url_filename}'
        styles.append({
            'name': item.get('name', ''),
            'name_cn': item.get('name_cn', item.get('name', '')),
            'prompt': item.get('prompt', ''),
            'thumbnail': local_path
        })
    return styles


@app.get("/api/poster/layouts")
async def get_poster_layouts():
    return {"layouts": _load_poster_layouts()}


@app.get("/api/poster/styles")
async def get_poster_styles():
    return {"styles": _load_poster_styles()}


@app.post("/api/poster/generate")
async def poster_generate(req: Request, token: str = ""):
    """生成海报"""
    try:
        body = await req.json()
        prompt = body.get('prompt', '')
        width = body.get('width', 1024)
        height = body.get('height', 1536)
        steps = body.get('steps', 4)
        mode = body.get('mode', 'turbo')
        count = body.get('count', 2)
        style_prompt = body.get('style_prompt', '')

        if not prompt:
            return {"error": "提示词不能为空"}

        # 合并风格提示词
        full_prompt = prompt
        if style_prompt:
            full_prompt = f"{prompt}, {style_prompt}"

        # 选择工作流
        workflow_name = "text2image/boogu-turbo.json" if mode == 'turbo' else "text2image/boogu-base.json"
        workflow_path = os.path.join(WORKFLOW_DIR, workflow_name)
        if not os.path.exists(workflow_path):
            return {"error": f"工作流 {workflow_name} 不存在"}

        with open(workflow_path, 'r', encoding='utf-8') as f:
            base_workflow = json.load(f)

        generated_images = []

        for i in range(count):
            workflow = json.loads(json.dumps(base_workflow))
            seed = int.from_bytes(os.urandom(6), 'big') % (2**32)

            # 设置参数
            workflow['11']['inputs']['text'] = full_prompt
            workflow['8']['inputs']['width'] = width
            workflow['8']['inputs']['height'] = height
            workflow['32']['inputs']['noise_seed'] = seed if 'noise_seed' in workflow.get('32', {}).get('inputs', {}) else workflow.get('32', {}).get('inputs', {}).get('seed', seed)
            if 'seed' in workflow.get('32', {}).get('inputs', {}):
                workflow['32']['inputs']['seed'] = seed
            workflow['34']['inputs']['filename_prefix'] = f"poster_{int(time.time())}_{i}"

            # 步数覆盖
            if '32' in workflow and 'steps' in workflow['32'].get('inputs', {}):
                workflow['32']['inputs']['steps'] = steps
            if '26' in workflow and 'steps' in workflow['26'].get('inputs', {}):
                workflow['26']['inputs']['steps'] = steps

            # 提交到 ComfyUI
            target = COMFYUI_ADDRESS
            if not target:
                return {"error": "未配置 ComfyUI 地址"}

            prompt_payload = {"prompt": workflow, "client_id": f"poster_{token[:8] if token else 'anon'}"}
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"http://{target}/prompt", json=prompt_payload)
                if resp.status_code != 200:
                    return {"error": f"提交失败: {resp.text[:200]}"}
                pid = resp.json().get('prompt_id')

            # 等待完成
            for _ in range(180):
                await asyncio.sleep(0.5)
                try:
                    async with httpx.AsyncClient(timeout=5) as client:
                        hr = await client.get(f"http://{target}/history/{pid}")
                        if hr.status_code == 200:
                            h = hr.json()
                            if pid in h and h[pid].get('status', {}).get('completed'):
                                outputs = h[pid].get('outputs', {})
                                for nid, out in outputs.items():
                                    if 'images' in out:
                                        for img in out['images']:
                                            fn = img['filename']
                                            generated_images.append({
                                                'filename': fn,
                                                'url': f'/api/view?filename={fn}&type=output'
                                            })
                                break
                except Exception:
                    pass

        return {"images": generated_images}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


# ==================== TTS API 路由 ====================

TTS_VOICE_DIR = os.path.join(DATA_DIR, "tts_voices")
os.makedirs(TTS_VOICE_DIR, exist_ok=True)

# 角色库子目录（新结构）
CHARACTERS_DIR = os.path.join(TTS_VOICE_DIR, "characters")
os.makedirs(CHARACTERS_DIR, exist_ok=True)

# 音色库索引文件(全局共享)
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
    """扫描角色文件夹，自动识别音频文件"""
    voices = {}
    if not os.path.exists(CHARACTERS_DIR):
        return voices
    
    for folder_name in os.listdir(CHARACTERS_DIR):
        folder_path = os.path.join(CHARACTERS_DIR, folder_name)
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
    if not os.path.exists(VOICE_INDEX_FILE):
        return {}
    try:
        with open(VOICE_INDEX_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def _save_voice_index(index: dict):
    """保存音色库索引(全局共享)"""
    with open(VOICE_INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


@app.get("/api/tts/voices")
async def get_tts_voices():
    """获取音色库列表(全局共享)"""
    index = _load_voice_index()
    return {"voices": index}


# 缓存 animadex 角色数据
_animadex_cache = None
_animadex_cache_time = 0

@app.get("/api/animadex/characters")
async def get_animadex_characters(
    copyright: str = "",
    limit: int = 200
):
    """获取 animadex 角色数据(用于头像映射)"""
    global _animadex_cache, _animadex_cache_time
    import time

    # 缓存 10 分钟
    if _animadex_cache is None or (time.time() - _animadex_cache_time) > 600:
        try:
            animadex_path = os.path.join(DATA_DIR, "animadex-characters.json")
            if os.path.exists(animadex_path):
                with open(animadex_path, 'r', encoding='utf-8') as f:
                    _animadex_cache = json.load(f)
                    _animadex_cache_time = time.time()
        except Exception as e:
            print(f"加载 animadex 数据失败: {e}")
            _animadex_cache = {"characters": []}

    characters = _animadex_cache.get("characters", []) if _animadex_cache else []

    # 按 copyright 过滤
    if copyright:
        characters = [c for c in characters if c.get("copyright") == copyright]

    # 限制数量
    characters = characters[:limit]

    return {"characters": characters, "count": len(characters)}


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

@app.post("/api/tts/to-podcast")
async def convert_to_podcast(
    text: str = Form(...),
    num_speakers: int = Form(2),
    style: str = Form("default"),
    word_count: int = Form(500)
):
    """将文本转换为播客对话格式"""
    from smart_tts import call_llm_direct
    from smart_prompt import load_config

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    config = load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")

    # 构造用户提示
    style_desc = {
        "default": "自然对话,主持人和嘉宾轻松交流",
        "news": "新闻播报风格,语言正式、节奏明快",
        "casual": "轻松闲聊,像朋友聊天一样随意",
        "interview": "深度采访,主持人追问细节",
        "debate": "观点碰撞,正反方讨论",
        "storytelling": "故事讲述,用叙事方式展开",
        "educational": "教学讲解,循序渐进地解释概念"
    }

    # 构造详细的用户提示
    user_prompt = f"""请将以下文章转换为 {num_speakers} 人对话的播客节目。

## 播客风格
{style_desc.get(style, style_desc['default'])}

## 对话人数
{num_speakers} 人(1位主持人 + {num_speakers - 1}位嘉宾)

## 输出要求
1. 必须包含完整的开场白(主持人介绍话题和嘉宾)
2. 将文章内容分解为 3-5 个讨论点
3. 必须包含结尾总结
4. 每句话控制在 15-40 字
5. 总字数控制在 {word_count} 字左右
6. 直接输出对话内容

## 格式要求(非常重要!)
- 角色标签必须用: [Speaker_1]: [Speaker_2]: [Speaker_3]:
- 绝对不要用人名作为标签(如 [张三] [李四] 都是错误的)
- 绝对不要在括号里加描述(如 (微笑) (回忆) (语气轻快) 都是错误的)
- 语气通过文字内容自然体现,不要加括号说明

## 文章内容
{text}"""

    try:
        result = call_llm_direct(user_prompt, PODCAST_SYSTEM_PROMPT, config)

        # 解析结果,提取说话人信息
        speakers = set()
        lines = result.strip().split('\n')
        for line in lines:
            line = line.strip()
            if line.startswith('[') and ']:' in line:
                speaker_name = line.split(']:')[0].replace('[', '').strip()
                speakers.add(speaker_name)

        # 将对话格式转换为 TTS 格式 (Speaker_1:, Speaker_2: 等)
        speaker_list = list(speakers)
        speaker_map = {}
        for i, name in enumerate(speaker_list[:num_speakers]):
            speaker_map[name] = f"Speaker_{i+1}"

        tts_lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith('[') and ']:' in line:
                speaker_name = line.split(']:')[0].replace('[', '').strip()
                content = line.split(']:', 1)[1].strip() if ']:' in line else ''
                tts_id = speaker_map.get(speaker_name, speaker_name)
                
                # 清理括号描述 (如 (微笑) (回忆) 等)
                content = re.sub(r'\([^)]*?\)', '', content)
                content = re.sub(r'\s+', ' ', content).strip()
                
                if content:
                    tts_lines.append(f"[{tts_id}]: {content}")
            else:
                line = re.sub(r'\([^)]*?\)', '', line)
                line = re.sub(r'\s+', ' ', line).strip()
                if line:
                    tts_lines.append(line)
        
        initial_text = "\n".join(tts_lines)
        
        # ========== 质检步骤 ==========
        print(f"[Podcast] 初稿生成完成,开始质检...")
        check_result = check_podcast_text(initial_text, num_speakers, word_count)
        
        if check_result['issues']:
            print(f"[Podcast] 发现 {len(check_result['issues'])} 个问题:")
            for issue in check_result['issues']:
                print(f"  - {issue}")
            
            # 如果有自动修复,先应用
            if check_result['auto_fixed']:
                initial_text = check_result['fixed_text']
                print(f"[Podcast] 自动修复完成")
            
            # 如果需要AI修正(字数问题),调用AI
            if check_result['needs_ai_fix']:
                print(f"[Podcast] 需要AI修正字数...")
                fix_prompt = get_ai_fix_prompt(check_result['issues'], initial_text)
                fixed_result = call_llm_direct(fix_prompt, "你是一个文本修正助手,只修正指定的问题,不要改变其他内容。", config)
                if fixed_result and not fixed_result.startswith('ERROR:'):
                    initial_text = fixed_result
                    print(f"[Podcast] AI修正完成")
            
            # 最终检查
            final_check = check_podcast_text(initial_text, num_speakers, word_count)
            if final_check['issues']:
                print(f"[Podcast] 最终检查仍有 {len(final_check['issues'])} 个问题:")
                for issue in final_check['issues']:
                    print(f"  - {issue}")
            else:
                print(f"[Podcast] 最终检查通过!")
        else:
            print(f"[Podcast] 质检通过,无问题!")
        
        return {
            "success": True,
            "podcast_text": initial_text,
            "original_speakers": speaker_list[:num_speakers],
            "speaker_map": speaker_map,
            "raw_text": result,
            "quality_check": {
                "issues_found": len(check_result['issues']),
                "auto_fixed": check_result['auto_fixed'],
                "total_chars": check_result['total_chars']
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")


@app.post("/api/tts/fetch-url")
async def fetch_url_content(url: str = Form("")):
    """抓取网页文章内容"""
    import re
    
    if not url.strip():
        raise HTTPException(status_code=400, detail="URL 不能为空")
    
    # 补全协议
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    
    try:
        # 方法1: 使用 Jina Reader API (免费,能绕过大部分反爬)
        try:
            import urllib.request
            jina_url = f"https://r.jina.ai/{url}"
            req = urllib.request.Request(jina_url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/plain',
            })
            with urllib.request.urlopen(req, timeout=20) as response:
                text = response.read().decode('utf-8', errors='ignore')
            
            # 清理 Jina 返回的内容
            text = text.strip()
            
            # 提取 Markdown Content 后的正文
            if 'Markdown Content:' in text:
                text = text.split('Markdown Content:', 1)[1].strip()
            elif 'Content:' in text:
                text = text.split('Content:', 1)[1].strip()
            
            # 移除图片链接和导航链接
            text = re.sub(r'!\[Image \d+:.*?\]\(.*?\)', '', text)
            text = re.sub(r'\[_.*?_\]\(.*?\)', '', text)
            text = re.sub(r'\[.*?\]\(https?://.*?\)', '', text)
            # 移除标题标记
            text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
            # 移除列表标记
            text = re.sub(r'^\*\s+', '', text, flags=re.MULTILINE)
            text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
            # 移除多余空行和空格
            text = re.sub(r'\n{3,}', '\n\n', text)
            text = re.sub(r' {2,}', ' ', text)
            # 移除开头的导航部分(直到找到文章标题)
            lines = text.split('\n')
            article_start = 0
            for i, line in enumerate(lines):
                line = line.strip()
                if len(line) > 20 and not line.startswith(('*', '-', '#', '!', '[')):
                    article_start = i
                    break
            text = '\n'.join(lines[article_start:]).strip()
            
            if len(text) > 200:
                # 截取前 5000 字
                if len(text) > 5000:
                    text = text[:5000] + '...'
                return {
                    "success": True,
                    "content": text,
                    "url": url
                }
        except Exception as e:
            print(f"[FetchURL] Jina Reader 失败: {e}")
        
        # 方法2: 使用 trafilatura
        try:
            import trafilatura
            downloaded = trafilatura.fetch_url(url)
            if downloaded:
                text = trafilatura.extract(downloaded, include_comments=False, include_tables=True, no_fallback=False)
                if text and len(text) > 100:
                    if len(text) > 5000:
                        text = text[:5000] + '...'
                    return {
                        "success": True,
                        "content": text,
                        "url": url
                    }
        except Exception as e:
            print(f"[FetchURL] trafilatura 失败: {e}")
        
        # 方法3: 回退到 urllib
        import urllib.request
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        })
        
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.I)
        html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.I)
        text = re.sub(r'<[^>]+>', ' ', html)
        text = re.sub(r'\s+', ' ', text).strip()
        
        if len(text) > 5000:
            text = text[:5000] + '...'
        
        if len(text) < 50:
            raise Exception("抓取内容过少,可能是反爬页面")
        
        return {
            "success": True,
            "content": text,
            "url": url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"抓取失败: {str(e)}")


@app.post("/api/tts/to-solo-podcast")
async def convert_to_solo_podcast(
    text: str = Form(...),
    style: str = Form("storytelling"),
    word_count: int = Form(500)
):
    """将文本转换为单人播客风格"""
    from smart_tts import call_llm_direct
    from smart_prompt import load_config

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    config = load_config()
    print(f"[SoloPodcast] config: base_url={config.get('base_url')}, api_key={'set' if config.get('api_key') else 'empty'}, model={config.get('model')}")
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")
    if not config.get("base_url"):
        raise HTTPException(status_code=400, detail=f"未配置 API base_url, config={config}")

    # 风格配置
    style_configs = {
        "storytelling": {
            "desc": "故事讲述风格,用生动的叙事方式展开,有起伏和悬念"
        },
        "knowledge": {
            "desc": "知识讲解风格,清晰有条理,用通俗易懂的语言解释概念"
        },
        "news": {
            "desc": "新闻播报风格,语言正式、节奏明快、客观公正"
        },
        "casual": {
            "desc": "轻松闲聊风格,像和朋友聊天一样自然随意"
        },
        "motivational": {
            "desc": "励志分享风格,充满感染力,激励人心"
        },
        "educational": {
            "desc": "教学讲解风格,循序渐进,由浅入深地讲解"
        }
    }

    style_config = style_configs.get(style, style_configs['storytelling'])

    # 字数范围
    word_min = max(100, word_count - 150)
    word_max = word_count + 150

    # 构造用户提示
    user_prompt = f"""请将以下文本转换为单人播客风格,适合一个人朗读讲述。

## 播客风格
{style_config['desc']}

## 输出要求
1. 开头要有吸引人的开场白,引出话题
2. 将内容重新组织为适合口语讲述的结构
3. 语言要自然流畅,像在和听众对话
4. 适当加入过渡词和连接词
5. 结尾要有总结或引发思考的收尾
6. 【重要】总字数必须控制在 {word_count} 字左右(不少于 {word_min} 字,不超过 {word_max} 字),超出或不足都不可接受
7. 如果原文较长,请提炼核心内容;如果原文较短,请适当展开

## 原始文本
{text}"""

    system_prompt = """你是一位专业的播客内容创作者,擅长将各种文本转换为适合单人讲述的播客风格。

## 播客创作原则
1. **口语化**:使用自然的口语表达,避免书面语
2. **节奏感**:合理安排停顿和节奏变化
3. **情感丰富**:根据内容调整语气和情感
4. **结构清晰**:有明确的开头、展开和结尾
5. **互动感**:适当使用"你"、"我们"等人称,拉近与听众的距离

## 输出格式
直接输出转换后的播客讲述内容,不要加任何标记或标签。"""

    try:
        result = call_llm_direct(user_prompt, system_prompt, config)

        return {
            "success": True,
            "result": result.strip()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")


# ==================== 统一类型 API ====================

@app.get("/api/tts/genres")
async def get_genres():
    """获取所有可用的语音节目类型"""
    from genre_registry import list_genres
    return {"genres": list_genres()}


@app.post("/api/tts/to-genre")
async def convert_to_genre(
    genre: str = Form(...),
    text: str = Form(...),
    style: str = Form(""),
    num_speakers: int = Form(0),
    word_count: int = Form(500),
):
    """统一类型转换接口"""
    from smart_tts import call_llm_direct
    from smart_prompt import load_config
    from genre_registry import get_genre, build_user_prompt, get_system_prompt, clean_stage_directions

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    genre_config = get_genre(genre)
    if not genre_config:
        raise HTTPException(status_code=400, detail=f"未知类型: {genre}")

    config = load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")

    # 确定模式和人数
    is_solo = num_speakers <= 1
    if num_speakers <= 0:
        num_speakers = genre_config["default_speakers"]
    num_speakers = max(genre_config["min_speakers"], min(num_speakers, genre_config["max_speakers"]))
    is_solo = num_speakers <= 1

    # 校验模式
    if is_solo and "solo" not in genre_config["modes"]:
        # 类型不支持 solo，强制切到 multi
        num_speakers = genre_config["default_speakers"]
        is_solo = False
    if not is_solo and "multi" not in genre_config["modes"]:
        # 类型不支持 multi，强制切到 solo
        num_speakers = 1
        is_solo = True

    # 获取 prompt
    system_prompt = get_system_prompt(genre, is_solo)
    user_prompt = build_user_prompt(genre, text, style, num_speakers, word_count)

    try:
        result = call_llm_direct(user_prompt, system_prompt, config)
        # 后处理：清理舞台指示
        result = clean_stage_directions(result)

        if is_solo:
            # 单人模式：直接返回文本
            return {
                "success": True,
                "mode": "solo",
                "genre": genre,
                "result": result.strip(),
            }
        else:
            # 多人模式：解析对话格式，映射为 Speaker_N
            speakers = []
            speaker_set = set()
            lines = result.strip().split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('[') and ']:' in line:
                    speaker_name = line.split(']:')[0].replace('[', '').strip()
                    if speaker_name not in speaker_set:
                        speaker_set.add(speaker_name)
                        speakers.append(speaker_name)

            # 构建角色映射
            role_map = {}
            role_keys = list(genre_config["roles"].keys())
            for i, name in enumerate(speakers[:num_speakers]):
                if i < len(role_keys):
                    role_map[name] = f"Speaker_{i+1}"
                else:
                    role_map[name] = f"Speaker_{i+1}"

            tts_lines = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                if line.startswith('[') and ']:' in line:
                    speaker_name = line.split(']:')[0].replace('[', '').strip()
                    content = line.split(']:', 1)[1].strip() if ']:' in line else ''
                    tts_id = role_map.get(speaker_name, speaker_name)
                    tts_lines.append(f"[{tts_id}]: {content}")
                else:
                    tts_lines.append(line)

            return {
                "success": True,
                "mode": "multi",
                "genre": genre,
                "podcast_text": "\n".join(tts_lines),
                "original_speakers": speakers[:num_speakers],
                "speaker_map": role_map,
                "raw_text": result,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")


@app.post("/api/tts/voices")
async def save_tts_voice(
    name: str = Form(...),
    instruct: str = Form(""),
    category: str = Form("custom"),
    file: UploadFile = File(...),
):
    """保存音色到音色库(全局共享)"""
    if not name.strip():
        raise HTTPException(status_code=400, detail="音色名称不能为空")

    # 保存音频文件到分类目录
    category_dir = os.path.join(TTS_VOICE_DIR, "audio", category)
    os.makedirs(category_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "voice.wav")[1] or ".wav"
    safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())[:60]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{safe_name}_{timestamp}{ext}"
    file_path = os.path.join(category_dir, filename)

    content = await file.read()
    with open(file_path, 'wb') as f:
        f.write(content)

    # 更新索引(存储相对路径)
    index = _load_voice_index()
    index[name.strip()] = {
        "file": f"audio/{category}/{filename}",
        "instruct": instruct,
        "category": category,
        "duration": 0,
        "created": timestamp,
        "starred": False,
        "note": "",
    }
    _save_voice_index(index)

    return {"success": True, "name": name.strip(), "filename": f"audio/{category}/{filename}"}


@app.post("/api/tts/voices/import")
async def import_tts_voices(
    source_dir: str = Form(...),
    category: str = Form("genshin"),
):
    """批量导入音色(全局共享)"""
    # 创建分类目录
    category_dir = os.path.join(TTS_VOICE_DIR, "audio", category)
    os.makedirs(category_dir, exist_ok=True)

    if not os.path.exists(source_dir):
        raise HTTPException(status_code=400, detail="源目录不存在")

    index = _load_voice_index()
    imported = 0
    skipped = 0
    errors = []

    # 扫描角色文件夹
    for character_name in os.listdir(source_dir):
        character_dir = os.path.join(source_dir, character_name)
        if not os.path.isdir(character_dir):
            continue

        # 获取所有音频文件
        audio_files = [f for f in os.listdir(character_dir) if f.endswith(('.mp3', '.wav', '.ogg', '.flac'))]
        if not audio_files:
            continue

        # 按文件大小排序,选择中间的
        audio_files_with_size = []
        for af in audio_files:
            try:
                size = os.path.getsize(os.path.join(character_dir, af))
                audio_files_with_size.append((af, size))
            except:
                continue

        if not audio_files_with_size:
            continue

        audio_files_with_size.sort(key=lambda x: x[1])
        mid_idx = len(audio_files_with_size) // 2
        selected_file = audio_files_with_size[mid_idx][0]

        # 跳过已存在的
        voice_name = f"原神·{character_name}"
        if voice_name in index:
            skipped += 1
            continue

        try:
            # 复制音频文件到分类目录
            src_path = os.path.join(character_dir, selected_file)
            ext = os.path.splitext(selected_file)[1]
            safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", character_name)[:60]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest_filename = f"{safe_name}_{timestamp}{ext}"
            dest_path = os.path.join(category_dir, dest_filename)

            shutil.copy2(src_path, dest_path)

            # 更新索引(存储相对路径)
            index[voice_name] = {
                "file": f"audio/{category}/{dest_filename}",
                "instruct": "女,高音调",
                "category": category,
                "created": timestamp,
            }
            imported += 1
        except Exception as e:
            errors.append(f"{character_name}: {str(e)}")

    _save_voice_index(index)

    return {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:10],  # 只返回前10个错误
    }


@app.post("/api/tts/voices/import-single")
async def import_single_voice(
    request: Request,
    name: str = Form(...),
    instruct: str = Form(""),
    category: str = Form("custom"),
    audio: UploadFile = File(...),
    avatar: UploadFile = File(None),
    token: str = Query(default=""),
):
    """导入单个音色"""
    if not name.strip():
        raise HTTPException(status_code=400, detail="名称不能为空")
    
    # 创建角色文件夹
    char_dir = os.path.join(CHARACTERS_DIR, name.strip())
    os.makedirs(char_dir, exist_ok=True)
    
    # 保存音频文件
    audio_ext = os.path.splitext(audio.filename)[1] or '.mp3'
    audio_path = os.path.join(char_dir, f'ref_audio{audio_ext}')
    with open(audio_path, 'wb') as f:
        content = await audio.read()
        f.write(content)
    
    # 保存头像（如果有）
    if avatar and avatar.filename:
        avatar_ext = os.path.splitext(avatar.filename)[1] or '.png'
        avatar_path = os.path.join(char_dir, f'avatar{avatar_ext}')
        with open(avatar_path, 'wb') as f:
            content = await avatar.read()
            f.write(content)
    
    # 保存配置文件
    meta = {
        'name': name.strip(),
        'display_name': name.strip(),
        'instruct': instruct,
        'category': category,
        'created': datetime.now().strftime('%Y%m%d')
    }
    meta_path = os.path.join(char_dir, 'meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    
    return {"success": True, "name": name.strip()}


@app.get("/api/tts/voices/file/{filename:path}")
async def get_tts_voice_file(filename: str):
    """获取音色音频文件(全局共享)"""
    # 路径安全检查:禁止路径穿越
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="非法路径")
    # filename 现在是 audio/category/file 格式
    file_path = os.path.abspath(os.path.join(TTS_VOICE_DIR, filename))
    voice_dir_abs = os.path.abspath(TTS_VOICE_DIR)
    if not file_path.startswith(voice_dir_abs + os.sep) and file_path != voice_dir_abs:
        raise HTTPException(status_code=403, detail="禁止访问目录外文件")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    # 根据扩展名设置 Content-Type
    ext = os.path.splitext(filename)[1].lower()
    content_type_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
    }
    content_type = content_type_map.get(ext, "audio/wav")

    return FileResponse(file_path, media_type=content_type)


@app.delete("/api/tts/voices/{voice_name}")
async def delete_tts_voice(voice_name: str):
    """删除音色(全局共享)"""
    index = _load_voice_index()

    entry = index.pop(voice_name, None)
    if not entry:
        raise HTTPException(status_code=404, detail="音色不存在")

    # 删除音频文件
    file_path = os.path.join(TTS_VOICE_DIR, entry.get("file", ""))
    if os.path.exists(file_path):
        os.remove(file_path)

    _save_voice_index(index)
    return {"success": True}


@app.put("/api/tts/voices/{voice_name}/meta")
async def update_tts_voice_meta(voice_name: str, body: dict):
    """更新音色元数据(星标、备注等)"""
    index = _load_voice_index()
    entry = index.get(voice_name)
    if not entry:
        raise HTTPException(status_code=404, detail="音色不存在")

    if "starred" in body:
        entry["starred"] = bool(body["starred"])
    if "note" in body:
        entry["note"] = str(body["note"])

    index[voice_name] = entry
    _save_voice_index(index)
    return {"success": True, "voice": entry}


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


@app.post("/api/tts/asr")
async def tts_asr(
    request: Request,
    token: str = Form(""),
):
    """真正的 ASR:用 Whisper 转写参考音频为文本"""
    form = await request.form()
    audio_file = form.get("audio")
    if not audio_file or not hasattr(audio_file, 'read'):
        raise HTTPException(status_code=400, detail="请上传音频文件")

    content = await audio_file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="音频文件太小")

    # 保存临时文件
    tmp_path = os.path.join(TTS_VOICE_DIR, f"_asr_{int(time.time())}.wav")
    try:
        with open(tmp_path, 'wb') as f:
            f.write(content)

        # 在 ComfyUI 的 Python 环境中运行 ASR
        comfy_python = os.path.join(
            os.path.dirname(COMFYUI_ADDRESS.split(":")[0]) if ":" in COMFYUI_ADDRESS else "",
            "..", "..", "..", "python", "python.exe"
        )
        # 尝试用 ComfyUI Python 环境(有 omnivoice)
        # fallback: 用当前环境的 transformers pipeline
        try:
            import torch
            import numpy as np
            import soundfile as sf
            from transformers import pipeline as hf_pipeline

            # 读取音频
            audio_data, sr = sf.read(tmp_path)
            if len(audio_data.shape) > 1:
                audio_data = audio_data.mean(axis=1)  # 转单声道

            # 重采样到 16kHz(Whisper 要求)
            if sr != 16000:
                import scipy.signal
                audio_data = scipy.signal.resample(audio_data, int(len(audio_data) * 16000 / sr))
                sr = 16000

            # 加载模型并转写
            pipe = _get_asr_pipeline()
            result = pipe(audio_data, generate_kwargs={"language": None})
            text = result.get("text", "").strip()

            return {"text": text}
        except Exception as e:
            print(f"[ASR] 转写失败: {e}")
            import traceback
            traceback.print_exc()
            return {"text": "", "note": f"ASR 失败: {e}"}
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except:
            pass


@app.get("/api/tts/presets")
async def get_tts_presets():
    """获取 TTS 参数预设列表"""
    return {
        "presets": [
            {"id": "fast_preview", "label": "极速预览", "steps": 8, "cfg": 1.5, "speed": 1.2, "denoise": False, "normalize": False, "preprocess": False, "postprocess": False},
            {"id": "balanced", "label": "均衡推荐", "steps": 32, "cfg": 2.0, "speed": 1.0, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "high_quality", "label": "高质量", "steps": 64, "cfg": 2.5, "speed": 1.0, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "clone_focused", "label": "克隆相似度优先", "steps": 40, "cfg": 3.0, "speed": 1.0, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "emotion_focused", "label": "情绪表现优先", "steps": 48, "cfg": 2.8, "speed": 0.95, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "longtext_stable", "label": "长文本稳定", "steps": 32, "cfg": 2.0, "speed": 0.9, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "broadcast", "label": "新闻播报", "steps": 40, "cfg": 2.2, "speed": 1.1, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "storytelling", "label": "有声书", "steps": 48, "cfg": 2.5, "speed": 0.92, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "whisper", "label": "耳语", "steps": 40, "cfg": 2.3, "speed": 0.8, "denoise": False, "normalize": False, "preprocess": False, "postprocess": True},
            {"id": "advertising", "label": "广告配音", "steps": 48, "cfg": 2.6, "speed": 1.05, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "meditation", "label": "冥想放松", "steps": 32, "cfg": 2.0, "speed": 0.78, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "low_vram", "label": "低显存模式", "steps": 16, "cfg": 1.8, "speed": 1.0, "denoise": False, "normalize": False, "preprocess": False, "postprocess": False},
        ]
    }


@app.get("/api/tts/modes")
async def get_tts_modes():
    """获取支持的 TTS 模式列表"""
    return {
        "modes": [
            {
                "id": "clone",
                "name": "Voice Clone",
                "description": "短文本声音克隆",
                "needs_ref": True,
            },
            {
                "id": "design",
                "name": "Voice Design",
                "description": "文字设计声音",
                "needs_ref": False,
            },
            {
                "id": "longform",
                "name": "Longform",
                "description": "长文本分块生成",
                "needs_ref": True,
            },
            {
                "id": "multi",
                "name": "Multi-Speaker",
                "description": "多人对话",
                "needs_ref": True,
                "multi_speaker": True,
            },
        ]
    }


@app.post("/api/tts/generate")
async def tts_generate(request: Request, token: str = Query(default="")):
    """TTS 生成接口"""
    # 优先从 URL 参数获取 token,其次从 Form 字段
    if not token:
        try:
            form = await request.form()
            token = form.get("token", "")
        except:
            pass
    try:
        return await _tts_generate_inner(request, token)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[TTS] 生成异常: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

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

@app.post("/api/local-assets/upload")
async def upload_local_assets(files: List[UploadFile] = File(...), folder: str = Form("")):
    uploaded = []
    folder_rel, folder_abs = _local_upload_safe_folder(folder)
    os.makedirs(folder_abs, exist_ok=True)
    for file in files:
        content = await file.read()
        if not content:
            continue
        kind, ext = _local_upload_kind_ext(file.filename, file.content_type)
        if kind is None:
            continue
        base = os.path.splitext(os.path.basename(file.filename or "file"))[0]
        base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or "file"
        base = base[:60]
        filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
        rel_name = f"{folder_rel}/{filename}".lstrip("/")
        path = os.path.join(folder_abs, filename)
        with open(path, "wb") as f:
            f.write(content)
        if kind == "image":
            classification = await classify_asset_image_best_effort(path)
            if classification:
                _write_local_upload_classification(rel_name, classification)
        uploaded.append(_local_upload_item(rel_name))
    return {"files": uploaded}

@app.post("/api/local-assets/import-urls")
async def import_local_assets_from_urls(payload: LocalAssetUrlImportRequest):
    uploaded = []
    results = []
    folder_rel, folder_abs = _local_upload_safe_folder(payload.folder)
    os.makedirs(folder_abs, exist_ok=True)
    timeout = httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "art-canvas-Asset-Importer/1.0"}) as client:
        for entry in (payload.items or [])[:200]:
            src_url = str(entry.url or "").strip()
            inline_data = str(entry.data or "").strip()
            result = {"url": src_url, "ok": False, "file": "", "error": ""}
            if not inline_data and not src_url.startswith(("http://", "https://")):
                result["error"] = "仅支持 http(s) 素材地址"
                results.append(result)
                continue
            try:
                if inline_data:
                    content_type = str(entry.content_type or "").split(";", 1)[0].strip().lower()
                    b64 = inline_data
                    if inline_data.startswith("data:"):
                        header, _, b64 = inline_data.partition(",")
                        if not content_type:
                            content_type = header[5:].split(";", 1)[0].strip().lower()
                    try:
                        content = base64.b64decode(b64, validate=False)
                    except Exception:
                        raise HTTPException(status_code=400, detail="素材数据无法解码")
                    name_path = urllib.parse.urlparse(src_url).path
                else:
                    response = await client.get(src_url)
                    response.raise_for_status()
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                    content = response.content
                    name_path = urllib.parse.urlparse(src_url).path
                kind, ext = _local_upload_kind_ext(name_path, content_type)
                if kind not in ("image", "video"):
                    raise HTTPException(status_code=400, detail=f"不是图片或视频资源:{content_type or src_url}")
                if not content:
                    raise HTTPException(status_code=400, detail="素材内容为空")
                if entry.name:
                    base = os.path.splitext(entry.name)[0]
                else:
                    base = os.path.splitext(os.path.basename(urllib.parse.unquote(name_path)))[0]
                base = base or ("web-video" if kind == "video" else "web-image")
                base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or ("web-video" if kind == "video" else "web-image")
                base = base[:60]
                if ext and base.lower().endswith(ext.lower()):
                    base = base[:-len(ext)].rstrip(".") or ("web-video" if kind == "video" else "web-image")
                filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
                rel_name = f"{folder_rel}/{filename}".lstrip("/")
                path = os.path.join(folder_abs, filename)
                with open(path, "wb") as f:
                    f.write(content)
                if payload.classify and kind == "image":
                    classification = await classify_asset_image_best_effort(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
                    if classification:
                        _write_local_upload_classification(rel_name, classification)
                item = _local_upload_item(rel_name)
                uploaded.append(item)
                result.update({"ok": True, "file": rel_name, "item": item})
            except HTTPException as exc:
                result["error"] = str(exc.detail or "导入失败")
            except Exception as exc:
                result["error"] = str(exc) or "导入失败"
            results.append(result)
    return {"ok": True, "count": len(uploaded), "files": uploaded, "items": results}

@app.get("/api/local-assets")
async def list_local_assets():
    tree, items = _local_upload_tree_and_items()
    return {"items": items, "tree": tree}

@app.post("/api/local-assets/folders")
async def create_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
    ensure_same_origin_request(request)
    parent_rel, parent_abs = _local_upload_safe_folder(payload.parent)
    if not os.path.isdir(parent_abs):
        raise HTTPException(status_code=404, detail="父文件夹不存在")
    name = _local_upload_safe_folder_name(payload.name)
    rel = f"{parent_rel}/{name}".lstrip("/")
    _, abs_path = _local_upload_safe_folder(rel)
    if os.path.exists(abs_path):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.makedirs(abs_path, exist_ok=False)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": rel, "name": name}, "tree": tree, "items": items}

@app.patch("/api/local-assets/folders")
async def rename_local_asset_folder(payload: LocalAssetFolderRequest, request: Request):
    ensure_same_origin_request(request)
    rel, abs_path = _local_upload_safe_folder(payload.path)
    if not rel:
        raise HTTPException(status_code=400, detail="根目录不能重命名")
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="文件夹不存在")
    name = _local_upload_safe_folder_name(payload.name)
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{name}".lstrip("/")
    _, new_abs = _local_upload_safe_folder(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.rename(abs_path, new_abs)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": new_rel, "name": name}, "tree": tree, "items": items}

@app.patch("/api/local-assets/items")
async def rename_local_asset_item(payload: LocalAssetRenameRequest, request: Request):
    ensure_same_origin_request(request)
    rel, abs_path = _local_upload_safe_path(payload.path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="本地素材不存在")
    kind, ext = _local_upload_kind_ext(rel, "")
    if kind is None:
        raise HTTPException(status_code=400, detail="不支持的素材类型")
    new_stem = _local_upload_safe_file_stem(payload.name)
    old_ext = os.path.splitext(rel)[1] or ext
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{new_stem}{old_ext}".lstrip("/")
    if new_rel == rel:
        tree, items = _local_upload_tree_and_items()
        return {"ok": True, "item": _local_upload_item(rel), "tree": tree, "items": items}
    _, new_abs = _local_upload_abs(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名素材已存在")
    os.rename(abs_path, new_abs)
    old_caption = _local_upload_caption_path(rel)
    new_caption = _local_upload_caption_path(new_rel)
    if os.path.isfile(old_caption) and not os.path.exists(new_caption):
        os.rename(old_caption, new_caption)
    old_classification = _local_upload_classification_path(rel)
    new_classification = _local_upload_classification_path(new_rel)
    if os.path.isfile(old_classification) and not os.path.exists(new_classification):
        os.rename(old_classification, new_classification)
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "item": _local_upload_item(new_rel), "old_path": rel, "tree": tree, "items": items}

@app.post("/api/local-assets/delete")
async def delete_local_assets(payload: dict, request: Request):
    ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list):
        names = []
    deleted = []
    for name in names:
        try:
            rel, path = _local_upload_safe_path(name)
        except HTTPException:
            continue
        if os.path.isfile(path):
            try:
                os.remove(path)
                txt_path = _local_upload_caption_path(rel)
                if os.path.isfile(txt_path):
                    os.remove(txt_path)
                cls_path = _local_upload_classification_path(rel)
                if os.path.isfile(cls_path):
                    os.remove(cls_path)
                deleted.append(rel)
            except OSError:
                pass
    return {"deleted": deleted}

@app.post("/api/local-assets/move")
async def move_local_assets(payload: dict, request: Request):
    ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="没有选择素材")
    folder_value = str(payload.get("folder") or "").strip() if isinstance(payload, dict) else ""
    target_rel, target_abs = _local_upload_safe_folder(folder_value)
    if target_rel and not os.path.isdir(target_abs):
        raise HTTPException(status_code=404, detail="目标文件夹不存在")
    moved = 0
    for name in names:
        try:
            rel, abs_path = _local_upload_safe_path(name)
        except HTTPException:
            continue
        if not os.path.isfile(abs_path):
            continue
        base = os.path.basename(rel)
        new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
        if new_rel == rel:
            continue
        _, new_abs = _local_upload_abs(new_rel)
        if os.path.exists(new_abs):
            stem, ext = os.path.splitext(base)
            base = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
            new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
            _, new_abs = _local_upload_abs(new_rel)
        try:
            os.makedirs(os.path.dirname(new_abs), exist_ok=True)
            os.rename(abs_path, new_abs)
            for src_sib, dst_sib in (
                (_local_upload_caption_path(rel), _local_upload_caption_path(new_rel)),
                (_local_upload_classification_path(rel), _local_upload_classification_path(new_rel)),
            ):
                if os.path.isfile(src_sib) and not os.path.exists(dst_sib):
                    os.rename(src_sib, dst_sib)
            moved += 1
        except OSError:
            continue
    tree, items = _local_upload_tree_and_items()
    return {"ok": True, "moved": moved, "items": items, "tree": tree}

@app.post("/api/local-assets/caption")
async def caption_local_assets(payload: LocalAssetCaptionRequest):
    prompt = (payload.prompt or "描述图片").strip() or "描述图片"
    items = []
    ok_count = 0
    for name in (payload.names or [])[:100]:
        item = {"name": name, "ok": False, "caption": "", "caption_file": "", "error": ""}
        try:
            filename, path = _local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材反推提示词")
            caption, resolved_model = await caption_image_with_provider(
                path, prompt, payload.provider, payload.model, payload.ms_model,
            )
            txt_path = _local_upload_caption_path(filename)
            with open(txt_path, "w", encoding="utf-8", newline="") as f:
                f.write(caption)
            item.update({
                "ok": True, "name": filename, "caption": caption,
                "caption_file": os.path.basename(txt_path), "model": resolved_model,
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = str(exc.detail or "反推失败")
        except Exception as exc:
            item["error"] = str(exc) or "反推失败"
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}

@app.post("/api/local-assets/classify")
async def classify_local_assets(payload: LocalAssetClassifyRequest):
    items = []
    ok_count = 0
    for name in (payload.names or [])[:80]:
        item = {"name": name, "ok": False, "classification": None, "classification_file": "", "error": ""}
        try:
            filename, path = _local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材智能分类")
            classification = await classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
            _write_local_upload_classification(filename, classification)
            item.update({
                "ok": True, "name": filename, "classification": classification,
                "classification_file": os.path.basename(_local_upload_classification_path(filename)),
                "model": classification.get("model") or "",
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = str(exc.detail or "智能分类失败")
        except Exception as exc:
            item["error"] = str(exc) or "智能分类失败"
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}

@app.patch("/api/local-assets/caption")
async def save_local_asset_caption(payload: LocalAssetCaptionSaveRequest):
    filename, path = _local_upload_safe_path(payload.name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    kind, _ = _local_upload_kind_ext(filename, "")
    if kind != "image":
        raise HTTPException(status_code=400, detail="仅支持图片素材保存提示词")
    caption = str(payload.caption or "")[:100000]
    txt_path = _local_upload_caption_path(filename)
    with open(txt_path, "w", encoding="utf-8", newline="") as f:
        f.write(caption)
    return {"ok": True, "caption": caption, "caption_file": os.path.basename(txt_path)}

# --- 画布资产 API ---

@app.get("/api/canvas-assets")
async def list_canvas_assets():
    return await asyncio.to_thread(canvas_assets_index)

@app.post("/api/canvas-assets/check")
async def check_canvas_assets(payload: CanvasAssetCheckRequest):
    result = {}
    for url in payload.urls[:3000]:
        text = str(url or "").strip()
        if not text:
            continue
        if text.startswith("/output/") or text.startswith("/assets/"):
            result[text] = bool(output_file_from_url(text))
        else:
            result[text] = True
    return {"exists": result}

@app.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: CanvasAssetDownloadRequest):
    buffer = BytesIO()
    used_names = set()
    count = 0
    raw_items = payload.items or [{"url": url} for url in payload.urls]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw in raw_items[:1000]:
            if isinstance(raw, dict):
                text = str(raw.get("url") or "").strip()
                requested_name = str(raw.get("name") or "").strip()
            else:
                text = str(raw or "").strip()
                requested_name = ""
            if not text:
                continue
            path = output_file_from_url(text)
            content = None
            content_type = ""
            if path and os.path.isfile(path):
                base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
            else:
                local_by_name = local_media_file_by_basename(filename_from_media_url(text, ""))
                if local_by_name and os.path.isfile(local_by_name):
                    path = local_by_name
                    base = sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                else:
                    try:
                        remote = fetch_remote_media_bytes(text)
                    except Exception:
                        remote = None
                    if not remote:
                        continue
                    content, content_type = remote
                    base = sanitize_export_filename(requested_name or filename_from_media_url(text, f"image-{count + 1}.bin"), f"image-{count + 1}.bin")
            name, ext = os.path.splitext(base)
            archive_name = base
            suffix = 2
            while archive_name in used_names:
                archive_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(archive_name)
            if path and os.path.isfile(path):
                zf.write(path, archive_name)
            elif content:
                zf.writestr(archive_name, content)
            count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可下载的内容")
    buffer.seek(0)
    filename = sanitize_export_filename(payload.filename or "canvas-output-images.zip", "canvas-output-images.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)

# --- 资产库 API ---

@app.get("/api/asset-library")
async def get_asset_library():
    return {"library": load_asset_library()}

@app.post("/api/asset-library/libraries")
async def create_asset_library(payload: AssetLibraryRequest):
    lib = load_asset_library()
    library = {"id": f"lib_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "资产库"), "type": "asset", "categories": []}
    library["categories"].append({"id": f"cat_{uuid.uuid4().hex[:12]}", "name": "默认分组", "type": "image", "items": []})
    library["categories"].append({"id": f"wf_{uuid.uuid4().hex[:12]}", "name": "工作流", "type": "workflow", "items": []})
    lib.setdefault("libraries", []).append(library)
    lib["active_library_id"] = library["id"]
    save_asset_library(lib)
    return {"library": lib, "asset_library": library}

@app.patch("/api/asset-library/libraries/{library_id}")
async def rename_asset_library(library_id: str, payload: AssetLibraryRenameRequest):
    lib = load_asset_library()
    library = find_asset_library(lib, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="资产库不存在")
    library["name"] = sanitize_asset_name(payload.name, library.get("name") or "资产库")
    save_asset_library(lib)
    return {"library": lib, "asset_library": library}

@app.delete("/api/asset-library/libraries/{library_id}")
async def delete_asset_library(library_id: str):
    lib = load_asset_library()
    libraries = lib.get("libraries") or []
    if len(libraries) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个资产库")
    if not any(item.get("id") == library_id for item in libraries):
        raise HTTPException(status_code=404, detail="资产库不存在")
    lib["libraries"] = [item for item in libraries if item.get("id") != library_id]
    if lib.get("active_library_id") == library_id:
        lib["active_library_id"] = lib["libraries"][0].get("id")
    save_asset_library(lib)
    return {"library": lib}

@app.post("/api/asset-library/categories")
async def create_asset_library_category(payload: AssetLibraryCategoryRequest):
    lib = load_asset_library()
    library = find_asset_library(lib, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    cat_type = "workflow" if str(payload.type or "").lower() == "workflow" else "image"
    category = {"id": f"cat_{uuid.uuid4().hex[:12]}", "name": sanitize_asset_name(payload.name, "新文件夹"), "type": cat_type, "items": []}
    if cat_type == "image":
        category["dir"] = unique_asset_category_dir(library, payload.name)
        try:
            os.makedirs(os.path.join(ASSET_LIBRARY_DIR, category["dir"]), exist_ok=True)
        except Exception as exc:
            print(f"创建分组文件夹失败: {exc}")
    library.setdefault("categories", []).append(category)
    lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
    save_asset_library(lib)
    return {"library": lib, "category": category}

@app.patch("/api/asset-library/categories/{category_id}")
async def rename_asset_library_category(category_id: str, payload: AssetLibraryRenameRequest):
    lib = load_asset_library()
    _, cat = find_asset_category_with_library(lib, category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    cat["name"] = sanitize_asset_name(payload.name, cat.get("name") or "新文件夹")
    save_asset_library(lib)
    return {"library": lib, "category": cat}

@app.delete("/api/asset-library/categories/{category_id}")
async def delete_asset_library_category(category_id: str, library_id: str = ""):
    lib = load_asset_library()
    library, cat = find_asset_category_with_library(lib, category_id, library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    cat_items = cat.get("items") or []
    categories = library.get("categories") or []
    remaining = [c for c in categories if c.get("id") != category_id]
    if remaining:
        fallback_cat = remaining[0]
        fallback_cat.setdefault("items", []).extend(cat_items)
    else:
        default_cat = library.get("categories", [{}])[0] if library.get("categories") else None
        if default_cat and default_cat.get("id") != category_id:
            default_cat.setdefault("items", []).extend(cat_items)
    library["categories"] = remaining
    save_asset_library(lib)
    return {"library": lib}

@app.post("/api/asset-library/items")
async def add_asset_library_item(payload: AssetLibraryAddRequest):
    lib = load_asset_library()
    _, cat = find_asset_category_with_library(lib, payload.category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    url = str(payload.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="素材 URL 不能为空")
    item = {
        "id": f"asset_{uuid.uuid4().hex[:12]}",
        "name": sanitize_asset_name(payload.name, "asset"),
        "url": url,
        "kind": asset_library_media_kind(url),
        "created_at": now_ms(),
    }
    cat.setdefault("items", []).append(item)
    lib["active_library_id"] = library_id = lib.get("active_library_id") or (find_asset_library(lib, "") or {}).get("id")
    save_asset_library(lib)
    return {"library": lib, "item": item}

@app.post("/api/asset-library/items/batch")
async def batch_add_asset_library_items(payload: AssetLibraryBatchAddRequest):
    lib = load_asset_library()
    _, cat = find_asset_category_with_library(lib, payload.category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    added = []
    for entry in (payload.items or [])[:200]:
        url = str(entry.url or "").strip()
        if not url:
            continue
        item = {
            "id": f"asset_{uuid.uuid4().hex[:12]}",
            "name": sanitize_asset_name(entry.name, "asset"),
            "url": url,
            "kind": asset_library_media_kind(url),
            "created_at": now_ms(),
        }
        cat.setdefault("items", []).append(item)
        added.append(item)
    save_asset_library(lib)
    return {"library": lib, "items": added}

@app.patch("/api/asset-library/items/{item_id}")
async def rename_asset_library_item(item_id: str, payload: AssetLibraryRenameRequest):
    lib = load_asset_library()
    for library in lib.get("libraries", []):
        for cat in library.get("categories", []):
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    item["name"] = sanitize_asset_name(payload.name, item.get("name") or "asset")
                    save_asset_library(lib)
                    return {"library": lib, "item": item}
    raise HTTPException(status_code=404, detail="资产不存在")

@app.post("/api/asset-library/items/classify")
async def classify_asset_library_items(payload: AssetLibraryClassifyRequest):
    lib = load_asset_library()
    results = []
    changed = False
    for item_id in (payload.ids or [])[:80]:
        item = find_asset_item_in_library(lib, item_id, payload.library_id)
        result = {"id": item_id, "ok": False, "classification": None, "error": ""}
        if not item:
            result["error"] = "资产不存在"
            results.append(result)
            continue
        if asset_library_media_kind(item.get("url") or "") != "image" and item.get("kind") != "image":
            result["error"] = "仅支持图片素材智能分类"
            results.append(result)
            continue
        path = output_file_from_url(item.get("url") or "")
        if not path or not os.path.isfile(path):
            result["error"] = "文件不存在"
            results.append(result)
            continue
        try:
            classification = await classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
            item["classification"] = classification
            changed = True
            result.update({"ok": True, "classification": classification})
        except Exception as exc:
            result["error"] = str(getattr(exc, "detail", "") or exc)
        results.append(result)
    if changed:
        save_asset_library(lib)
    return {"library": lib, "count": sum(1 for item in results if item.get("ok")), "items": results}

@app.delete("/api/asset-library/items/{item_id}")
async def delete_asset_library_item(item_id: str):
    lib = load_asset_library()
    removed = None
    for library in lib.get("libraries", []):
        for cat in library.get("categories", []):
            keep = []
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    removed = item
                else:
                    keep.append(item)
            cat["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="资产不存在")
    remove_asset_library_file(removed)
    save_asset_library(lib)
    return {"library": lib}

@app.post("/api/asset-library/items/delete")
async def batch_delete_asset_library_items(payload: AssetLibraryBatchDeleteRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = load_asset_library()
    removed = 0
    removed_items = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            keep = []
            for item in cat.get("items", []):
                if item.get("id") in ids:
                    removed += 1
                    removed_items.append(item)
                else:
                    keep.append(item)
            cat["items"] = keep
    for item in removed_items:
        remove_asset_library_file(item)
    save_asset_library(lib)
    return {"library": lib, "removed": removed}

@app.post("/api/asset-library/items/move")
async def batch_move_asset_library_items(payload: AssetLibraryBatchMoveRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = load_asset_library()
    target_cat = find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
    if not target_cat:
        raise HTTPException(status_code=404, detail="目标分组不存在")
    target_type = target_cat.get("type") or "image"
    moved = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if (cat.get("type") or "image") != target_type:
                continue
            keep = []
            for item in cat.get("items", []):
                if item.get("id") in ids:
                    moved.append(item)
                else:
                    keep.append(item)
            cat["items"] = keep
    existing_ids = {item.get("id") for item in target_cat.get("items", [])}
    for item in moved:
        if item.get("id") not in existing_ids:
            target_cat.setdefault("items", []).append(item)
            existing_ids.add(item.get("id"))
    save_asset_library(lib)
    return {"library": lib, "moved": len(moved)}

@app.post("/api/asset-library/items/crop")
async def batch_crop_asset_library_items(payload: AssetLibraryBatchCropRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = load_asset_library()
    target_cat = None
    if payload.target_category_id:
        target_cat = find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
        if not target_cat:
            raise HTTPException(status_code=404, detail="目标分组不存在")
        if target_cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="目标分组不支持媒体")
    added = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if cat.get("type") != "image":
                continue
            cat_items = cat.get("items") or []
            target_items = []
            remaining = []
            for item in cat_items:
                if item.get("id") in ids:
                    target_items.append(item)
                else:
                    remaining.append(item)
            cat["items"] = remaining
            if not target_cat:
                target_cat = cat
            for item in target_items:
                existing_ids = {i.get("id") for i in target_cat.get("items", [])}
                if item.get("id") not in existing_ids:
                    target_cat.setdefault("items", []).append(item)
                    added.append(item)
    save_asset_library(lib)
    return {"library": lib, "items": added}

# --- 提示词库 API ---

@app.get("/api/prompt-libraries")
async def get_prompt_libraries():
    return {"library": public_prompt_libraries()}

@app.post("/api/prompt-libraries")
async def create_prompt_library(payload: PromptLibraryRequest):
    data = load_prompt_libraries()
    library = {
        "id": f"lib_{uuid.uuid4().hex[:12]}",
        "name": sanitize_asset_name(payload.name, "提示词库"),
        "type": "prompt",
        "categories": [],
        "items": [],
    }
    data.setdefault("libraries", []).append(library)
    data["active_library_id"] = library["id"]
    data = save_prompt_libraries(data)
    new_lib = next((lib for lib in data.get("libraries", []) if lib.get("id") == library["id"]), library)
    return {"library": public_prompt_libraries(data), "prompt_library": new_lib}

@app.patch("/api/prompt-libraries/{library_id}")
async def rename_prompt_library(library_id: str, payload: PromptLibraryRequest):
    data = load_prompt_libraries()
    library = find_prompt_library(data, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    library["name"] = sanitize_asset_name(payload.name, library.get("name") or "提示词库")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "prompt_library": library}

@app.delete("/api/prompt-libraries/{library_id}")
async def delete_prompt_library(library_id: str):
    if library_id == "system":
        raise HTTPException(status_code=400, detail="系统提示词库不能删除,可以删除其中的提示词")
    data = load_prompt_libraries()
    libraries = data.get("libraries", []) or []
    kept = [lib for lib in libraries if lib.get("id") != library_id]
    if len(kept) == len(libraries):
        raise HTTPException(status_code=404, detail="提示词库不存在")
    data["libraries"] = kept
    if data.get("active_library_id") == library_id:
        data["active_library_id"] = "system"
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

@app.post("/api/prompt-libraries/items")
async def add_prompt_library_item(payload: PromptLibraryItemRequest):
    data = load_prompt_libraries()
    library = find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    item = normalize_prompt_library_item({
        "id": f"tpl_{uuid.uuid4().hex[:12]}",
        "name": payload.name,
        "category": payload.category,
        "positive": payload.positive,
        "negative": payload.negative,
        "scene": payload.scene,
        "created_at": now_ms(),
        "updated_at": now_ms(),
    })
    library.setdefault("items", []).insert(0, item)
    data["active_library_id"] = library.get("id") or data.get("active_library_id")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "item": item}

@app.patch("/api/prompt-libraries/items/{item_id}")
async def update_prompt_library_item(item_id: str, payload: PromptLibraryItemRequest):
    data = load_prompt_libraries()
    for library in data.get("libraries", []) or []:
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for index, item in enumerate(library.get("items", []) or []):
            if item.get("id") == item_id:
                next_item = normalize_prompt_library_item({
                    **item,
                    "name": payload.name or item.get("name"),
                    "category": payload.category or item.get("category"),
                    "positive": payload.positive or item.get("positive"),
                    "negative": payload.negative,
                    "scene": payload.scene,
                    "updated_at": now_ms(),
                })
                library["items"][index] = next_item
                data = save_prompt_libraries(data)
                return {"library": public_prompt_libraries(data), "item": next_item}
    raise HTTPException(status_code=404, detail="提示词不存在")

@app.delete("/api/prompt-libraries/items/{item_id}")
async def delete_prompt_library_item(item_id: str):
    data = load_prompt_libraries()
    removed = None
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") == item_id:
                removed = item
            else:
                keep.append(item)
        library["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="提示词不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "removed": 1}

@app.post("/api/prompt-libraries/items/delete")
async def batch_delete_prompt_library_items(payload: PromptLibraryBatchDeleteRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择提示词")
    data = load_prompt_libraries()
    removed = 0
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") in ids:
                removed += 1
            else:
                keep.append(item)
        library["items"] = keep
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "removed": removed}

PROMPT_BUILTIN_CATEGORY_IDS = {"view", "storyboard", "character", "product", "lighting", "custom"}

@app.post("/api/prompt-libraries/categories")
async def add_prompt_library_category(payload: PromptLibraryCategoryRequest):
    data = load_prompt_libraries()
    library = find_prompt_library(data, payload.library_id) or find_prompt_library(data, "system")
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    name = sanitize_asset_name(payload.name, "新分组")
    existing = {str(c.get("id")) for c in (library.get("categories") or []) if isinstance(c, dict)} | PROMPT_BUILTIN_CATEGORY_IDS
    cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    while cat_id in existing:
        cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    category = {"id": cat_id, "name": name}
    library.setdefault("categories", []).append(category)
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data), "category": category}

@app.patch("/api/prompt-libraries/categories/{category_id}")
async def rename_prompt_library_category(category_id: str, payload: PromptLibraryCategoryRequest):
    name = sanitize_asset_name(payload.name, "")
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    data = load_prompt_libraries()
    updated = False
    for library in data.get("libraries", []) or []:
        for cat in library.get("categories") or []:
            if isinstance(cat, dict) and cat.get("id") == category_id:
                cat["name"] = name
                updated = True
    if not updated:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

@app.delete("/api/prompt-libraries/categories/{category_id}")
async def delete_prompt_library_category(category_id: str):
    data = load_prompt_libraries()
    found = False
    for library in data.get("libraries", []) or []:
        cats = library.get("categories") or []
        kept = [c for c in cats if not (isinstance(c, dict) and c.get("id") == category_id)]
        if len(kept) != len(cats):
            found = True
            library["categories"] = kept
            fallback = next((str(c.get("id")) for c in kept if isinstance(c, dict) and c.get("id")), "")
            for item in library.get("items", []) or []:
                if isinstance(item, dict) and item.get("category") == category_id:
                    item["category"] = fallback
    if not found:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = save_prompt_libraries(data)
    return {"library": public_prompt_libraries(data)}

# --- 共享文件夹 API ---

@app.get("/api/shared-folders")
async def list_shared_folders():
    data = shared_folders_load()
    folders = []
    for entry in data.get("folders", []):
        abs_path = shared_folder_abs(entry)
        folders.append({
            "id": entry.get("id"),
            "name": entry.get("name") or os.path.basename(abs_path) or abs_path,
            "rel": entry.get("rel") or "",
            "path": abs_path,
            "exists": os.path.isdir(abs_path),
            "created_at": entry.get("created_at"),
        })
    return {"folders": folders}

@app.post("/api/shared-folders")
async def register_shared_folder(payload: SharedFolderRegister):
    abs_path, rel = shared_resolve_register(payload.path)
    name = sanitize_asset_name(payload.name or os.path.basename(abs_path), "共享文件夹")
    with SHARED_FOLDERS_LOCK:
        data = shared_folders_load()
        for entry in data.get("folders", []):
            if os.path.normpath(shared_folder_abs(entry)) == os.path.normpath(abs_path):
                entry["name"] = name
                shared_folders_save(data)
                return {"folder": {**entry, "path": abs_path, "exists": True}}
        entry = {
            "id": f"shared_{uuid.uuid4().hex[:12]}",
            "name": name,
            "rel": rel,
            "created_at": now_ms(),
        }
        data.setdefault("folders", []).append(entry)
        shared_folders_save(data)
    return {"folder": {**entry, "path": abs_path, "exists": True}}

@app.delete("/api/shared-folders/{folder_id}")
async def unregister_shared_folder(folder_id: str):
    with SHARED_FOLDERS_LOCK:
        data = shared_folders_load()
        before = len(data.get("folders", []))
        data["folders"] = [f for f in data.get("folders", []) if f.get("id") != folder_id]
        if len(data["folders"]) == before:
            raise HTTPException(status_code=404, detail="共享文件夹不存在")
        shared_folders_save(data)
    return {"ok": True}

@app.get("/api/shared-folders/{folder_id}/tree")
async def get_shared_folder_tree(folder_id: str):
    entry = shared_folder_by_id(folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    abs_path = shared_folder_abs(entry)
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="文件夹已不存在")
    tree = scan_shared_tree(folder_id, abs_path, "", entry.get("name") or os.path.basename(abs_path))
    return {"folder": {"id": folder_id, "name": entry.get("name"), "path": abs_path}, "tree": tree}

@app.get("/api/shared-folders/{folder_id}/file")
async def get_shared_folder_file(folder_id: str, path: str = ""):
    entry = shared_folder_by_id(folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    folder_abs = shared_folder_abs(entry)
    abs_path = shared_child_abs(folder_abs, path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    ext = os.path.splitext(abs_path)[1].lower()
    if ext not in SHARED_MEDIA_EXTS:
        raise HTTPException(status_code=400, detail="不支持的文件类型")
    return FileResponse(abs_path, media_type=content_type_for_path(abs_path))

@app.post("/api/shared-folders/import")
async def import_shared_folder_files(payload: SharedFolderImport):
    entry = shared_folder_by_id(payload.folder_id)
    if not entry:
        raise HTTPException(status_code=404, detail="共享文件夹不存在")
    folder_abs = shared_folder_abs(entry)
    lib = load_asset_library()
    cat = find_asset_category_in_library(lib, payload.category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    if cat.get("type") != "image":
        raise HTTPException(status_code=400, detail="该分类暂不支持添加媒体")
    added = []
    for rel in (payload.paths or [])[:200]:
        abs_path = shared_child_abs(folder_abs, rel)
        if not os.path.isfile(abs_path):
            continue
        ext = os.path.splitext(abs_path)[1].lower()
        if ext not in SHARED_MEDIA_EXTS:
            continue
        _, item = make_asset_library_item(abs_path, os.path.basename(abs_path), subdir=cat.get("dir") or "")
        if item.get("kind") == "image":
            classification = await classify_asset_image_best_effort(output_file_from_url(item.get("url") or "") or abs_path)
            if classification:
                item["classification"] = classification
        cat.setdefault("items", []).append(item)
        added.append(item)
    save_asset_library(lib)
    return {"library": lib, "items": added}

# --- 服务静态文件(上传素材) ---

@app.get("/assets/uploads/{path:path}")
async def serve_local_upload(path: str):
    clean_path = path.replace("\\", "/")
    if ".." in clean_path:
        raise HTTPException(status_code=404, detail="File not found")
    full_path = os.path.abspath(os.path.join(LOCAL_UPLOAD_DIR, clean_path))
    root = os.path.abspath(LOCAL_UPLOAD_DIR)
    if not full_path.startswith(root):
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".mp4": "video/mp4", ".webm": "video/webm",
    }.get(ext, "application/octet-stream")
    return StarletteFileResponse(full_path, media_type=media_type)

@app.get("/assets/library/{path:path}")
async def serve_asset_library(path: str):
    clean_path = path.replace("\\", "/")
    if ".." in clean_path:
        raise HTTPException(status_code=404, detail="File not found")
    full_path = os.path.abspath(os.path.join(ASSET_LIBRARY_DIR, clean_path))
    root = os.path.abspath(ASSET_LIBRARY_DIR)
    if not full_path.startswith(root):
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".json": "application/json",
        ".zip": "application/zip",
    }.get(ext, "application/octet-stream")
    return StarletteFileResponse(full_path, media_type=media_type)

# --- 智能画布分组导出 API ---

@app.get("/api/smart-canvas/prompt-templates")
async def smart_canvas_prompt_templates():
    try:
        template_path = prompt_template_markdown_path()
        source = os.path.relpath(template_path, BASE_DIR).replace("\\", "/") if template_path else ""
        return {"templates": builtin_prompt_templates(), "source": source}
    except Exception as e:
        print(f"读取提示词模板失败: {e}")
        return {"templates": []}

@app.post("/api/smart-canvas/group-export")
async def export_smart_canvas_group(payload: SmartCanvasGroupExportRequest):
    target_dir = smart_group_export_folder(payload.folder, payload.group_name)
    used_names = set()
    count = 0
    text_index = 1
    for item in payload.items[:2000]:
        kind = str(item.kind or "").lower()
        if kind == "text":
            text = str(item.text or "")
            if not text.strip():
                continue
            base = sanitize_export_filename(item.name or f"{text_index}.txt", f"{text_index}.txt")
            if not base.lower().endswith(".txt"):
                base += ".txt"
            text_index += 1
            name, ext = os.path.splitext(base)
            out_name = base
            suffix = 2
            while out_name in used_names:
                out_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(out_name)
            with open(os.path.join(target_dir, out_name), "w", encoding="utf-8") as f:
                f.write(text)
            count += 1
            continue
        src = output_file_from_url(item.url)
        if not src or not os.path.isfile(src):
            continue
        base = sanitize_export_filename(item.name or os.path.basename(src), os.path.basename(src) or f"asset-{count + 1}")
        name, ext = os.path.splitext(base)
        if not ext:
            _, src_ext = os.path.splitext(src)
            ext = src_ext or ".bin"
            base = name + ext
        out_name = base
        suffix = 2
        while out_name in used_names:
            out_name = f"{name}-{suffix}{ext}"
            suffix += 1
        used_names.add(out_name)
        shutil.copy2(src, os.path.join(target_dir, out_name))
        count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可导出的内容")
    return {"ok": True, "folder": target_dir, "count": count}


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

@app.get("/api/media-preview")
async def media_preview(url: str, w: int = 512):
    # ComfyUI 图片(如 /api/comfyui/view?filename=...)直接走 ComfyUI 代理缩略图
    if url.startswith("/api/comfyui/view"):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        filename = qs.get("filename", [""])[0]
        subfolder = qs.get("subfolder", [""])[0]
        ctype = qs.get("type", ["output"])[0]
        return await proxy_comfyui_view(filename=filename, subfolder=subfolder, type=ctype, w=w)

    path = output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")

    width = max(64, min(2048, int(w or 512)))
    webp_path, png_path = media_preview_cache_paths(path, width)

    if os.path.exists(webp_path):
        return FileResponse(webp_path, media_type="image/webp")
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png")

    try:
        os.makedirs(MEDIA_PREVIEW_DIR, exist_ok=True)
        if is_video_preview_file(path):
            img = await asyncio.to_thread(generate_video_preview_image, path, width)
        else:
            def _process_image():
                with Image.open(path) as source:
                    img = ImageOps.exif_transpose(source)
                    img.thumbnail((width, width), Image.BILINEAR)
                    return img.convert("RGBA" if image_has_alpha(img) else "RGB")
            img = await asyncio.to_thread(_process_image)

        def _save_preview():
            try:
                img.save(webp_path, format="WEBP", quality=88)
                return webp_path, "image/webp"
            except Exception:
                img.save(png_path, format="PNG", optimize=True)
                return png_path, "image/png"
        saved_path, saved_type = await asyncio.to_thread(_save_preview)
        # 浏览器缓存:文件名含 mtime+size 哈希,内容变了 key 就变,可以安全长缓存
        etag = _etag_for(saved_path)
        headers = {
            "Cache-Control": "public, max-age=2592000, immutable",
            "ETag": f'"{etag}"',
        }
        return FileResponse(saved_path, media_type=saved_type, headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=415, detail=f"无法生成预览图:{exc}") from exc

# --- 缓存管理 API ---

@app.get("/api/cache/info")
async def api_cache_info():
    """获取缩略图缓存信息"""
    if not os.path.isdir(MEDIA_PREVIEW_DIR):
        return {"count": 0, "size": 0}
    total_size = 0
    count = 0
    for f in os.listdir(MEDIA_PREVIEW_DIR):
        fp = os.path.join(MEDIA_PREVIEW_DIR, f)
        if os.path.isfile(fp):
            total_size += os.path.getsize(fp)
            count += 1
    return {"count": count, "size": total_size}

@app.post("/api/cache/clear")
async def api_cache_clear():
    """清理缩略图缓存"""
    if not os.path.isdir(MEDIA_PREVIEW_DIR):
        return {"message": "缓存目录不存在,无需清理", "cleared": 0}
    count = 0
    for f in os.listdir(MEDIA_PREVIEW_DIR):
        fp = os.path.join(MEDIA_PREVIEW_DIR, f)
        try:
            if os.path.isfile(fp):
                os.remove(fp)
                count += 1
        except OSError:
            pass
    return {"message": f"已清理 {count} 个缓存文件", "cleared": count}

# --- 云视频上传 API ---

@app.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: CloudVideoUploadRequest, request: Request):
    ensure_same_origin_request(request)
    return await upload_local_video_to_cloud(payload.url, payload.service)

# --- 本地图片导入 API ---

@app.post("/api/ai/import-local-image")
async def import_local_ai_reference(payload: LocalImageImportRequest, request: Request):
    ensure_same_origin_request(request)
    requested = [payload.path] if payload.path else []
    requested.extend(payload.paths or [])
    requested = [p for p in requested if str(p or "").strip()][:20]
    if not requested:
        raise HTTPException(status_code=400, detail="没有可导入的本地图片")
    return {"files": [import_local_image_file(normalize_local_image_path(path)) for path in requested]}

# --- RunningHub API ---

@app.get("/api/runninghub/app-info")
async def runninghub_app_info(webappId: str = ""):
    webapp_id = str(webappId or "").strip()
    if not webapp_id:
        raise HTTPException(status_code=400, detail="webappId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider)
    url = runninghub_endpoint_url(provider, f"/api/webapp/apiCallDemo?apiKey={urllib.parse.quote(api_key)}&webappId={urllib.parse.quote(webapp_id)}")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)) as client:
        try:
            response = await client.get(url, headers=runninghub_app_headers(False))
            raw = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text[:500]) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"请求 RunningHub 应用信息失败:{exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:500])
    if isinstance(raw, dict) and raw.get("code") not in (0, "0", None):
        raise HTTPException(status_code=400, detail=raw.get("msg") or f"RunningHub 查询失败 code={raw.get('code')}")
    data = raw.get("data") if isinstance(raw, dict) else {}
    return {"success": True, "data": data or {}}

@app.post("/api/runninghub/submit")
async def runninghub_submit(payload: RunningHubSubmitRequest):
    webapp_id = str(payload.webappId or "").strip()
    if not webapp_id:
        raise HTTPException(status_code=400, detail="webappId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider, use_wallet=payload.useWallet)
    body = {
        "apiKey": api_key,
        "webappId": webapp_id,
        "nodeInfoList": sanitize_runninghub_node_info_list(payload.nodeInfoList or []),
    }
    instance_type = str(payload.instanceType or "").strip()
    if instance_type:
        body["instanceType"] = instance_type
    url = runninghub_endpoint_url(provider, "/task/openapi/ai-app/run")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)) as client:
        try:
            response = await client.post(url, headers=runninghub_app_headers(True, payload.useWallet), json=body)
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"提交 RunningHub 任务失败:{exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:800])
    if isinstance(raw, dict) and raw.get("code") in (0, "0"):
        task_id = raw.get("data", {}).get("taskId") if isinstance(raw.get("data"), dict) else ""
        if not task_id:
            raise HTTPException(status_code=502, detail=f"RunningHub 未返回 taskId:{raw}")
        return {"success": True, "data": {"taskId": task_id, "raw": raw}}
    raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 提交失败:{raw}")

@app.post("/api/runninghub/workflow-submit")
async def runninghub_workflow_submit(payload: RunningHubWorkflowSubmitRequest):
    workflow_id = str(payload.workflowId or "").strip()
    if not workflow_id:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider, use_wallet=payload.useWallet)
    body = {
        "apiKey": api_key,
        "workflowId": workflow_id,
        "addMetadata": True,
    }
    if payload.nodeInfoList:
        body["nodeInfoList"] = sanitize_runninghub_node_info_list(payload.nodeInfoList)
    workflow_payload = payload.workflow
    if workflow_payload:
        if isinstance(workflow_payload, (dict, list)):
            body["workflow"] = json.dumps(sanitize_seed_like_workflow_values(workflow_payload), ensure_ascii=False)
        else:
            body["workflow"] = str(workflow_payload)
    url = runninghub_endpoint_url(provider, "/task/openapi/create")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=180.0, write=120.0, pool=20.0)) as client:
        try:
            response = await client.post(url, headers=runninghub_app_headers(True, payload.useWallet), json=body)
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"提交 RunningHub 工作流失败:{exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:800])
    if isinstance(raw, dict) and raw.get("code") in (0, "0"):
        task_id = raw.get("data", {}).get("taskId") if isinstance(raw.get("data"), dict) else ""
        if not task_id:
            raise HTTPException(status_code=502, detail=f"RunningHub 工作流未返回 taskId:{raw}")
        return {"success": True, "data": {"taskId": task_id, "raw": raw}}
    raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 工作流提交失败:{raw}")

@app.get("/api/runninghub/workflow-info")
async def runninghub_workflow_info(workflowId: str = ""):
    workflow_id = str(workflowId or "").strip()
    if not workflow_id:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider)
    url = runninghub_endpoint_url(provider, "/api/openapi/getJsonApiFormat")
    body = {"apiKey": api_key, "workflowId": workflow_id}
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)) as client:
        try:
            response = await client.post(url, headers=runninghub_app_headers(True), json=body)
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"拉取 RunningHub 工作流参数失败:{exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:800])
    if not isinstance(raw, dict) or raw.get("code") not in (0, "0"):
        raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub 工作流参数拉取失败:{raw}")
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    prompt = data.get("prompt")
    workflow_json = {}
    if isinstance(prompt, str) and prompt.strip():
        try:
            workflow_json = json.loads(prompt)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"RunningHub 工作流 JSON 解析失败:{exc}") from exc
    elif isinstance(prompt, dict):
        workflow_json = prompt
    node_info_list = runninghub_workflow_node_info_list(workflow_json)
    return {"success": True, "data": {"workflowId": workflow_id, "nodeInfoList": node_info_list, "raw": raw}}

@app.get("/api/runninghub/workflows")
def list_runninghub_workflows():
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
    merged = {workflow_id: cfg for workflow_id, cfg in store.items() if isinstance(cfg, dict)}
    for provider in load_api_providers():
        if provider.get("id") != "runninghub":
            continue
        for entry in provider.get("rh_workflows") or []:
            workflow_id = runninghub_workflow_store_key(entry.get("workflowId") or entry.get("id"))
            if not workflow_id:
                continue
            provider_cfg = runninghub_provider_workflow_config(workflow_id)
            if provider_cfg:
                merged[workflow_id] = runninghub_select_workflow_config(merged.get(workflow_id), provider_cfg, workflow_id)
    items = []
    for workflow_id, cfg in merged.items():
        if not isinstance(cfg, dict):
            continue
        items.append({
            "workflowId": workflow_id,
            "title": cfg.get("title") or workflow_id,
            "fieldCount": len(cfg.get("fields") or []),
            "updatedAt": cfg.get("updatedAt"),
            "description": cfg.get("description") or "",
        })
    items.sort(key=lambda item: item["title"])
    return {"workflows": items}

@app.get("/api/runninghub/workflows/{workflow_id:path}")
def get_runninghub_workflow(workflow_id: str):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
    cfg = store.get(key)
    provider_cfg = runninghub_provider_workflow_config(key)
    cfg = runninghub_select_workflow_config(cfg, provider_cfg, key)
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=404, detail="RunningHub 工作流未找到")
    return {"workflow": cfg}

@app.post("/api/runninghub/workflows/fetch")
async def fetch_runninghub_workflow(payload: RunningHubWorkflowConfig):
    workflow_id = runninghub_workflow_store_key(payload.workflowId)
    if not workflow_id:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider)
    url = runninghub_endpoint_url(provider, "/api/openapi/getJsonApiFormat")
    body = {"apiKey": api_key, "workflowId": workflow_id}
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0)) as client:
        try:
            response = await client.post(url, headers=runninghub_app_headers(True), json=body)
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch RunningHub workflow parameters: {exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:800])
    if not isinstance(raw, dict) or raw.get("code") not in (0, "0"):
        raise HTTPException(status_code=400, detail=(raw.get("msg") if isinstance(raw, dict) else "") or f"RunningHub workflow fetch failed: {raw}")
    data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
    prompt = data.get("prompt")
    workflow_json = {}
    if isinstance(prompt, str) and prompt.strip():
        try:
            workflow_json = json.loads(prompt)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to parse RunningHub workflow JSON: {exc}") from exc
    elif isinstance(prompt, dict):
        workflow_json = prompt
    fields = runninghub_collect_workflow_fields(workflow_json)
    return {"success": True, "data": {"workflowId": workflow_id, "title": payload.title or workflow_id, "description": payload.description or "", "fields": fields, "workflowJson": workflow_json, "raw": raw}}

@app.put("/api/runninghub/workflows/{workflow_id:path}")
def save_runninghub_workflow(workflow_id: str, payload: RunningHubWorkflowConfig):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    fields = [
        field for field in (runninghub_normalize_field(item) for item in (payload.fields or []))
        if not runninghub_is_saved_link_field(field)
    ]
    cfg = {
        "workflowId": key,
        "title": (payload.title or key).strip() or key,
        "description": payload.description or "",
        "fields": fields,
        "workflowJson": payload.workflowJson or {},
        "optionalImageMode": payload.optionalImageMode or "prune-workflow",
        "raw": payload.raw or {},
        "updatedAt": now_ms(),
    }
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
        store[key] = cfg
        save_runninghub_workflow_store(store)
    sync_runninghub_workflow_to_provider(cfg)
    return {"success": True, "workflow": cfg}

@app.delete("/api/runninghub/workflows/{workflow_id:path}")
def delete_runninghub_workflow(workflow_id: str):
    key = runninghub_workflow_store_key(workflow_id)
    if not key:
        raise HTTPException(status_code=400, detail="workflowId 必填")
    with RUNNINGHUB_WORKFLOW_LOCK:
        store = load_runninghub_workflow_store()
        provider_cfg = runninghub_provider_workflow_config(key)
        if key not in store and not provider_cfg:
            raise HTTPException(status_code=404, detail="RunningHub 工作流未找到")
        store.pop(key, None)
        save_runninghub_workflow_store(store)
    remove_runninghub_workflow_from_provider(key)
    return {"success": True}

@app.get("/api/runninghub/query")
async def runninghub_query(taskId: str = ""):
    task_id = str(taskId or "").strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="taskId 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider)
    url = runninghub_endpoint_url(provider, "/task/openapi/outputs")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=240.0, write=30.0, pool=20.0)) as client:
        try:
            response = await client.post(url, headers=runninghub_app_headers(True), json={"apiKey": api_key, "taskId": task_id})
            raw = response.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"查询 RunningHub 任务失败:{exc}") from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:800])
        code = raw.get("code") if isinstance(raw, dict) else None
        status = "PENDING"
        urls = []
        if code in (0, "0"):
            status = "SUCCESS"
            for remote in runninghub_extract_outputs(raw.get("data")):
                try:
                    urls.append(await runninghub_store_remote_output(client, remote))
                except Exception:
                    urls.append(remote)
        elif code in (804, "804"):
            status = "RUNNING"
        elif code in (813, "813"):
            status = "QUEUED"
        elif code in (805, "805"):
            status = "FAILED"
        else:
            status = "UNKNOWN"
        return {"success": True, "data": {"status": status, "urls": urls, "failReason": runninghub_fail_reason(raw), "code": code, "raw": raw}}

@app.post("/api/runninghub/upload-asset")
async def runninghub_upload_asset(payload: RunningHubUploadAssetRequest):
    source_url = str(payload.url or "").strip()
    if not source_url:
        raise HTTPException(status_code=400, detail="url 必填")
    provider = runninghub_provider()
    api_key = runninghub_api_key(provider, use_wallet=payload.useWallet)
    filename = "asset.bin"
    content_type = "application/octet-stream"
    content = b""
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=240.0, write=240.0, pool=20.0), follow_redirects=True) as client:
        path = runninghub_local_asset_path(source_url)
        if path:
            filename = os.path.basename(path)
            content_type = content_type_for_path(path)
            with open(path, "rb") as f:
                content = f.read()
        elif source_url.startswith(("http://", "https://")):
            response = await client.get(source_url)
            if not response.is_success:
                raise HTTPException(status_code=400, detail=f"下载素材失败 HTTP {response.status_code}")
            content = response.content
            content_type = response.headers.get("content-type") or content_type
        else:
            raise HTTPException(status_code=400, detail="不支持的素材来源")
    upload_url = runninghub_endpoint_url(provider, "/api/openapi/upload")
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=120.0, write=300.0, pool=20.0)) as client:
        files = {"file": (filename, content, content_type)}
        data = {"apiKey": api_key}
        response = await client.post(upload_url, data=data, files=files, headers=runninghub_app_headers(False, payload.useWallet))
        raw = response.json()
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=json.dumps(raw, ensure_ascii=False)[:500])
    if isinstance(raw, dict) and raw.get("code") not in (0, "0"):
        raise HTTPException(status_code=400, detail=raw.get("msg") or f"RunningHub 上传失败:{raw}")
    file_url = ""
    data = raw.get("data") if isinstance(raw, dict) else {}
    if isinstance(data, dict):
        file_url = data.get("fileUrl") or data.get("url") or ""
    return {"success": True, "url": file_url, "raw": raw}

# --- 画布工作流 API ---

@app.post("/api/canvas-workflows/export")
async def export_canvas_workflow(payload: CanvasWorkflowExportRequest):
    archive, _ = build_canvas_workflow_archive(payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(archive, media_type="application/zip", headers=headers)

@app.post("/api/canvas-workflows/export-to-library")
async def export_canvas_workflow_to_library(payload: CanvasWorkflowExportRequest):
    archive, meta = build_canvas_workflow_archive(payload)
    filename = sanitize_export_filename(payload.filename or "canvas-workflow.zip", "canvas-workflow.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    lib = load_asset_library()
    _, cat = asset_library_workflow_category(lib, payload.library_id, payload.category_id)
    item = make_workflow_library_item_from_bytes(archive, filename, payload.name or os.path.splitext(filename)[0])
    item["node_count"] = meta.get("node_count") or len(payload.nodes or [])
    item["connection_count"] = meta.get("connection_count") or len(payload.connections or [])
    item["resource_count"] = len(meta.get("resources") or [])
    cat.setdefault("items", []).append(item)
    save_asset_library(lib)
    return {"library": lib, "item": item}

@app.post("/api/canvas-workflows/import")
async def import_canvas_workflow(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    name = str(file.filename or "").lower()
    resource_mapping = {}
    workflow = None
    try:
        if name.endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(BytesIO(raw), "r") as zf:
                candidates = [n for n in zf.namelist() if n.lower().endswith("workflow.json")]
                workflow_name = "workflow.json" if "workflow.json" in zf.namelist() else (candidates[0] if candidates else "")
                if not workflow_name:
                    raise HTTPException(status_code=400, detail="压缩包中没有 workflow.json")
                workflow = json.loads(zf.read(workflow_name).decode("utf-8-sig"))
                stamp = time.strftime("%Y%m%d-%H%M%S")
                import_dir = os.path.join(OUTPUT_INPUT_DIR, f"workflow_import_{stamp}_{uuid.uuid4().hex[:6]}")
                os.makedirs(import_dir, exist_ok=True)
                for res in workflow.get("resources") or []:
                    archive = str(res.get("archive") or "").replace("\\", "/").lstrip("/")
                    if not archive or archive not in zf.namelist():
                        continue
                    base = sanitize_export_filename(res.get("name") or os.path.basename(archive), os.path.basename(archive) or "resource.bin")
                    target = os.path.join(import_dir, f"{uuid.uuid4().hex[:8]}_{base}")
                    with zf.open(archive) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    rel = os.path.relpath(target, ASSETS_DIR).replace("\\", "/")
                    new_url = f"/assets/{rel}"
                    old_url = str(res.get("url") or "").strip()
                    if old_url:
                        resource_mapping[old_url] = new_url
                    resource_mapping[archive] = new_url
                    resource_mapping[f"./{archive}"] = new_url
                    resource_mapping[os.path.basename(archive)] = new_url
        else:
            workflow = json.loads(raw.decode("utf-8-sig"))
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="无法读取压缩包") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法解析工作流文件:{exc}") from exc
    if isinstance(workflow, list):
        workflow = {"nodes": workflow, "connections": []}
    if not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail="工作流格式不正确")
    nodes_payload = workflow.get("nodes")
    connections_payload = workflow.get("connections")
    if nodes_payload is None and isinstance(workflow.get("workflow"), dict):
        nodes_payload = workflow["workflow"].get("nodes")
        connections_payload = workflow["workflow"].get("connections")
    if not isinstance(nodes_payload, list):
        raise HTTPException(status_code=400, detail="工作流 JSON 缺少 nodes")
    if not isinstance(connections_payload, list):
        connections_payload = []
    if resource_mapping:
        nodes_payload = canvas_workflow_replace_strings(nodes_payload, resource_mapping)
        connections_payload = canvas_workflow_replace_strings(connections_payload, resource_mapping)
    return {
        "workflow": canvas_workflow_payload(nodes_payload, connections_payload, workflow.get("resources") or []),
        "nodes": nodes_payload,
        "connections": connections_payload,
        "resource_map": resource_mapping,
    }

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


@app.post("/api/ideogram4/generate-json")
async def generate_ideogram4_json(req: Ideogram4JsonRequest, token: str = ""):
    """调用 LLM 将中文创意描述转换为 Ideogram4 结构化 JSON 提示词"""
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空")

    user_message = (
        f"Please generate the JSON caption for the user idea below.\n\n"
        f"TARGET IMAGE ASPECT RATIO: {req.width}:{req.height} (width:height).\n"
        f"User idea: {req.prompt.strip()}"
    )

    try:
        chat_base, chat_hdrs, model = resolve_chat_provider(req.provider, req.model, "")
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": IDEOGRAM4_JSON_SYSTEM_PROMPT},
                        {"role": "user", "content": user_message}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000
                },
            )
            response.raise_for_status()
            raw = response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误: {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败: {exc}") from exc

    result_text = text_from_chat_response(raw).strip()
    if not result_text:
        raise HTTPException(status_code=502, detail="LLM 返回为空")

    # 清理可能的 markdown 代码块
    cleaned = re.sub(r'^```(?:json)?\s*', '', result_text)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned)
    first_brace = cleaned.find('{')
    last_brace = cleaned.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        cleaned = cleaned[first_brace:last_brace + 1]
    cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)

    # 验证 JSON 格式
    try:
        json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"LLM 返回的 JSON 无效: {str(e)[:100]}")

    return {"json": cleaned, "model": model}


# === 随机源管理 API ===

# 导入随机源管理器
try:
    from random_source import get_manager
    random_manager = get_manager()
    print("[RandomSource] 随机源管理器已加载")
except Exception as e:
    print(f"[RandomSource] 加载失败: {e}")
    random_manager = None


@app.get("/api/random/sources")
async def random_sources():
    """列出所有随机源"""
    if not random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    return random_manager.list_sources()


@app.get("/api/random/categories/{source_id}")
async def random_categories(source_id: str):
    """获取指定随机源的所有类别"""
    if not random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    categories = random_manager.get_categories(source_id)
    return {"categories": categories}


@app.get("/api/random/{source_id}")
async def random_get(source_id: str, category: Optional[str] = None, count: int = 1):
    """随机获取指定源的元素"""
    if not random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    
    source = random_manager.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"随机源不存在: {source_id}")
    
    filters = {}
    if category:
        filters['category'] = category
    
    if count == 1:
        item = source.random(filters)
        return item or {}
    else:
        items = source.random_multi(filters, count)
        return {"items": items}


@app.post("/api/random/all")
async def random_all(config: Dict[str, Dict]):
    """根据配置随机选择所有源"""
    if not random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    return random_manager.random_all(config)


@app.post("/api/random/apply-plan")
async def random_apply_plan(config: Dict[str, Any]):
    """根据方案配置随机选择"""
    if not random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    
    result = {}
    
    # 处理角色
    char_config = config.get('character', {})
    if char_config.get('enabled'):
        names = char_config.get('names', [])
        count = char_config.get('count', 1)
        if names:
            source = random_manager.get_source('character')
            if source:
                filtered = [item for item in source.items if item.get('name') in names]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['character'] = random.choice(filtered)
                    else:
                        result['character'] = random.sample(filtered, actual_count)
    
    # 处理画师
    artist_config = config.get('artist', {})
    if artist_config.get('enabled'):
        names = artist_config.get('names', [])
        count = artist_config.get('count', 1)
        if names:
            source = random_manager.get_source('artist')
            if source:
                filtered = [item for item in source.items if item.get('name') in names]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['artist'] = [random.choice(filtered)]
                    else:
                        result['artist'] = random.sample(filtered, actual_count)
    
    # 处理预设
    preset_config = config.get('preset', {})
    if preset_config.get('enabled'):
        names = preset_config.get('names', [])
        count = preset_config.get('count', 1)
        if names:
            source = random_manager.get_source('preset')
            if source:
                # 跨分类同名时用 name_key(category_id::id)严格匹配;
                # 旧方案可能存的是短 name,这里用 name 再兜底一次保持兼容
                name_set = set(names)
                def _preset_match(item):
                    if item.get('name_key') in name_set:
                        return True
                    if item.get('name') in name_set:
                        return True
                    return False
                filtered = [item for item in source.items if _preset_match(item)]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['preset'] = random.choice(filtered)
                    else:
                        result['preset'] = random.sample(filtered, actual_count)
    
    return result


@app.post("/api/restart")
async def restart_server():
    """重启后端服务(同窗口)"""
    async def _restart():
        await asyncio.sleep(1)
        os.execv(sys.executable, [sys.executable] + sys.argv)
    asyncio.create_task(_restart())
    return {"message": "restarting", "status": "ok"}


# ============================================================
# 通配符管理 API
# - 列出内置 / 导入的通配符
# - 创建 / 更新 / 删除用户通配符（每行一条提示词）
# - 随机组合：选多个类型，每个类型随机抽一条拼接
# ============================================================
from wildcard_engine import get_engine as _wc_engine, WildcardEngine as _WildcardEngine

@app.get("/api/wildcards")
async def api_wildcards_list():
    """列出所有通配符（builtin + imported），附带条目数"""
    try:
        return _wc_engine().list_wildcards()
    except Exception as e:
        log.exception(f"列出通配符失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wildcards/{name}")
async def api_wildcards_get(name: str):
    """获取指定通配符的原始文本（每行一条，# 为注释）"""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    text = _wc_engine().get_wildcard_text(name)
    if not text:
        raise HTTPException(status_code=404, detail=f"通配符 {name} 不存在")
    options = _wc_engine().get_wildcard(name)
    return {"name": name, "text": text, "count": len(options)}


@app.post("/api/wildcards")
async def api_wildcards_create(payload: dict):
    """创建新的用户通配符（写入 data/wildcards/imported/）

    Body: { "name": "my_pack", "text": "line1\\nline2\\n..." , "overwrite": false }
    """
    name = (payload.get("name") or "").strip()
    text = payload.get("text") or ""
    overwrite = bool(payload.get("overwrite", False))
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().save_wildcard(name, text, overwrite=overwrite)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.put("/api/wildcards/{name}")
async def api_wildcards_update(name: str, payload: dict):
    """更新一个已存在的用户通配符（不能覆盖内置）"""
    name = (name or "").strip()
    text = payload.get("text") or ""
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().save_wildcard(name, text, overwrite=True)
    if not result["success"]:
        # 当类型不存在时退化为创建
        if "已存在" not in result["error"]:
            result = _wc_engine().save_wildcard(name, text, overwrite=False)
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.delete("/api/wildcards/{name}")
async def api_wildcards_delete(name: str):
    """删除一个导入的通配符（内置不可删）"""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().delete_wildcard(name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/wildcards/roll")
async def api_wildcards_roll(payload: dict):
    """随机组合：从所选类型中各抽一条拼接

    Body: { "names": ["clothing","background","pose"], "seed": 42(可选) }
    """
    names = payload.get("names") or []
    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="names 不能为空")
    seed = payload.get("seed")
    try:
        seed = int(seed) if seed is not None and str(seed) != "" else None
    except (ValueError, TypeError):
        seed = None
    return _wc_engine().roll_combo([str(n).strip() for n in names if str(n).strip()], seed=seed)


@app.post("/api/wildcards/resolve")
async def api_wildcards_resolve(payload: dict):
    """解析一段带通配符的文本（{a|b|c} / __name__ / [opt]）"""
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")
    seed = payload.get("seed")
    try:
        seed = int(seed) if seed is not None and str(seed) != "" else None
    except (ValueError, TypeError):
        seed = None
    return _wc_engine().preview(text, seed=seed) if hasattr(_wc_engine(), 'preview') else {
        "resolved": _wc_engine().resolve(text, seed=seed)
    }


@app.post("/api/wildcards/validate")
async def api_wildcards_validate(payload: dict):
    """校验一段提示词的通配符语法"""
    text = (payload.get("text") or "").strip()
    return {"warnings": _wc_engine().validate(text)}


if __name__ == "__main__":
    import uvicorn
    import socket

    # Get local IP for LAN access
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    print(f"\n  Local:   http://127.0.0.1:7000")
    print(f"  LAN:     http://{local_ip}:7000\n")

    uvicorn.run(app, host="0.0.0.0", port=7000)
