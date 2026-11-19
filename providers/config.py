"""Provider config rules; no dependency on FastAPI's entry module."""
import json
import logging
import os
from contextlib import suppress
from pathlib import Path

from core.json_store import atomic_write_json
from core.user_paths import user_data_dir
from providers.catalog import MODELSCOPE_DEFAULT_LORAS

_log = logging.getLogger(__name__)

IMAGE_REQUEST_MODES = {"openai", "openai-json", "openai-video-proxy", "openai-responses", "openai-async-image"}


def provider_protocol(provider):
    return str((provider or {}).get("protocol") or "openai").strip().lower()


def normalize_image_request_mode(mode):
    """统一 image_request_mode 值"""
    m = str(mode or "").strip().lower()
    return m if m in IMAGE_REQUEST_MODES else "openai"

def provider_key_env(provider_id):
    """生成提供商 API Key 的环境变量名"""
    return f"{provider_id.upper()}_API_KEY"

def clean_model_labels(raw, models):
    if not isinstance(raw, dict):
        return {}
    allowed = {str(model).strip() for model in (models or []) if str(model).strip()}
    labels = {}
    for key, value in raw.items():
        model = str(key or "").strip()
        name = str(value or "").strip()[:40]
        if model in allowed and name:
            labels[model] = name
    return labels

def normalize_provider(data):
    """规范化提供商数据"""
    image_models = data.get("image_models") or []
    chat_models = data.get("chat_models") or []
    video_models = data.get("video_models") or []
    return {
        "id": data.get("id", "").strip(),
        "name": data.get("name", "").strip(),
        "base_url": data.get("base_url", "").strip(),
        "protocol": data.get("protocol", "openai"),
        "model_capabilities": data.get("model_capabilities") or {},
        "image_request_mode": normalize_image_request_mode(data.get("image_request_mode", "")),
        "image_models": image_models,
        "chat_models": chat_models,
        "video_models": video_models,
        "model_labels": clean_model_labels(data.get("model_labels"), list(image_models) + list(chat_models) + list(video_models)),
        "ms_loras": data.get("ms_loras") or [],
        "primary": bool(data.get("primary", False)),
        "enabled": bool(data.get("enabled", True)),
    }

def public_provider(provider, *, read_key, visitor=False):
    """返回公开的提供商信息(隐藏 API Key)"""
    env_key = provider_key_env(provider["id"])
    has_key = bool(os.getenv(env_key, "") or read_key(env_key))
    key_preview = ''
    if has_key and not visitor:
        raw = os.getenv(env_key, "") or read_key(env_key)
        key_preview = raw[:4] + '••••' + raw[-4:] if len(raw) > 8 else '••••••••'
    return {
        "id": provider["id"],
        "name": provider["name"],
        "base_url": provider["base_url"],
        "protocol": provider["protocol"],
        "model_capabilities": provider.get("model_capabilities") or {},
        "image_request_mode": normalize_image_request_mode(provider.get("image_request_mode", "")),
        "image_models": provider["image_models"] or (["gpt-image-2"] if provider_protocol(provider) == "codex" else []),
        "chat_models": provider["chat_models"],
        "video_models": provider.get("video_models") or [],
        "model_labels": provider.get("model_labels") or {},
        "ms_loras": provider.get("ms_loras") or [],
        "primary": provider["primary"],
        "enabled": provider["enabled"],
        "has_key": has_key,
        "key_preview": key_preview,
        "key_env": env_key,
    }


class ProviderStore:
    def __init__(self, path=None, app_dir=None):
        self.path = str(path or Path(user_data_dir()) / 'api_providers.json')
        self.app_dir = Path(app_dir or Path(__file__).resolve().parent.parent)

    def migrate(self):
        legacy = self.app_dir / 'api_providers.json'
        if os.path.exists(self.path) or not legacy.exists():
            return
        try:
            data = json.loads(legacy.read_text(encoding='utf-8'))
            if isinstance(data, list) and data:
                atomic_write_json(self.path, data, ensure_ascii=False, indent=2)
        except Exception as error:
            _log.warning("API provider migration failed: %s", error)

    def load(self):
        self.migrate()
        if not os.path.exists(self.path):
            with suppress(Exception):
                atomic_write_json(self.path, [], ensure_ascii=False, indent=2)
            return []
        try:
            with open(self.path, encoding='utf-8') as handle:
                data = json.load(handle)
            if not isinstance(data, list):
                data = []
        except Exception:
            data = []
        data, changed = ensure_builtin_providers(data)
        if changed:
            with suppress(Exception):
                atomic_write_json(self.path, data, ensure_ascii=False, indent=2)
        return data

    def save(self, providers):
        # Preserve the existing API contract; failure reporting is a separate behavior change.
        try:
            atomic_write_json(self.path, providers, ensure_ascii=False, indent=2)
        except Exception as error:
            _log.warning("Failed to save API providers: %s", error)


def ensure_builtin_providers(providers):
    changed = False
    for provider in providers:
        if provider.get('id') == 'modelscope' and not provider.get('ms_loras'):
            provider['ms_loras'] = [dict(item) for item in MODELSCOPE_DEFAULT_LORAS]
            changed = True
    return providers, changed
