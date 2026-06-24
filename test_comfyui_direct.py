"""测试 V3 DynamicCombo 格式"""
import requests, json, time

COMFYUI = "http://127.0.0.1:8188"
ART = "http://127.0.0.1:7000"

voices = requests.get(f"{ART}/api/tts/voices", timeout=5).json().get("voices", {})
names = list(voices.keys())
v1, v2 = voices[names[0]], voices[names[min(1, len(names)-1)]]

def upload(info):
    content = requests.get(f"{ART}/api/tts/voices/file/{info.get('file','')}", timeout=10).content
    name = f"v3test_{int(time.time())}.wav"
    requests.post(f"{COMFYUI}/upload/image", files={'image': (name, content, 'audio/wav')}, timeout=30)
    return name

f1, f2 = upload(v1), upload(v2)
print(f"已上传: {f1}, {f2}")

# 格式: speaker 输入在顶层, num_speakers 值为 "2"
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
            "speaker_2_instruct": ""
        },
        "class_type": "OmniVoiceMultiSpeakerTTS", "_meta": {"title": "Multi-Speaker TTS"}
    },
    "2": {"inputs": {"audio": ["26", 0]}, "class_type": "PreviewAudio", "_meta": {"title": "预览音频"}}
}

print("提交...")
r = requests.post(f"{COMFYUI}/prompt", json={"prompt": workflow, "client_id": "v3test"}, timeout=30)
result = r.json()
pid = result.get("prompt_id")

if "error" in result:
    print(f"❌ 提交错误: {result['error']}")
    if "node_errors" in result:
        for nid, err in result["node_errors"].items():
            print(f"  节点 {nid}: {json.dumps(err, ensure_ascii=False)[:500]}")
    exit(1)

print(f"prompt_id: {pid}")

for i in range(60):
    time.sleep(2)
    r = requests.get(f"{COMFYUI}/history/{pid}", timeout=10)
    h = r.json().get(pid, {})
    status = h.get("status", {})
    if status.get("completed") or status.get("status_str") == "error":
        msgs = status.get("messages", [])
        for m in msgs:
            if m[0] == "execution_error":
                print(f"❌ 错误: {m[1].get('exception_message', '')[:300]}")
                print(f"   类型: {m[1].get('exception_type', '')}")
                exit(1)
        outputs = h.get("outputs", {})
        if outputs:
            for nid, out in outputs.items():
                if "audio" in out:
                    print(f"✅ 成功! 节点 {nid} 输出了 {len(out['audio'])} 个音频")
                    for a in out["audio"]:
                        print(f"   {a.get('filename')}")
        else:
            print("❌ 无输出")
        break
else:
    print("⏰ 超时")
