"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/user/assets
"""
from fastapi import HTTPException
import os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/user/assets")
async def list_user_assets(token: str = ""):
    """列出用户级资产文件夹 input/{username}/ 中的图片文件(包括画布资产子目录中的图片)"""
    username = _main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")

    asset_dir, dirname = _main.get_user_input_dir(username)
    if not os.path.exists(asset_dir):
        return {"files": []}

    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    files = []
    try:
        for filename in sorted(os.listdir(asset_dir), key=lambda f: os.path.getmtime(os.path.join(asset_dir, f)), reverse=True):
            filepath = os.path.join(asset_dir, filename)
            if os.path.isfile(filepath):
                ext = os.path.splitext(filename)[1].lower()
                if ext in image_exts:
                    stat = os.stat(filepath)
                    # 读取提示词元数据（同名 .txt）
                    prompt = ""
                    txt_path = os.path.splitext(filepath)[0] + ".txt"
                    if os.path.isfile(txt_path):
                        try:
                            with open(txt_path, "r", encoding="utf-8") as tf:
                                prompt = tf.read()
                        except Exception:
                            pass
                    files.append({
                        "name": filename,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "url": f"/assets/{dirname}/{filename}",
                        "type": "image",
                        "prompt": prompt
                    })
        # 同时扫描画布资产子目录 input/{username}/{canvas_folder}/
        for item in sorted(os.listdir(asset_dir), reverse=True):
            subdir = os.path.join(asset_dir, item)
            if not os.path.isdir(subdir):
                continue
            for filename in sorted(os.listdir(subdir), key=lambda f: os.path.getmtime(os.path.join(subdir, f)), reverse=True):
                filepath = os.path.join(subdir, filename)
                if os.path.isfile(filepath):
                    ext = os.path.splitext(filename)[1].lower()
                    if ext in image_exts:
                        stat = os.stat(filepath)
                        # 读取提示词元数据（同名 .txt）
                        prompt = ""
                        txt_path = os.path.splitext(filepath)[0] + ".txt"
                        if os.path.isfile(txt_path):
                            try:
                                with open(txt_path, "r", encoding="utf-8") as tf:
                                    prompt = tf.read()
                            except Exception:
                                pass
                        files.append({
                            "name": filename,
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                            "url": f"/assets/{dirname}/{item}/{filename}",
                            "type": "image",
                            "prompt": prompt
                        })
    except Exception as e:
        print(f"读取用户资产列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}
