"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/history, /api/queue_status
"""
from pydantic import BaseModel
import json, os, time, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/history/save")
async def save_history(req: _main.SaveHistoryRequest, token: str = ""):
    username = _main.get_username_by_token(token)
    record = {
        "prompt": req.prompt,
        "images": req.images,
        "videos": req.videos or [],
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
    if req.genParams is not None:
        record["genParams"] = req.genParams

    # 下载直连模式的 ComfyUI 图片到用户目录
    if username:
        user_dir, user_dirname = _main.get_user_output_dir(username)
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

    # 下载直连模式的 ComfyUI 视频到用户目录(与图片对称)
    if username and req.videos:
        new_videos = []
        for vid_url in req.videos:
            if vid_url.startswith("/output/") or vid_url.startswith("/assets/"):
                new_videos.append(vid_url)
            elif vid_url.startswith("http://127.0.0.1:8188/view"):
                try:
                    import urllib.request, shutil
                    filename = f"{req.type}_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp4"
                    local_path = os.path.join(user_dir, filename)
                    with urllib.request.urlopen(vid_url, timeout=60) as resp, open(local_path, 'wb') as out:
                        shutil.copyfileobj(resp, out)
                    new_videos.append(f"/output/{user_dirname}/{filename}")
                except Exception as e:
                    print(f"下载直连视频到用户目录失败: {e}")
                    new_videos.append(vid_url)
            else:
                new_videos.append(vid_url)
        record["videos"] = new_videos

    # 确保 user 字段不被前端数据覆盖
    record["user"] = username
    if req.genParams:
        record["genParams"] = req.genParams
    if req.original:
        record["original"] = req.original
    _main.save_to_history(record)
    return {"success": True, "timestamp": record["timestamp"]}

@router.get("/api/history")
async def get_history_api(type: str = None, token: str = "", page: int = None, page_size: int = 15, q: str = None):
    username = _main.get_username_by_token(token)
    # 优先走进程内缓存,history.json 越大收益越明显
    data = list(_main._load_history_cached())  # 拷贝避免污染缓存
    # 当 data 还是 list 时,继续走过滤逻辑
    if isinstance(data, list):
        if type:
            types = [t.strip() for t in type.split(',')]
            data = [item for item in data if item.get("type", "zimage") in types]
        # 按用户过滤: 隔离多用户, 同时保留历史遗留的空 user 记录(避免升级后旧历史凭空消失)
        if username:
            data = [item for item in data if item.get("user") in (None, "", username)]
        # Support image, text, audio and video outputs: keep records with images OR text OR audio OR videos
        data = [item for item in data if item.get("images") or item.get("text") or item.get("audio") or item.get("videos")]

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

@router.get("/api/queue_status")
async def get_queue_status(client_id: str):
    with _main.QUEUE_LOCK:
        total = len(_main.QUEUE)
        positions = [i + 1 for i, t in enumerate(_main.QUEUE) if t["client_id"] == client_id]
        position = positions[0] if positions else 0
    return {"total": total, "position": position}

@router.post("/api/history/delete")
async def delete_history(req: _main.DeleteHistoryRequest, token: str = ""):
    username = _main.get_username_by_token(token)
    is_admin = _main.is_admin_by_token(token)
    if not os.path.exists(_main.HISTORY_FILE):
        return {"success": False, "message": "History file not found"}
    try:
        with _main.HISTORY_LOCK:
            with open(_main.HISTORY_FILE, 'r', encoding='utf-8') as f:
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
                _main.atomic_write_json(_main.HISTORY_FILE, new_history, ensure_ascii=False, indent=4)

        if target_record:
            # 删除图片文件
            for img_url in target_record.get("images", []):
                file_path = _main._url_to_output_path(img_url)
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
                file_path = _main._url_to_output_path(audio_url)
                if not file_path:
                    continue
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete audio file {file_path}: {e}")
                else:
                    print(f"Audio file not found (skipping): {file_path}")
            # 删除视频文件（videos 字段：URL 字符串列表，如 litevideo 保存的 {videos:[url]}）
            for video_url in target_record.get("videos", []):
                file_path = _main._url_to_output_path(video_url)
                if not file_path:
                    continue
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Failed to delete video file {file_path}: {e}")
                else:
                    print(f"Video file not found (skipping): {file_path}")
            # 兜底：兼容部分记录把视频放在 "video"/"video_url"/"video_urls" 字段的情况
            for extra_key in ("video", "video_url"):
                v = target_record.get(extra_key)
                if isinstance(v, str) and v:
                    file_path = _main._url_to_output_path(v)
                    if file_path and os.path.exists(file_path):
                        try: os.remove(file_path)
                        except Exception as e: print(f"Failed to delete {extra_key} file {file_path}: {e}")
            vurls = target_record.get("video_urls")
            if isinstance(vurls, list):
                for v in vurls:
                    file_path = _main._url_to_output_path(v)
                    if file_path and os.path.exists(file_path):
                        try: os.remove(file_path)
                        except Exception as e: print(f"Failed to delete video_urls file {file_path}: {e}")
            return {"success": True}
        else:
            return {"success": False, "message": "Record not found"}
    except Exception as e:
        print(f"Delete history error: {e}")
        return {"success": False, "message": str(e)}


class DeleteImageRequest(BaseModel):
    timestamp: float
    image_url: str

@router.post("/api/history/delete-image")
async def delete_single_image(req: DeleteImageRequest, token: str = ""):
    """从历史记录中删除单张图片(多图组合场景)"""
    username = _main.get_username_by_token(token)
    if not os.path.exists(_main.HISTORY_FILE):
        return {"success": False, "message": "History file not found"}
    try:
        with _main.HISTORY_LOCK:
            with open(_main.HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
            target_record = None
            for item in history:
                item_ts = item.get("timestamp", 0)
                if abs(float(item_ts) - float(req.timestamp)) < 0.001:
                    target_record = item
                    break
            if not target_record:
                return {"success": False, "message": "Record not found"}
            if username and not _main.is_admin_by_token(token) and target_record.get("user") and target_record.get("user") != username:
                return {"success": False, "message": "无权操作"}
            images = target_record.get("images", [])
            if req.image_url not in images:
                return {"success": False, "message": "Image not in record"}
            # 删除本地文件
            file_path = _main._url_to_output_path(req.image_url)
            if file_path and os.path.exists(file_path):
                try: os.remove(file_path)
                except: pass
            # 从记录中移除
            images.remove(req.image_url)
            if not images:
                # 图片全部删完,删除整条记录
                history = [h for h in history if abs(float(h.get("timestamp", 0)) - float(req.timestamp)) >= 0.001]
            _main.atomic_write_json(_main.HISTORY_FILE, history[:5000], ensure_ascii=False, indent=4)
            _main._invalidate_history_cache()
            return {"success": True, "remaining": len(images)}
    except Exception as e:
        return {"success": False, "message": str(e)}
