"""ComfyUI 代理相关路由（提交工作流、查询状态、取回结果）"""
import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from fastapi import APIRouter, HTTPException, Request, File, UploadFile, WebSocket, Response, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from typing import Optional
import os, re, time, asyncio, subprocess, hashlib, uuid, io

import httpx
import requests
from PIL import Image, ImageOps

router = APIRouter(prefix="/api/comfyui")

import websockets as ws_client

@router.get("/llama-models")
async def list_comfyui_llama_models():
    """从本地 ComfyUI 获取 llama_cpp_model_loader 可用模型列表"""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"http://{_main.COMFYUI_ADDRESS}/object_info/llama_cpp_model_loader")
            resp.raise_for_status()
            info = resp.json() or {}
        node_info = info.get("llama_cpp_model_loader", {}) or {}
        inputs = node_info.get("input", {}) or node_info.get("input_required", {}) or {}
        required = inputs.get("required", {}) if isinstance(inputs, dict) else {}
        model_input = required.get("model") or []
        models = []
        if isinstance(model_input, (list, tuple)) and len(model_input) > 0 and isinstance(model_input[0], list):
            models = [str(m) for m in model_input[0]]
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}
@router.get("/instances")
async def get_comfyui_instances():
    """获取 ComfyUI 实例列表"""
    return {"instances": _main.COMFYUI_INSTANCES.copy(), "basePath": _main.COMFYUI_BASE_PATH or ""}
@router.put("/base-path")
async def update_comfyui_base_path(req: dict):
    """更新 ComfyUI 基础路径"""
    global COMFYUI_BASE_PATH
    path = str(req.get("path", "")).strip().rstrip("\\").rstrip("/")
    if path and not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"路径不存在:{path}")
    try:
        _main.update_env_values({"COMFYUI_BASE_PATH": path})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置失败:{e}")
    COMFYUI_BASE_PATH = path
    return {"basePath": COMFYUI_BASE_PATH}
@router.put("/instances")
async def update_comfyui_instances(req: _main.ComfyUIInstancesUpdateRequest):
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
        _main.update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
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
@router.post("/start")
async def start_comfyui_process():
    """启动 ComfyUI 后端进程"""
    global _comfyui_process

    # 检查是否已在运行
    if await _main.get_comfyui_health():
        if _comfyui_process is not None and _comfyui_process.poll() is None:
            return {"status": "already_running", "pid": _comfyui_process.pid}
        return {"status": "already_running", "note": "ComfyUI 后端已达"}

    base_path = _main.COMFYUI_BASE_PATH or ""
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

    # 查找 Python 可执行文件（兼容 ComfyUI standalone 各种布局：python/ / python_embeded/ / venv/）
    parent = os.path.dirname(base_path)
    candidates = [
        os.path.join(base_path, "python", "python.exe"),                      # ComfyUI/python/python.exe
        os.path.join(base_path, "python_embeded", "python.exe"),              # ComfyUI/python_embeded/python.exe
        os.path.join(parent, "python", "python.exe"),                         # <父目录>/python/python.exe
        os.path.join(parent, "python_embeded", "python.exe"),                 # <父目录>/python_embeded/python.exe
        os.path.join(base_path, "venv", "Scripts", "python.exe"),
        os.path.join(parent, "venv", "Scripts", "python.exe"),
        os.path.join(base_path, "..", "..", "python", "python.exe"),
    ]
    python_exe = ""
    for c in candidates:
        resolved = os.path.abspath(c)
        if os.path.isfile(resolved):
            python_exe = resolved
            break
    # 轻量兜底：扫描 base_path 与 parent 自身及直接子目录，寻找 python.exe（不递归深层，避免扫大目录）
    if not python_exe:
        for root in (base_path, parent):
            if not os.path.isdir(root):
                continue
            dirs_to_check = [root]
            try:
                dirs_to_check += [os.path.join(root, d) for d in os.listdir(root)
                                  if os.path.isdir(os.path.join(root, d))]
            except OSError:
                pass
            for d in dirs_to_check:
                for sub in ("", "python", "Scripts"):
                    cand = os.path.join(d, sub, "python.exe") if sub else os.path.join(d, "python.exe")
                    if os.path.isfile(cand):
                        python_exe = cand
                        break
                if python_exe:
                    break
            if python_exe:
                break
    if not python_exe:
        # 系统 PATH 中的 python
        python_exe = _main.shutil.which("python") or _main.shutil.which("python3") or "python"

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
@router.post("/stop")
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
    for addr in _main.COMFYUI_INSTANCES:
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
                if os.name == "nt":
                    try:
                        out = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, errors="replace")
                    except Exception:
                        out = ""
                    for line in out.splitlines():
                        parts = line.split()
                        if len(parts) < 5 or parts[3] != "LISTENING" or not parts[1].endswith(f":{port}"):
                            continue
                        try:
                            pid = int(parts[4])
                        except ValueError:
                            continue
                        if pid <= 0:
                            continue
                        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False)
                        killed.append(f"port:{port} pid:{pid}")
        except:
            pass

    if killed:
        return {"status": "stopped", "details": killed}
    return {"status": "not_running"}
@router.get("/process-status")
async def get_comfyui_status():
    """获取 ComfyUI 进程状态"""
    running = _comfyui_process is not None and _comfyui_process.poll() is None
    reachable = await _main.get_comfyui_health()

    return {
        "running": running,
        "pid": _comfyui_process.pid if running else None,
        "reachable": reachable,
    }
@router.get("/log-tail")
async def get_comfyui_log_tail(lines: int = 80, max_bytes: int = 200_000):
    """读取 ComfyUI 日志最后 N 行。max_bytes 限制读取大小，避免巨文件。"""
    log_path = _main._find_latest_comfyui_log()
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
@router.post("/log-clear")
async def clear_comfyui_log():
    """清空当前 ComfyUI 日志（截断到 0）"""
    log_path = _main._find_latest_comfyui_log()
    if not log_path or not os.path.isfile(log_path):
        return {"status": "no_log"}
    try:
        with open(log_path, "wb"):
            pass
        return {"status": "cleared", "path": log_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清空失败: {e}")


# --- ComfyUI 代理端点(供前端在 non-local 模式下使用) ---

# object_info 缓存:避免每次请求都向 ComfyUI 拉全量数据(数据量大且响应慢)
_object_info_cache = {"data": None, "ts": 0}
_OBJECT_INFO_CACHE_TTL = 30  # 秒
@router.get("/object_info")
@router.get("/object_info/{node_type:path}")
async def proxy_comfyui_object_info(node_type: str = None):
    """代理获取 ComfyUI 节点信息(含模型列表等),支持按节点类型查询"""
    import time
    now = time.time()
    target = _main.COMFYUI_ADDRESS
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
@router.get("/loras")
async def list_comfyui_loras():
    """从 ComfyUI 获取可用 LoRA 列表(查询 LoraLoader 和 LoraLoaderModelOnly 节点)"""
    target = _main.COMFYUI_ADDRESS
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

@router.get("/history/{prompt_id}")
async def proxy_comfyui_history(prompt_id: str):
    """代理获取 ComfyUI 任务历史"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/history/{prompt_id}"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI history 请求失败: {str(e)}")
@router.get("/queue")
async def proxy_comfyui_queue():
    """代理获取 ComfyUI 队列状态（用于前端进度轮询）"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/queue"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI queue 请求失败: {str(e)}")
@router.post("/prompt")
async def proxy_comfyui_prompt(request: Request):
    """代理提交 ComfyUI 任务"""
    target = _main.COMFYUI_ADDRESS
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
@router.get("/view")
async def proxy_comfyui_view(filename: str = "", subfolder: str = "", type: str = "output", w: int = 0):
    """代理 ComfyUI /view,支持缩略图与流式透传

    性能要点(解决大图秒显问题):
    - w=0(默认):用 StreamingResponse 边下边传给浏览器,并加 immutable 缓存头
      (ComfyUI 输出 filename 是 hash 唯一标识,安全 long-cache)
    - w>0:先查 WebP 缓存,命中直接 FileResponse 秒出;未命中则下载原图 +
      PIL 缩放 + 写 WebP 缓存,后续同 (filename, w) 直接秒出
    """
    target = _main.COMFYUI_ADDRESS
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
        cache_dir = os.path.join(_main.MEDIA_PREVIEW_DIR, "comfyui")
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
@router.get("/open-folder")
async def open_comfyui_folder(filename: str = "", subfolder: str = "", type: str = "output"):
    """在资源管理器中打开图片所在文件夹"""
    if not _main.COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    type_map = {"output": "output", "temp": "temp", "input": "input"}
    sub_dir = type_map.get(type, "output")
    folder_path = os.path.join(_main.COMFYUI_BASE_PATH, sub_dir, subfolder or "")
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
@router.get("/save-to-output")
async def save_comfyui_to_output(filename: str = "", subfolder: str = "", type: str = "output", token: str = "", feature: str = "其他"):
    """将 ComfyUI 的图片保存到用户 output 目录,返回本地 URL

    性能优化(解决 47s 慢问题):
    - 用 client.stream() 边下边写盘,避免内存中转大图(1-2MB 一次性加载)
    - timeout 60s(原 15s 太短,ComfyUI 慢时容易超时)
    """
    import time as _t
    _t_start = _t.perf_counter()
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")

    try:
        # 从 ComfyUI 流式下载到磁盘
        params = {"filename": filename, "subfolder": subfolder, "type": type}
        url = f"http://{target}/view"

        # 存到用户文件夹: output/{user}/{feature}/YYYY-MM-DD/
        ext = os.path.splitext(filename)[1] or ".png"
        now = time.localtime()
        username = _main.get_username_by_token(token)
        date_str = f"{now.tm_year:04d}-{now.tm_mon:02d}-{now.tm_mday:02d}"
        if username:
            user_dir = _main.get_user_dirname(username)
            date_path = f"{user_dir}/{feature}/{date_str}"
        else:
            date_path = f"{feature}/{date_str}"
        save_dir = os.path.join(_main.OUTPUT_DIR, date_path)
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
        # 复用统一 helper(同步版,可在事件循环内通过 to_thread 安全调用)
        asyncio.create_task(asyncio.to_thread(_main._prewarm_thumbnails, local_path, (600, 768, 1536)))

        return {"url": f"/output/{date_path}/{local_name}", "path": local_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存图片失败: {str(e)}")
@router.get("/system_stats")
async def proxy_comfyui_system_stats():
    """代理检查 ComfyUI 服务器状态"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/system_stats"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
        return Response(content=resp.content, media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ComfyUI 连接失败: {str(e)}")
@router.post("/upload/image")
async def proxy_comfyui_upload_image(image: UploadFile = File(None), file: UploadFile = File(None)):
    """代理上传图片到 ComfyUI(兼容前端 apiFetch 模式)"""
    upload = image or file
    if upload is None:
        raise HTTPException(status_code=422, detail="缺少 image 或 file 字段")
    content = await upload.read()
    file_filename = upload.filename
    file_content_type = upload.content_type
    result = None
    for addr in _main.COMFYUI_INSTANCES:
        try:
            files_data = {'image': (file_filename or f"upload_{int(time.time())}.png", content, file_content_type or "image/png")}
            resp = await asyncio.to_thread(requests.post, f"http://{addr}/upload/image", files=files_data, timeout=10)
            if resp.status_code == 200 and result is None:
                result = resp.json()
        except Exception as e:
            print(f"[ComfyUI Proxy] Upload to {addr} failed: {e}")
    if result:
        return result
    raise HTTPException(status_code=502, detail="所有 ComfyUI 实例上传均失败")
@router.websocket("/ws")
async def proxy_comfyui_ws(websocket: WebSocket, client_id: str = None):
    """代理 ComfyUI WebSocket,让前端通过后端获取实时进度"""
    await websocket.accept()
    target = _main.COMFYUI_ADDRESS
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
