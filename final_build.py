#!/usr/bin/env python3
"""
最终合并脚本 - 将扩充数据合并到原始结构，生成带子分类和中文名的YAML/JSON
"""
import json, yaml

EXPANDED_JSON = "H:/AI-Tools/data/prompt-presets.json"  # 69K扩充
ORIGINAL_JSON = "H:/AI-Tools/art-canvas/data/prompt-presets.json"  # 21K原始
YAML_OUT = "H:/AI-Tools/art-canvas/data/prompt-presets.yaml"
JSON_OUT = "H:/AI-Tools/art-canvas/data/prompt-presets.json"

CAT_NAMES = {
    'quality': '质量词', 'style': '画风', 'character': '角色特征', 'clothing': '服装',
    'pose': '姿势动作', 'scene': '场景背景', 'lighting': '光影', 'composition': '构图',
    'effects': '特效', 'negative': '负向提示词'
}
SUBCAT_NAMES = {
    'quality': '基础质量', 'rating': '评分标签', 'detail': '细节增强', 'common': '常用标签',
    'anime': '动漫风格', 'realistic': '写实风格', 'traditional': '传统艺术', 'digital': '数字艺术',
    'special': '特殊风格', 'artist_style': '知名画风', 'imported': '导入风格',
    'hair_length': '发长', 'hair_style': '发型', 'hair_color': '发色',
    'eyes': '眼睛颜色', 'expression': '表情', 'body': '身体特征', 'emotional_states': '情感状态',
    'casual': '日常服装', 'school': '校服', 'formal': '正装', 'traditional': '传统服装',
    'uniform': '制服', 'swimwear': '泳装', 'fantasy': '幻想服装', 'lingerie': '内衣',
    'accessories': '配饰',
    'basic': '基础姿势', 'dynamic': '动态姿势', 'hand': '手部动作', 'actions': '动作',
    'indoor': '室内场景', 'outdoor': '室外场景', 'nature': '自然元素',
    'backgrounds': '背景', 'types': '场景类型',
    'natural': '自然光', 'effect': '光影效果', 'mood': '氛围光',
    'shot': '景别', 'angle': '角度',
    'weather': '天气效果', 'particles': '粒子效果', 'lens': '镜头效果', 'visual': '视觉效果',
    'anatomy': '人体问题', 'face': '面部问题', 'other': '其他问题'
}
CONTEXT_SUBCAT = {
    ('pose', 'styles'): '姿势风格', ('lighting', 'styles'): '光影风格',
    ('effects', 'styles'): '特效风格', ('clothing', 'styles'): '服装风格',
}

# 扩充分类 -> (目标主分类, 目标子分类)
EXPANDED_MAP = {
    'Hair Styles': ('character', 'hair_style'),
    'Hair Colors': ('character', 'hair_color'),
    'Eye Colors': ('character', 'eyes'),
    'Expressions': ('character', 'expression'),
    'Body Types': ('character', 'body'),
    'Emotional States': ('character', 'emotional_states'),
    'Clothing': ('clothing', 'casual'),
    'Clothing Styles': ('clothing', 'styles'),
    'Accessories': ('clothing', 'accessories'),
    'Poses': ('pose', 'basic'),
    'Actions': ('pose', 'actions'),
    'Backgrounds': ('scene', 'backgrounds'),
    'Scene Types': ('scene', 'types'),
    'Lighting': ('lighting', 'natural'),
    'Effects': ('effects', 'visual'),
    'Quality': ('quality', 'common'),
    # 重复的合并到对应位置
    'Character': ('character', 'expression'),  # 合并到表情
    'Pose': ('pose', 'dynamic'),
    'Scene': ('scene', 'outdoor'),
}

def get_subcat_name(cat, sub):
    return CONTEXT_SUBCAT.get((cat, sub), SUBCAT_NAMES.get(sub, sub.replace("_", " ")))

def main():
    # 加载
    with open(EXPANDED_JSON, 'r', encoding='utf-8') as f:
        expanded = json.load(f)
    with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
        original = json.load(f)

    # 1. 从原始数据构建基础结构 (presets dict: cat -> sub -> {key: prompt})
    presets = {}
    for cat in original.get('categories', []):
        cid = cat['id']
        if cid not in presets:
            presets[cid] = {}
        for sub in cat.get('subcategories', []):
            sid = sub['id']
            if sid not in presets[cid]:
                presets[cid][sid] = {}
            for p in sub.get('presets', []):
                presets[cid][sid][p['id']] = p.get('positive', p.get('prompt', ''))

    # 2. 合并扩充数据
    merged_count = 0
    for cat in expanded.get('categories', []):
        cname = cat['name']
        if cname not in EXPANDED_MAP:
            continue
        dst_cat, dst_sub = EXPANDED_MAP[cname]
        if dst_cat not in presets:
            presets[dst_cat] = {}
        if dst_sub not in presets[dst_cat]:
            presets[dst_cat][dst_sub] = {}
        for p in cat.get('presets', []):
            pid = p['id']
            prompt = p.get('positive', p.get('prompt', ''))
            if pid not in presets[dst_cat][dst_sub]:
                presets[dst_cat][dst_sub][pid] = prompt
                merged_count += 1

    print(f'合并了 {merged_count} 个新预设')

    # 3. 生成YAML
    with open(YAML_OUT, 'w', encoding='utf-8') as f:
        yaml.dump(presets, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    # 4. 生成JSON (带中文名)
    categories = []
    total = 0
    for cat_key, subs in presets.items():
        cat_obj = {"id": cat_key, "name": CAT_NAMES.get(cat_key, cat_key),
                   "subcategories": []}
        for sub_key, items in subs.items():
            sub_obj = {"id": sub_key, "name": get_subcat_name(cat_key, sub_key),
                       "presets": []}
            for pk, pv in items.items():
                sub_obj["presets"].append({
                    "id": pk, "name": pk.replace("_", " ").title(),
                    "positive": pv, "prompt": pv, "negative": ""
                })
                total += 1
            if sub_obj["presets"]:
                cat_obj["subcategories"].append(sub_obj)
        if cat_obj["subcategories"]:
            categories.append(cat_obj)

    with open(JSON_OUT, 'w', encoding='utf-8') as f:
        json.dump({"categories": categories}, f, ensure_ascii=False, indent=2)

    # 5. 统计
    print("\n=== 最终预设结构 ===")
    grand = 0
    for cat in categories:
        cat_n = sum(len(s["presets"]) for s in cat["subcategories"])
        grand += cat_n
        subs_str = ", ".join(f'{s["name"]}({len(s["presets"])})' for s in cat["subcategories"])
        print(f'  {cat["name"]}: {cat_n} 个预设')
        print(f'    [{subs_str}]')
    print(f'\n  总计: {grand} 个预设, {len(categories)} 个分类')

if __name__ == "__main__":
    main()