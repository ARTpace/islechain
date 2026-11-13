"""画布 AI 工具：一张参考图 + 一句话 → Unity 地表生成。

AI 负责从图片/描述里推断轮廓、色档和高度，本模块只做参数校验与执行：
regions → uloop_wizard.build_code() → uloop_cli.run() → 返回中文结果给 Agent。
不在这里二次调用模型，避免多一次幻觉和延迟。
"""
from __future__ import annotations

from core import uloop_cli


def generate(arguments: dict) -> dict:
    instruction = str(arguments.get('instruction') or '').strip()[:500]
    raw = arguments.get('regions')
    if not isinstance(raw, list) or not raw:
        return {'ok': False, 'error': 'regions 为空：请根据参考图推断至少一个封闭轮廓（每个至少 3 个 XZ 点）。'}
    if len(raw) > 12:
        return {'ok': False, 'error': '一次最多 12 个图层。'}
    values = {
        'mode': 'generate',
        'regions': raw,
        'reference': str(arguments.get('reference') or '')[:300],
        'root_name': str(arguments.get('root_name') or '')[:120],
        'output_folder': str(arguments.get('output_folder') or '')[:300],
        'save_scene': bool(arguments.get('save_scene')),
        'project': '', 'cli': '', 'timeout': 600,
    }
    try:
        text = uloop_cli.run(values, None, None)
    except Exception as exc:  # uloop / Unity / 编译错误都要回给 Agent，让它能自行修正
        return {'ok': False, 'instruction': instruction, 'error': str(exc)[:1200],
                'hint': '检查 Unity 编辑器是否打开、场景是否已保存；按上方错误修正后重试。'}
    ok = '预检通过，自动正式生成' in text and '预检未通过' not in text
    return {'ok': ok, 'instruction': instruction, 'layers': len(raw),
            'output': text[:12000],
            'hint': '' if ok else '未生成成功：请阅读 output 里的 Error，修正 regions 后重试。'}
