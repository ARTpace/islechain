"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/codex, /api/gemini-cli
"""
from fastapi import HTTPException
import asyncio, subprocess
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/codex/status")
async def codex_status():
    import shutil
    exe = shutil.which("codex")
    if not exe:
        return {"installed": False, "logged_in": False, "message": "未找到 OpenAI Codex CLI，请先安装。"}
    try:
        proc = await asyncio.create_subprocess_exec(exe, "login", "status", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        logged_in = proc.returncode == 0
        message = (stdout + stderr).decode("utf-8", errors="replace").strip()
        return {"installed": True, "logged_in": logged_in, "message": message or "已安装"}
    except Exception as e:
        return {"installed": True, "logged_in": False, "message": f"检测失败: {e}"}

@router.post("/api/codex/help")
async def codex_help(payload: _main.CodexHelpRequest):
    import shutil
    exe = shutil.which("codex")
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 OpenAI Codex CLI。")
    allowed = {"", "exec", "login", "logout", "doctor", "mcp", "app", "update"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不允许的 Codex CLI 命令")
    args = [exe]
    if command:
        args += [command, "--help"]
    else:
        args.append("--help")
    try:
        proc = await asyncio.create_subprocess_exec(*args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        text = stdout.decode("utf-8", errors="replace").strip()
        err_text = stderr.decode("utf-8", errors="replace").strip()
        if err_text:
            text = f"{text}\n{err_text}" if text else err_text
        return {"success": True, "output": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Antigravity CLI ---
@router.get("/api/gemini-cli/status")
async def gemini_cli_status():
    import shutil
    exe = shutil.which("gemini")
    if not exe:
        return {"installed": False, "logged_in": False, "message": "未找到 Gemini CLI，请先安装。"}
    try:
        proc = await asyncio.create_subprocess_exec(exe, "auth", "status", stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        logged_in = proc.returncode == 0
        return {"installed": True, "logged_in": logged_in, "message": stdout.decode("utf-8", errors="replace").strip() or "已安装"}
    except Exception as e:
        return {"installed": True, "logged_in": False, "message": f"检测失败: {e}"}

@router.post("/api/gemini-cli/help")
async def gemini_cli_help(payload: _main.GeminiCliHelpRequest):
    import shutil
    exe = shutil.which("gemini")
    if not exe:
        raise HTTPException(status_code=400, detail="未找到 Gemini CLI。")
    allowed = {"", "help", "mcp", "extensions"}
    command = str(payload.command or "").strip()
    if command not in allowed:
        raise HTTPException(status_code=400, detail="不允许的 Gemini CLI 命令")
    args = [exe, "help", command] if command else [exe, "help"]
    try:
        proc = await asyncio.create_subprocess_exec(*args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        text = stdout.decode("utf-8", errors="replace").strip()
        err_text = stderr.decode("utf-8", errors="replace").strip()
        if err_text:
            text = f"{text}\n{err_text}" if text else err_text
        return {"success": True, "output": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
