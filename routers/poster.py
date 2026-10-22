"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/poster
"""
from fastapi import Request
import asyncio, httpx, json, os, time
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/poster/layouts")
async def get_poster_layouts():
    return {"layouts": _main._load_poster_layouts()}


@router.get("/api/poster/styles")
async def get_poster_styles():
    return {"styles": _main._load_poster_styles()}


@router.post("/api/poster/generate")
async def poster_generate(req: Request, token: str = ""):
    """生成海报"""
    _main.require_valid_token(token)
    try:
        body = await req.json()
        prompt = body.get('prompt', '')
        width = body.get('width', 1024)
        height = body.get('height', 1536)
        steps = body.get('steps', 4)
        mode = body.get('mode', 'turbo')
        count = body.get('count', 2)
        style_prompt = body.get('style_prompt', '')

        if not prompt:
            return {"error": "提示词不能为空"}

        # 合并风格提示词
        full_prompt = prompt
        if style_prompt:
            full_prompt = f"{prompt}, {style_prompt}"

        # 选择工作流
        workflow_name = "text2image/boogu-turbo.json" if mode == 'turbo' else "text2image/boogu-base.json"
        workflow_path = os.path.join(_main.WORKFLOW_DIR, workflow_name)
        if not os.path.exists(workflow_path):
            return {"error": f"工作流 {workflow_name} 不存在"}

        with open(workflow_path, 'r', encoding='utf-8') as f:
            base_workflow = json.load(f)

        generated_images = []

        for i in range(count):
            workflow = json.loads(json.dumps(base_workflow))
            seed = int.from_bytes(os.urandom(6), 'big') % (2**32)

            # 设置参数
            workflow['11']['inputs']['text'] = full_prompt
            workflow['8']['inputs']['width'] = width
            workflow['8']['inputs']['height'] = height
            workflow['32']['inputs']['noise_seed'] = seed if 'noise_seed' in workflow.get('32', {}).get('inputs', {}) else workflow.get('32', {}).get('inputs', {}).get('seed', seed)
            if 'seed' in workflow.get('32', {}).get('inputs', {}):
                workflow['32']['inputs']['seed'] = seed
            workflow['34']['inputs']['filename_prefix'] = f"poster_{int(time.time())}_{i}"

            # 步数覆盖
            if '32' in workflow and 'steps' in workflow['32'].get('inputs', {}):
                workflow['32']['inputs']['steps'] = steps
            if '26' in workflow and 'steps' in workflow['26'].get('inputs', {}):
                workflow['26']['inputs']['steps'] = steps

            # 提交到 ComfyUI
            target = _main.COMFYUI_ADDRESS
            if not target:
                return {"error": "未配置 ComfyUI 地址"}

            prompt_payload = {"prompt": workflow, "client_id": f"poster_{token[:8] if token else 'anon'}"}
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(f"http://{target}/prompt", json=prompt_payload)
                if resp.status_code != 200:
                    return {"error": f"提交失败: {resp.text[:200]}"}
                pid = resp.json().get('prompt_id')

            # 等待完成
            for _ in range(180):
                await asyncio.sleep(0.5)
                try:
                    async with httpx.AsyncClient(timeout=5) as client:
                        hr = await client.get(f"http://{target}/history/{pid}")
                        if hr.status_code == 200:
                            h = hr.json()
                            if pid in h and h[pid].get('status', {}).get('completed'):
                                outputs = h[pid].get('outputs', {})
                                for nid, out in outputs.items():
                                    if 'images' in out:
                                        for img in out['images']:
                                            fn = img['filename']
                                            generated_images.append({
                                                'filename': fn,
                                                'url': f'/api/view?filename={fn}&type=output'
                                            })
                                break
                except Exception:
                    pass

        return {"images": generated_images}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
