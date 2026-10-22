"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/proxy-download-to-output
"""
from fastapi import HTTPException
import httpx, os, time, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/proxy-download-to-output")
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
        username = _main.get_username_by_token(token)
        date_str = f"{now.tm_year:04d}-{now.tm_mon:02d}-{now.tm_mday:02d}"
        if username:
            user_dir = _main.get_user_dirname(username)
            date_path = f"{user_dir}/{feature}/{date_str}"
        else:
            date_path = f"{feature}/{date_str}"
        save_dir = os.path.join(_main.OUTPUT_DIR, date_path)
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
