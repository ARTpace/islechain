"""测试多人对话 TTS 生成接口"""
import requests
import sys

BASE = "http://127.0.0.1:7000"

# 1. 检查服务是否活着
try:
    r = requests.get(f"{BASE}/api/tts/modes", timeout=5)
    print(f"[1] 服务状态: {r.status_code}")
    if r.status_code != 200:
        print("    服务不可用，请先启动 art-canvas")
        sys.exit(1)
    print(f"    modes: {r.json()}")
except Exception as e:
    print(f"[1] 连接失败: {e}")
    sys.exit(1)

# 2. 检查音色库
r = requests.get(f"{BASE}/api/tts/voices", timeout=5)
voices = r.json().get("voices", {})
print(f"\n[2] 音色库数量: {len(voices)}")
if len(voices) == 0:
    print("    音色库为空，无法测试多人对话")
    sys.exit(1)
# 列出前几个
for name, info in list(voices.items())[:3]:
    print(f"    - {name}: file={info.get('file', 'N/A')}")

# 3. 用音色库的音频做多人对话测试
voice_names = list(voices.keys())
voice1_name = voice_names[0]
voice1_info = voices[voice1_name]
voice2_name = voice_names[min(1, len(voice_names)-1)]
voice2_info = voices[voice2_name]

print(f"\n[3] 使用音色: S1={voice1_name}, S2={voice2_name}")

# 下载音频文件
def download_voice(info):
    fname = info.get("file", "")
    if not fname:
        return None
    url = f"{BASE}/api/tts/voices/file/{fname}"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        return (fname.split("/")[-1].split("\\")[-1], r.content, "audio/wav")
    print(f"    下载失败: {url} -> {r.status_code}")
    return None

audio1 = download_voice(voice1_info)
audio2 = download_voice(voice2_info)

if not audio1 or not audio2:
    print("    音频下载失败")
    sys.exit(1)

print(f"    S1 音频: {len(audio1[1])} bytes")
print(f"    S2 音频: {len(audio2[1])} bytes")

# 4. 构造 FormData 并发送
text = "[speaker1] 你好啊 [speaker2] 你好你好"

data = {
    "text": text,
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
    "speaker_1_ref_text": voice1_info.get("instruct", ""),
    "speaker_1_instruct": voice1_info.get("instruct", ""),
    "speaker_2_ref_text": voice2_info.get("instruct", ""),
    "speaker_2_instruct": voice2_info.get("instruct", ""),
}

files = {
    "speaker_1_audio": audio1,
    "speaker_2_audio": audio2,
}

print(f"\n[4] 发送请求到 {BASE}/api/tts/generate ...")
print(f"    text: {text}")
print(f"    mode: multi, num_speakers: 2")

try:
    r = requests.post(f"{BASE}/api/tts/generate", data=data, files=files, timeout=120)
    print(f"\n[5] 响应状态: {r.status_code}")
    if r.status_code == 200:
        result = r.json()
        print(f"    成功! audio: {result.get('audio', [])}")
    else:
        print(f"    失败! 响应内容:")
        try:
            print(f"    {r.json()}")
        except:
            print(f"    {r.text[:500]}")
except Exception as e:
    print(f"\n[5] 请求异常: {e}")
