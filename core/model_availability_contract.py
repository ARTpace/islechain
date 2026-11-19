"""模型可用性检测的共享契约：配置、常量、小工具。

放在最底层，被 cloud / local / 编排层单向依赖，不 import 任何业务模块。
"""

import os
from typing import Any, Dict, List

SETTINGS: Dict[str, Any] = {
    "cache_ttl": float(os.getenv("ISLECHAIN_MODEL_AVAIL_TTL", "60")),
    "probe_timeout": float(os.getenv("ISLECHAIN_MODEL_AVAIL_TIMEOUT", "3")),
    "object_info_timeout": float(os.getenv("ISLECHAIN_MODEL_AVAIL_OBJECT_TIMEOUT", "4")),
    "max_parallel": int(os.getenv("ISLECHAIN_MODEL_AVAIL_PARALLEL", "8")),
    # 按节点类型查 object_info 的缓存时长：类型清单变化很慢，缓存可远长于快照 TTL。
    # 全量 /object_info 有 28MB / 22s，绝不能每次检测都拉。
    "node_type_ttl": float(os.getenv("ISLECHAIN_MODEL_AVAIL_TYPE_TTL", "300")),
    "type_parallel": int(os.getenv("ISLECHAIN_MODEL_AVAIL_TYPE_PARALLEL", "16")),
    "cloud_probe": os.getenv("ISLECHAIN_MODEL_AVAIL_CLOUD", "1") != "0",
    "local_probe": os.getenv("ISLECHAIN_MODEL_AVAIL_LOCAL", "1") != "0",
    # CLI 登录态检查（<binary> login status）的超时，独立旋钮避免拖垮整体探测。
    "cli_auth_timeout": float(os.getenv("ISLECHAIN_MODEL_AVAIL_CLI_TIMEOUT", "15")),
}

# 走本地 CLI / 特殊通道：没有 HTTP 地址也算可用，且不做 /models 探测。
CLI_PROTOCOLS = {"jimeng", "codex", "gemini-cli", "gpt-cli", "cli"}
# 与 main._resolve_image_provider 的豁免保持一致；webai2api 是免 Key 本地网关。
KEYLESS_PROTOCOLS = CLI_PROTOCOLS | {"webai2api", "volcengine"}
WEIGHT_EXT = (".safetensors", ".gguf", ".ckpt", ".pth", ".pt", ".bin", ".onnx", ".sft")
OVERRIDE_FILE = "model_availability_overrides.json"


def configure(**kwargs):
    """运行期覆盖阈值（配置缝）。返回被改动的键。"""
    changed = []
    for key, value in kwargs.items():
        if key in SETTINGS:
            SETTINGS[key] = value
            changed.append(key)
    return changed


def norm(value) -> str:
    """路径分隔符 / 大小写归一化，用于比对 ComfyUI 权重名与上游模型 id。"""
    return str(value or "").strip().replace("\\", "/").lower()


def entry(available: bool, reason: str = "", stage: str = "", **extra):
    item = {"available": bool(available), "reason": reason, "stage": stage}
    if not available and not reason:
        item["reason"] = "不可用"
    item.update(extra)
    return item


def choices(spec) -> List[str]:
    """取 ComfyUI object_info 里的枚举项。

    语义与 core.comfy_workflow_validation.enum_options 一致，但这里刻意不 import
    那个模块 —— 它会连带拉进 pydantic 与 node_catalog，本模块只需要这两个分支。
    """
    if not isinstance(spec, (list, tuple)) or not spec:
        return []
    if isinstance(spec[0], (list, tuple)):
        return [str(v) for v in spec[0]]
    if spec[0] == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):
        options = spec[1].get("options")
        if isinstance(options, list) and not spec[1].get("multiselect", False):
            return [str(v) for v in options]
    return []
