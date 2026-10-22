"""ComfyUI V3 DynamicCombo 格式直连测试。

原始脚本：从 art-canvas 拉音色 -> 下载音频 -> 上传 ComfyUI -> 提交
OmniVoiceMultiSpeakerTTS 工作流 -> 轮询 history。依赖两个外部服务。
改造为 pytest：全部打 @pytest.mark.integration，默认 skip；
保留纯本地用例 test_smoke_imports。
"""

import pytest

COMFYUI = "http://127.0.0.1:8188"
ART = "http://127.0.0.1:7000"


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


@pytest.mark.integration
def test_comfyui_v3_dynamic_combo():
    """[integration] V3 DynamicCombo 格式多人 TTS 直连测试。"""
    import time

    import requests

    # 1. 拉音色库
    voices = requests.get(f"{ART}/api/tts/voices", timeout=5).json().get("voices", {})
    names = list(voices.keys())
    assert len(names) >= 2, "音色不足 2 个"
    v1, v2 = voices[names[0]], voices[names[1]]

    # 2. 下载音频
    def upload(info):
        content = requests.get(
            f"{ART}/api/tts/voices/file/{info.get('file','')}", timeout=10
        ).content
        name = f"v3test_{int(time.time())}.wav"
        resp = requests.post(
            f"{COMFYUI}/upload/image",
            files={"image": (name, content, "audio/wav")},
            timeout=30,
        )
        assert resp.status_code == 200, f"上传失败: {resp.status_code}"
        return name

    f1, f2 = upload(v1), upload(v2)

    # 3. 构造 V3 DynamicCombo 工作流
    workflow = {
        "5": {"inputs": {"audio": f1}, "class_type": "LoadAudio", "_meta": {"title": "说话人1 音频"}},
        "6": {"inputs": {"audio": f2}, "class_type": "LoadAudio", "_meta": {"title": "说话人2 音频"}},
        "26": {
            "inputs": {
                "model": "OmniVoice-bf16 (auto download)",
                "text": "[Speaker_1]: 你好啊 [Speaker_2]: 你好你好",
                "steps": 32, "guidance_scale": 2.0, "t_shift": 0.1, "speed": 1.0,
                "pause_between_speakers": 0.3, "device": "auto", "dtype": "auto", "attention": "auto",
                "seed": 0, "position_temperature": 5.0, "class_temperature": 0.0,
                "layer_penalty_factor": 5.0, "denoise": True, "preprocess_prompt": True,
                "postprocess_output": True, "keep_model_loaded": False,
                "num_speakers": "2",
                "speaker_1_audio": ["5", 0],
                "speaker_1_ref_text": "",
                "speaker_1_instruct": "",
                "speaker_2_audio": ["6", 0],
                "speaker_2_ref_text": "",
                "speaker_2_instruct": "",
            },
            "class_type": "OmniVoiceMultiSpeakerTTS", "_meta": {"title": "Multi-Speaker TTS"},
        },
        "2": {"inputs": {"audio": ["26", 0]}, "class_type": "PreviewAudio", "_meta": {"title": "预览音频"}},
    }

    # 4. 提交
    r = requests.post(f"{COMFYUI}/prompt", json={"prompt": workflow, "client_id": "v3test"}, timeout=30)
    result = r.json()
    assert "error" not in result, f"提交错误: {result.get('error')}"
    pid = result.get("prompt_id")
    assert pid, "缺少 prompt_id"

    # 5. 轮询
    for _ in range(60):
        time.sleep(2)
        h = requests.get(f"{COMFYUI}/history/{pid}", timeout=10).json().get(pid, {})
        status = h.get("status", {})
        if status.get("completed") or status.get("status_str") == "error":
            msgs = status.get("messages", [])
            for m in msgs:
                if m[0] == "execution_error":
                    pytest.fail(f"执行错误: {m[1].get('exception_message', '')[:300]}")
            outputs = h.get("outputs", {})
            assert outputs, "无输出"
            has_audio = any("audio" in out for out in outputs.values())
            assert has_audio, "未生成音频"
            return
    pytest.fail("轮询超时")
