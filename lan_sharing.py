"""局域网共享。默认关闭，只监听本机；打开后在独立端口接受局域网访问。"""
import json
import os
import socket
import threading
import time
import hmac
from hashlib import scrypt
from secrets import token_hex

from fastapi import HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

import main as _main

CONFIG_NAME = "lan-sharing.json"
CLIENTS_NAME = "lan-sharing.json.clients.json"
COOKIE = "artcanvas_lan"
SESSION_MS = 12 * 60 * 60 * 1000
LOCAL_PORT = 7000
DEFAULT_PORT = 7001
_LOCK = threading.Lock()
_SESSIONS = {}
_ATTEMPTS = {}
_SERVERS = []
_ERROR = ""


def _config_path():
    return os.path.join(_main.USER_DATA_DIR, CONFIG_NAME)


def _clients_path():
    return os.path.join(_main.USER_DATA_DIR, CLIENTS_NAME)


def _private_ip(ip: str) -> bool:
    parts = (ip or "").split(".")
    if len(parts) != 4 or not all(part.isdigit() for part in parts):
        return False
    a, b = int(parts[0]), int(parts[1])
    return a == 10 or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31)


def network_addresses():
    found = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if _private_ip(ip) and ip not in found:
                found.append(ip)
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        ip = probe.getsockname()[0]
        probe.close()
        if _private_ip(ip) and ip not in found:
            found.insert(0, ip)
    except OSError:
        pass
    return found


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, type(default)) else default
    except FileNotFoundError:
        return default
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _main.atomic_write_json(path, data, ensure_ascii=False, indent=2)


def load_config():
    data = _read_json(_config_path(), {})
    port = data.get("port") if isinstance(data, dict) else None
    if not isinstance(port, int) or not 1 <= port <= 65535 or port == LOCAL_PORT:
        port = DEFAULT_PORT
    return {
        "enabled": bool(data.get("enabled")) if isinstance(data, dict) else False,
        "salt": str(data.get("salt") or "") if isinstance(data, dict) else "",
        "hash": str(data.get("hash") or "") if isinstance(data, dict) else "",
        "port": port,
    }


def _clients():
    items = _read_json(_clients_path(), [])
    result = {}
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and _private_ip(str(item.get("ip") or "")):
                result[item["ip"]] = item
    return result


def _save_clients(clients):
    _write_json(_clients_path(), list(clients.values()))


def _hash_password(password: str, salt: str) -> str:
    return scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=2**14, r=8, p=1, dklen=32).hex()


def status():
    config = load_config()
    addresses = []
    if config["enabled"] and not _ERROR:
        addresses = [f"http://{ip}:{config['port']}/" for ip in network_addresses()]
    return {
        "enabled": config["enabled"],
        "available": bool(config["enabled"] and addresses and not _ERROR),
        "hasPassword": bool(config["hash"]),
        "sharingPort": config["port"],
        "addresses": addresses,
        "error": _ERROR,
    }


def client_status():
    now = int(time.time() * 1000)
    clients = _clients()
    rows = []
    for item in clients.values():
        ip = item.get("ip")
        active = [session for session in _SESSIONS.values() if session.get("ip") == ip and session.get("expires", 0) > now]
        online = (not item.get("blocked")) and now - int(item.get("lastSeen") or 0) < 5 * 60 * 1000
        rows.append({
            "ip": ip,
            "firstSeen": item.get("firstSeen") or 0,
            "lastSeen": item.get("lastSeen") or 0,
            "blocked": bool(item.get("blocked")),
            "usernames": item.get("usernames") or [],
            "onlineUsers": sorted({session.get("username") for session in active if session.get("username")}),
            "online": online,
        })
    rows.sort(key=lambda row: row["lastSeen"], reverse=True)
    return {"total": len(rows), "online": sum(1 for row in rows if row["online"]), "clients": rows}


def configure(payload: dict):
    global _ERROR
    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        raise HTTPException(status_code=400, detail="共享开关格式无效")
    config = load_config()
    previous = load_config()
    port = payload.get("sharingPort", config["port"])
    if isinstance(port, float) and port.is_integer():
        port = int(port)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise HTTPException(status_code=400, detail="分享端口须为 1–65535 的整数")
    if port == LOCAL_PORT:
        raise HTTPException(status_code=400, detail="分享端口不能与本机入口端口相同")
    changed = payload["enabled"] != previous["enabled"] or port != previous["port"]
    config["enabled"] = payload["enabled"]
    config["port"] = port
    _write_json(_config_path(), config)
    if changed:
        _SESSIONS.clear()
        _ATTEMPTS.clear()
    _ERROR = ""
    sync_listeners()
    return status()


def set_client_blocked(ip: str, blocked: bool):
    clients = _clients()
    client = clients.get(ip)
    if not client or not isinstance(blocked, bool):
        raise HTTPException(status_code=400, detail="设备或禁用状态无效")
    client["blocked"] = blocked
    _save_clients(clients)
    if blocked:
        stale = [key for key, session in _SESSIONS.items() if session.get("ip") == ip]
        for key in stale:
            _SESSIONS.pop(key, None)
    return client_status()


def _stop_listeners():
    global _SERVERS
    current = _SERVERS
    _SERVERS = []
    for server in current:
        server.should_exit = True


def sync_listeners():
    global _ERROR
    _stop_listeners()
    config = load_config()
    if not config["enabled"]:
        _ERROR = ""
        return
    addresses = network_addresses()
    if not addresses:
        _ERROR = "未检测到可用局域网地址"
        return
    import uvicorn
    started = []
    for ip in addresses:
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((ip, config["port"]))
            probe.close()
        except OSError:
            _ERROR = f"分享端口 {config['port']} 被占用或不可用，局域网分享已暂停，本机仍可使用。"
            _stop_listeners()
            return
        config_uv = uvicorn.Config(
            _main.app,
            host=ip,
            port=config["port"],
            log_level="warning",
            access_log=False,
            lifespan="off",
        )
        server = uvicorn.Server(config_uv)
        server.install_signal_handlers = False
        thread = threading.Thread(target=server.run, daemon=True, name=f"artcanvas-lan-{ip}")
        thread.start()
        started.append(server)
    _SERVERS[:] = started
    _ERROR = ""


def _is_local(request) -> bool:
    ip = (request.client.host if request.client else "") or ""
    if ip in {"127.0.0.1", "::1", "testclient"}:
        server = request.scope.get("server") or ("", 0)
        port = server[1] if len(server) > 1 else 0
        return port in {0, LOCAL_PORT} or ip == "testclient"
    return False


def _cookie_token(request) -> str:
    raw = request.headers.get("cookie") or ""
    for part in raw.split(";"):
        part = part.strip()
        if part.startswith(COOKIE + "="):
            return part.split("=", 1)[1]
    return ""


_LOGIN_PAGE = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtCanvas · 局域网访问</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10141c;color:#e8edf5;font:15px "Segoe UI","Microsoft YaHei",sans-serif}main{width:min(360px,86vw);padding:32px;border:1px solid #2a3344;border-radius:18px;background:#171d28}h1{font-size:24px;margin:0 0 8px}p{color:#9aa6b8;line-height:1.7}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;border:1px solid #394456;font:inherit}input{background:#10141c;color:#eee;margin:8px 0 14px}button{background:#d7f56a;color:#1b2410;cursor:pointer;font-weight:700}.error{color:#edaa89}</style>
<main><h1>ArtCanvas</h1><p>填写你的名字和主机设置的共享密码。进入后仍使用各自的登录账号，接口密钥留在主机上。</p>__ERROR__<form method="post" action="/api/lan/login"><label>你的名字</label><input name="username" required maxlength="24" autocomplete="nickname" value="__USERNAME__"><label>访问密码</label><input name="password" type="password" required maxlength="128" autocomplete="current-password"><button type="submit">进入</button></form></main></html>"""


def _login_html(error="", username=""):
    safe_user = (username or "").replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    err = f'<p class="error">{error}</p>' if error else ""
    page = _LOGIN_PAGE.replace("__ERROR__", err).replace("__USERNAME__", safe_user)
    return HTMLResponse(page, status_code=401 if error else 200)


def _host_only(path: str, method: str) -> bool:
    if path.startswith("/api/lan/settings") or path.startswith("/api/lan/clients"):
        return True
    if path.startswith("/api/auth/admin") or path.startswith("/api/restart"):
        return True
    if path.startswith("/api/translate/config"):
        return True
    if path.startswith("/api/providers") and method not in {"GET", "HEAD"}:
        return True
    return False


async def guard(request, call_next):
    if _is_local(request):
        return await call_next(request)
    ip = (request.client.host if request.client else "") or ""
    ip = ip.removeprefix("::ffff:")
    config = load_config()
    if not config["enabled"] or not _private_ip(ip) or _ERROR:
        return JSONResponse({"detail": "局域网共享未开启或访问地址不受支持"}, status_code=403)
    path = request.url.path
    if _host_only(path, request.method):
        return JSONResponse({"detail": "局域网访客不能修改主机设置"}, status_code=403)
    if path == '/api/feature-access' and request.method not in {'GET', 'HEAD'}:
        return JSONResponse({"detail": "访客权限只能在主机本地修改"}, status_code=403)
    from feature_access import guest_disabled, required_modules
    required = await required_modules(request)
    if required and required <= guest_disabled():
        return JSONResponse({"detail": "主机未向局域网访客开放此功能"}, status_code=403)
    clients = _clients()
    client = clients.get(ip)
    now = int(time.time() * 1000)
    if client is None:
        client = {"ip": ip, "firstSeen": now, "lastSeen": now, "blocked": False, "usernames": []}
        clients[ip] = client
        _save_clients(clients)
    if client.get("blocked"):
        return JSONResponse({"detail": "此设备已被主机禁用"}, status_code=403)
    client["lastSeen"] = now
    _save_clients(clients)
    handle = _main.LAN_VISITOR.set(True)
    try:
        return await call_next(request)
    finally:
        _main.LAN_VISITOR.reset(handle)


from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/api/lan/settings")
async def get_lan_settings(request: Request):
    if not _is_local(request):
        raise HTTPException(status_code=403, detail="共享设置只能在主机本地修改")
    return status()


@router.post("/api/lan/settings")
async def save_lan_settings(request: Request):
    if not _is_local(request):
        raise HTTPException(status_code=403, detail="共享设置只能在主机本地修改")
    payload = await request.json()
    return configure(payload)


@router.get("/api/lan/clients")
async def get_lan_clients(request: Request):
    if not _is_local(request):
        raise HTTPException(status_code=403, detail="共享设置只能在主机本地修改")
    return client_status()


@router.post("/api/lan/clients")
async def save_lan_client(request: Request):
    if not _is_local(request):
        raise HTTPException(status_code=403, detail="共享设置只能在主机本地修改")
    payload = await request.json()
    return set_client_blocked(str(payload.get("ip") or ""), payload.get("blocked"))


def _session_ok(request, ip: str) -> bool:
    token = _cookie_token(request)
    session = _SESSIONS.get(token)
    now = int(time.time() * 1000)
    return bool(session and session.get("ip") == ip and session.get("expires", 0) > now)


@router.get("/api/lan/gate")
async def lan_gate(request: Request):
    return {"required": False}


@router.post("/api/lan/login")
async def lan_login_retired(request: Request):
    return JSONResponse({"detail": "不需要访问密码，请刷新页面后直接注册或登录"}, status_code=400)
