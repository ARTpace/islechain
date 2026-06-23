#!/usr/bin/env python3
"""批量导入原神角色音色到 TTS 音色库（新目录结构）"""
import os
import re
import shutil
import json
from datetime import datetime

# 配置
SOURCE_DIR = r"H:\AI-Tools\mys-voice-genshin\res\audio"
TTS_VOICE_DIR = r"H:\AI-Tools\art-canvas\data\tts_voices"
AUDIO_DIR = os.path.join(TTS_VOICE_DIR, "audio", "genshin")
INDEX_FILE = os.path.join(TTS_VOICE_DIR, "voices.json")

def load_index():
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_index(index):
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

def import_voices():
    index = load_index()
    imported = 0
    skipped = 0
    
    # 确保目标目录存在
    os.makedirs(AUDIO_DIR, exist_ok=True)
    
    for character_name in os.listdir(SOURCE_DIR):
        character_dir = os.path.join(SOURCE_DIR, character_name)
        if not os.path.isdir(character_dir):
            continue
        
        # 获取所有音频文件
        audio_files = [f for f in os.listdir(character_dir) if f.endswith(('.mp3', '.wav', '.ogg', '.flac'))]
        if not audio_files:
            continue
        
        # 按文件大小排序，选择中间的
        audio_files_with_size = []
        for af in audio_files:
            try:
                size = os.path.getsize(os.path.join(character_dir, af))
                audio_files_with_size.append((af, size))
            except:
                continue
        
        if not audio_files_with_size:
            continue
        
        audio_files_with_size.sort(key=lambda x: x[1])
        mid_idx = len(audio_files_with_size) // 2
        selected_file = audio_files_with_size[mid_idx][0]
        
        # 跳过已存在的
        voice_name = f"原神·{character_name}"
        if voice_name in index:
            skipped += 1
            print(f"  跳过: {voice_name} (已存在)")
            continue
        
        try:
            # 复制音频文件到分类目录
            src_path = os.path.join(character_dir, selected_file)
            ext = os.path.splitext(selected_file)[1]
            safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", character_name)[:60]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest_filename = f"{safe_name}_{timestamp}{ext}"
            dest_path = os.path.join(AUDIO_DIR, dest_filename)
            
            shutil.copy2(src_path, dest_path)
            
            # 更新索引（存储相对路径）
            index[voice_name] = {
                "file": f"audio/genshin/{dest_filename}",
                "instruct": "女，高音调",
                "category": "genshin",
                "created": timestamp,
            }
            imported += 1
            print(f"  导入: {voice_name} -> audio/genshin/{dest_filename}")
        except Exception as e:
            print(f"  错误: {character_name}: {str(e)}")
    
    save_index(index)
    print(f"\n完成！导入: {imported} 条，跳过: {skipped} 条")

if __name__ == "__main__":
    print("开始导入原神角色音色...")
    print(f"源目录: {SOURCE_DIR}")
    print(f"目标目录: {AUDIO_DIR}")
    print("-" * 50)
    import_voices()
