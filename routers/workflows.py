"""工作流管理相关路由"""
import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from fastapi import APIRouter, HTTPException, Request
from typing import Dict, Any
import os, json


router = APIRouter(prefix="/api/workflows")

@router.get("/builtin")
async def list_builtin_workflows():
    """列出所有内置工作流及元数据（含模型文件夹前缀）"""
    if not os.path.isdir(_main.WORKFLOW_DIR):
        return {"workflows": []}
    items = []
    for rel in sorted(_main.BUILTIN_WORKFLOWS):
        filepath = os.path.join(_main.WORKFLOW_DIR, *rel.split("/"))
        if not os.path.isfile(filepath):
            continue
        meta = _main._extract_workflow_meta(filepath)
        # 读取 config.json
        cfg = {}
        cfg_path = filepath.replace(".json", ".config.json")
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            except Exception:
                cfg = {}
        title = cfg.get("title") or os.path.basename(rel).replace(".json", "")
        # model_folders 优先取 config.json,fallback 到 unet 解析的 model_folder
        _mf = cfg.get("model_folders")
        if isinstance(_mf, list) and _mf:
            model_folders = _mf
        else:
            _unet_folder = (meta and meta.get("model_folder")) or ""
            model_folders = [_unet_folder] if _unet_folder else []
        items.append({
            "name": rel,
            "title": title,
            "builtin": True,
            "has_unet": meta and meta.get("has_unet"),
            "model_folder": (model_folders[0] if model_folders else ((meta and meta.get("model_folder")) or "")),
            "model_folders": model_folders,
            "unet_name": (meta and meta.get("unet_name")) or "",
        })
    return {"workflows": items}
@router.get("/{name:path}")
async def get_workflow(name: str):
    """获取单个工作流详情"""
    if not _main.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    workflow_path = _main.workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    # 读取工作流
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)

    # 读取配置
    cfg = {"title": name.replace(".json", ""), "fields": []}
    cfg_path = _main.workflow_config_path(name)
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or cfg
        except Exception:
            pass

    return {
        "name": name,
        "workflow": workflow,
        "config": cfg,
        "builtin": _main.is_builtin_workflow(name)
    }
@router.put("/{name:path}/config")
async def update_workflow_config(name: str, req: Request):
    """更新工作流配置"""
    if not _main.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    workflow_path = _main.workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    try:
        body = await req.json()
        cfg_path = _main.workflow_config_path(name)

        _main.atomic_write_json(cfg_path, body, ensure_ascii=False, indent=2)

        return {"config": body}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新配置失败: {str(e)}")
@router.delete("/{name:path}")
async def delete_workflow(name: str):
    """删除工作流"""
    if not _main.WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法")

    # 内置工作流不可删除
    if _main.is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流不可删除")

    workflow_path = _main.workflow_path_from_name(name)
    cfg_path = _main.workflow_config_path(name)

    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="工作流不存在")

    try:
        os.remove(workflow_path)
        if os.path.exists(cfg_path):
            os.remove(cfg_path)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除工作流失败: {str(e)}")
@router.post("/{workflow_name:path}/run")
def run_workflow(workflow_name: str, payload: _main.WorkflowRunRequest, token: str = ""):
    """运行工作流(使用 generate 函数)"""
    try:
        # 校验工作流名称
        if not _main.WORKFLOW_NAME_RE.match(workflow_name):
            raise HTTPException(status_code=400, detail="工作流名称不合法")

        workflow_path = _main.workflow_path_from_name(workflow_name)
        if not os.path.exists(workflow_path):
            raise HTTPException(status_code=404, detail="工作流不存在")

        # 根据 config 的字段把值映射成 params 节点覆盖
        params: Dict[str, Dict[str, Any]] = {}
        for field in payload.config.fields:
            if not field.node or not field.input:
                continue
            if field.id in payload.fields:
                value = payload.fields[field.id]
                # 类型转换
                if field.type in ("number", "slider"):
                    try:
                        value = float(value) if (field.step and field.step < 1) else int(float(value))
                    except Exception:
                        pass
                elif field.type == "boolean":
                    value = bool(value)
                elif field.type == "dropdown":
                    # 下拉值如果看起来是数字,自动转成 int/float
                    if isinstance(value, str):
                        s = value.strip()
                        try:
                            if s and ('.' in s or 'e' in s.lower()):
                                value = float(s)
                            elif s and s.lstrip('-').isdigit():
                                value = int(s)
                        except (ValueError, TypeError):
                            pass
                elif field.type == "image":
                    # 图片字段:值已经是 ComfyUI 图片文件名
                    pass
                params.setdefault(field.node, {})[field.input] = value

        # 调用 generate 函数
        generate_req = _main.GenerateRequest(
            prompt="",
            workflow_json=workflow_name,
            params=params,
            type="workflow",
            client_id=payload.client_id or _main.CLIENT_ID,
        )

        # 调用同步的 generate 函数
        result = _main.generate(generate_req, token=token)

        if result.get("error"):
            raise HTTPException(status_code=500, detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"运行工作流失败: {str(e)}")


# ==================== 海报设计 API ====================

POSTER_DATA_DIR = os.path.join(_main.DATA_DIR)
POSTER_LAYOUT_THUMBS = os.path.join(_main.STATIC_DIR, "images", "poster_layouts", "thumbnails")
POSTER_STYLE_THUMBS = os.path.join(_main.STATIC_DIR, "images", "style_thumbnails")

# 100种布局名称
LAYOUT_NAMES = [
    None,
    "三分法构图","九宫格构图","黄金分割构图","对称构图","非对称构图",
    "均衡式构图","上下构图","前后构图","水平构图","垂直构图",
    "开放式构图","封闭式构图","满版构图","留白式构图","密集式构图",
    "疏朗式构图","疏密对比构图","单点构图","双点构图","多点构图",
    "S形构图","C形构图","Z形构图","V形构图","X形构图",
    "放射式构图","向心式构图","离心式构图","环绕式构图","框架式构图",
    "三角形构图","倒三角构图","圆形构图","椭圆形构图","方形构图",
    "矩形构图","菱形构图","十字构图","T形构图","L形构图",
    "单点聚焦构图","多点平衡构图","群组式构图","分组式构图","聚合式构图",
    "分散式构图","集中式构图","扩散式构图","层叠式构图","阶梯式构图",
    "重复式构图","渐变式构图","节奏式构图","韵律式构图","对比式构图",
    "呼应式构图","镜像式构图","轴线式构图","中轴构图","偏轴构图",
    "网格式构图","模块化构图","分栏式构图","分割式构图","区块式构图",
    "矩阵式构图","棋盘式构图","卡片式构图","拼贴式构图","蒙太奇构图",
    "引导线构图","透视构图","纵深构图","近大远小构图","前景构图",
    "中景构图","背景构图","层次构图","空间构图","深度构图",
    "斜线构图","曲线构图","折线构图","波浪线构图","交叉线构图",
    "平行线构图","重心构图","偏重心构图","视觉中心构图","视觉动线构图",
    "动势构图","静态构图","主次构图","开合构图","虚实构图",
    "明暗构图","色块构图","色彩对比构图","大小对比构图","动静对比构图"
]

LAYOUT_CATEGORIES = [
    {'id': '0', 'name': '🎬 电影/影视'},{'id': '1', 'name': '🎵 活动/音乐'},
    {'id': '2', 'name': '📦 产品发布'},{'id': '3', 'name': '🗺️ 旅游/目的地'},
    {'id': '4', 'name': '🎓 教育/学术'},{'id': '5', 'name': '💪 激励/励志'},
    {'id': '6', 'name': '📢 宣传/广告'},{'id': '7', 'name': '🎨 艺术/展览'}
]
