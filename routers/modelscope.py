"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /generate
"""
from fastapi import HTTPException
import asyncio, httpx, os, time
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/generate")
async def generate_cloud(req: _main.CloudGenRequest, token: str = ""):
    username = _main.require_valid_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = _main.sanitize_api_key((req.api_key or _main.MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": req.prompt.strip(),
        "size": req.resolution,
        "n": 1
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers={**headers, "X-ModelScope-Async-Mode": "true"},
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"Z-Image Task submitted, ID: {task_id}")

            for i in range(200):
                await asyncio.sleep(0.8)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if i % 5 == 0:
                        print(f"Task {task_id} status check {i}: {status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_{int(time.time())}.png"
                                    if username:
                                        user_dir, _ = _main.get_user_output_dir(username)
                                        file_path = os.path.join(user_dir, filename)
                                        local_path = _main.build_output_url(None, filename, username)
                                    else:
                                        file_path = os.path.join(_main.OUTPUT_DIR, filename)
                                        local_path = f"/output/{filename}"
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                else:
                                    local_path = img_url
                        except Exception as dl_e:
                            print(f"Download error: {dl_e}")
                            local_path = img_url

                        record = {"timestamp": time.time() * 1000, "prompt": req.prompt, "images": [local_path], "type": "cloud", "user": username}
                        _main.save_to_history(record)
                        try:
                            await _main.manager.broadcast_new_image(record)
                        except Exception:
                            pass
                        return {"url": local_path}

                    elif status == "FAILED":
                        raise Exception(f"ModelScope task failed: {data}")

                except Exception as loop_e:
                    print(f"Polling error (retrying): {loop_e}")
                    continue

            raise Exception("Cloud generation timeout")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Cloud generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
