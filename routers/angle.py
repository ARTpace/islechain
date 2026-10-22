"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/angle
"""
from fastapi import HTTPException
import asyncio, httpx, os, time
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/angle/poll_status")
async def poll_angle_cloud(req: _main.CloudPollRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = _main.sanitize_api_key((req.api_key or _main.MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    task_id = req.task_id
    print(f"Resuming polling for Angle Task: {task_id}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    file_path = os.path.join(_main.OUTPUT_DIR, filename)
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = f"/output/{filename}"
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time() * 1000, "prompt": f"Resumed {task_id}", "images": [local_path], "type": "angle", "user": _main.get_username_by_token("")}
                        _main.save_to_history(record)
                        if req.client_id:
                            await _main.manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        return {"url": local_path}

                    elif status == "FAILED":
                        if req.client_id:
                            await _main.manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise Exception(f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await _main.manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    print(f"Angle polling error: {loop_e}")
                    continue

            if req.client_id:
                await _main.manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except Exception as e:
        print(f"Angle polling error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/api/angle/generate")
async def generate_angle_cloud(req: _main.CloudGenRequest, token: str = ""):
    if token:
        _main.require_valid_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    username = _main.get_username_by_token(token)
    clean_token = _main.sanitize_api_key((req.api_key or _main.MODELSCOPE_API_KEY).strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": "Qwen/Qwen-Image-Edit-2511",
        "prompt": req.prompt.strip(),
        "image_url": req.image_urls
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(f"{base_url}v1/images/generations", headers=headers, json=payload)
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"Angle Task submitted, ID: {task_id}")

            for i in range(300):
                await asyncio.sleep(0.5)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
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
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time() * 1000, "prompt": req.prompt, "images": [local_path], "type": "angle", "user": username}
                        _main.save_to_history(record)
                        if req.client_id:
                            await _main.manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        if _main.GLOBAL_LOOP:
                            asyncio.run_coroutine_threadsafe(_main.manager.broadcast_new_image(record), _main.GLOBAL_LOOP)
                        return {"url": local_path, "task_id": task_id}

                    elif status == "FAILED":
                        if req.client_id:
                            await _main.manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise Exception(f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await _main.manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    print(f"Angle polling error: {loop_e}")
                    continue

            if req.client_id:
                await _main.manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            return {"status": "timeout", "task_id": task_id, "message": "Task still pending"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Angle generation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
