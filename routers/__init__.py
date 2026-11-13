"""routers 包——P2 路由拆分（2026-10-22）

惰性导出（PEP 562）：原急切 `from .X import router as X` 会在任意入口
（如测试直接 import routers.assets）时加载全部子模块，而子模块的
`import main as _main` 又会触发 main.py 加载，main 末尾的
`from routers import ...` 在包半初始化窗口期拿到半成品子模块，
导致 include_router 崩溃。改为按需加载后，每个子模块的
`import main as _main` 都能拿到已注册且顶层符号完整的 main。

入口约定：app 的唯一入口是 main（uvicorn main:app / import main）。
auth/canvases 为函数内惰性依赖（_get_main_deps 模式），可独立加载；
其余 7 个子模块在模块级 `import main as _main`，**不可作为独立入口**——
直接 import 会与 main 末尾的 include_router 形成半初始化死锁
（改造前 `from main import` 同样不可，非本次退化）。
"""
import importlib

_SUBROUTERS = (
    "auth",
    "canvases",
    "comfyui",
    "jimeng",
    "runninghub",
    "tts",
    "workflows",
    "assets",
    "config",
    "random_sources",
    "wildcards",
    "prompt_libraries",
    "shared_folders",
    "lora_manager",
    "poster",
    "translate",
    "prompt_dict",
    "chat",
    "history",
    "gallery",
    "smart_prompt",
    "angle",
    "modelscope",
    "presets",
    "output_ops",
    "canvas_tasks",
    "cli_tools",
    "cli_manager",
    "lora_scan",
    "asset_library",
    "static_files",
    "canvas_workflows",
    "smart_canvas",
    "ms_generate",
    "canvas_comfy",
    "proxy_download",
    "workflows_legacy",
    "animadex",
    "characters",
    "artists",
    "media_ops",
    "ideogram4",
    "restart",
    "interrogate",
    "online_gen",
    "output_zip",
    "user_assets",
    "training",
    "game_projects",
    "game_workspace",
    "game_testing",
    "game_code_candidates",
    "game_development_tasks",
    "game_native_runtime",
    "game_model3d",
    "model3d_viewer",
    "rodin3d",
    "game_audio",
    "game_node_assets",
    "mcp_tools",
    "generation_dashboard",
    "dcc_bridge",
    "ability_packs",
    "materials",
    "tripo_studio",
)

__all__ = list(_SUBROUTERS)


def __getattr__(name):
    if name in _SUBROUTERS:
        mod = importlib.import_module("." + name, __name__)
        router = getattr(mod, "router")
        # import 系统会把子模块 setattr 到父包，需显式固化为 router 对象，
        # 保持与旧急切版 `from .auth import router as auth` 相同的导出语义
        globals()[name] = router
        return router
    raise AttributeError("module %r has no attribute %r" % (__name__, name))
