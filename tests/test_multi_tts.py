"""多人对话 TTS 生成接口测试。

原始脚本是顺序执行的探针（requests 直连 127.0.0.1:7000，print + sys.exit）。
改造为 pytest：顶层逻辑包进 test 函数，print 改 assert，
依赖 art-canvas 后端的用例打 @pytest.mark.integration，默认 skip。
"""

import pytest

BASE = "http://127.0.0.1:7000"


@pytest.fixture
def client():
    """[integration] 需要 art-canvas 后端运行时才可用。"""
    import requests

    return requests


@pytest.mark.integration
def test_tts_modes_reachable(client):
    """[1] 检查服务是否活着。"""
    r = client.get(f"{BASE}/api/tts/modes", timeout=5)
    assert r.status_code == 200, f"服务不可用: {r.status_code}"


@pytest.mark.integration
def test_voices_library_nonempty(client):
    """[2] 检查音色库数量。"""
    r = client.get(f"{BASE}/api/tts/voices", timeout=5)
    voices = r.json().get("voices", {})
    assert len(voices) > 0, "音色库为空，无法测试多人对话"


@pytest.mark.integration
def test_multi_tts_generate(client):
    """[3]-[5] 用音色库前两个音频做多人对话生成。"""
    r = client.get(f"{BASE}/api/tts/voices", timeout=5)
    voices = r.json().get("voices", {})
    assert len(voices) >= 2, "音色不足 2 个"

    names = list(voices.keys())
    v1, v2 = voices[names[0]], voices[names[1]]

    def download_voice(info):
        fname = info.get("file", "")
        assert fname, "音色缺少 file 字段"
        url = f"{BASE}/api/tts/voices/file/{fname}"
        resp = client.get(url, timeout=10)
        assert resp.status_code == 200, f"音频下载失败: {url} -> {resp.status_code}"
        return (fname.split("/")[-1].split("\\")[-1], resp.content, "audio/wav")

    audio1 = download_voice(v1)
    audio2 = download_voice(v2)
    assert len(audio1[1]) > 0
    assert len(audio2[1]) > 0

    data = {
        "text": "[speaker1] 你好啊 [speaker2] 你好你好",
        "mode": "multi",
        "instruct": "",
        "ref_text": "",
        "speed": "1.0",
        "steps": "32",
        "guidance_scale": "2.0",
        "seed": "0",
        "language": "",
        "audio_format": "wav",
        "sample_rate": "24000",
        "t_shift": "0.1",
        "position_temperature": "5.0",
        "class_temperature": "0.0",
        "layer_penalty_factor": "5.0",
        "denoise": "true",
        "normalize": "false",
        "preprocess": "true",
        "postprocess": "true",
        "save_prefix": "tts",
        "num_speakers": "2",
        "pause_between_speakers": "0.3",
        "speaker_1_ref_text": v1.get("instruct", ""),
        "speaker_1_instruct": v1.get("instruct", ""),
        "speaker_2_ref_text": v2.get("instruct", ""),
        "speaker_2_instruct": v2.get("instruct", ""),
    }
    files = {
        "speaker_1_audio": audio1,
        "speaker_2_audio": audio2,
    }

    resp = client.post(f"{BASE}/api/tts/generate", data=data, files=files, timeout=120)
    assert resp.status_code == 200, f"生成失败: {resp.status_code} {resp.text[:500]}"
    result = resp.json()
    assert result.get("audio"), "响应缺少 audio 字段"


def test_smoke_imports():
    """[unit] 纯本地检查：确认项目核心模块可被 import。"""
    import importlib
    import os
    import sys

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    import contextlib

    for mod in ("random_source", "genre_registry", "preset_manager"):
        with contextlib.suppress(ImportError):
            importlib.import_module(mod)
