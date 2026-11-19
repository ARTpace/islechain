"""Recommended providers are opt-in; defaults are not auto-installed."""

MODELSCOPE_DEFAULT_LORAS = [
    {
        "id": "Daniel8152/film",
        "name": "Z-Image Film",
        "target_model": "Tongyi-MAI/Z-Image-Turbo",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Qwen-Image-2512-Film",
        "name": "Qwen Image 2512 Film",
        "target_model": "Qwen/Qwen-Image-2512",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Klein-enhance",
        "name": "Klein enhance",
        "target_model": "black-forest-labs/FLUX.2-klein-9B",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
]

BUILTIN_PROVIDERS = [
    {
        "id": "modelscope",
        "name": "ModelScope",
        "base_url": "https://api-inference.modelscope.cn/v1",
        "protocol": "openai",
        "image_models": [
            "Tongyi-MAI/Z-Image-Turbo",
            "Qwen/Qwen-Image-2512",
            "Qwen/Qwen-Image-Edit-2511",
            "black-forest-labs/FLUX.2-klein-9B"
        ],
        "chat_models": ["Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-Coder-480B-A35B-Instruct"],
        "video_models": [],
        "ms_loras": MODELSCOPE_DEFAULT_LORAS,
        "primary": False,
        "enabled": True,
    },
    {
        "id": "runninghub",
        "name": "RunningHub",
        "base_url": "https://www.runninghub.ai",
        "protocol": "runninghub",
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "primary": False,
        "enabled": True,
    },
    {
        "id": "volcengine",
        "name": "火山引擎",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "protocol": "volcengine",
        "image_models": [],
        "chat_models": [],
        "video_models": [],
        "primary": False,
        "enabled": True,
    },
]

MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
JIMENG_DEFAULT_IMAGE_MODELS = ["5.0Pro", "5.0", "4.7", "4.6", "4.5", "4.1", "4.0", "3.1", "3.0"]
JIMENG_DEFAULT_VIDEO_MODELS = ["VideoGen-720p", "VideoGen-1080p", "VideoGen-4K"]
CODEX_DEFAULT_IMAGE_MODELS = ["gpt-image-2"]
GEMINI_CLI_DEFAULT_IMAGE_MODELS = ["imagen-3", "imagen-3-2k", "Nano-Banana", "$imagegen"]
RUNNINGHUB_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]

def builtin_default_models(provider_id: str):
    """返回内置平台的默认 image_models（当 provider 自定义为空时使用）"""
    pid = (provider_id or "").lower()
    if pid == "modelscope":
        return list(MODELSCOPE_DEFAULT_IMAGE_MODELS), [], []
    if pid == "jimeng":
        return list(JIMENG_DEFAULT_IMAGE_MODELS), [], list(JIMENG_DEFAULT_VIDEO_MODELS)
    if pid == "codex":
        return list(CODEX_DEFAULT_IMAGE_MODELS), [], []
    if pid == "gemini-cli":
        return list(GEMINI_CLI_DEFAULT_IMAGE_MODELS), [], []
    if pid == "runninghub":
        return list(RUNNINGHUB_DEFAULT_IMAGE_MODELS), [], []
    return [], [], []

