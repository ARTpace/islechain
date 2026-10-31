"""
config.py — 配置管理
======================
职责：统一 provider 发现、API key 解析、配置读取。
单一来源：所有 provider 和 API key 的获取逻辑都集中在此。

不再存在的问题（vs 旧 smart_prompt.py）：
  - API key 读取逻辑重复了 3 次（load_config + generate_smart_prompt + main.py）
  - 配置散落在 api_providers.json / smart-prompt-config.json / 环境变量 三处
  - 预设的 provider_id 和全局 provider_id 互相覆盖逻辑混乱
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any


# ── 路径常量 ──────────────────────────────────────────────────────────
# 所有路径基于模块所在目录（prompt/）向上取项目根
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = MODULE_DIR.parent

import sys
_ROOT = str(MODULE_DIR.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from core.user_paths import user_data_dir
_USER_DATA = Path(user_data_dir())

API_PROVIDERS_PATH = PROJECT_DIR / "api_providers.json"
ENV_FILE_PATH = _USER_DATA / "api.env"

def smart_config_path() -> Path:
    try:
        import main as _m
        return Path(_m.smart_prompt_config_path())
    except Exception:
        return _USER_DATA / "smart-prompt-config.json"

# ── 默认值 ────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "base_url": "https://api.deepseek.com",
    "api_key": "",
    "model": "deepseek-chat",
    "temperature": 0.3,
    "max_tokens": 1024,
}


def resolve(preset_provider_id: Optional[str] = None) -> Dict[str, Any]:
    """
    解析最终的 LLM 配置。

    优先级（高 → 低）：
      1. preset_provider_id（预设指定的 provider）
      2. smart-prompt-config.json 中保存的全局 provider_id
      3. 第一个有可用 API key 的 provider
      4. 硬编码默认值（DEFAULT_CONFIG）

    Args:
        preset_provider_id: 预设中指定的 provider_id（如 "agnes::agnes-2.0-flash"）

    Returns:
        dict: 包含 base_url, api_key, model, temperature, max_tokens
    """
    config = DEFAULT_CONFIG.copy()

    # 步骤 1：确定要用的 provider id
    target_id = _resolve_target_provider_id(preset_provider_id)
    if not target_id:
        # 没有指定任何 provider，用第一个有 key 的
        provider = _find_first_available_provider()
        if provider:
            _apply_provider(config, provider, None)
        return config

    # 步骤 2：解析 id::model 格式
    pid, model_suffix = _parse_provider_id(target_id)

    # 步骤 3：查找 provider 并应用配置
    provider = _find_provider_by_id(pid)
    if provider:
        _apply_provider(config, provider, model_suffix)

    return config


def _resolve_target_provider_id(preset_provider_id: Optional[str]) -> Optional[str]:
    """确定最终要用的 provider id"""
    # 预设指定优先
    if preset_provider_id:
        return preset_provider_id
    # 其次全局配置
    try:
        if smart_config_path().exists():
            with open(smart_config_path(), 'r', encoding='utf-8') as f:
                data = json.load(f)
                pid = data.get("provider_id", "")
                if pid:
                    return pid
    except Exception:
        pass
    return None


def _parse_provider_id(provider_id: str):
    """解析 'agnes::agnes-2.0-flash' → ('agnes', 'agnes-2.0-flash')"""
    if '::' in provider_id:
        parts = provider_id.split('::', 1)
        return parts[0], parts[1]
    return provider_id, None


def _find_provider_by_id(pid: str) -> Optional[Dict]:
    """从 api_providers.json 中按 id 查找 provider"""
    if not API_PROVIDERS_PATH.exists():
        return None
    try:
        with open(API_PROVIDERS_PATH, 'r', encoding='utf-8') as f:
            providers = json.load(f)
        for p in providers:
            if isinstance(p, dict) and p.get("id") == pid:
                return p
    except Exception:
        return None
    return None


def _find_first_available_provider() -> Optional[Dict]:
    """找到第一个有可用 API key 的 provider"""
    if not API_PROVIDERS_PATH.exists():
        return None
    try:
        with open(API_PROVIDERS_PATH, 'r', encoding='utf-8') as f:
            providers = json.load(f)
        for p in providers:
            if not isinstance(p, dict):
                continue
            api_key = _resolve_api_key(p.get("id", ""))
            if api_key and p.get("base_url", "").strip():
                return p
    except Exception:
        return None
    return None


def _apply_provider(config: Dict[str, Any], provider: Dict, model_suffix: Optional[str]):
    """将 provider 的配置写入 config dict"""
    config["base_url"] = (provider.get("base_url") or "").strip().rstrip("/")
    config["api_key"] = _resolve_api_key(provider.get("id", ""))
    chat_models = provider.get("chat_models") or []

    if model_suffix:
        config["model"] = model_suffix
    elif chat_models:
        config["model"] = chat_models[0]


def _resolve_api_key(pid: str) -> str:
    """
    解析 API key，按优先级：
      1. 环境变量 {PID}_API_KEY
      2. API/.env 文件中的 {PID}_API_KEY
      3. api_providers.json 中没有存储 key（安全），不从此处读

    Returns:
        空的 str 表示未找到
    """
    env_key_name = f"{pid.upper()}_API_KEY"

    # 1. 环境变量
    key = os.environ.get(env_key_name, "").strip()
    if key:
        return key

    # 2. API/.env 文件
    if ENV_FILE_PATH.exists():
        try:
            with open(ENV_FILE_PATH, 'r', encoding='utf-8-sig') as f:
                for line in f.read().splitlines():
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    k, v = line.split('=', 1)
                    if k.strip().upper() == env_key_name.upper():
                        return v.strip().strip('"').strip("'")
        except Exception:
            pass

    return ""


def get_selected_provider_id() -> str:
    """获取全局配置中选中的 provider_id"""
    try:
        if smart_config_path().exists():
            with open(smart_config_path(), 'r', encoding='utf-8') as f:
                return json.load(f).get("provider_id", "")
    except Exception:
        pass
    return ""


def set_selected_provider_id(provider_id: str):
    """保存全局选中的 provider_id"""
    smart_config_path().parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if smart_config_path().exists():
        try:
            with open(smart_config_path(), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
    data["provider_id"] = provider_id
    with open(smart_config_path(), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
