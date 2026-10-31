"""TTS 语音相关路由"""
import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from fastapi import APIRouter, HTTPException, Request, File, UploadFile, Form, Query
import os, re, time, shutil
from datetime import datetime
from fastapi.responses import FileResponse


router = APIRouter(prefix="/api/tts")

@router.get("/voices")
async def get_tts_voices():
    """获取音色库列表(全局共享)"""
    index = _main._load_voice_index()
    return {"voices": index}


# 缓存 animadex 角色数据
_animadex_cache = None
_animadex_cache_time = 0
@router.post("/to-podcast")
async def convert_to_podcast(
    text: str = Form(...),
    num_speakers: int = Form(2),
    style: str = Form("default"),
    word_count: int = Form(500)
):
    """将文本转换为播客对话格式"""
    from core.smart_tts import call_llm_direct
    from core.smart_prompt import load_config

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    config = load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")

    # 构造用户提示
    style_desc = {
        "default": "自然对话,主持人和嘉宾轻松交流",
        "news": "新闻播报风格,语言正式、节奏明快",
        "casual": "轻松闲聊,像朋友聊天一样随意",
        "interview": "深度采访,主持人追问细节",
        "debate": "观点碰撞,正反方讨论",
        "storytelling": "故事讲述,用叙事方式展开",
        "educational": "教学讲解,循序渐进地解释概念"
    }

    # 构造详细的用户提示
    user_prompt = f"""请将以下文章转换为 {num_speakers} 人对话的播客节目。

## 播客风格
{style_desc.get(style, style_desc['default'])}

## 对话人数
{num_speakers} 人(1位主持人 + {num_speakers - 1}位嘉宾)

## 输出要求
1. 必须包含完整的开场白(主持人介绍话题和嘉宾)
2. 将文章内容分解为 3-5 个讨论点
3. 必须包含结尾总结
4. 每句话控制在 15-40 字
5. 总字数控制在 {word_count} 字左右
6. 直接输出对话内容

## 格式要求(非常重要!)
- 角色标签必须用: [Speaker_1]: [Speaker_2]: [Speaker_3]:
- 绝对不要用人名作为标签(如 [张三] [李四] 都是错误的)
- 绝对不要在括号里加描述(如 (微笑) (回忆) (语气轻快) 都是错误的)
- 语气通过文字内容自然体现,不要加括号说明

## 文章内容
{text}"""

    try:
        result = call_llm_direct(user_prompt, _main.PODCAST_SYSTEM_PROMPT, config)

        # 解析结果,提取说话人信息
        speakers = set()
        lines = result.strip().split('\n')
        for line in lines:
            line = line.strip()
            if line.startswith('[') and ']:' in line:
                speaker_name = line.split(']:')[0].replace('[', '').strip()
                speakers.add(speaker_name)

        # 将对话格式转换为 TTS 格式 (Speaker_1:, Speaker_2: 等)
        speaker_list = list(speakers)
        speaker_map = {}
        for i, name in enumerate(speaker_list[:num_speakers]):
            speaker_map[name] = f"Speaker_{i+1}"

        tts_lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith('[') and ']:' in line:
                speaker_name = line.split(']:')[0].replace('[', '').strip()
                content = line.split(']:', 1)[1].strip() if ']:' in line else ''
                tts_id = speaker_map.get(speaker_name, speaker_name)
                
                # 清理括号描述 (如 (微笑) (回忆) 等)
                content = re.sub(r'\([^)]*?\)', '', content)
                content = re.sub(r'\s+', ' ', content).strip()
                
                if content:
                    tts_lines.append(f"[{tts_id}]: {content}")
            else:
                line = re.sub(r'\([^)]*?\)', '', line)
                line = re.sub(r'\s+', ' ', line).strip()
                if line:
                    tts_lines.append(line)
        
        initial_text = "\n".join(tts_lines)
        
        # ========== 质检步骤 ==========
        print("[Podcast] 初稿生成完成,开始质检...")
        check_result = _main.check_podcast_text(initial_text, num_speakers, word_count)
        
        if check_result['issues']:
            print(f"[Podcast] 发现 {len(check_result['issues'])} 个问题:")
            for issue in check_result['issues']:
                print(f"  - {issue}")
            
            # 如果有自动修复,先应用
            if check_result['auto_fixed']:
                initial_text = check_result['fixed_text']
                print("[Podcast] 自动修复完成")
            
            # 如果需要AI修正(字数问题),调用AI
            if check_result['needs_ai_fix']:
                print("[Podcast] 需要AI修正字数...")
                fix_prompt = _main.get_ai_fix_prompt(check_result['issues'], initial_text)
                fixed_result = call_llm_direct(fix_prompt, "你是一个文本修正助手,只修正指定的问题,不要改变其他内容。", config)
                if fixed_result and not fixed_result.startswith('ERROR:'):
                    initial_text = fixed_result
                    print("[Podcast] AI修正完成")
            
            # 最终检查
            final_check = _main.check_podcast_text(initial_text, num_speakers, word_count)
            if final_check['issues']:
                print(f"[Podcast] 最终检查仍有 {len(final_check['issues'])} 个问题:")
                for issue in final_check['issues']:
                    print(f"  - {issue}")
            else:
                print("[Podcast] 最终检查通过!")
        else:
            print("[Podcast] 质检通过,无问题!")
        
        return {
            "success": True,
            "podcast_text": initial_text,
            "original_speakers": speaker_list[:num_speakers],
            "speaker_map": speaker_map,
            "raw_text": result,
            "quality_check": {
                "issues_found": len(check_result['issues']),
                "auto_fixed": check_result['auto_fixed'],
                "total_chars": check_result['total_chars']
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")
@router.post("/fetch-url")
async def fetch_url_content(url: str = Form("")):
    """抓取网页文章内容"""
    import re
    
    if not url.strip():
        raise HTTPException(status_code=400, detail="URL 不能为空")
    
    # 补全协议
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    
    try:
        # 方法1: 使用 Jina Reader API (免费,能绕过大部分反爬)
        try:
            jina_url = f"https://r.jina.ai/{url}"
            req = _main.urllib.request.Request(jina_url, headers={
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/plain',
            })
            with _main.urllib.request.urlopen(req, timeout=20) as response:
                text = response.read().decode('utf-8', errors='ignore')
            
            # 清理 Jina 返回的内容
            text = text.strip()
            
            # 提取 Markdown Content 后的正文
            if 'Markdown Content:' in text:
                text = text.split('Markdown Content:', 1)[1].strip()
            elif 'Content:' in text:
                text = text.split('Content:', 1)[1].strip()
            
            # 移除图片链接和导航链接
            text = re.sub(r'!\[Image \d+:.*?\]\(.*?\)', '', text)
            text = re.sub(r'\[_.*?_\]\(.*?\)', '', text)
            text = re.sub(r'\[.*?\]\(https?://.*?\)', '', text)
            # 移除标题标记
            text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
            # 移除列表标记
            text = re.sub(r'^\*\s+', '', text, flags=re.MULTILINE)
            text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
            # 移除多余空行和空格
            text = re.sub(r'\n{3,}', '\n\n', text)
            text = re.sub(r' {2,}', ' ', text)
            # 移除开头的导航部分(直到找到文章标题)
            lines = text.split('\n')
            article_start = 0
            for i, line in enumerate(lines):
                line = line.strip()
                if len(line) > 20 and not line.startswith(('*', '-', '#', '!', '[')):
                    article_start = i
                    break
            text = '\n'.join(lines[article_start:]).strip()
            
            if len(text) > 200:
                # 截取前 5000 字
                if len(text) > 5000:
                    text = text[:5000] + '...'
                return {
                    "success": True,
                    "content": text,
                    "url": url
                }
        except Exception as e:
            print(f"[FetchURL] Jina Reader 失败: {e}")
        
        # 方法2: 使用 trafilatura
        try:
            import trafilatura
            downloaded = trafilatura.fetch_url(url)
            if downloaded:
                text = trafilatura.extract(downloaded, include_comments=False, include_tables=True, no_fallback=False)
                if text and len(text) > 100:
                    if len(text) > 5000:
                        text = text[:5000] + '...'
                    return {
                        "success": True,
                        "content": text,
                        "url": url
                    }
        except Exception as e:
            print(f"[FetchURL] trafilatura 失败: {e}")
        
        # 方法3: 回退到 urllib
        req = _main.urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        })
        
        with _main.urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8', errors='ignore')
        
        html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.I)
        html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.I)
        text = re.sub(r'<[^>]+>', ' ', html)
        text = re.sub(r'\s+', ' ', text).strip()
        
        if len(text) > 5000:
            text = text[:5000] + '...'
        
        if len(text) < 50:
            raise Exception("抓取内容过少,可能是反爬页面")
        
        return {
            "success": True,
            "content": text,
            "url": url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"抓取失败: {str(e)}")
@router.post("/to-solo-podcast")
async def convert_to_solo_podcast(
    text: str = Form(...),
    style: str = Form("storytelling"),
    word_count: int = Form(500)
):
    """将文本转换为单人播客风格"""
    from core.smart_tts import call_llm_direct
    from core.smart_prompt import load_config

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    config = load_config()
    print(f"[SoloPodcast] config: base_url={config.get('base_url')}, api_key={'set' if config.get('api_key') else 'empty'}, model={config.get('model')}")
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")
    if not config.get("base_url"):
        raise HTTPException(status_code=400, detail=f"未配置 API base_url, config={config}")

    # 风格配置
    style_configs = {
        "storytelling": {
            "desc": "故事讲述风格,用生动的叙事方式展开,有起伏和悬念"
        },
        "knowledge": {
            "desc": "知识讲解风格,清晰有条理,用通俗易懂的语言解释概念"
        },
        "news": {
            "desc": "新闻播报风格,语言正式、节奏明快、客观公正"
        },
        "casual": {
            "desc": "轻松闲聊风格,像和朋友聊天一样自然随意"
        },
        "motivational": {
            "desc": "励志分享风格,充满感染力,激励人心"
        },
        "educational": {
            "desc": "教学讲解风格,循序渐进,由浅入深地讲解"
        }
    }

    style_config = style_configs.get(style, style_configs['storytelling'])

    # 字数范围
    word_min = max(100, word_count - 150)
    word_max = word_count + 150

    # 构造用户提示
    user_prompt = f"""请将以下文本转换为单人播客风格,适合一个人朗读讲述。

## 播客风格
{style_config['desc']}

## 输出要求
1. 开头要有吸引人的开场白,引出话题
2. 将内容重新组织为适合口语讲述的结构
3. 语言要自然流畅,像在和听众对话
4. 适当加入过渡词和连接词
5. 结尾要有总结或引发思考的收尾
6. 【重要】总字数必须控制在 {word_count} 字左右(不少于 {word_min} 字,不超过 {word_max} 字),超出或不足都不可接受
7. 如果原文较长,请提炼核心内容;如果原文较短,请适当展开

## 原始文本
{text}"""

    system_prompt = """你是一位专业的播客内容创作者,擅长将各种文本转换为适合单人讲述的播客风格。

## 播客创作原则
1. **口语化**:使用自然的口语表达,避免书面语
2. **节奏感**:合理安排停顿和节奏变化
3. **情感丰富**:根据内容调整语气和情感
4. **结构清晰**:有明确的开头、展开和结尾
5. **互动感**:适当使用"你"、"我们"等人称,拉近与听众的距离

## 输出格式
直接输出转换后的播客讲述内容,不要加任何标记或标签。"""

    try:
        result = call_llm_direct(user_prompt, system_prompt, config)

        return {
            "success": True,
            "result": result.strip()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")


# ==================== 统一类型 API ====================
@router.get("/genres")
async def get_genres():
    """获取所有可用的语音节目类型"""
    from core.genre_registry import list_genres
    return {"genres": list_genres()}
@router.post("/to-genre")
async def convert_to_genre(
    genre: str = Form(...),
    text: str = Form(...),
    style: str = Form(""),
    num_speakers: int = Form(0),
    word_count: int = Form(500),
):
    """统一类型转换接口"""
    from core.smart_tts import call_llm_direct
    from core.smart_prompt import load_config
    from core.genre_registry import get_genre, build_user_prompt, get_system_prompt, clean_stage_directions

    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    genre_config = get_genre(genre)
    if not genre_config:
        raise HTTPException(status_code=400, detail=f"未知类型: {genre}")

    config = load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先在智能提示配置中设置 API Key")

    # 确定模式和人数
    is_solo = num_speakers <= 1
    if num_speakers <= 0:
        num_speakers = genre_config["default_speakers"]
    num_speakers = max(genre_config["min_speakers"], min(num_speakers, genre_config["max_speakers"]))
    is_solo = num_speakers <= 1

    # 校验模式
    if is_solo and "solo" not in genre_config["modes"]:
        # 类型不支持 solo，强制切到 multi
        num_speakers = genre_config["default_speakers"]
        is_solo = False
    if not is_solo and "multi" not in genre_config["modes"]:
        # 类型不支持 multi，强制切到 solo
        num_speakers = 1
        is_solo = True

    # 获取 prompt
    system_prompt = get_system_prompt(genre, is_solo)
    user_prompt = build_user_prompt(genre, text, style, num_speakers, word_count)

    try:
        result = call_llm_direct(user_prompt, system_prompt, config)
        # 后处理：清理舞台指示
        result = clean_stage_directions(result)

        if is_solo:
            # 单人模式：直接返回文本
            return {
                "success": True,
                "mode": "solo",
                "genre": genre,
                "result": result.strip(),
            }
        else:
            # 多人模式：解析对话格式，映射为 Speaker_N
            speakers = []
            speaker_set = set()
            lines = result.strip().split('\n')
            for line in lines:
                line = line.strip()
                if line.startswith('[') and ']:' in line:
                    speaker_name = line.split(']:')[0].replace('[', '').strip()
                    if speaker_name not in speaker_set:
                        speaker_set.add(speaker_name)
                        speakers.append(speaker_name)

            # 构建角色映射
            role_map = {}
            role_keys = list(genre_config["roles"].keys())
            for i, name in enumerate(speakers[:num_speakers]):
                if i < len(role_keys):
                    role_map[name] = f"Speaker_{i+1}"
                else:
                    role_map[name] = f"Speaker_{i+1}"

            tts_lines = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                if line.startswith('[') and ']:' in line:
                    speaker_name = line.split(']:')[0].replace('[', '').strip()
                    content = line.split(']:', 1)[1].strip() if ']:' in line else ''
                    tts_id = role_map.get(speaker_name, speaker_name)
                    tts_lines.append(f"[{tts_id}]: {content}")
                else:
                    tts_lines.append(line)

            return {
                "success": True,
                "mode": "multi",
                "genre": genre,
                "podcast_text": "\n".join(tts_lines),
                "original_speakers": speakers[:num_speakers],
                "speaker_map": role_map,
                "raw_text": result,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")
@router.post("/voices")
async def save_tts_voice(
    name: str = Form(...),
    instruct: str = Form(""),
    category: str = Form("custom"),
    file: UploadFile = File(...),
):
    """保存音色到音色库(全局共享)"""
    if not name.strip():
        raise HTTPException(status_code=400, detail="音色名称不能为空")

    # 保存音频文件到分类目录
    category_dir = os.path.join(_main.tts_voice_dir(), "audio", category)
    os.makedirs(category_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "voice.wav")[1] or ".wav"
    safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", name.strip())[:60]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{safe_name}_{timestamp}{ext}"
    file_path = os.path.join(category_dir, filename)

    content = await file.read()
    with open(file_path, 'wb') as f:
        f.write(content)

    # 更新索引(存储相对路径)
    index = _main._load_voice_index()
    index[name.strip()] = {
        "file": f"audio/{category}/{filename}",
        "instruct": instruct,
        "category": category,
        "duration": 0,
        "created": timestamp,
        "starred": False,
        "note": "",
    }
    _main._save_voice_index(index)

    return {"success": True, "name": name.strip(), "filename": f"audio/{category}/{filename}"}
@router.post("/voices/import")
async def import_tts_voices(
    source_dir: str = Form(...),
    category: str = Form("genshin"),
):
    """批量导入音色(全局共享)"""
    # 创建分类目录
    category_dir = os.path.join(_main.tts_voice_dir(), "audio", category)
    os.makedirs(category_dir, exist_ok=True)

    if not os.path.exists(source_dir):
        raise HTTPException(status_code=400, detail="源目录不存在")

    index = _main._load_voice_index()
    imported = 0
    skipped = 0
    errors = []

    # 扫描角色文件夹
    for character_name in os.listdir(source_dir):
        character_dir = os.path.join(source_dir, character_name)
        if not os.path.isdir(character_dir):
            continue

        # 获取所有音频文件
        audio_files = [f for f in os.listdir(character_dir) if f.endswith(('.mp3', '.wav', '.ogg', '.flac'))]
        if not audio_files:
            continue

        # 按文件大小排序,选择中间的
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
            continue

        try:
            # 复制音频文件到分类目录
            src_path = os.path.join(character_dir, selected_file)
            ext = os.path.splitext(selected_file)[1]
            safe_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", character_name)[:60]
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest_filename = f"{safe_name}_{timestamp}{ext}"
            dest_path = os.path.join(category_dir, dest_filename)

            shutil.copy2(src_path, dest_path)

            # 更新索引(存储相对路径)
            index[voice_name] = {
                "file": f"audio/{category}/{dest_filename}",
                "instruct": "女,高音调",
                "category": category,
                "created": timestamp,
            }
            imported += 1
        except Exception as e:
            errors.append(f"{character_name}: {str(e)}")

    _main._save_voice_index(index)

    return {
        "success": True,
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:10],  # 只返回前10个错误
    }
@router.post("/voices/import-single")
async def import_single_voice(
    request: Request,
    name: str = Form(...),
    instruct: str = Form(""),
    category: str = Form("custom"),
    audio: UploadFile = File(...),
    avatar: UploadFile = File(None),
    token: str = Query(default=""),
):
    """导入单个音色"""
    if not name.strip():
        raise HTTPException(status_code=400, detail="名称不能为空")
    
    # 创建角色文件夹
    char_dir = os.path.join(_main.CHARACTERS_DIR, name.strip())
    os.makedirs(char_dir, exist_ok=True)
    
    # 保存音频文件
    audio_ext = os.path.splitext(audio.filename)[1] or '.mp3'
    audio_path = os.path.join(char_dir, f'ref_audio{audio_ext}')
    with open(audio_path, 'wb') as f:
        content = await audio.read()
        f.write(content)
    
    # 保存头像（如果有）
    if avatar and avatar.filename:
        avatar_ext = os.path.splitext(avatar.filename)[1] or '.png'
        avatar_path = os.path.join(char_dir, f'avatar{avatar_ext}')
        with open(avatar_path, 'wb') as f:
            content = await avatar.read()
            f.write(content)
    
    # 保存配置文件
    meta = {
        'name': name.strip(),
        'display_name': name.strip(),
        'instruct': instruct,
        'category': category,
        'created': datetime.now().strftime('%Y%m%d')
    }
    meta_path = os.path.join(char_dir, 'meta.json')
    _main.atomic_write_json(meta_path, meta, ensure_ascii=False, indent=2)
    
    return {"success": True, "name": name.strip()}
@router.get("/voices/file/{filename:path}")
async def get_tts_voice_file(filename: str):
    """获取音色音频文件(全局共享)"""
    # 路径安全检查:禁止路径穿越
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="非法路径")
    # filename 现在是 audio/category/file 格式
    file_path = os.path.abspath(os.path.join(_main.tts_voice_dir(), filename))
    voice_dir_abs = os.path.abspath(_main.tts_voice_dir())
    if not file_path.startswith(voice_dir_abs + os.sep) and file_path != voice_dir_abs:
        raise HTTPException(status_code=403, detail="禁止访问目录外文件")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    # 根据扩展名设置 Content-Type
    ext = os.path.splitext(filename)[1].lower()
    content_type_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
    }
    content_type = content_type_map.get(ext, "audio/wav")

    return FileResponse(file_path, media_type=content_type)
@router.delete("/voices/{voice_name}")
async def delete_tts_voice(voice_name: str):
    """删除音色(全局共享)"""
    index = _main._load_voice_index()

    entry = index.pop(voice_name, None)
    if not entry:
        raise HTTPException(status_code=404, detail="音色不存在")

    # 删除音频文件
    file_path = os.path.join(_main.tts_voice_dir(), entry.get("file", ""))
    if os.path.exists(file_path):
        os.remove(file_path)

    _main._save_voice_index(index)
    return {"success": True}
@router.put("/voices/{voice_name}/meta")
async def update_tts_voice_meta(voice_name: str, body: dict):
    """更新音色元数据(星标、备注等)"""
    index = _main._load_voice_index()
    entry = index.get(voice_name)
    if not entry:
        raise HTTPException(status_code=404, detail="音色不存在")

    if "starred" in body:
        entry["starred"] = bool(body["starred"])
    if "note" in body:
        entry["note"] = str(body["note"])

    index[voice_name] = entry
    _main._save_voice_index(index)
    return {"success": True, "voice": entry}


# Whisper ASR 模型缓存
_asr_pipeline = None
@router.post("/asr")
async def tts_asr(
    request: Request,
    token: str = Form(""),
):
    """真正的 ASR:用 Whisper 转写参考音频为文本"""
    form = await request.form()
    audio_file = form.get("audio")
    if not audio_file or not hasattr(audio_file, 'read'):
        raise HTTPException(status_code=400, detail="请上传音频文件")

    content = await audio_file.read()
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="音频文件太小")

    # 保存临时文件
    tmp_path = os.path.join(_main.tts_voice_dir(), f"_asr_{int(time.time())}.wav")
    try:
        with open(tmp_path, 'wb') as f:
            f.write(content)

        # 在 ComfyUI 的 Python 环境中运行 ASR
        _comfy_python = os.path.join(
            os.path.dirname(_main.COMFYUI_ADDRESS.split(":")[0]) if ":" in _main.COMFYUI_ADDRESS else "",
            "..", "..", "..", "python", "python.exe"
        )
        # 尝试用 ComfyUI Python 环境(有 omnivoice)
        # fallback: 用当前环境的 transformers pipeline
        try:
            import soundfile as sf

            # 读取音频
            audio_data, sr = sf.read(tmp_path)
            if len(audio_data.shape) > 1:
                audio_data = audio_data.mean(axis=1)  # 转单声道

            # 重采样到 16kHz(Whisper 要求)
            if sr != 16000:
                import scipy.signal
                audio_data = scipy.signal.resample(audio_data, int(len(audio_data) * 16000 / sr))
                sr = 16000

            # 加载模型并转写
            pipe = _main._get_asr_pipeline()
            result = pipe(audio_data, generate_kwargs={"language": None})
            text = result.get("text", "").strip()

            return {"text": text}
        except Exception as e:
            print(f"[ASR] 转写失败: {e}")
            import traceback
            traceback.print_exc()
            return {"text": "", "note": f"ASR 失败: {e}"}
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except:
            pass
@router.get("/presets")
async def get_tts_presets():
    """获取 TTS 参数预设列表"""
    return {
        "presets": [
            {"id": "fast_preview", "label": "极速预览", "steps": 8, "cfg": 1.5, "speed": 1.2, "denoise": False, "normalize": False, "preprocess": False, "postprocess": False},
            {"id": "balanced", "label": "均衡推荐", "steps": 32, "cfg": 2.0, "speed": 1.0, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "high_quality", "label": "高质量", "steps": 64, "cfg": 2.5, "speed": 1.0, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "clone_focused", "label": "克隆相似度优先", "steps": 40, "cfg": 3.0, "speed": 1.0, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "emotion_focused", "label": "情绪表现优先", "steps": 48, "cfg": 2.8, "speed": 0.95, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "longtext_stable", "label": "长文本稳定", "steps": 32, "cfg": 2.0, "speed": 0.9, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "broadcast", "label": "新闻播报", "steps": 40, "cfg": 2.2, "speed": 1.1, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "storytelling", "label": "有声书", "steps": 48, "cfg": 2.5, "speed": 0.92, "denoise": True, "normalize": False, "preprocess": True, "postprocess": True},
            {"id": "whisper", "label": "耳语", "steps": 40, "cfg": 2.3, "speed": 0.8, "denoise": False, "normalize": False, "preprocess": False, "postprocess": True},
            {"id": "advertising", "label": "广告配音", "steps": 48, "cfg": 2.6, "speed": 1.05, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "meditation", "label": "冥想放松", "steps": 32, "cfg": 2.0, "speed": 0.78, "denoise": True, "normalize": True, "preprocess": True, "postprocess": True},
            {"id": "low_vram", "label": "低显存模式", "steps": 16, "cfg": 1.8, "speed": 1.0, "denoise": False, "normalize": False, "preprocess": False, "postprocess": False},
        ]
    }
@router.get("/modes")
async def get_tts_modes():
    """获取支持的 TTS 模式列表"""
    return {
        "modes": [
            {
                "id": "clone",
                "name": "Voice Clone",
                "description": "短文本声音克隆",
                "needs_ref": True,
            },
            {
                "id": "design",
                "name": "Voice Design",
                "description": "文字设计声音",
                "needs_ref": False,
            },
            {
                "id": "longform",
                "name": "Longform",
                "description": "长文本分块生成",
                "needs_ref": True,
            },
            {
                "id": "multi",
                "name": "Multi-Speaker",
                "description": "多人对话",
                "needs_ref": True,
                "multi_speaker": True,
            },
        ]
    }
@router.post("/generate")
async def tts_generate(request: Request, token: str = Query(default="")):
    """TTS 生成接口"""
    # 优先从 URL 参数获取 token,其次从 Form 字段
    if not token:
        try:
            form = await request.form()
            token = form.get("token", "")
        except:
            pass
    _main.require_valid_token(token)
    try:
        return await _main._tts_generate_inner(request, token)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[TTS] 生成异常: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
