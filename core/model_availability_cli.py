"""CLI 工具可用性探测：数据驱动复用 CLI/cli_registry.json 的协议→二进制映射与登录态命令。

判定纪律（与云端一致）：只有「二进制不在 PATH」或「登录态检查明确失败」才判不可用；
任何查不清 / 起子进程出错 / 超时 一律 unknown 放行，绝不误杀。

为什么不写死：每个 CLI 的二进制名、登录态命令、WSL 适配都在 cli_registry.json 里，
新增 CLI 只需改注册表，本模块零改动。找不到注册表项时退化为 unknown（放行），不硬判。
"""
import asyncio
import json
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from core import model_availability_contract as contract

Verdict = Tuple[str, str, List[str]]  # (available|unavailable|unknown, reason, [])

_ROOT = Path(__file__).resolve().parents[1]
_REGISTRY_PATH = _ROOT / "CLI" / "cli_registry.json"

_registry_cache: Dict[str, Any] = {"mtime": 0.0, "data": None}


def load_registry(force: bool = False) -> List[Dict[str, Any]]:
    """读取 CLI 注册表，按 mtime 缓存（注册表改了才重读）。"""
    try:
        mtime = _REGISTRY_PATH.stat().st_mtime
    except OSError:
        return []
    if not force and _registry_cache["data"] is not None and _registry_cache["mtime"] == mtime:
        return _registry_cache["data"]
    try:
        data = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _registry_cache["data"] or []
    clis = data.get("clis") or []
    _registry_cache["data"] = clis
    _registry_cache["mtime"] = mtime
    return clis


def _proto_map() -> Dict[str, Dict[str, Any]]:
    """protocol → 注册表条目（按 provider.protocol 索引，键名小写）。"""
    mapping: Dict[str, Dict[str, Any]] = {}
    for entry in load_registry():
        proto = (entry.get("provider") or {}).get("protocol") or entry.get("id")
        if proto:
            mapping[str(proto).strip().lower()] = entry
    return mapping


def _candidates(entry: Dict[str, Any], proto: str) -> List[str]:
    """二进制候选：commands + command，外加 local_executable（相对项目根，存在即算装好）。"""
    cmds: List[str] = list(entry.get("commands") or [])
    if entry.get("command") and entry["command"] not in cmds:
        cmds.append(entry["command"])
    if not cmds:
        cmds = [proto]
    local = entry.get("local_executable")
    if local:
        local_path = _ROOT / local
        if local_path.exists():
            cmds.insert(0, str(local_path))
    return cmds


def _find_exe(candidates: List[str]) -> Optional[str]:
    """优先绝对/相对路径型（直接判存在），否则走 shutil.which 查 PATH（含 PATHEXT）。"""
    for candidate in candidates:
        if candidate.startswith("/") or candidate.startswith(".") or "\\" in candidate or candidate.endswith(".exe"):
            if Path(candidate).exists():
                return candidate
            continue
        exe = shutil.which(candidate)
        if exe:
            return exe
    return None


async def _check_login(exe: str, entry: Dict[str, Any]) -> str:
    """返回 logged_in | not_logged_in | unknown。unknown 一律放行，避免误杀。"""
    auth_args = entry.get("auth_args")
    if not auth_args:
        return "unknown"
    try:
        proc = await asyncio.create_subprocess_exec(
            exe, *auth_args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=contract.SETTINGS["cli_auth_timeout"])
    except Exception:
        return "unknown"
    out = ""
    if stdout:
        out += stdout.decode("utf-8", "replace")
    if stderr:
        out += stderr.decode("utf-8", "replace")
    auth_json_path = entry.get("auth_json_path")
    if auth_json_path:
        try:
            data = json.loads(out)
            node: Any = data
            for key in str(auth_json_path).split("."):
                if isinstance(node, dict):
                    node = node.get(key)
                else:
                    node = None
                    break
            return "logged_in" if node else "not_logged_in"
        except Exception:
            return "unknown"
    # 无 json path：依赖返回码（与 routers/cli_tools.py 的 status 判定一致）。
    return "logged_in" if proc.returncode == 0 else "not_logged_in"


async def probe_cli(ctx, provider: dict) -> Verdict:
    """CLI 协议探测：二进制在 PATH + （可选）登录态。"""
    proto = str(provider.get("protocol") or "").strip().lower()
    entry = _proto_map().get(proto)
    if not entry:
        return "unknown", "", []

    detector = entry.get("detector", "local")
    # jimeng 登录是交互式 QR，无法自动判定；仅按二进制是否存在放行。
    if detector == "jimeng":
        try:
            import main as _main  # 复用 main 的 WSL / JIMENG_BIN 适配解析器（惰性导入避免循环依赖）
            exe = _main.jimeng_cli_executable() or ""
        except Exception:
            exe = ""
        if not exe:
            return "unavailable", "未安装 dreamina CLI（不在 PATH，或未配置 JIMENG_BIN）", []
        return "available", "", []

    candidates = _candidates(entry, proto)
    exe = _find_exe(candidates)
    if not exe:
        return "unavailable", f"未安装 CLI 工具（{' / '.join(candidates)} 不在 PATH）", []

    login = await _check_login(exe, entry)
    if login == "not_logged_in":
        cmd = " ".join(entry.get("auth_args") or [])
        return "unavailable", f"CLI 未登录（运行 `{Path(exe).name} {cmd}` 失败）", []
    return "available", "", []


def cli_probe_for(protocol) -> Optional[Callable]:
    """返回该协议的 CLI 探针；协议不在 CLI 组或无注册表项则返回 None。"""
    proto = str(protocol or "").strip().lower()
    if proto not in contract.CLI_PROTOCOLS:
        return None
    return probe_cli if _proto_map().get(proto) else None
