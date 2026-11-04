"""Host-managed LAN module visibility, separate from each browser's menu preference."""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from .user_paths import user_data_dir

MODULES = frozenset(('chat-gen','training','generation-dashboard','canvas','asset-manager',
    'zimage','klein','angle','cgstyle','2dstyle','watermark-removal','rmbg','gaoqingxiufu',
    'kuotu','promptgen','textmatting','yichuwuti','poster','tts','litevideo','threeview'))
COMFY_MODULES = MODULES - {'training','generation-dashboard','canvas','asset-manager'}
router = APIRouter()


def policy_path():
    return Path(user_data_dir()) / 'feature-access.json'


def guest_disabled():
    try:
        data = json.loads(policy_path().read_text(encoding='utf-8'))
        disabled = data.get('guest_disabled', [])
        if not isinstance(disabled, list):
            return set(MODULES)
        return {item for item in disabled if isinstance(item, str) and item in MODULES} | {'training'}
    except FileNotFoundError:
        return {'training'}
    except (OSError, ValueError, TypeError, AttributeError):
        # A corrupt policy must not silently reopen restricted modules.
        return set(MODULES)


@router.get('/api/feature-access')
async def get_feature_access(request: Request):
    from .lan_sharing import _is_local
    return {'visitor': not _is_local(request), 'guest_disabled': sorted(guest_disabled())}


@router.post('/api/feature-access')
async def set_feature_access(request: Request):
    from .lan_sharing import _is_local
    import main
    if not _is_local(request):
        raise HTTPException(403, '访客权限只能在主机本地修改')
    main.ensure_same_origin_request(request)
    data = await request.json()
    disabled = data.get('guest_disabled') if isinstance(data, dict) else None
    if not isinstance(disabled, list) or any(not isinstance(item, str) or item not in MODULES for item in disabled):
        raise HTTPException(400, '功能模块设置无效')
    main.atomic_write_json(str(policy_path()), {'guest_disabled': sorted(set(disabled) | {'training'})}, ensure_ascii=False, indent=2)
    return {'visitor': False, 'guest_disabled': sorted(guest_disabled())}


async def required_modules(request):
    """Alternatives for shared execution APIs; distinct pages keep distinct switches."""
    path = request.url.path
    if path == '/api/game-projects' or path.startswith('/api/game-projects/'):
        return {'canvas'}
    if path == '/static/app/zimage.html':
        return {'chat-gen' if request.query_params.get('chat') == '1' else 'zimage'}
    if path.startswith('/static/app/') and path.endswith('.html'):
        module = Path(path).stem
        return {module} if module in MODULES else set()
    pages = {'/static/canvas.html':'canvas', '/static/asset-manager.html':'asset-manager'}
    if path == '/api/image-cutout/workflow':
        try:
            body = await request.json()
        except ValueError:
            return {'rmbg', 'textmatting', 'canvas'}
        if not isinstance(body, dict):
            return {'rmbg', 'textmatting', 'canvas'}
        return {'textmatting'} if body.get('branch') == 'textmatting' else {'rmbg', 'canvas'}
    if path == '/api/image-cutout' or path.startswith('/api/image-cutout/'):
        return {'rmbg'}
    if path in pages:
        return {pages[path]}
    for prefix, module in (('/api/generation-data','generation-dashboard'),('/api/training','training'),
                           ('/api/canvases','canvas'),('/api/canvas-workflows','canvas'),
                           ('/api/asset-library','asset-manager'),('/api/local-assets','asset-manager'),
                           ('/api/tts','tts'),('/api/poster','poster'),('/api/angle','angle')):
        if path == prefix or path.startswith(prefix + '/'):
            return {module}
    if path in {'/api/online-video','/api/canvas-video'}:
        return {'litevideo','canvas'}
    if path in {'/api/online-image','/api/canvas-image-tasks','/generate','/api/ms/generate','/api/ideogram4/generate-json'}:
        return {'chat-gen','zimage','canvas'}
    if path in {'/api/canvas-llm','/api/chat','/api/chat/stream'}:
        return {'chat-gen','canvas'}
    if path in {'/api/generate','/api/canvas-comfy-tasks'} and request.method == 'POST':
        try:
            payload = await request.json()
        except ValueError:
            return set(COMFY_MODULES) | {'canvas'}
        kind = payload.get('type') if isinstance(payload, dict) else None
        if kind == 'video':
            kind = 'litevideo'
        if kind in MODULES and kind != 'zimage':
            return {kind,'canvas'}
        return {'zimage','chat-gen','canvas'}
    if path == '/api/comfyui/prompt':
        return set(COMFY_MODULES) | {'canvas'}
    return set()
