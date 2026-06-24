"""检查 ComfyUI 节点信息"""
import requests
import json

COMFYUI = "http://127.0.0.1:8188"

# 1. 检查 ComfyUI 是否在线
try:
    r = requests.get(f"{COMFYUI}/system_stats", timeout=5)
    print(f"ComfyUI 状态: {r.status_code}")
    if r.status_code == 200:
        stats = r.json()
        print(f"  设备: {json.dumps(stats.get('devices', []), ensure_ascii=False)[:200]}")
except Exception as e:
    print(f"ComfyUI 连接失败: {e}")
    exit(1)

# 2. 获取所有可用节点
try:
    r = requests.get(f"{COMFYUI}/object_info", timeout=10)
    nodes = r.json()
    
    # 搜索 OmniVoice 相关节点
    print(f"\n[OmniVoice 节点]")
    for name, info in sorted(nodes.items()):
        if "omnivoice" in name.lower() or "OmniVoice" in name:
            print(f"  ✅ {name}")
            # 显示输入参数
            inputs = info.get("input", {}).get("required", {})
            if inputs:
                for param_name, param_info in list(inputs.items())[:15]:
                    print(f"      - {param_name}: {param_info[0] if param_info else '?'}")
    
    # 检查关键节点是否存在
    print(f"\n[关键节点检查]")
    for key in ["OmniVoiceMultiSpeakerTTS", "OmniVoiceVoiceCloneTTS", "OmniVoiceWhisperLoader", "LoadAudio", "PreviewAudio"]:
        exists = key in nodes
        print(f"  {'✅' if exists else '❌'} {key}")
        
except Exception as e:
    print(f"获取节点信息失败: {e}")
