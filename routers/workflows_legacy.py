"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/workflows
"""
from fastapi import HTTPException, Request
import json, os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/workflows")
async def list_workflows():
    """获取工作流列表"""
    if not os.path.isdir(_main.WORKFLOW_DIR):
        return {"workflows": []}

    items = []
    for root, dirs, files in os.walk(_main.WORKFLOW_DIR):
        # 只遍历特定目录
        if os.path.abspath(root) == os.path.abspath(_main.WORKFLOW_DIR):
            dirs[:] = [d for d in dirs if d in {"custom", "自定义"}]  # 允许遍历自定义工作流目录

        for fn in sorted(files):
            if not fn.endswith(".json") or fn.endswith(".config.json"):
                continue

            rel = os.path.relpath(os.path.join(root, fn), _main.WORKFLOW_DIR).replace("\\", "/")

            # 跳过内置工作流
            if _main.is_builtin_workflow(rel):
                continue

            # 读取配置
            cfg = {}
            cfg_path = _main.workflow_config_path(rel)
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}

            items.append({
                "name": rel,
                "title": cfg.get("title") or fn.replace(".json", ""),
                "builtin": False,
                "field_count": len(cfg.get("fields") or [])
            })

    # 排序
    items.sort(key=lambda item: item["title"])
    return {"workflows": items}

@router.post("/api/workflows")
async def create_workflow(req: Request):
    """创建新工作流"""
    try:
        body = await req.json()
        name = os.path.basename(body.get('name', 'workflow.json').strip())
        workflow_data = body.get('workflow', {})

        if not name.endswith('.json'):
            name = name + '.json'

        if not _main.WORKFLOW_NAME_RE.match(name):
            raise HTTPException(status_code=400, detail="工作流名称不合法,请使用中文/英文/数字/_-.")

        if not isinstance(workflow_data, dict) or not workflow_data:
            raise HTTPException(status_code=400, detail="工作流 JSON 为空")

        # 校验是否为有效的 ComfyUI API 格式
        sample = next(iter(workflow_data.values()), None)
        if not isinstance(sample, dict) or "class_type" not in sample:
            raise HTTPException(status_code=400, detail="不是有效的 ComfyUI API 工作流 JSON(需包含 class_type)")

        # 保存到自定义工作流目录
        custom_dir = os.path.join(_main.WORKFLOW_DIR, "custom")
        os.makedirs(custom_dir, exist_ok=True)
        stored_name = f"custom/{name}"
        path = _main.workflow_path_from_name(stored_name)

        _main.atomic_write_json(path, workflow_data, ensure_ascii=False, indent=2)

        return {"name": stored_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建工作流失败: {str(e)}")
