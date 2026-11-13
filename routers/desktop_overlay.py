"""桌面叠加模式的节点矩形中转站。

画布页（`canvas.html?mode=desktop`）把自己每个节点的屏幕矩形 POST 上来，
桌面端 Rust 侧每 100ms 轮询 GET 拉走，交给 `SetWindowRgn` 裁剪窗口区域。
走 HTTP 而不是 Tauri IPC，是因为 overlay 窗口加载的是 `http://127.0.0.1:7000`
这个远程 origin，默认没有 IPC 权限；HTTP 中转零权限依赖，浏览器里也能调试。

矩形格式：`x,y,w,h`，单位是**相对窗口左上角的 CSS 像素**，逗号分隔，
多块用分号连接。空字符串表示没有节点（Rust 侧退化成兜底控制条区域）。
"""

from __future__ import annotations

import time
from typing import List

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

router = APIRouter()

# 超过这个时间没收到上报，就认为画布页已经关了，别再把旧区域套给窗口。
_TTL_SECONDS = 6.0

_state: dict[str, object] = {"key": "", "rects": [], "mode": "tight", "ts": 0.0}

# 页面点「退出透明」时置一个时间戳，Rust 侧下一次拉矩形就能看到。
# 走 HTTP 而不是 Tauri IPC：页面是 127.0.0.1:7000 远程 origin，
# 调自定义 command 会被 capability 拒掉（not allowed. Plugin not found）。
_EXIT_TTL = 5.0
_state["exit_ts"] = 0.0


class OverlayRectsPayload(BaseModel):
    key: str = ""
    mode: str = "tight"
    rects: List[List[float]] = []


@router.post("/api/desktop/overlay-rects")
async def overlay_set_rects(payload: OverlayRectsPayload):
    rects: list[list[int]] = []
    for item in payload.rects[:200]:  # 上限保护，避免异常页面把窗口切成一堆碎块
        if len(item) < 4:
            continue
        x, y, w, h = (int(round(float(v))) for v in item[:4])
        if w <= 0 or h <= 0:
            continue
        rects.append([x, y, w, h])
    _state["key"] = payload.key
    _state["rects"] = rects
    _state["mode"] = "full" if payload.mode == "full" else "tight"
    _state["ts"] = time.time()
    return {"ok": True, "count": len(rects)}


@router.get("/api/desktop/overlay-rects")
async def overlay_get_rects(key: str = ""):
    # 退出请求优先返回，Rust 侧看到 "EXIT" 就把窗口还原成编辑态。
    exit_ts = float(_state.get("exit_ts") or 0.0)
    if exit_ts and (time.time() - exit_ts) < _EXIT_TTL:
        _state["exit_ts"] = 0.0
        return PlainTextResponse("EXIT")
    stale = (time.time() - float(_state["ts"])) > _TTL_SECONDS
    if stale:
        return PlainTextResponse("")
    if key and key != _state["key"]:
        return PlainTextResponse("")
    if _state.get("mode") == "full":
        return PlainTextResponse("FULL")
    rects = _state["rects"] or []
    body = ";".join(",".join(str(v) for v in rect) for rect in rects)  # type: ignore[union-attr]
    return PlainTextResponse(body)


class OverlayWherePayload(BaseModel):
    where: str = "no"
    x: float = 0
    y: float = 0


@router.post("/api/desktop/overlay-where")
async def overlay_set_where(payload: OverlayWherePayload):
    """主窗口说自己是画布页、工作室里的画布框，还是别的页面。

    x/y 是画布框相对窗口的位置。穿透态把框铺满窗口时，要用它把节点补回原处。
    """
    where = payload.where if payload.where in ("canvas", "frame", "no") else "no"
    _state["where"] = where
    _state["anchor"] = [payload.x, payload.y]
    _state["where_ts"] = time.time()
    return {"ok": True, "where": where}


@router.get("/api/desktop/overlay-anchor")
async def overlay_get_anchor():
    anchor = _state.get("anchor") or [0, 0]
    x, y = anchor[0], anchor[1]  # type: ignore[index]
    return PlainTextResponse(f"{x},{y}")


@router.get("/api/desktop/overlay-where")
async def overlay_get_where():
    ts = float(_state.get("where_ts") or 0.0)
    if not ts or (time.time() - ts) > 2.0:
        return PlainTextResponse("")
    _state["where_ts"] = 0.0
    return PlainTextResponse(str(_state.get("where") or ""))


@router.post("/api/desktop/overlay-exit")
async def overlay_request_exit():
    """画布页右下角控制条的「退出透明」按钮。"""
    _state["exit_ts"] = time.time()
    return {"ok": True}
