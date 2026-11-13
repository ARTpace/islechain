"""CLI 工具统一管理：注册表驱动的「识别 / 安装 / 验证」。

前缀: /api/cli
新增 CLI 只需在 CLI/cli_registry.json 追加一条，无需改前后端代码。

- GET  /api/cli/list            识别：返回注册表 + 每个 CLI 的可执行文件、版本、登录态、检查项
- POST /api/cli/verify          验证：重新探测单个或全部 CLI
- POST /api/cli/install         安装：后台执行注册表中的安装脚本，返回 task_id
- GET  /api/cli/task?id=&after= 轮询安装日志增量；任务结束会自动重新验证
- POST /api/cli/terminal        打开交互式终端脚本（用于需要人工参与的登录）
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import urllib.request
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import main as _main

router = APIRouter(prefix="/api/cli", tags=["cli-manager"])

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = ROOT / "CLI" / "cli_registry.json"
CAPS_PATH = ROOT / "CLI" / "cli_capabilities.json"
LOG_DIR = ROOT / "logs"
RUN_DIR = Path(_main.INPUT_DIR) / "cli-runs"
TASK_TIMEOUT = 900
PROBE_TIMEOUT = 6
VERSION_TIMEOUT = 4
AUTH_TIMEOUT = 8
JIMENG_CREDIT_TIMEOUT = 10
MAX_KEEP_TASKS = 20
CACHE_PATH = LOG_DIR / "cli_status_cache.json"
STATE_PATH = LOG_DIR / "cli_state.json"

# task_id -> {id, cli, status, lines[], started_at, finished_at, exit_code, verify, ...}
_TASKS: dict[str, dict[str, Any]] = {}
_CACHE: dict[str, Any] | None = None
_STATE: dict | None = None


class CliRequest(BaseModel):
    id: str
    action: str = "install"


class VerifyRequest(BaseModel):
    id: str = "*"


class AddProviderRequest(BaseModel):
    id: str


class ToggleRequest(BaseModel):
    id: str
    enabled: bool


class RunRequest(BaseModel):
    cli: str
    capability: str
    input: dict[str, Any] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------- 注册表

def _load_registry() -> dict:
    try:
        with REGISTRY_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"CLI 注册表不存在: {REGISTRY_PATH}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"CLI 注册表 JSON 格式错误: {exc}") from exc
    if not isinstance(data.get("clis"), list):
        raise HTTPException(status_code=500, detail="CLI 注册表缺少 clis 列表")
    return data


def _find(data: dict, cli_id: str) -> dict | None:
    return next((s for s in data["clis"] if s.get("id") == cli_id), None)


def _safe_script(rel: str) -> Path:
    """脚本路径必须落在项目目录内，防止注册表被改坏后越界执行。"""
    path = (ROOT / rel).resolve()
    if ROOT != path and ROOT not in path.parents:
        raise HTTPException(status_code=400, detail="脚本路径超出项目目录")
    if not path.is_file():
        raise HTTPException(status_code=400, detail=f"脚本不存在: {rel}")
    return path


# ---------------------------------------------------------------- 探测

def _decode(data: bytes) -> str:
    data = data or b""
    if b"\x00" in data[:200]:  # WSL / PowerShell 偶尔输出 UTF-16
        try:
            return data.decode("utf-16le", errors="replace")
        except Exception:
            pass
    for enc in ("utf-8-sig", "gbk", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


async def _exec(args: list[str], timeout: int = PROBE_TIMEOUT) -> tuple[int, str]:
    kwargs: dict[str, Any] = dict(
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = await asyncio.create_subprocess_exec(*args, **kwargs)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, _decode(out).strip()
    except asyncio.TimeoutError:
        return -1, f"命令超时（{timeout}s）"
    except Exception as exc:  # noqa: BLE001 - 探测失败要回显原因，不能中断整页
        return -1, str(exc)


def _json_path(obj: Any, dotted: str) -> Any:
    """从 JSON envelope 里取点路径值，如 data.version / data.signed_in。"""
    if dotted in ("", "$", "."):
        return obj
    for key in dotted.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def _envelope(text: str) -> dict | None:
    """comfy-cli 非 TTY 输出 JSON envelope；解析失败返回 None，让探测回落到首行文本。"""
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


_CLI_CMD_RE = re.compile(r"[A-Za-z0-9_.-]+")


def _json_value(text: str) -> Any:
    """Parse CLI output; accepts dict or list (tripo models/usage return arrays)."""
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def _cli_prefix(spec: dict) -> list[str]:
    """Build the CLI argv prefix.

    Project-local executables (comfy venv) run directly. npm global CLIs on
    Windows ship a .cmd shim; running it through cmd.exe breaks UTF-8 prompts
    and opens command injection, so resolve dist/cli.js and run it with node
    instead (argv list only, shell=False).
    """
    rel = spec.get("executable") or spec.get("local_executable")
    if rel:
        path = (ROOT / rel).resolve()
        if ROOT != path and ROOT not in path.parents:
            raise HTTPException(status_code=400, detail="CLI executable outside project")
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"CLI executable not found: {rel}")
        return [str(path)]
    name = spec.get("command") or ""
    if not _CLI_CMD_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail=f"invalid CLI command name: {name}")
    shim = shutil.which(name)
    if not shim:
        raise HTTPException(status_code=404, detail=f"{name} not found in PATH")
    pkg, entry = spec.get("npm_package"), spec.get("npm_entry")
    if pkg and entry:
        js = (Path(shim).parent / "node_modules" / pkg / entry).resolve()
        node = shutil.which("node")
        if js.is_file() and node:
            return [node, str(js)]
    return [shim]


def _first_command(spec: dict) -> tuple[str, list[str] | None]:
    try:
        prefix = _cli_prefix(spec)
        return (spec.get("command") or Path(prefix[0]).name), prefix
    except HTTPException:
        pass
    for name in spec.get("commands") or [spec.get("command") or ""]:
        if not name or not _CLI_CMD_RE.fullmatch(name):
            continue
        found = shutil.which(name)
        if found:
            return name, [found]
    return (spec.get("command") or ""), None


def _head(text: str, limit: int = 200) -> str:
    return (text.splitlines() or [""])[0].strip()[:limit]


async def _detect_local(spec: dict) -> dict:
    name, prefix = _first_command(spec)
    checks: list[dict] = []
    result: dict[str, Any] = {
        "installed": bool(prefix), "path": prefix[0] if prefix else None, "version": None,
        "version_ok": None, "auth_ok": None, "message": "", "checks": checks,
        "probe_error": False,
    }
    if not prefix:
        result["message"] = f"未在 PATH 中找到 {name}"
        checks.append({"name": "可执行文件", "ok": False, "detail": f"未找到 {name}"})
        checks.append({"name": "版本探测", "ok": False, "detail": "跳过（未安装）"})
        checks.append({"name": "登录状态", "ok": False, "detail": "跳过（未安装）"})
        return result

    checks.append({"name": "可执行文件", "ok": True, "detail": prefix[0]})
    auth_args = spec.get("auth_args")
    ver_task = _exec([*prefix, *(spec.get("version_args") or ["--version"])], VERSION_TIMEOUT)
    auth_task = _exec([*prefix, *auth_args], AUTH_TIMEOUT) if auth_args else None
    if auth_task:
        (rc, out), (rc2, out2) = await asyncio.gather(ver_task, auth_task)
    else:
        rc, out = await ver_task
        rc2, out2 = 0, ""

    result["probe_error"] = (rc == -1) or (bool(auth_task) and rc2 == -1)
    vpath = spec.get("version_json_path")
    version = _json_path(_envelope(out) or {}, vpath) if vpath else None
    result["version"] = str(version) if version is not None else (_head(out, 60) if rc == 0 and out else None)
    result["version_ok"] = rc == 0
    checks.append({"name": "版本探测", "ok": rc == 0, "detail": result["version"] or _head(out) or "无输出"})
    if auth_task:
        apath = spec.get("auth_json_path")
        flag = _json_path(_envelope(out2) or {}, apath) if apath else None
        result["auth_ok"] = bool(flag) if flag is not None else (rc2 == 0)
        detail = ("已登录" if result["auth_ok"] else "未登录") if apath else (_head(out2) or "无输出")
        checks.append({"name": "登录状态", "ok": result["auth_ok"], "detail": detail})
    else:
        checks.append({"name": "登录状态", "ok": True, "detail": "未配置登录检测，跳过"})
    return result


async def _jimeng_version(exe: str) -> tuple[str | None, bool | None]:
    """只试 --version / -V，各 4s；不复用 jimeng_cli_version 的 3x15s 串行探测。"""
    for flag in ("--version", "-V"):
        try:
            rc, out = await _exec(list(_main.jimeng_command([flag], exe)), VERSION_TIMEOUT)
        except Exception:
            continue
        parsed = _main.jimeng_parse_version(out)
        if parsed:
            return ".".join(str(p) for p in parsed), parsed >= _main.JIMENG_MIN_CLI_VERSION
    return None, None


async def _detect_jimeng(spec: dict) -> dict:
    """即梦走 main.py 的 WSL / JIMENG_BIN 适配，避免重复实现。"""
    checks: list[dict] = []
    result: dict[str, Any] = {
        "installed": False, "path": None, "version": None,
        "version_ok": None, "auth_ok": None, "message": "", "checks": checks,
        "probe_error": False,
    }
    exe = _main.jimeng_cli_executable()
    if not exe:
        result["message"] = "未找到 dreamina CLI（可设置 JIMENG_BIN 或开启 JIMENG_USE_WSL）"
        checks.append({"name": "可执行文件", "ok": False, "detail": result["message"]})
        return result

    result["installed"] = True
    result["path"] = exe
    checks.append({"name": "可执行文件", "ok": True, "detail": str(exe)})

    ver_res, credit_res = await asyncio.gather(
        _jimeng_version(exe),
        _main.run_jimeng_cli(["user_credit"], timeout=JIMENG_CREDIT_TIMEOUT),
        return_exceptions=True,
    )
    result["probe_error"] = isinstance(ver_res, BaseException)
    if isinstance(ver_res, BaseException):
        ver_res = (None, None)
    version_str, version_ok = ver_res
    min_str = ".".join(str(p) for p in _main.JIMENG_MIN_CLI_VERSION)
    result["version"] = version_str
    result["version_ok"] = version_ok
    checks.append({"name": "版本探测", "ok": version_ok is not False,
                   "detail": f"{version_str or '未知'}（最低 {min_str}）"})

    if isinstance(credit_res, BaseException):
        if "超时" in str(getattr(credit_res, "detail", "")):
            result["probe_error"] = True
        result["auth_ok"] = False
        result["message"] = str(getattr(credit_res, "detail", credit_res))[:300]
        checks.append({"name": "登录状态", "ok": False, "detail": result["message"]})
    else:
        result["auth_ok"] = True
        checks.append({"name": "登录状态", "ok": True, "detail": "user_credit 调用成功"})
    return result


async def _detect(spec: dict) -> dict:
    if spec.get("detector") == "jimeng":
        return await _detect_jimeng(spec)
    return await _detect_local(spec)


def _state(spec: dict, status: dict) -> str:
    if not status.get("installed"):
        return "missing"
    if status.get("version_ok") is False:
        return "outdated"
    if status.get("auth_ok") is False:
        return "unauthorized"
    return "ready"


# ---------------------------------------------------------------- 启用状态

def _load_state() -> dict:
    global _STATE
    if isinstance(_STATE, dict):
        return _STATE
    try:
        with STATE_PATH.open("r", encoding="utf-8") as fh:
            obj = json.load(fh)
        if isinstance(obj, dict):
            _STATE = obj
            return obj
    except Exception:
        pass
    _STATE = {"disabled": []}
    return _STATE


def _disabled_ids() -> set[str]:
    return {str(x) for x in (_load_state().get("disabled") or [])}


def _save_state(disabled: set[str]) -> None:
    global _STATE
    _STATE = {"disabled": sorted(disabled)}
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(_STATE, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_PATH)
    except Exception:
        pass


def _require_enabled(cli_id: str) -> None:
    if cli_id in _disabled_ids():
        raise HTTPException(status_code=403, detail=f"CLI「{cli_id}」已停用，请先在 CLI 工具页启用")


# ---------------------------------------------------------------- 识别缓存

def _registry_signature(data: dict) -> list:
    return [[s.get("id"), s.get("command"), s.get("detector")] for s in data.get("clis", [])]


def _cache_load(data: dict) -> dict | None:
    global _CACHE
    sig = _registry_signature(data)
    if isinstance(_CACHE, dict) and _CACHE.get("signature") == sig:
        return _sync_enabled(_CACHE)
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as fh:
            obj = json.load(fh)
        if isinstance(obj, dict) and obj.get("signature") == sig and isinstance(obj.get("clis"), list):
            _CACHE = obj
            return _sync_enabled(obj)
    except Exception:
        pass
    return None


def _cache_save(payload: dict) -> None:
    global _CACHE
    _CACHE = payload
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        os.replace(tmp, CACHE_PATH)
    except Exception:
        pass


def _cache_usable(cached) -> bool:
    """只有一次完整且无异常的识别结果才长期记住。"""
    return (isinstance(cached, dict)
            and cached.get("complete") is True
            and cached.get("has_error") is not True
            and isinstance(cached.get("clis"), list)
            and len(cached["clis"]) > 0)


def _probe_error(status) -> bool:
    """探测命令超时 / 异常才算出错；未安装、未登录、版本过低是正常结果，照常记住。"""
    if isinstance(status, BaseException) or not isinstance(status, dict):
        return True
    if status.get("probe_error"):
        return True
    if status.get("message") and not (status.get("checks") or []):
        return True
    return False


def _cache_mark_running(data: dict) -> None:
    """识别开始前标记未完成；服务中途被杀，下次打开会自动重新识别。"""
    payload = dict(_CACHE) if isinstance(_CACHE, dict) else {}
    payload.update({
        "platform": sys.platform,
        "registry": str(REGISTRY_PATH.relative_to(ROOT)),
        "cache_ts": time.time(),
        "signature": _registry_signature(data),
        "complete": False,
    })
    _cache_save(payload)


def _sync_enabled(payload: dict) -> dict:
    """启停变化只改标记，不触发重新识别（识别结果继续长期记住）。"""
    if not isinstance(payload, dict):
        return payload
    disabled = _disabled_ids()
    for item in payload.get("clis") or []:
        if isinstance(item, dict):
            item["enabled"] = item.get("id") not in disabled
    sig = sorted(disabled)
    if payload.get("disabled_sig") != sig:
        payload["disabled_sig"] = sig
        _cache_save(payload)
    return payload


def _cache_patch(clis: list[dict], has_error: bool | None = None) -> None:
    """验证 / 安装 / 添加通道后回写局部结果，避免紧接着又全量重探。"""
    cached = _CACHE
    if not isinstance(cached, dict) or not cached.get("clis"):
        return
    lookup = {c.get("id"): c for c in cached["clis"] if isinstance(c, dict)}
    for item in clis:
        target = lookup.get(item.get("id"))
        if not target:
            continue
        for key, value in item.items():
            if key != "id":
                target[key] = value
    cached["cache_ts"] = time.time()
    if has_error is not None:
        cached["has_error"] = has_error
    _cache_save(cached)


async def _detect_all(data: dict) -> dict:
    """全量探测；停用的 CLI 跳过探测并复用上次结果，只有跑完且无异常才写 complete=True。"""
    disabled = _disabled_ids()
    prev: dict[str, Any] = {}
    if isinstance(_CACHE, dict):
        prev = {c.get("id"): c.get("status") for c in (_CACHE.get("clis") or []) if isinstance(c, dict)}
    _cache_mark_running(data)
    specs = data["clis"]

    async def _skip_or_detect(spec: dict):
        if spec["id"] in disabled:
            return prev.get(spec["id"]) or {
                "installed": True, "path": None, "version": None,
                "version_ok": None, "auth_ok": None, "message": "",
                "checks": [{"name": "启用状态", "ok": True, "detail": "已停用，跳过识别"}],
                "probe_error": False,
            }
        return await _detect(spec)

    statuses = await asyncio.gather(*[_skip_or_detect(s) for s in specs], return_exceptions=True)
    protocols = _provider_protocols()
    out, failed = [], False
    for spec, status in zip(specs, statuses):
        if isinstance(status, BaseException):
            failed = True
            status = {"installed": False, "message": str(status), "checks": [],
                      "path": None, "version": None, "auth_ok": None, "version_ok": None}
        elif _probe_error(status):
            failed = True
        item = dict(spec)
        item["status"] = status
        item["state"] = _state(spec, status)
        item["enabled"] = spec["id"] not in disabled
        item["can_install"] = bool((spec.get("install") or {}).get(sys.platform))
        login = spec.get("login") or {}
        item["can_terminal"] = bool((login.get("terminal") or {}).get(sys.platform))
        pcfg = spec.get("provider") or {}
        item["provider_added"] = bool(pcfg.get("protocol")) and str(pcfg["protocol"]).lower() in protocols
        out.append(item)
    payload = {
        "platform": sys.platform,
        "registry": str(REGISTRY_PATH.relative_to(ROOT)),
        "clis": out,
        "cache_ts": time.time(),
        "signature": _registry_signature(data),
        "disabled_sig": sorted(disabled),
        "complete": True,
        "has_error": failed,
    }
    _cache_save(payload)
    return payload

# ---------------------------------------------------------------- 接口
# ---------------------------------------------------------------- 接口

@router.get("/list")
async def cli_list(refresh: bool = False):
    """识别：成功结果长期记住，下次打开直接显示；仅在没识别过 / 中断 / 出错 / 主动刷新时重探。"""
    data = _load_registry()
    cached = _cache_load(data)
    if refresh or not _cache_usable(cached):
        return {**await _detect_all(data), "cached": False}
    return {**cached, "cached": True}


@router.post("/toggle")
async def cli_toggle(req: ToggleRequest):
    """启用 / 停用某个 CLI；状态持久化，停用后不参与识别、也不允许执行。"""
    if _main.LAN_VISITOR.get():
        raise HTTPException(status_code=403, detail="仅管理员可启停 CLI")
    data = _load_registry()
    if not _find(data, req.id):
        raise HTTPException(status_code=404, detail=f"注册表中没有 CLI: {req.id}")
    disabled = _disabled_ids()
    if req.enabled:
        disabled.discard(req.id)
    else:
        disabled.add(req.id)
    _save_state(disabled)
    _cache_load(data)  # 同步缓存里的 enabled 标记，不重新识别
    return {"id": req.id, "enabled": req.enabled,
            "cli": {"id": req.id, "enabled": req.enabled}}


@router.post("/verify")
async def cli_verify(req: VerifyRequest):
    """验证：重新探测。id=* 表示全部。"""
    data = _load_registry()
    if req.id == "*":
        targets = [s for s in data["clis"] if s["id"] not in _disabled_ids()]
    else:
        _require_enabled(req.id)
        targets = [s for s in data["clis"] if s["id"] == req.id]
    if not targets:
        raise HTTPException(status_code=404, detail="没有可验证的已启用 CLI")
    statuses = await asyncio.gather(*[_detect(s) for s in targets], return_exceptions=True)
    clis, failed = [], False
    for spec, status in zip(targets, statuses):
        if isinstance(status, BaseException):
            failed = True
            status = {"installed": False, "message": str(status), "checks": [],
                      "path": None, "version": None, "auth_ok": None, "version_ok": None}
        elif _probe_error(status):
            failed = True
        clis.append({"id": spec["id"], "status": status, "state": _state(spec, status)})
    flag = failed if req.id == "*" else (True if failed else None)
    _cache_patch(clis, has_error=flag)
    return {"clis": clis}


def _build_command(cfg: dict, script: Path) -> list[str]:
    if cfg.get("shell") == "powershell":
        exe = shutil.which("powershell.exe") or shutil.which("pwsh") or "powershell.exe"
        quoted = str(script).replace("'", "''")
        inner = f"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '{quoted}'"
        for arg in cfg.get("args") or []:
            inner += f" {arg}"
        return [exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-NonInteractive", "-Command", inner]
    return ["/bin/bash", str(script), *(cfg.get("args") or [])]


def _gc_tasks() -> None:
    if len(_TASKS) > MAX_KEEP_TASKS:
        for key in sorted(_TASKS, key=lambda k: _TASKS[k]["started_at"])[:-MAX_KEEP_TASKS]:
            _TASKS.pop(key, None)


async def _run_task(task: dict, spec: dict, cfg: dict, script: Path) -> None:
    lines: list[str] = task["lines"]
    try:
        cmd = _build_command(cfg, script)
        lines.append(f"$ {cmd[0]} -NoProfile -NonInteractive ... {script.name}")
        lines.append(f"脚本: {script}")
        kwargs: dict[str, Any] = dict(
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,  # 安装脚本末尾的 Read-Host 会立刻遇到 EOF，不会卡住
            cwd=str(ROOT),
        )
        if sys.platform == "win32":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        kwargs["env"] = env
        proc = await asyncio.create_subprocess_exec(*cmd, **kwargs)
        task["proc"] = proc

        async def pump() -> None:
            assert proc.stdout is not None
            while True:
                chunk = await proc.stdout.readline()
                if not chunk:
                    break
                lines.append(_decode(chunk).rstrip("\r\n"))

        await asyncio.wait_for(pump(), timeout=TASK_TIMEOUT)
        await proc.wait()
        task["exit_code"] = proc.returncode
        task["status"] = "done" if proc.returncode == 0 else "failed"
        lines.append(f"[进程结束] exit={proc.returncode}")
    except asyncio.TimeoutError:
        task["status"] = "timeout"
        proc = task.get("proc")
        if proc and getattr(proc, "returncode", None) is None:
            try:
                proc.kill()
            except Exception:
                pass
        lines.append(f"[超时] 超过 {TASK_TIMEOUT}s，已终止进程")
    except Exception as exc:  # noqa: BLE001
        task["status"] = "failed"
        task["error"] = str(exc)
        lines.append(f"[异常] {exc}")
    finally:
        task["finished_at"] = time.time()
        lines.append("[验证] 正在重新识别 CLI ...")
        try:
            status = await _detect(spec)
            task["verify"] = {"status": status, "state": _state(spec, status)}
            _cache_patch([{"id": spec["id"], "status": status, "state": _state(spec, status)}],
                         has_error=_probe_error(status))
            lines.append(f"[验证] state={task['verify']['state']}，installed={status.get('installed')}，"
                         f"auth_ok={status.get('auth_ok')}")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"[验证] 失败: {exc}")
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            log_file = LOG_DIR / f"cli-{spec['id']}-{task['id']}.log"
            log_file.write_text("\n".join(lines), encoding="utf-8")
            task["log_file"] = str(log_file.relative_to(ROOT))
        except Exception:
            pass
        task["proc"] = None


@router.post("/install")
async def cli_install(req: CliRequest):
    """安装：后台执行注册表中的脚本，返回 task_id 供轮询日志。"""
    data = _load_registry()
    spec = _find(data, req.id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"注册表中没有 CLI: {req.id}")
    _require_enabled(req.id)
    if req.action != "install":
        raise HTTPException(status_code=400, detail="仅支持 action=install；登录请使用对应 CLI 的登录入口")
    cfg = (spec.get("install") or {}).get(sys.platform)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"{sys.platform} 平台暂无 {spec['name']} 的安装脚本")
    script = _safe_script(cfg["script"])

    for existing in _TASKS.values():
        if existing["cli"] == req.id and existing["status"] == "running":
            return {"task_id": existing["id"], "reused": True}

    _gc_tasks()
    task_id = uuid.uuid4().hex[:12]
    task = {
        "id": task_id,
        "cli": req.id,
        "status": "running",
        "lines": [],
        "started_at": time.time(),
        "finished_at": None,
        "exit_code": None,
        "verify": None,
        "log_file": None,
        "proc": None,
    }
    _TASKS[task_id] = task
    asyncio.create_task(_run_task(task, spec, cfg, script))
    return {"task_id": task_id, "reused": False}


@router.get("/task")
async def cli_task(id: str, after: int = 0):
    """增量轮询安装日志；任务完成时附带自动验证结果。"""
    task = _TASKS.get(id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已被清理")
    lines = task["lines"]
    return {
        "id": id,
        "cli": task["cli"],
        "status": task["status"],
        "lines": lines[max(0, after):],
        "next": len(lines),
        "exit_code": task.get("exit_code"),
        "error": task.get("error"),
        "verify": task.get("verify"),
        "log_file": task.get("log_file"),
        "elapsed": round((task.get("finished_at") or time.time()) - task["started_at"], 1),
    }


@router.post("/terminal")
async def cli_terminal(req: CliRequest):
    """打开交互式终端脚本（登录等需要人工参与的操作）。"""
    data = _load_registry()
    spec = _find(data, req.id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"注册表中没有 CLI: {req.id}")
    _require_enabled(req.id)
    rel = ((spec.get("login") or {}).get("terminal") or {}).get(sys.platform)
    if not rel:
        raise HTTPException(status_code=400, detail=f"{sys.platform} 平台暂无 {spec['name']} 的终端脚本")
    path = _safe_script(rel)
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"打开终端失败: {exc}") from exc
    return {"success": True, "path": str(path.relative_to(ROOT))}


# ---------------------------------------------------------------- 生图通道

def _provider_protocols() -> set[str]:
    """已注册为出图通道的 CLI 协议集合（直接读原始列表，避免脱敏/字段裁剪）。"""
    try:
        return {str(p.get("protocol") or "").lower() for p in _main.load_api_providers()}
    except Exception:
        return set()


@router.post("/add-provider")
async def cli_add_provider(req: AddProviderRequest):
    """把 CLI 注册为一条生图通道，等价于旧 API 设置页的 addCliProvider 快捷入口。"""
    if _main.LAN_VISITOR.get():
        raise HTTPException(status_code=403, detail="仅管理员可添加生图通道")
    spec = _find(_load_registry(), req.id)
    if not spec:
        raise HTTPException(status_code=404, detail=f"注册表中没有 CLI: {req.id}")
    _require_enabled(req.id)
    cfg = spec.get("provider") or {}
    protocol = str(cfg.get("protocol") or "").strip().lower()
    if not protocol:
        raise HTTPException(status_code=400, detail="该 CLI 未配置生图通道，无需添加")

    providers = _main.load_api_providers()
    hit = next((p for p in providers
                if str(p.get("protocol") or "").lower() == protocol), None)
    added_cli = {"id": spec["id"], "provider_added": True}
    if hit:
        _cache_patch([{"id": spec["id"], "provider_added": True}])
        return {"added": False, "provider_id": hit.get("id"),
                "message": f"已存在生图通道「{hit.get('name') or protocol}」，可在 API 设置页管理。",
                "cli": added_cli}

    ids = {str(p.get("id") or "") for p in providers}
    new_id, idx = protocol, 2
    while new_id in ids:
        new_id, idx = f"{protocol}-{idx}", idx + 1
    providers.append(_main.normalize_provider({
        "id": new_id,
        "name": cfg.get("name") or spec.get("name") or new_id,
        "base_url": "",
        "protocol": protocol,
        "image_models": cfg.get("image_models") or [],
        "chat_models": [], "video_models": [], "model_labels": {},
        "enabled": True, "primary": False,
    }))
    _main.save_api_providers(providers)
    _cache_patch([{"id": spec["id"], "provider_added": True}])
    return {"added": True, "provider_id": new_id,
            "message": f"已添加生图通道「{cfg.get('name') or new_id}」，可在 API 设置页继续配置模型。",
            "cli": added_cli}


# ---------------------------------------------------------------- 能力调用（供画布节点使用）

_ALIAS_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_PARAM_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
_RESERVED_PARAMS = {"where", "yes", "json", "json_stream", "download", "async",
                    "emit_workflow", "workspace", "help", "version", "out",
                    "workflow", "workflow_file", "host", "port", "timeout", "prompt",
                    "set", "notify", "wait", "url", "filename", "relative_path",
                    "background", "deps", "skip_prompt", "skip-prompt"}
_ARTIFACT_RE = re.compile(r"^[a-f0-9]{32}\.[a-z0-9]{1,8}$")
_MEDIA_TYPES = {"json": "application/json", "png": "image/png", "jpg": "image/jpeg",
                "jpeg": "image/jpeg", "webp": "image/webp", "mp4": "video/mp4",
                "glb": "model/gltf-binary", "gltf": "model/gltf+json",
                "fbx": "application/octet-stream", "obj": "text/plain",
                "usdz": "model/vnd.usdz+zip", "stl": "model/stl",
                "ply": "application/octet-stream", "zip": "application/zip"}
_ASSET_MODEL_EXTS = {"glb", "gltf", "fbx", "obj", "usdz", "stl", "ply", "zip"}
_ASSET_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "mp4"}
_ASSET_MAX_BYTES = 200 * 1024 * 1024


def _collect_assets(src: Path) -> tuple[list[dict], list[dict]]:
    """Scan a CLI output dir, copy model/preview files into RUN_DIR, return URLs.
    Deliberately independent of the CLI JSON envelope shape.
    """
    models: list[dict] = []
    images: list[dict] = []
    if not src.is_dir():
        return models, images
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower().lstrip(".")
        if ext not in _MEDIA_TYPES or ext == "json":
            continue
        try:
            size = path.stat().st_size
            if size > _ASSET_MAX_BYTES or size == 0:
                continue
            dest = RUN_DIR / f"{uuid.uuid4().hex}.{ext}"
            shutil.copy2(path, dest)
        except OSError:
            continue
        item = {"url": f"/api/cli/artifact?name={dest.name}", "filename": path.name,
                 "size": size, "ext": ext}
        (models if ext in _ASSET_MODEL_EXTS else images).append(item)
    return models, images


def _load_caps() -> dict:
    try:
        with CAPS_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"CLI 能力卡不存在: {CAPS_PATH}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"CLI 能力卡 JSON 格式错误: {exc}") from exc
    if not isinstance(data.get("clis"), dict):
        raise HTTPException(status_code=500, detail="CLI 能力卡缺少 clis 映射")
    return data


def _arg_value(token: str, values: dict[str, str]) -> str:
    return re.sub(r"\{\{([a-z_]+)\}\}", lambda m: values.get(m.group(1), m.group(0)), token)


def _find_prompt_id(obj: Any) -> str | None:
    """Find prompt_id anywhere in a CLI JSON envelope (comfy --json output)."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in ("prompt_id", "promptId") and isinstance(value, str) and value:
                return value
            found = _find_prompt_id(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_prompt_id(value)
            if found:
                return found
    return None


def _local_comfy_images(payload: Any) -> tuple[list[dict], str]:
    """Resolve images of a finished `comfy --where local run` via ComfyUI /history.

    Independent of the CLI envelope shape: prefer /history/{prompt_id} when the
    envelope exposes one, otherwise take the newest /history entry.
    """
    import httpx
    from urllib.parse import urlencode

    target = getattr(_main, "COMFYUI_ADDRESS", "") or ""
    if not target:
        return [], "未配置本机 ComfyUI 地址"
    prompt_id = _find_prompt_id(payload)
    try:
        with httpx.Client(timeout=15) as client:
            url = f"http://{target}/history" + (f"/{prompt_id}" if prompt_id else "")
            resp = client.get(url)
            history = resp.json() if resp.status_code == 200 else {}
        if not prompt_id and isinstance(history, dict) and history:
            last = list(history)[-1]
            history = {last: history[last]}
    except Exception as exc:
        return [], f"读取 ComfyUI 历史失败: {exc}"
    images: list[dict] = []
    entries = list(history.values()) if isinstance(history, dict) else []
    for item in entries:
        if not isinstance(item, dict):
            continue
        outputs = item.get("outputs") or {}
        if not isinstance(outputs, dict):
            continue
        for node_out in outputs.values():
            if not isinstance(node_out, dict):
                continue
            raw_images = node_out.get("images") or []
            if not isinstance(raw_images, list):
                continue
            for img in raw_images:
                if not isinstance(img, dict) or not img.get("filename"):
                    continue
                params = {"filename": img["filename"],
                          "subfolder": img.get("subfolder") or "",
                          "type": img.get("type") or "output"}
                images.append({"url": "/api/comfyui/view?" + urlencode(params),
                               "filename": img["filename"]})
    return images[:16], ""


@router.get("/capabilities")
async def cli_capabilities():
    """列出可被画布节点调用的能力（含输入声明，节点可据此自动生成图形表单）。"""
    data = _load_caps()
    out = []
    for cli_id, spec in data["clis"].items():
        try:
            prefix = _cli_prefix({**spec, "id": cli_id})
            exe = Path(prefix[0])
            try:
                rel = str(exe.relative_to(ROOT))
            except ValueError:
                rel = str(exe)
            available = True
        except (HTTPException, ValueError):
            available, rel = False, None
        out.append({"id": cli_id, "available": available, "executable": rel,
                    "note": spec.get("note"), "capabilities": spec.get("capabilities") or []})
    return {"clis": out}


@router.post("/run")
async def cli_run(req: RunRequest):
    """按能力卡执行一条 CLI 能力，返回统一 {type,url,path,data} 供画布节点消费。"""
    if _main.LAN_VISITOR.get():
        raise HTTPException(status_code=403, detail="仅管理员可调用 CLI 能力")
    _require_enabled(req.cli)
    caps = _load_caps()
    spec = caps["clis"].get(req.cli)
    if not spec:
        raise HTTPException(status_code=404, detail=f"能力卡中没有 CLI: {req.cli}")
    cap = next((c for c in (spec.get("capabilities") or []) if c.get("id") == req.capability), None)
    if not cap:
        raise HTTPException(status_code=404, detail=f"{req.cli} 没有能力: {req.capability}")
    prefix = _cli_prefix({**spec, "id": req.cli})

    values: dict[str, str] = {}
    for field in cap.get("inputs") or []:
        name = field.get("name")
        value = req.input.get(name)
        if field.get("required") and (value is None or str(value).strip() == ""):
            raise HTTPException(status_code=400, detail=f"缺少必填参数: {field.get('label') or name}")
        if value is None:
            continue
        text = str(value)
        if "\x00" in text or len(text) > 4000:
            raise HTTPException(status_code=400, detail=f"参数 {name} 非法或过长")
        if field.get("type") == "alias" and not _ALIAS_RE.match(text):
            raise HTTPException(status_code=400, detail=f"参数 {name} 只能是模型别名")
        if text.startswith("-"):
            raise HTTPException(status_code=400, detail=f"参数 {name} 不能以 - 开头（防止注入 CLI 选项）")
        values[name] = text

    out_cfg = cap.get("output") or {}
    out_file = None
    assets_dir: Path | None = None
    assets_collected: tuple[list[dict], list[dict]] | None = None
    if out_cfg.get("kind") == "file":
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        out_file = RUN_DIR / f"{uuid.uuid4().hex}.{out_cfg.get('ext') or 'bin'}"
        values["out"] = str(out_file)
    if out_cfg.get("kind") == "assets":
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        assets_dir = RUN_DIR / f"{uuid.uuid4().hex}.assets"
        assets_dir.mkdir()
        values["out"] = str(assets_dir)

    wf_tmp: Path | None = None
    if cap.get("kind") == "workflow":
        wid = str(req.input.get("workflow") or "").strip()
        if not wid:
            raise HTTPException(status_code=400, detail="缺少必填参数: workflow")
        wf_path = _wf_path(wid)
        try:
            wf_obj = json.loads(wf_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"工作流 JSON 无法解析: {exc}") from exc
        wf_fmt = _wf_format(wf_obj)
        if wf_fmt == "unknown":
            raise HTTPException(status_code=400, detail="不是 ComfyUI API/UI 格式工作流")
        wf_prompt = str(req.input.get("prompt") or "").strip()
        if wf_prompt:
            wf_pref = str(_wf_meta(wf_path).get("positive") or "")
            used = _wf_inject_prompt(wf_obj, wf_fmt, wf_prompt, wf_pref)
            if not used:
                raise HTTPException(status_code=400, detail="工作流里没有 CLIPTextEncode 提示词节点")
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        wf_tmp = RUN_DIR / f"{uuid.uuid4().hex}.wf.json"
        wf_tmp.write_text(json.dumps(wf_obj, ensure_ascii=False), encoding="utf-8")
        values["out"] = str(wf_tmp)

    argv = [_arg_value(str(t), values) for t in cap.get("argv") or []]
    if out_cfg.get("kind") == "images":
        target = getattr(_main, "COMFYUI_ADDRESS", "") or ""
        host, _, port = target.rpartition(":")
        if host and port.isdigit():
            argv.extend(["--host", host, "--port", port])
    for key, value in (req.params or {}).items():
        if not _PARAM_RE.match(key) or key in _RESERVED_PARAMS:
            if wf_tmp is not None:
                wf_tmp.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"不允许的参数: {key}")
        if isinstance(value, bool):
            if value:
                argv.append(f"--{key}")
        elif value is not None and str(value).strip() != "":
            if "\x00" in str(value) or len(str(value)) > 4000 or str(value).startswith("-"):
                if wf_tmp is not None:
                    wf_tmp.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"参数 {key} 非法或过长")
            argv.extend([f"--{key}", str(value)])

    kwargs: dict[str, Any] = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 stdin=subprocess.DEVNULL, cwd=str(ROOT))
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    timeout = int(cap.get("timeout") or 60)
    started = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(*prefix, *argv, **kwargs)
        out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail=f"命令超时（{timeout}s）") from exc
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"命令启动失败: {exc}") from exc
    finally:
        if wf_tmp is not None:
            try:
                wf_tmp.unlink()
            except OSError:
                pass
        if assets_dir is not None:
            try:
                assets_collected = await asyncio.to_thread(_collect_assets, assets_dir)
            except Exception:  # noqa: BLE001
                assets_collected = ([], [])
            shutil.rmtree(assets_dir, ignore_errors=True)
    elapsed = int((time.time() - started) * 1000)
    out, err = _decode(out_b), _decode(err_b)
    payload = _json_value(out.strip())
    if payload is None:
        payload = _json_value(err.strip())
    env = payload if isinstance(payload, dict) else {}
    raw = (out or err).strip()
    if env and env.get("ok") is False:
        error = env.get("error") or {}
        detail = error.get("hint") or error.get("message") or str(error) or "CLI 返回失败"
        raise HTTPException(status_code=502, detail=str(detail)[:400])
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=f"命令退出码 {proc.returncode}: {_head(raw, 300)}")
    data = _json_path(payload, out_cfg.get("from") or "data") if payload is not None else None
    if data is None:
        data = raw

    result: dict[str, Any] = {"ok": True, "cli": req.cli, "capability": req.capability,
                              "type": out_cfg.get("content_type") or out_cfg.get("kind") or "text",
                              "data": data, "elapsed_ms": elapsed}
    if out_cfg.get("kind") == "images":
        images, warn = _local_comfy_images(payload)
        result["images"] = images
        if warn:
            result["warning"] = warn
    if assets_collected is not None:
        models, imgs = assets_collected
        result["models"] = models
        result["images"] = imgs
        result["type"] = "assets"
        if models:
            result["url"] = models[0]["url"]
        if not models and not imgs:
            result["warning"] = "未产出模型/预览文件：请确认已登录、积分充足且任务成功"
    if out_file is not None:
        if not out_file.is_file():
            raise HTTPException(status_code=502, detail="CLI 未生成产物文件")
        result["url"] = f"/api/cli/artifact?name={out_file.name}"
        try:
            result["path"] = str(out_file.relative_to(ROOT))
        except ValueError:
            result["path"] = str(out_file)
        if out_file.suffix.lower() == ".json" and out_file.stat().st_size < 1024 * 1024:
            try:
                result["data"] = json.loads(out_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
    return result


@router.get("/artifact")
async def cli_artifact(name: str):
    """读取 /api/cli/run 产出的文件（限定 RUN_DIR，文件名不接受路径分隔符）。"""
    if not _ARTIFACT_RE.match(name or ""):
        raise HTTPException(status_code=400, detail="非法文件名")
    path = (RUN_DIR / name).resolve()
    if RUN_DIR.resolve() != path.parent or not path.is_file():
        raise HTTPException(status_code=404, detail="产物不存在")
    ext = path.suffix.lower().lstrip(".")
    return FileResponse(str(path), media_type=_MEDIA_TYPES.get(ext, "application/octet-stream"))
# ---------------------------------------------------------------- 工作流库（Comfy 本地）

WORKFLOW_DIR = ROOT / "CLI" / "workflows"
_WORKFLOW_ID_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,180}\.json$")
_MODEL_INPUT_KEYS = {
    "ckpt_name", "lora_name", "vae_name", "control_net_name", "unet_name",
    "clip_name", "clip_name1", "clip_name2", "clip_name3", "diffusion_model",
    "style_model_name", "ipadapter_file", "clip_vision", "insightface",
    "upscale_model", "model_name", "gguf_name",
}
_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".gguf")
_wf_cache: dict[str, Any] = {"sig": None, "items": []}


def _comfy_workspace() -> str:
    try:
        spec = _find(_load_registry(), "comfy") or {}
    except Exception:  # noqa: BLE001
        return ""
    return str(spec.get("workspace") or "").strip()


def _wf_path(wf_id: str) -> Path:
    wid = (wf_id or "").replace("\\", "/")
    if ".." in wid or not _WORKFLOW_ID_RE.fullmatch(wid):
        raise HTTPException(status_code=400, detail="非法工作流 id")
    root = WORKFLOW_DIR.resolve()
    path = (root / wid).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="工作流不存在")
    return path


def _wf_format(obj: Any) -> str:
    if isinstance(obj, dict) and isinstance(obj.get("nodes"), list):
        return "ui"
    if isinstance(obj, dict) and any(isinstance(v, dict) and "class_type" in v for v in obj.values()):
        return "api"
    return "unknown"


def _wf_refs(obj: dict, fmt: str) -> tuple[list[str], list[str], list[str]]:
    node_types: set[str] = set()
    models: set[str] = set()
    slots: list[str] = []
    if fmt == "api":
        for key, node in obj.items():
            if not isinstance(node, dict):
                continue
            ct = str(node.get("class_type") or "")
            if ct:
                node_types.add(ct)
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                continue
            for k, v in inputs.items():
                if k not in _MODEL_INPUT_KEYS:
                    continue
                if isinstance(v, str) and v.strip():
                    models.add(v.strip())
                elif isinstance(v, dict):
                    name = v.get("name") or v.get("lora_name") or v.get("ckpt_name")
                    if isinstance(name, str) and name.strip():
                        models.add(name.strip())
            if ct == "CLIPTextEncode" and isinstance(inputs.get("text"), str):
                slots.append(str(key))
    elif fmt == "ui":
        for node in obj.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            ct = str(node.get("type") or "")
            if ct:
                node_types.add(ct)
            vals = node.get("widgets_values")
            if isinstance(vals, list):
                for v in vals:
                    if isinstance(v, str) and v.lower().endswith(_MODEL_EXTS):
                        models.add(v.strip())
                if ct == "CLIPTextEncode" and vals and isinstance(vals[0], str):
                    slots.append(str(node.get("id")))
    order = lambda s: (0, int(s)) if s.isdigit() else (1, s)
    return sorted(node_types), sorted(models), sorted(slots, key=order)


def _wf_meta(path: Path) -> dict:
    meta_path = path.parent / (path.stem + ".meta.json")
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _wf_model_spec(meta: dict, name: str) -> dict:
    raw = (meta.get("models") or {}).get(name)
    if isinstance(raw, str):
        return {"url": raw, "path": "checkpoints"}
    if isinstance(raw, dict):
        return {"url": str(raw.get("url") or ""), "path": str(raw.get("path") or "checkpoints")}
    return {"url": "", "path": "checkpoints"}


def _wf_scan() -> list[dict]:
    if not WORKFLOW_DIR.is_dir():
        return []
    files = []
    for path in WORKFLOW_DIR.rglob("*.json"):
        rel = path.relative_to(WORKFLOW_DIR).as_posix()
        if path.name.startswith("_") or path.name.endswith(".meta.json"):
            continue
        if path.name in ("config.json", "index.json") or not _WORKFLOW_ID_RE.fullmatch(rel):
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        files.append((rel, path, st.st_mtime_ns, st.st_size))
    files.sort(key=lambda x: x[0])
    sig = hashlib.sha256(repr([(f[0], f[2], f[3]) for f in files]).encode()).hexdigest()
    if _wf_cache.get("sig") == sig:
        return _wf_cache["items"]
    items = []
    for rel, path, _, size in files:
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        fmt = _wf_format(obj)
        if fmt == "unknown":
            continue
        nodes, models, slots = _wf_refs(obj, fmt)
        meta = _wf_meta(path)
        tags = [str(t) for t in (meta.get("tags") or []) if str(t).strip()]
        items.append({"id": rel, "name": str(meta.get("name") or path.stem),
                      "desc": str(meta.get("desc") or ""), "tags": tags,
                      "format": fmt, "nodes": nodes, "models": models,
                      "slots": slots, "size": size, "has_meta": bool(meta)})
    _wf_cache["sig"], _wf_cache["items"] = sig, items
    return items


def _wf_score(item: dict, query: str) -> int:
    if not query:
        return 0
    toks = [t for t in re.split(r"[\s,，、/]+", query.lower()) if t]
    tags = [t.lower() for t in item["tags"]]
    name = item["name"].lower()
    hay = " ".join([item["id"], item["name"], item["desc"], " ".join(item["tags"])]).lower()
    score = 0
    for tok in toks:
        if tok in tags:
            score += 10
        elif tok in name:
            score += 6
        elif tok in hay:
            score += 3
    return score


def _norm_model(name: str) -> str:
    return str(name).replace("\\", "/").rsplit("/", 1)[-1].lower()


def _comfy_object_info(timeout: int = 6) -> Any:
    addr = str(getattr(_main, "COMFYUI_ADDRESS", "") or "").strip()
    if not addr:
        return None
    base = addr if addr.startswith("http") else "http://" + addr
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(base.rstrip("/") + "/object_info", timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _object_refs(info: Any) -> tuple[set[str], set[str]]:
    if not isinstance(info, dict):
        return set(), set()
    installed_models: set[str] = set()
    for _, spec in info.items():
        if not isinstance(spec, dict):
            continue
        req = (spec.get("input") or {}).get("required") or {}
        if not isinstance(req, dict):
            continue
        for key, val in req.items():
            if key not in _MODEL_INPUT_KEYS or not isinstance(val, list) or not val:
                continue
            names = val[0] if isinstance(val[0], list) else val
            for name in names:
                if isinstance(name, str):
                    installed_models.add(_norm_model(name))
    return set(info.keys()), installed_models


def _wf_inject_prompt(obj: dict, fmt: str, prompt: str, preferred: str = "") -> str | None:
    _, _, slots = _wf_refs(obj, fmt)
    if not slots:
        return None
    slot = preferred if preferred and preferred in slots else slots[0]
    if fmt == "api":
        obj[slot]["inputs"]["text"] = prompt
    else:
        for node in obj.get("nodes") or []:
            if isinstance(node, dict) and str(node.get("id")) == slot:
                vals = node.get("widgets_values")
                if isinstance(vals, list) and vals:
                    vals[0] = prompt
                break
    return slot


class WorkflowInstallRequest(BaseModel):
    id: str
    items: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/workflows")
async def cli_workflows(q: str = "", pick: bool = False):
    """列出 CLI/workflows 下的工作流；q 按标签/名称/描述打分排序，pick 返回最佳一条。"""
    query = (q or "").strip()[:200]
    scored = []
    for item in _wf_scan():
        score = _wf_score(item, query)
        if query and score == 0:
            continue
        scored.append((score, item))
    scored.sort(key=lambda x: (-x[0], x[1]["id"]))
    if pick:
        return {"best": scored[0][1] if scored else None, "total": len(scored)}
    items = [{"id": it["id"], "name": it["name"], "desc": it["desc"], "tags": it["tags"],
              "format": it["format"], "size": it["size"], "has_meta": it["has_meta"],
              "node_count": len(it["nodes"]), "model_count": len(it["models"])} for _, it in scored]
    return {"items": items, "total": len(items), "workspace": _comfy_workspace()}


@router.get("/workflows/check")
async def cli_workflow_check(id: str):
    """只读检查：与本机 ComfyUI /object_info 比对，列出缺失的自定义节点与模型。"""
    wid = (id or "").replace("\\", "/")
    item = next((i for i in _wf_scan() if i["id"] == wid), None)
    if not item:
        raise HTTPException(status_code=404, detail="工作流不存在")
    reason = ""
    info = None
    try:
        info = await asyncio.to_thread(_comfy_object_info)
    except Exception as exc:  # noqa: BLE001 - 离线时降级为只读声明清单
        reason = str(exc)[:160]
    online = isinstance(info, dict) and bool(info)
    meta = _wf_meta(_wf_path(item["id"]))
    if online:
        installed_nodes, installed_models = _object_refs(info)
        missing_nodes = [n for n in item["nodes"] if n not in installed_nodes]
        missing_models = [m for m in item["models"] if _norm_model(m) not in installed_models]
    else:
        missing_nodes, missing_models = list(item["nodes"]), list(item["models"])
    nodes_out = [{"name": n, "source": str((meta.get("nodes") or {}).get(n) or "")}
                 for n in missing_nodes]
    models_out = []
    for name in missing_models:
        spec = _wf_model_spec(meta, name)
        models_out.append({"name": name, "url": spec["url"], "path": spec["path"],
                           "installable": spec["url"].startswith("https://")})
    note = ("已与本机 ComfyUI /object_info 比对。" if online else
            "ComfyUI 离线：仅列出该工作流声明的节点/模型，未与已安装项比对，安装已禁用。")
    if not online and reason:
        note += " " + reason
    ws = _comfy_workspace()
    return {"id": item["id"], "online": online, "workspace": ws,
            "workspace_valid": bool(ws) and Path(ws).is_dir(),
            "declared_nodes": len(item["nodes"]), "declared_models": len(item["models"]),
            "missing_nodes": nodes_out, "missing_models": models_out, "note": note}


async def _exec_install(args: list[str], timeout: int) -> tuple[int, str]:
    kwargs: dict[str, Any] = dict(stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL, cwd=str(ROOT))
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = await asyncio.create_subprocess_exec(*args, **kwargs)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode, _decode(out).strip()
    except asyncio.TimeoutError:
        return -1, f"命令超时（{timeout}s）"
    except Exception as exc:  # noqa: BLE001
        return -1, str(exc)


@router.post("/workflows/install")
async def cli_workflow_install(req: WorkflowInstallRequest):
    """逐项确认后的补装：节点走 node install-deps，模型走 model download --background。
    下载 URL 只从同目录 .meta.json 读取，不接受前端传入，避免任意 URL 下载。
    """
    if _main.LAN_VISITOR.get():
        raise HTTPException(status_code=403, detail="仅管理员可安装工作流依赖")
    _require_enabled("comfy")
    path = _wf_path(req.id)
    item = next((i for i in _wf_scan() if i["id"] == req.id.replace("\\", "/")), None)
    if not item:
        raise HTTPException(status_code=404, detail="工作流不存在")
    ws = _comfy_workspace()
    if not ws or not Path(ws).is_dir():
        raise HTTPException(status_code=400, detail="未配置 ComfyUI workspace：请在 CLI/cli_registry.json 的 comfy.workspace 指定")
    meta = _wf_meta(path)
    chosen_nodes: list[str] = []
    chosen_models: list[tuple[str, dict]] = []
    for raw in (req.items or [])[:20]:
        kind, name = str(raw.get("kind") or ""), str(raw.get("name") or "")
        if kind == "node" and name in item["nodes"]:
            chosen_nodes.append(name)
        elif kind == "model" and name in item["models"]:
            spec = _wf_model_spec(meta, name)
            if spec["url"].startswith("https://"):
                chosen_models.append((name, spec))
    if not chosen_nodes and not chosen_models:
        raise HTTPException(status_code=400, detail="没有可安装项；模型需在同名 .meta.json 登记 https 下载地址")
    prefix = _cli_prefix({**_load_caps()["clis"]["comfy"], "id": "comfy"})
    results: list[dict] = []
    if chosen_nodes:
        args = [*prefix, "--workspace", ws, "--json", "node", "install-deps", "--workflow", str(path)]
        code, out = await _exec_install(args, 300)
        results.append({"kind": "node", "name": f"自定义节点（{len(chosen_nodes)} 项）",
                        "ok": code == 0, "message": _head(out, 600)})
    for name, spec in chosen_models:
        rel = str(spec["path"] or "checkpoints").strip("/\\")
        relpath = rel if rel.startswith("models/") else "models/" + rel
        args = [*prefix, "--workspace", ws, "--json", "model", "download",
                "--url", spec["url"], "--filename", _norm_model(name).replace("/", "_"),
                "--relative-path", relpath, "--background"]
        code, out = await _exec_install(args, 90)
        results.append({"kind": "model", "name": name, "ok": code == 0, "message": _head(out, 600)})
    return {"ok": all(r["ok"] for r in results), "workspace": ws, "results": results,
            "note": "模型为后台下载，可用 comfy model download-status 查询；自定义节点安装可能写入 workspace venv 依赖。"}
