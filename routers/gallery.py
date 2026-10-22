"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/gallery
"""
import os, time
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/gallery/purge-orphans")
async def purge_orphan_records(token: str = "", dry_run: bool = False):
    """
    扫描 history.json,找出 images[] 指向不存在的孤儿记录:
      - 所有图片都缺失 → 整条删除
      - 部分图片缺失 → 修剪 images[],仅保留仍存在的图片
    仅管理员可调用。dry_run=True 时只统计不写盘。
    """
    is_admin = _main.is_admin_by_token(token)
    if not is_admin:
        return {"success": False, "message": "需要管理员权限"}

    if not os.path.exists(_main.HISTORY_FILE):
        return {"success": True, "removed": 0, "trimmed": 0, "scanned": 0}

    try:
        with _main.HISTORY_LOCK:
            data = _main._load_history_cached()
            data = [dict(item) for item in data]  # 拷贝,避免污染缓存

            removed_records = []   # 整条删除
            trimmed_records = []   # 修剪 images[]
            scanned = 0

            new_history = []
            for item in data:
                images = item.get("images") or []
                if not images:
                    new_history.append(item)
                    continue
                scanned += 1
                kept_imgs = []
                missing = []
                for img in images:
                    p = _main._url_to_output_path(img) if isinstance(img, str) else None
                    if p and os.path.isfile(p):
                        kept_imgs.append(img)
                    else:
                        missing.append(img)
                if not kept_imgs:
                    # 所有图片都缺失 → 整条删除
                    removed_records.append({
                        "timestamp": item.get("timestamp"),
                        "user": item.get("user"),
                        "model": item.get("model"),
                        "missing": missing,
                    })
                    # 不加入 new_history
                elif missing:
                    # 部分缺失 → 修剪
                    new_history.append({**item, "images": kept_imgs})
                    trimmed_records.append({
                        "timestamp": item.get("timestamp"),
                        "user": item.get("user"),
                        "kept": len(kept_imgs),
                        "missing": missing,
                    })
                else:
                    new_history.append(item)

            if not dry_run and (removed_records or trimmed_records):
                _main.atomic_write_json(_main.HISTORY_FILE, new_history, ensure_ascii=False, indent=4)
                _main._invalidate_history_cache()

        return {
            "success": True,
            "dry_run": dry_run,
            "scanned": scanned,
            "removed": len(removed_records),
            "trimmed": len(trimmed_records),
            "removed_records": removed_records[:20],   # 最多返回 20 条详情
            "trimmed_records": trimmed_records[:20],
        }
    except Exception as e:
        print(f"Purge orphans error: {e}")
        return {"success": False, "message": str(e)}


@router.get("/api/gallery/scan-new")
async def scan_new_images(type: str = "", token: str = ""):
    """扫描用户 output 文件夹,找出还没入库的图片,自动创建历史记录"""
    username = _main.get_username_by_token(token)
    if not username:
        return {"success": False, "message": "未登录"}

    user_dirname = _main.get_user_dirname(username)
    user_output = os.path.join(_main.OUTPUT_DIR, user_dirname)
    if not os.path.isdir(user_output):
        return {"success": True, "imported": 0}

    # 收集已入库的图片 URL
    existing_images = set()
    with _main.HISTORY_LOCK:
        try:
            data = _main._load_history_cached()
            for item in data:
                for img in (item.get("images") or []):
                    existing_images.add(img)
        except: pass

    IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}

    def extract_prompt_from_png(fpath):
        """从 ComfyUI PNG 元数据提取正面 prompt + genParams,直接匹配工具参数"""
        import struct as _struct, json as _json
        def _read_workflow(fpath):
            with open(fpath, 'rb') as f:
                data = f.read(1024 * 1024)
            idx = data.find(b'prompt')
            if idx < 0: return None
            chunk_start = idx - 8
            if chunk_start < 0: return None
            length = _struct.unpack('>I', data[chunk_start:chunk_start+4])[0]
            chunk_data = data[chunk_start+8:chunk_start+8+length]
            marker = b'prompt\x00'
            pidx = chunk_data.find(marker)
            if pidx < 0: return None
            raw = chunk_data[pidx+len(marker):].decode('utf-8', errors='ignore').rstrip('\x00').strip()
            return _json.loads(raw)

        def _resolve(node_id, wf, depth=0):
            """追踪引用链拿到文本"""
            if depth > 8: return ''
            nid = str(node_id)
            node = wf.get(nid)
            if not isinstance(node, dict): return ''
            inputs = node.get('inputs', {})
            ct = node.get('class_type', '')
            # CLIPTextEncode → text
            if ct.startswith('CLIPTextEncode'):
                t = inputs.get('text', '')
                if isinstance(t, str) and t.strip(): return t.strip()
                if isinstance(t, list) and len(t) == 2: return _resolve(t[0], wf, depth+1)
                return ''
            # 自定义节点 → 常见文本字段
            for k in ('character_tags', 'text', 'prompt', 'opt_prompt'):
                v = inputs.get(k, '')
                if isinstance(v, str) and v.strip(): return v.strip()
            # 递归引用
            for v in inputs.values():
                if isinstance(v, list) and len(v) == 2:
                    r = _resolve(v[0], wf, depth+1)
                    if r: return r
            return ''

        try:
            wf = _read_workflow(fpath)
            if not wf: return '', {}

            prompt_text = ''
            seed = None
            width = height = None
            batch = 1
            loras = []
            is_anima = False

            for nid, node in wf.items():
                if not isinstance(node, dict): continue
                ct = node.get('class_type', '')
                inp = node.get('inputs', {})

                # 识别工作流类型
                if ct == 'AnimaCharacterTagSelector':
                    is_anima = True

                # 采样器 → seed + positive prompt
                if ct in ('KSampler', 'KSamplerAdvanced') and 'positive' in inp:
                    ref = inp['positive']
                    if isinstance(ref, list) and len(ref) == 2:
                        prompt_text = _resolve(ref[0], wf)
                    seed = inp.get('seed') or inp.get('noise_seed')

                # CFGGuider → positive prompt
                elif ct == 'CFGGuider' and 'positive' in inp:
                    ref = inp['positive']
                    if isinstance(ref, list) and len(ref) == 2:
                        prompt_text = _resolve(ref[0], wf)

                # RandomNoise → seed
                elif ct == 'RandomNoise':
                    seed = inp.get('noise_seed')

                # Latent → 尺寸 + batch
                elif ct in ('EmptyLatentImage',) or 'EmptyFlux' in ct:
                    width = inp.get('width')
                    height = inp.get('height')
                    bs = inp.get('batch_size')
                    if isinstance(bs, int) and bs > 0: batch = bs

                # LoRA
                elif 'LoraLoader' in ct:
                    name = inp.get('lora_name', '')
                    strength = float(inp.get('strength_model', 1.0))
                    if name:
                        loras.append({'name': name, 'strength': strength})

            # 从尺寸推算 ratio + resolution
            ratio_w, ratio_h, resolution = 9, 16, 1
            if width and height:
                from math import gcd
                g = gcd(width, height)
                rw, rh = width // g, height // g
                # 标准化到常见比例
                _known = {(1,1),(4,3),(3,4),(16,9),(9,16),(3,2),(2,3)}
                if (rw, rh) not in _known:
                    rw, rh = min(_known, key=lambda k: abs(k[0]/k[1] - rw/rh))
                ratio_w, ratio_h = rw, rh
                resolution = 2 if max(width, height) > 1200 else 1

            gen_params = {
                'workflow': 'text2image/anima.json' if is_anima else 'text2image/z-image.json',
                'ratioW': ratio_w, 'ratioH': ratio_h,
                'resolution': resolution,
                'batchCount': batch,
                'loras': loras,
            }
            if seed is not None: gen_params['seed'] = seed
            if width: gen_params['width'] = width
            if height: gen_params['height'] = height

            return prompt_text, gen_params
        except:
            return '', {}

    new_records = []

    # 遍历 output/{user}/{feature}/{date}/ 目录
    for feature_dir in os.listdir(user_output):
        feature_path = os.path.join(user_output, feature_dir)
        if not os.path.isdir(feature_path):
            continue
        # 按 type 过滤
        if type:
            types = [t.strip() for t in type.split(',')]
            if feature_dir not in types:
                continue
        for date_dir in os.listdir(feature_path):
            date_path = os.path.join(feature_path, date_dir)
            if not os.path.isdir(date_path):
                continue
            for fname in os.listdir(date_path):
                ext = os.path.splitext(fname)[1].lower()
                if ext not in IMAGE_EXTS:
                    continue
                img_url = f"/output/{user_dirname}/{feature_dir}/{date_dir}/{fname}"
                if img_url in existing_images:
                    continue
                # 新图片:创建记录
                fpath = os.path.join(date_path, fname)
                try:
                    mtime = os.path.getmtime(fpath)
                except:
                    mtime = time.time()
                # 尝试从 PNG 元数据提取 prompt 和参数
                prompt_text = ''
                gen_params = {}
                if ext == '.png':
                    prompt_text, gen_params = extract_prompt_from_png(fpath)
                record = {
                    "prompt": prompt_text or f"[自动导入] {feature_dir}",
                    "images": [img_url],
                    "type": feature_dir,
                    "timestamp": mtime * 1000,
                    "user": username,
                    "model": feature_dir.upper(),
                    "auto_imported": True
                }
                if gen_params:
                    record['genParams'] = gen_params
                new_records.append(record)
                existing_images.add(img_url)

    # 批量写入新记录
    updated_old = 0
    with _main.HISTORY_LOCK:
        try:
            data = _main._load_history_cached()
            data = list(data)
        except:
            data = []
        # 更新旧的自动导入记录(prompt 还是 [自动导入] 的)
        for item in data:
            if not item.get('auto_imported'):
                continue
            if not item.get('prompt', '').startswith('[自动导入]'):
                continue
            images = item.get('images', [])
            if not images:
                continue
            img_url = images[0]
            if not img_url.startswith('/output/'):
                continue
            fpath = _main._url_to_output_path(img_url)
            if not fpath or not os.path.isfile(fpath):
                continue
            ext = os.path.splitext(fpath)[1].lower()
            if ext != '.png':
                continue
            prompt_text, gen_params = extract_prompt_from_png(fpath)
            if prompt_text:
                item['prompt'] = prompt_text
                updated_old += 1
            if gen_params:
                item['genParams'] = gen_params
        for rec in new_records:
            data.insert(0, rec)
        data.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        _main.atomic_write_json(_main.HISTORY_FILE, data[:5000], ensure_ascii=False, indent=4)
        _main._invalidate_history_cache()

    return {"success": True, "imported": len(new_records), "updated": updated_old}
