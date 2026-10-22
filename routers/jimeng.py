"""即梦 API 相关路由（文生图、图生图等）"""
import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from fastapi import APIRouter, HTTPException
import asyncio, time, re, os


router = APIRouter(prefix="/api/jimeng")

@router.get("/status")
async def jimeng_status():
    exe = _main.jimeng_cli_executable()
    if not exe:
        return {"installed": False, "logged_in": False, "message": "未找到 dreamina CLI"}
    version, version_text = await _main.jimeng_cli_version()
    version_str = ".".join(str(part) for part in version) if version else None
    version_ok = version >= _main.JIMENG_MIN_CLI_VERSION if version else None
    min_version_str = ".".join(str(part) for part in _main.JIMENG_MIN_CLI_VERSION)
    try:
        raw = await _main.run_jimeng_cli(["user_credit"], timeout=30)
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
@router.get("/credit")
async def jimeng_credit():
    raw = await _main.run_jimeng_cli(["user_credit"], timeout=30)
    return {"success": True, "raw": raw}
@router.post("/logout")
async def jimeng_logout():
    raw = await _main.run_jimeng_cli(["logout"], timeout=30)
    return {"success": True, "raw": raw}
@router.post("/login/start")
async def jimeng_login_start():
    old_proc = _main.JIMENG_LOGIN_SESSION.get("proc")
    if old_proc and getattr(old_proc, "returncode", None) is None:
        try:
            old_proc.terminate()
        except Exception:
            pass
    exe = _main.jimeng_cli_executable()
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 dreamina CLI")
    _main.JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
    args = ["login", "--headless"]
    command = _main.jimeng_command(args, exe)
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=_main.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=f"未找到即梦 CLI:{exe}") from exc
    _main.JIMENG_LOGIN_SESSION["proc"] = proc
    asyncio.create_task(_main.jimeng_login_reader(proc))
    await asyncio.sleep(2)
    text = _main.jimeng_login_text()
    if proc.returncode not in (None, 0) and ("unknown" in text.lower() or "no such option" in text.lower()):
        _main.JIMENG_LOGIN_SESSION.update({"proc": None, "stdout": "", "stderr": "", "started_at": time.time()})
        proc = await asyncio.create_subprocess_exec(
            *_main.jimeng_command(["login", "--debug"], exe),
            cwd=_main.BASE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _main.JIMENG_LOGIN_SESSION["proc"] = proc
        asyncio.create_task(_main.jimeng_login_reader(proc))
        await asyncio.sleep(2)
        text = _main.jimeng_login_text()
    return {
        "success": True,
        "running": _main.JIMENG_LOGIN_SESSION.get("proc") is not None and _main.JIMENG_LOGIN_SESSION["proc"].returncode is None,
        "text": text,
        "qr_url": _main.jimeng_login_qr_from_text(text),
        "started_at": _main.JIMENG_LOGIN_SESSION.get("started_at") or 0,
    }
@router.get("/login/status")
async def jimeng_login_status():
    proc = _main.JIMENG_LOGIN_SESSION.get("proc")
    text = _main.jimeng_login_text()
    running = proc is not None and getattr(proc, "returncode", None) is None
    logged_in = False
    credit_raw = None
    if not running:
        try:
            credit_raw = await _main.run_jimeng_cli(["user_credit"], timeout=20)
            logged_in = True
        except HTTPException:
            logged_in = False
    return {
        "success": True,
        "running": running,
        "logged_in": logged_in,
        "text": text,
        "qr_url": _main.jimeng_login_qr_from_text(text),
        "raw": credit_raw,
    }
@router.post("/help")
async def jimeng_help(payload: _main.JimengHelpRequest):
    command = str(payload.command or "").strip()
    allowed = {"", "login", "logout", "user_credit", "text2image", "image2image", "image_upscale", "text2video", "image2video", "multimodal2video", "frames2video", "multiframe2video", "list_task", "query_result"}
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不支持的帮助命令")
    args = [command, "-h"] if command else ["-h"]
    raw = await _main.run_jimeng_cli(args, timeout=30, raw_text=True)
    text = raw.get("_stdout") or ""
    if raw.get("_stderr"):
        text = f"{text}\n{raw.get('_stderr')}".strip()
    return {"success": True, "command": command, "text": text, "raw": raw}

# --- OpenAI Codex CLI ---
@router.post("/query-media")
async def jimeng_query_media(payload: _main.JimengQueryMediaRequest):
    """按 submit_id 续查即梦任务:出图返回 succeeded+urls;仍排队返回 pending+queue_info;失败返回 failed。"""
    submit_id = str(payload.submit_id or "").strip()
    if not submit_id:
        raise HTTPException(status_code=400, detail="缺少 submit_id")
    kind = str(payload.kind or "image").strip().lower()
    if kind not in ("image", "video", "audio"):
        kind = "image"
    queried = await _main.jimeng_query_result(submit_id, kind)
    try:
        urls = await _main.jimeng_store_outputs(queried, kind, allow_query=False)
        return {"status": "succeeded", "submit_id": submit_id, "kind": kind, "urls": urls}
    except _main.JimengPendingError as exc:
        return {"status": "pending", "submit_id": submit_id, "kind": kind, "queue_info": exc.queue_info, "message": _main.jimeng_pending_payload(exc)["message"]}
    except HTTPException as exc:
        return {"status": "failed", "submit_id": submit_id, "kind": kind, "error": str(getattr(exc, "detail", "") or exc)}

# --- ComfyUI 设置相关 API ---

# 工作流名称校验正则
WORKFLOW_NAME_RE = re.compile(r'^[\w\u4e00-\u9fff][\w\u4e00-\u9fff\.\-_\/ ]*\.json$')

# 内置工作流列表(workflows/ 根级 + text2image/ 子目录下的文生图生成器 + 提示词/ 子目录下的本地扩写工作流)
BUILTIN_WORKFLOW_DIRS = [_main.WORKFLOW_DIR, os.path.join(_main.WORKFLOW_DIR, "text2image"), os.path.join(_main.WORKFLOW_DIR, "提示词"), os.path.join(_main.WORKFLOW_DIR, "video")]
BUILTIN_WORKFLOWS = set()
for _wd in BUILTIN_WORKFLOW_DIRS:
    if not os.path.isdir(_wd):
        continue
    for fn in os.listdir(_wd):
        if fn.endswith('.json') and not fn.endswith('.config.json') and os.path.isfile(os.path.join(_wd, fn)):
            rel = os.path.relpath(os.path.join(_wd, fn), _main.WORKFLOW_DIR).replace("\\", "/")
            BUILTIN_WORKFLOWS.add(rel)
