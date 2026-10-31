"""内容包的标准包管理路由：列表 / 导入 / 安装官方包 / 导出 / 卸载。

角色包与画师包的这套接口完全同构，只有路径前缀和展示名不同，
所以抽成工厂函数，两边各自 `register_pack_routes(router, ...)` 一次。

用 add_api_route 显式注册而不是装饰器，避免闭包里捕获循环变量导致路由错位。
"""

import os
import shutil
import tempfile

from fastapi import File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from content_packs.packer import PackError
from content_packs.paths import is_valid_pack_id


def _pack_to_dict(pack) -> dict:
    return {
        "packId": pack.pack_id,
        "name": pack.name,
        "version": pack.version,
        "builtin": pack.builtin,
        "entryCount": pack.entry_count,
    }


def register_pack_routes(router, module, prefix: str, display_name: str):
    """把标准包管理路由挂到 router 上。

    module 需要提供：installed_packs / official_with_status / stats /
    import_pack / install_official / export_pack_zip / uninstall_pack
    """

    def list_packs():
        return {
            "installed": module.installed_packs(),
            "official": module.official_with_status(),
            "stats": module.stats(),
        }

    async def import_pack(file: UploadFile = File(...), replace: bool = False):
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=".zip")
            os.close(fd)
            with open(tmp_path, "wb") as out:
                shutil.copyfileobj(file.file, out)
            pack = module.import_pack(tmp_path, replace=replace)
            return {"success": True, "pack": _pack_to_dict(pack)}
        except PackError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    def install_official(payload: dict = None):
        pack_id = str((payload or {}).get("packId") or "").strip()
        replace = bool((payload or {}).get("replace"))
        if not pack_id:
            raise HTTPException(status_code=400, detail="缺少 packId")
        try:
            pack = module.install_official(pack_id, replace=replace)
            return {"success": True, "pack": _pack_to_dict(pack)}
        except PackError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    def download(pack_id: str):
        tmp_dir = tempfile.mkdtemp(prefix="content-pack-export-")
        out_path = os.path.join(tmp_dir, pack_id + ".zip")
        try:
            module.export_pack_zip(pack_id, out_path)
        except PackError as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(status_code=404, detail=str(exc))
        return FileResponse(out_path, media_type="application/zip",
                            filename=pack_id + ".zip")

    def uninstall(pack_id: str):
        if not is_valid_pack_id(pack_id):
            raise HTTPException(status_code=400, detail="packId 非法")
        try:
            ok = module.uninstall_pack(pack_id)
        except PackError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"success": ok}

    router.add_api_route(
        prefix + "/packs", list_packs, methods=["GET"],
        name="list_%s_packs" % display_name, summary="已装与可装%s" % display_name,
    )
    router.add_api_route(
        prefix + "/packs/import", import_pack, methods=["POST"],
        name="import_%s_pack" % display_name, summary="导入%s zip" % display_name,
    )
    router.add_api_route(
        prefix + "/packs/install-official", install_official, methods=["POST"],
        name="install_%s_pack" % display_name, summary="安装官方%s" % display_name,
    )
    router.add_api_route(
        prefix + "/packs/{pack_id}/download", download, methods=["GET"],
        name="download_%s_pack" % display_name, summary="导出%s" % display_name,
    )
    router.add_api_route(
        prefix + "/packs/{pack_id}", uninstall, methods=["DELETE"],
        name="uninstall_%s_pack" % display_name, summary="卸载%s" % display_name,
    )
