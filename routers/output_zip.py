"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/download-output-zip
"""
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
import httpx, io, os, zipfile
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/download-output-zip")
async def download_output_zip(payload: _main.DownloadZipRequest):
    """下载 Output 节点图片为 ZIP"""
    if not payload.urls:
        raise HTTPException(status_code=400, detail="没有可下载的图片")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i, url in enumerate(payload.urls):
            try:
                # 处理本地路径
                if url.startswith('/assets/') or url.startswith('/output/'):
                    local_path = url.lstrip('/')
                    if os.path.isfile(local_path):
                        zf.write(local_path, f"image_{i+1}_{os.path.basename(local_path)}")
                        continue

                # 处理远程 URL
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, timeout=10.0)
                    if resp.status_code == 200:
                        ext = url.split('.')[-1].split('?')[0] or 'png'
                        zf.writestr(f"image_{i+1}.{ext}", resp.content)
            except Exception as e:
                print(f"Download failed for {url}: {e}")
                continue

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={payload.filename}"}
    )
