"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/smart-canvas/prompt-templates, /api/smart-canvas/group-export
"""
from fastapi import HTTPException
import os, shutil
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/smart-canvas/prompt-templates")
async def smart_canvas_prompt_templates():
    try:
        template_path = _main.prompt_template_markdown_path()
        source = os.path.relpath(template_path, _main.BASE_DIR).replace("\\", "/") if template_path else ""
        return {"templates": _main.builtin_prompt_templates(), "source": source}
    except Exception as e:
        print(f"读取提示词模板失败: {e}")
        return {"templates": []}

@router.post("/api/smart-canvas/group-export")
async def export_smart_canvas_group(payload: _main.SmartCanvasGroupExportRequest):
    target_dir = _main.smart_group_export_folder(payload.folder, payload.group_name)
    used_names = set()
    count = 0
    text_index = 1
    for item in payload.items[:2000]:
        kind = str(item.kind or "").lower()
        if kind == "text":
            text = str(item.text or "")
            if not text.strip():
                continue
            base = _main.sanitize_export_filename(item.name or f"{text_index}.txt", f"{text_index}.txt")
            if not base.lower().endswith(".txt"):
                base += ".txt"
            text_index += 1
            name, ext = os.path.splitext(base)
            out_name = base
            suffix = 2
            while out_name in used_names:
                out_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(out_name)
            with open(os.path.join(target_dir, out_name), "w", encoding="utf-8") as f:
                f.write(text)
            count += 1
            continue
        src = _main.output_file_from_url(item.url)
        if not src or not os.path.isfile(src):
            continue
        base = _main.sanitize_export_filename(item.name or os.path.basename(src), os.path.basename(src) or f"asset-{count + 1}")
        name, ext = os.path.splitext(base)
        if not ext:
            _, src_ext = os.path.splitext(src)
            ext = src_ext or ".bin"
            base = name + ext
        out_name = base
        suffix = 2
        while out_name in used_names:
            out_name = f"{name}-{suffix}{ext}"
            suffix += 1
        used_names.add(out_name)
        shutil.copy2(src, os.path.join(target_dir, out_name))
        count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可导出的内容")
    return {"ok": True, "folder": target_dir, "count": count}
