"""Rodin 3D（Gen-2.5 免费预览通道）

art-canvas 不自己开浏览器，把生成请求转发给本机 webai2api 的异步 3D 接口：

    POST /v1/3d/tasks           提交（图片 + 档位）
    GET  /v1/3d/tasks/{id}      轮询
    GET  /v1/3d/tasks/{id}/file 取 GLB

拿到 GLB 后落到 output 目录，前端就能用 /output/... 直接预览、下载、进素材库。
未「确认模型」不扣积分，代价是只有裸几何（无 UV / 材质）。
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

import main as _main

router = APIRouter()

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "rodin3d.json"
TASK_DIR = ROOT / "data" / "rodin3d-tasks"
STATS_PATH = ROOT / "data" / "rodin3d-stats.json"
REDO_PATH = ROOT / "data" / "rodin3d-redo.json"
# hyper3d 每个生成任务自带 10 次免费重做（x 10），用掉一次少一次。
REDO_LIMIT = 10
RODIN_URL_RE = re.compile(r"^https://hyper3d\.ai/workspace/rodin/([a-f0-9-]{36})$")
DEFAULT_BASE = "http://127.0.0.1:3005"
# webai2api 与 art-canvas 常放在同一父目录，默认直接从它的配置文件取调用凭据，省一次手填。
SIBLING_CONFIG = ROOT.parent / "webai2api" / "data" / "config.yaml"

_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"RIFF", "webp"),
)

# 下载格式：glb 直接给原件，其余用 Blender 无头转一次并缓存到同目录。
CONVERT_SCRIPT = ROOT / "scripts" / "glb_convert.py"
FORMATS = {
    "glb": (".glb", "model/gltf-binary"),
    "stl": (".stl", "model/stl"),
    "obj": (".obj", "text/plain"),
    "fbx": (".fbx", "application/octet-stream"),
    "usdz": (".usdz", "model/vnd.usdz+zip"),
}


# ---------------------------------------------------------------- 配置

def _sibling_key() -> str:
    try:
        text = SIBLING_CONFIG.read_text("utf-8", errors="ignore")
    except OSError:
        return ""
    match = re.search(r"^server:\s*$([\s\S]*?)(?=^\S)", text, re.M)
    block = match.group(1) if match else text
    found = re.search(r"^\s+auth:\s*['\"]?([^\s'\"#]+)", block, re.M)
    return found.group(1) if found else ""


def _load_config() -> dict:
    data: dict[str, Any] = {}
    if CONFIG_PATH.is_file():
        try:
            data = json.loads(CONFIG_PATH.read_text("utf-8")) or {}
        except ValueError:
            data = {}
    base = str(data.get("base_url") or DEFAULT_BASE).rstrip("/")
    key = str(data.get("api_key") or "") or _sibling_key()
    return {"base_url": base, "api_key": key}


def _save_config(values: dict) -> dict:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(values, ensure_ascii=False, indent=2), "utf-8")
    return values


def _mask(key: str) -> str:
    if not key:
        return ""
    return key[:6] + "…" + key[-4:] if len(key) > 12 else "…"


def _client(value: dict) -> httpx.AsyncClient:
    if not value["api_key"]:
        raise HTTPException(400, "缺少 webai2api 调用凭据：在页面右上角「连接设置」里填写 API Key")
    return httpx.AsyncClient(
        base_url=value["base_url"],
        headers={"Authorization": f"Bearer {value['api_key']}"},
        timeout=httpx.Timeout(240.0, connect=10.0),
        trust_env=False,  # 本机回环，别走系统代理
    )


# ---------------------------------------------------------------- 请求模型

class ConfigBody(BaseModel):
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class GenerateBody(BaseModel):
    image: str = Field(..., description="图片：/output 或 /assets 路径、http(s) 地址、dataURL")
    effort: str = Field("medium", description="low / medium / high")
    prompt: Optional[str] = None
    resume_url: Optional[str] = Field(None, description="复用已生成任务：https://hyper3d.ai/workspace/rodin/{uuid}")
    idempotency_key: Optional[str] = None
    provider: Literal["hyper3d", "hunyuan", "tripo"] = "hyper3d"
    max_credits: Optional[int] = Field(None, strict=True, ge=0)
    topology: Literal["quad", "triangle"] = "quad"
    face_count: int = Field(20000, strict=True, ge=100, le=60000)
    dry_run: bool = True


class RedoBody(BaseModel):
    task_url: str = Field(..., description="hyper3d 任务地址 https://hyper3d.ai/workspace/rodin/{uuid}")
    prompt: Optional[str] = None


class TopologyBody(BaseModel):
    filename: str = ""
    base64: str = ""
    source_task_id: Optional[str] = None
    topology: str = "quad"
    face_count: Optional[int] = Field(None, strict=True, ge=100, le=60000)
    dry_run: bool = True
    idempotency_key: Optional[str] = Field(None, max_length=128)


def _topology_input(body: TopologyBody) -> tuple[str, bytes]:
    if body.topology not in ("quad", "triangle"):
        raise HTTPException(400, "拓扑只能是 quad / triangle")
    if body.source_task_id:
        if body.base64 or body.filename:
            raise HTTPException(400, "上传文件与当前模型只能选择一种")
        if not re.fullmatch(r"[A-Za-z0-9]{8,64}", body.source_task_id):
            raise HTTPException(400, "来源任务号格式不正确")
        cached = _load_task(body.source_task_id)
        url = str(cached.get("file_url") or "")
        if not url.startswith("/output/"):
            raise HTTPException(409, "请先载入一个已完成的模型")
        root = Path(_main.OUTPUT_DIR).resolve()
        path = (root / url[len("/output/"):]).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, "来源模型不存在")
        filename = path.name
        if path.stat().st_size > 24 * 1024 * 1024:
            raise HTTPException(400, "模型超过 24MB，请先在建模软件中简化后上传")
        raw = path.read_bytes()
    else:
        filename = body.filename.replace("\\", "/").rsplit("/", 1)[-1]
        if len(body.base64) > 32 * 1024 * 1024:
            raise HTTPException(400, "模型超过 24MB")
        try:
            raw = base64.b64decode(body.base64, validate=True)
        except ValueError as exc:
            raise HTTPException(400, "模型 base64 解析失败") from exc
    if not re.fullmatch(r"[^/\\\x00]{1,160}\.(obj|glb|fbx)", filename, re.I):
        raise HTTPException(400, "只支持 OBJ / GLB / FBX 模型")
    if not raw or len(raw) > 24 * 1024 * 1024:
        raise HTTPException(400, "模型不能为空且不能超过 24MB")
    if filename.lower().endswith(".glb") and (
        len(raw) < 12 or raw[:4] != b"glTF"
        or int.from_bytes(raw[4:8], "little") != 2
        or int.from_bytes(raw[8:12], "little") != len(raw)
    ):
        raise HTTPException(400, "输入不是完整的 GLB 2.0 模型")
    return filename, raw


# ---------------------------------------------------------------- 图片读取

def _read_image(value: str) -> tuple[bytes, str]:
    text = (value or "").strip()
    if not text:
        raise HTTPException(400, "请先选择一张图片")
    if text.startswith("data:"):
        head, _, payload = text.partition(",")
        ext = "png" if "png" in head else "webp" if "webp" in head else "jpg"
        try:
            return base64.b64decode(payload), ext
        except ValueError as exc:
            raise HTTPException(400, "图片 dataURL 解析失败") from exc
    if text.startswith(("http://", "https://")):
        try:
            with httpx.Client(timeout=60, trust_env=False, follow_redirects=True) as client:
                response = client.get(text)
                response.raise_for_status()
                raw = response.content
        except httpx.HTTPError as exc:
            raise HTTPException(400, f"下载图片失败：{exc}") from exc
        return raw, _sniff(raw)
    clean = text.split("?", 1)[0]
    if clean.startswith("/output/"):
        path = os.path.join(_main.OUTPUT_DIR, clean[len("/output/"):])
    elif clean.startswith("/assets/"):
        path = os.path.join(_main.ASSETS_DIR, clean[len("/assets/"):])
    elif os.path.isabs(clean) and os.path.isfile(clean):
        path = clean
    else:
        raise HTTPException(400, "无法识别的图片来源")
    if ".." in clean or not os.path.isfile(path):
        raise HTTPException(404, "图片不存在")
    return Path(path).read_bytes(), _sniff(Path(path).read_bytes())


def _sniff(raw: bytes) -> str:
    for magic, ext in _IMAGE_MAGIC:
        if raw.startswith(magic):
            if ext == "webp" and raw[8:12] != b"WEBP":
                continue
            return ext
    return "png"


# ---------------------------------------------------------------- 任务落盘

def _store_task(task_id: str, payload: dict) -> None:
    TASK_DIR.mkdir(parents=True, exist_ok=True)
    (TASK_DIR / f"{task_id}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")


def _load_task(task_id: str) -> dict:
    path = TASK_DIR / f"{task_id}.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text("utf-8")) or {}
    except ValueError:
        return {}


def _materialize(task_id: str, value: dict, task: dict) -> dict:
    """把远端 GLB 存进 output，换成 art-canvas 能直接访问的地址。"""
    cached = _load_task(task_id)
    if cached.get("file_url"):
        task["file_url"] = cached["file_url"]
        task["file_bytes"] = cached.get("file_bytes")
        return task
    url = f"{value['base_url']}/v1/3d/tasks/{task_id}/file"
    try:
        with httpx.Client(timeout=180, trust_env=False) as client:
            response = client.get(url, headers={"Authorization": f"Bearer {value['api_key']}"})
            if response.status_code != 200:
                task["materialize_error"] = f"取回 GLB 失败：HTTP {response.status_code}"
                return task
            raw = response.content
    except httpx.HTTPError as exc:
        task["materialize_error"] = f"取回 GLB 失败：{exc}"
        return task
    if raw[:4] != b"glTF":
        task["materialize_error"] = "远端返回的不是 GLB 文件"
        return task

    feature = "hunyuan3d" if cached.get("provider") == "hunyuan" else "rodin3d"
    directory, prefix = _main.media_paths.resolve_media_dir(
        owner="", feature=feature, kind="model", ext=".glb", root=_main.OUTPUT_DIR
    )
    name = f"{feature}_{task_id[:8]}_{int(time.time())}.glb"
    Path(directory, name).write_bytes(raw)
    file_url = f"{prefix}/{name}"
    task["file_url"] = file_url
    task["file_bytes"] = len(raw)
    _store_task(task_id, {**cached, "file_url": file_url, "file_bytes": len(raw)})
    return task


def _blender_exe() -> str:
    """找 Blender：环境变量优先，其次 PATH，最后扫默认安装目录取最高版本。"""
    env = os.environ.get("BLENDER_EXE", "").strip()
    if env and os.path.isfile(env):
        return env
    found = shutil.which("blender")
    if found:
        return found
    base = Path("C:/Program Files/Blender Foundation")
    if base.is_dir():
        candidates = sorted(base.glob("Blender */blender.exe"), reverse=True)
        if candidates:
            return str(candidates[0])
    return ""


def _convert(src: Path, fmt: str) -> Path:
    """把 GLB 转成 fmt，结果按同目录缓存；重复下载不再转。"""
    ext = FORMATS[fmt][0]
    dst = src.with_suffix(ext) if fmt == "glb" else src.with_name(f"{src.stem}_{fmt}{ext}")
    if dst.is_file() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst
    blender = _blender_exe()
    if not blender:
        raise HTTPException(500, "本机未找到 Blender，无法转换格式（可设置环境变量 BLENDER_EXE）")
    if not CONVERT_SCRIPT.is_file():
        raise HTTPException(500, f"缺少转换脚本 {CONVERT_SCRIPT}")
    try:
        result = subprocess.run(
            [blender, "-b", "--factory-startup", "--python", str(CONVERT_SCRIPT), "--", str(src), str(dst), fmt],
            capture_output=True,
            text=True,
            timeout=600,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "转换超时，模型面数可能过高") from exc
    if not dst.is_file():
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-3:]
        raise HTTPException(500, "转换失败：" + (" / ".join(tail) or f"退出码 {result.returncode}"))
    return dst


def _load_stats() -> dict:
    try:
        data = json.loads(STATS_PATH.read_text("utf-8"))
    except (OSError, ValueError):
        return {"total": 0, "days": {}}
    if not isinstance(data, dict):
        return {"total": 0, "days": {}}
    data.setdefault("total", 0)
    data.setdefault("days", {})
    return data


def _bump_stats(effort: str) -> None:
    """每次成功提交都记一笔，统计生成次数（不问平台要，纯本地账本）。"""
    stats = _load_stats()
    stats["total"] = int(stats.get("total") or 0) + 1
    day = time.strftime("%Y-%m-%d")
    days = stats.get("days") or {}
    days[day] = int(days.get(day) or 0) + 1
    stats["days"] = days
    stats["last_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    stats["last_effort"] = effort
    try:
        STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATS_PATH.write_text(json.dumps(stats, ensure_ascii=False, indent=2), "utf-8")
    except OSError:
        pass


def _load_redos() -> dict:
    try:
        data = json.loads(REDO_PATH.read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _bump_redo(uuid_value: str) -> int:
    data = _load_redos()
    used = int(data.get(uuid_value) or 0) + 1
    data[uuid_value] = used
    try:
        REDO_PATH.parent.mkdir(parents=True, exist_ok=True)
        REDO_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    except OSError:
        pass
    return used


# ---------------------------------------------------------------- 路由

@router.get("/api/rodin3d/stats")
async def stats():
    data = _load_stats()
    today = time.strftime("%Y-%m-%d")
    return {
        "total": int(data.get("total") or 0),
        "today": int((data.get("days") or {}).get(today) or 0),
        "days": data.get("days") or {},
        "last_at": data.get("last_at"),
    }


@router.get("/api/rodin3d/config")
async def get_config():
    value = _load_config()
    reachable = False
    try:
        async with httpx.AsyncClient(base_url=value["base_url"], timeout=4, trust_env=False) as client:
            reachable = (await client.get("/")).status_code < 500
    except httpx.HTTPError:
        reachable = False
    return {
        "base_url": value["base_url"],
        "has_key": bool(value["api_key"]),
        "key_hint": _mask(value["api_key"]),
        "reachable": reachable,
        "models": ["rodin_3d/gen2.5", "hunyuan_3d/image-to-low-poly", "hunyuan_3d/low-poly", "tripo_3d/h3.1"],
    }


@router.post("/api/rodin3d/config")
async def set_config(body: ConfigBody):
    current = _load_config()
    if body.base_url is not None:
        base = body.base_url.strip().rstrip("/")
        if base and not base.startswith(("http://", "https://")):
            raise HTTPException(400, "服务地址需以 http:// 或 https:// 开头")
        current["base_url"] = base or DEFAULT_BASE
    if body.api_key is not None and body.api_key.strip():
        current["api_key"] = body.api_key.strip()
    _save_config(current)
    return {"ok": True, "base_url": current["base_url"], "has_key": bool(current["api_key"]), "key_hint": _mask(current["api_key"])}


@router.post("/api/rodin3d/generate")
async def generate(body: GenerateBody):
    if body.effort not in ("low", "medium", "high"):
        raise HTTPException(400, "档位只能是 low / medium / high")
    raw, ext = _read_image(body.image)
    if not raw:
        raise HTTPException(400, "图片内容为空")
    if len(raw) > 24 * 1024 * 1024:
        raise HTTPException(400, "图片超过 24MB")
    hunyuan = body.provider == "hunyuan"
    tripo = body.provider == "tripo"
    if tripo:
        if body.resume_url or (body.prompt and body.prompt.strip()):
            raise HTTPException(400, "Tripo 网页通道仅支持图片生成")
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(400, "Tripo 图片不能超过 20MB")
        if not body.dry_run and body.max_credits is None:
            raise HTTPException(400, "请设置 Tripo 网页任务积分上限")
    if hunyuan:
        if body.resume_url or (body.prompt and body.prompt.strip()):
            raise HTTPException(400, "混元图生低模不支持任务复用或提示词")
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(400, "混元图片不能超过 10MB")
        try:
            with Image.open(BytesIO(raw)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP") or min(image.size) < 128:
                    raise HTTPException(400, "混元需要 PNG/JPEG/WebP 图片，宽高至少 128 像素")
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(400, "图片损坏或格式不支持") from exc

    value = _load_config()
    key = (body.idempotency_key or f"canvas-{uuid.uuid4().hex[:12]}")[:128]
    params: dict[str, Any] = {"version": "gen2.5", "effort": body.effort, "action": "generate"}
    if body.prompt and body.prompt.strip():
        params["prompt"] = body.prompt.strip()[:2000]
    payload = {
        "model": "rodin_3d/gen2.5",
        "idempotency_key": key,
        "dry_run": False,
        "params": params,
        "input": {"filename": f"input.{ext}", "base64": base64.b64encode(raw).decode()},
    }
    if hunyuan:
        payload.update(model="hunyuan_3d/image-to-low-poly", dry_run=body.dry_run,
                       params={"topology": body.topology, "face_count": body.face_count})
    if tripo:
        payload.update(model="tripo_3d/h3.1", dry_run=body.dry_run,
                       params={"version": "h3.1", **({"max_credits": body.max_credits} if body.max_credits is not None else {})})
    if body.resume_url:
        if not re.match(r"^https://hyper3d\.ai/workspace/rodin/[a-f0-9-]{36}$", body.resume_url):
            raise HTTPException(400, "任务地址格式不正确")
        payload["resume_url"] = body.resume_url
        payload["params"] = {"version": "gen2.5", "effort": body.effort}

    async with _client(value) as client:
        try:
            response = await client.post("/v1/3d/tasks", json=payload)
        except httpx.HTTPError as exc:
            if hunyuan or tripo:
                raise HTTPException(502, "提交连接中断，请先检查网站资产记录，勿直接重复提交") from exc
            raise HTTPException(502, f"提交失败，webai2api 未响应：{exc}") from exc
        if response.status_code >= 400:
            detail = ""
            try:
                detail = str(response.json().get("error") or "")
            except ValueError:
                detail = response.text[:300]
            raise HTTPException(response.status_code if response.status_code < 500 else 502, detail or "提交失败")

    task = response.json()
    task_id = str(task.get("id") or "")
    if not task_id:
        raise HTTPException(502, "webai2api 未返回任务号")
    _store_task(task_id, {"id": task_id, "created_at": time.strftime("%Y-%m-%d %H:%M:%S"), "effort": body.effort,
                          "provider": body.provider, "operation": "image-to-low-poly" if hunyuan else "generate",
                          "dry_run": body.dry_run if hunyuan or tripo else False,
                          "face_count": body.face_count if hunyuan else None,
                          "topology": body.topology if hunyuan else None})
    if not (hunyuan or tripo) or not body.dry_run:
        _bump_stats(body.effort)
    return {
        "id": task_id,
        "status": task.get("status"),
        "effort": body.effort,
        "provider": body.provider,
        "preview_url": (task.get("output") or {}).get("preview_url"),
    }


@router.post("/api/rodin3d/topology")
async def topology(body: TopologyBody):
    """复用 webai2api 混元适配器；默认只预检，真实提交由用户显式触发。"""
    filename, raw = _topology_input(body)
    value = _load_config()
    payload = {
        "model": "hunyuan_3d/low-poly",
        "idempotency_key": body.idempotency_key or f"canvas-topology-{uuid.uuid4().hex}",
        "dry_run": body.dry_run,
        "input": {"filename": filename, "base64": base64.b64encode(raw).decode()},
        "params": {"topology": body.topology},
    }
    if body.face_count is not None:
        payload["params"]["face_count"] = body.face_count
    # ponytail: 沿用现有异步任务、文件与历史接口，不另建一套任务系统。
    async with _client(value) as client:
        try:
            response = await client.post("/v1/3d/tasks", json=payload)
        except httpx.HTTPError as exc:
            raise HTTPException(502, "混元提交连接中断，请先检查网站资产记录，勿直接重复提交") from exc
        if response.status_code >= 400:
            try:
                detail = response.json().get("error") or response.json().get("detail")
            except ValueError:
                detail = response.text[:300]
            raise HTTPException(response.status_code if response.status_code < 500 else 502, str(detail or "混元提交失败"))
        task = response.json()
    task_id = str(task.get("id") or "")
    if not re.fullmatch(r"[A-Za-z0-9]{8,64}", task_id):
        raise HTTPException(502, "webai2api 未返回有效任务号，请先检查网站记录")
    _store_task(task_id, {
        "id": task_id, "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "provider": "hunyuan", "operation": "low-poly", "topology": body.topology,
        "face_count": body.face_count,
        "dry_run": body.dry_run, "source_filename": filename, "source_task_id": body.source_task_id,
    })
    return {"id": task_id, "status": task.get("status"), "provider": "hunyuan", "dry_run": body.dry_run}


@router.get("/api/rodin3d/redo")
async def redo_state(task_url: str = ""):
    """查某个 hyper3d 任务还剩几次免费重做。"""
    matched = RODIN_URL_RE.match(task_url.strip())
    if not matched:
        raise HTTPException(400, "任务地址需形如 https://hyper3d.ai/workspace/rodin/{uuid}")
    uuid_value = matched.group(1)
    used = int(_load_redos().get(uuid_value) or 0)
    return {"task_url": task_url.strip(), "used": used, "left": max(0, REDO_LIMIT - used), "limit": REDO_LIMIT}


@router.post("/api/rodin3d/redo")
async def redo(body: RedoBody):
    """对已有任务重做几何：不换图片、沿用原档位，消耗 1 次免费重做。"""
    matched = RODIN_URL_RE.match(body.task_url.strip())
    if not matched:
        raise HTTPException(400, "任务地址需形如 https://hyper3d.ai/workspace/rodin/{uuid}")
    uuid_value = matched.group(1)
    used = int(_load_redos().get(uuid_value) or 0)
    if used >= REDO_LIMIT:
        raise HTTPException(409, f"这个任务已用完 {REDO_LIMIT} 次免费重做")

    value = _load_config()
    key = f"canvas-redo-{uuid.uuid4().hex[:10]}"
    params: dict[str, Any] = {
        "version": "gen2.5",
        "effort": "medium",
        "action": "redo",
        "task_url": body.task_url.strip(),
    }
    if body.prompt and body.prompt.strip():
        params["prompt"] = body.prompt.strip()[:2000]
    payload = {
        "model": "rodin_3d/gen2.5",
        "idempotency_key": key,
        "dry_run": False,
        "params": params,
    }

    async with _client(value) as client:
        try:
            response = await client.post("/v1/3d/tasks", json=payload)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"重做提交失败，webai2api 未响应：{exc}") from exc
        if response.status_code >= 400:
            detail = ""
            try:
                detail = str(response.json().get("error") or "")
            except ValueError:
                detail = response.text[:300]
            raise HTTPException(response.status_code if response.status_code < 500 else 502, detail or "重做提交失败")

    task = response.json()
    task_id = str(task.get("id") or "")
    if not task_id:
        raise HTTPException(502, "webai2api 未返回任务号")
    used = _bump_redo(uuid_value)
    _store_task(task_id, {
        "id": task_id,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "effort": "redo",
        "source_url": body.task_url.strip(),
    })
    return {"id": task_id, "status": task.get("status"), "used": used, "left": max(0, REDO_LIMIT - used), "limit": REDO_LIMIT}


@router.get("/api/rodin3d/task/{task_id}")
async def task_status(task_id: str):
    if not re.fullmatch(r"[A-Za-z0-9]{8,64}", task_id):
        raise HTTPException(400, "任务号格式不正确")
    value = _load_config()
    async with _client(value) as client:
        try:
            response = await client.get(f"/v1/3d/tasks/{task_id}")
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"查询失败：{exc}") from exc
        if response.status_code >= 400:
            raise HTTPException(response.status_code, "任务查询失败")
        task = response.json()

    status = str(task.get("status") or "")
    output = task.get("output") or {}
    # 面数/顶点在 output 里，前端只读顶层，这里提上来省一层判断。
    task["faces"] = task.get("faces") or output.get("faces")
    task["vertices"] = task.get("vertices") or output.get("vertices")
    if status in ("succeeded", "preview_ready"):
        task = _materialize(task_id, value, task)
    task["local_task_id"] = (task.get("id") or task_id)
    cached = _load_task(task_id)
    task["provider"] = cached.get("provider", "hyper3d")
    task["operation"] = cached.get("operation", "generate")
    task["dry_run"] = cached.get("dry_run", False)
    return task


@router.get("/api/rodin3d/task/{task_id}/file")
async def task_file(task_id: str, fmt: str = "glb"):
    """给页面「下载」按钮用：按 fmt 返回 glb / stl / obj / fbx / usdz。"""
    fmt = (fmt or "glb").lower().lstrip(".")
    if fmt not in FORMATS:
        raise HTTPException(400, f"不支持的格式 {fmt}，可选 {'/'.join(FORMATS)}")
    cached = _load_task(task_id)
    file_url = cached.get("file_url")
    if not file_url:
        value = _load_config()
        async with _client(value) as client:
            response = await client.get(f"/v1/3d/tasks/{task_id}")
            if response.status_code >= 400:
                raise HTTPException(404, "任务不存在")
            task = response.json()
        if str(task.get("status")) != "succeeded":
            raise HTTPException(409, "任务尚未产出可下载文件")
        task = _materialize(task_id, value, task)
        file_url = task.get("file_url")
        if not file_url:
            raise HTTPException(502, task.get("materialize_error") or "取回 GLB 失败")
    path = os.path.join(_main.OUTPUT_DIR, file_url[len("/output/"):])
    if not os.path.isfile(path):
        raise HTTPException(404, "文件已不在磁盘上")
    source = Path(path)
    if fmt == "glb":
        target = source
    else:
        target = await asyncio.to_thread(_convert, source, fmt)
    return FileResponse(target, media_type=FORMATS[fmt][1], filename=target.name)


@router.get("/api/rodin3d/history")
async def history(limit: int = 20):
    """最近生成过的任务，方便回头取模型。"""
    if not TASK_DIR.is_dir():
        return {"items": []}
    files = sorted(TASK_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    items = []
    for path in files:
        try:
            data = json.loads(path.read_text("utf-8"))
        except ValueError:
            continue
        if not data.get("file_url"):
            continue
        items.append({"id": data.get("id") or path.stem, "file_url": data["file_url"],
                      "bytes": data.get("file_bytes"), "created_at": data.get("created_at"),
                      "provider": data.get("provider", "hyper3d"), "operation": data.get("operation", "generate")})
        if len(items) >= max(1, min(limit, 60)):
            break
    return {"items": items}
