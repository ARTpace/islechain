#!/usr/bin/env python3
"""生图链路冒烟测试（P0 迁移收尾 + 断循环导入后的回归安全网）。

覆盖两层：
- 纯本地用例（默认运行）：auth 注册/登录/me/失败路径、画布列表、config、
  comfyui 实例。全部经 TestClient 打 HTTP 层；users/canvases/output/history
  通过 monkeypatch 隔离到 tmp_path，不进入 lifespan（避免触发真实资产库
  迁移），不碰真实数据。
- 集成用例（@pytest.mark.integration，默认 skip）：ComfyUI(8188) 可达时
  跑真实生图（text2image/z-image.json，512x512），校验返回图片 URL、
  落盘文件与 PNG magic bytes；不可达则 skip。

隔离注意：
- 取 router 模块必须用 importlib.import_module("routers.auth")。
  不能用 `import routers.auth as m`——routers/__init__.py 的 PEP 562 惰性
  导出会把包属性固化成 APIRouter 对象，patch 会打到错误对象上（2026-10-22
  实测踩坑：冒烟测试曾因此误写真实 users.json）。
- TestClient 是 httpx.Client 子类，默认 5s 超时；生图需显式调大。

运行：
    pytest tests/test_generate_smoke.py -v               # 只跑纯本地
    pytest tests/test_generate_smoke.py -m integration   # 追加真实生图
"""

import importlib
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def _import_main():
    """导入 main 模块（幂等；复用 sys.modules 中已加载实例）。"""
    import sys

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    return importlib.import_module("main")


def _import_router_module(name: str):
    """按名字导入 routers 子模块（拿真模块，而非包属性上的 APIRouter）。"""
    _import_main()  # 确保 routers 包可被正常导入
    return importlib.import_module(f"routers.{name}")


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    """隔离后的 TestClient：所有写盘路径指向 tmp_path。"""
    main = _import_main()
    auth_mod = _import_router_module("auth")

    users_file = tmp_path / "users.json"
    users_file.write_text("{}", encoding="utf-8")
    # auth 路由已委托 main 的用户存储（2026-10-22 统一缓存），patch main 即可；
    # load_users 按路径失效，跨测试的 tmp_path 各不相同，无缓存串味
    monkeypatch.setattr(main, "USERS_FILE", str(users_file))
    monkeypatch.setattr(main, "HISTORY_FILE", str(tmp_path / "history.json"))
    monkeypatch.setattr(main, "OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setattr(main, "CANVAS_DIR", str(tmp_path / "canvases"))

    client = TestClient(main.app)
    client.timeout = httpx.Timeout(600.0)  # 生图链路可达数分钟
    yield client
    client.close()


def _register(client, username="smoke_user", password="smoke_pass_123"):
    r = client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )
    assert r.status_code == 200, f"注册失败: {r.status_code} {r.text}"
    return r.json()["token"]


# ─── 纯本地用例（默认运行）────────────────────────────────────────────


def test_auth_full_flow(app_env):
    """注册 → me → 登录轮换 token → 旧 token 失效（P0 行为契约）。"""
    token = _register(app_env)

    r = app_env.get("/api/auth/me", params={"token": token})
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "smoke_user"

    r = app_env.post(
        "/api/auth/login",
        json={"username": "smoke_user", "password": "smoke_pass_123"},
    )
    assert r.status_code == 200, r.text
    new_token = r.json()["token"]
    assert new_token != token, "登录未轮换 token"

    r = app_env.get("/api/auth/me", params={"token": token})
    assert r.status_code == 401, "旧 token 应已失效"
    r = app_env.get("/api/auth/me", params={"token": new_token})
    assert r.status_code == 200


def test_auth_failure_paths(app_env):
    """失败路径：空/假 token、重复注册、错误密码、不存在用户。"""
    assert app_env.get("/api/auth/me").status_code == 401
    assert app_env.get("/api/auth/me", params={"token": ""}).status_code == 401
    assert app_env.get("/api/auth/me", params={"token": "no-such-token"}).status_code == 401

    _register(app_env, "dup_user")
    r = app_env.post(
        "/api/auth/register", json={"username": "dup_user", "password": "whatever123"}
    )
    assert r.status_code == 400

    r = app_env.post(
        "/api/auth/login", json={"username": "dup_user", "password": "wrong_pass"}
    )
    assert r.status_code == 400

    r = app_env.post(
        "/api/auth/login", json={"username": "ghost_user", "password": "whatever123"}
    )
    assert r.status_code == 400


def test_canvases_list(app_env):
    """画布列表路由回归：storage_file_path 幽灵键修复前此端点必然 500。"""
    token = _register(app_env, "canvas_user")
    r = app_env.get("/api/canvases", params={"token": token})
    assert r.status_code == 200, r.text
    # 隔离环境应为空列表，且不得泄漏真实画布
    assert r.json()["canvases"] == []


def test_config_router(app_env):
    """config router 存活回归：幽灵导入清理前曾整包导入失败。"""
    r = app_env.get("/api/config")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "chat_models" in body and "image_models" in body


def test_comfyui_instances_router(app_env):
    """comfyui router 存活回归：ComfyUIInstancesUpdateRequest 缺失导入修复项。"""
    r = app_env.get("/api/comfyui/instances")
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["instances"], list)


# ─── 取消机制多槽化 + history 写路径（P1-2，2026-10-22）──────────────

import types


@pytest.fixture()
def comfy_registry():
    """隔离 _ACTIVE_COMFY_TASKS / _HISTORY_CACHE 全局登记表，测后恢复原状。

    _HISTORY_CACHE 按路径失效（与 _USERS_CACHE 一致），app_env 把
    HISTORY_FILE patch 到 tmp_path 后自动重读，不会串味；这里仍显式
    保存/恢复，防止测试向真实缓存写入。
    """
    main = _import_main()
    with main._ACTIVE_COMFY_LOCK:
        saved_tasks = dict(main._ACTIVE_COMFY_TASKS)
        main._ACTIVE_COMFY_TASKS.clear()
    saved_cache = main._HISTORY_CACHE
    yield main
    with main._ACTIVE_COMFY_LOCK:
        main._ACTIVE_COMFY_TASKS.clear()
        main._ACTIVE_COMFY_TASKS.update(saved_tasks)
    main._HISTORY_CACHE = saved_cache


def _register_comfy_task(main, prompt_id, caller, backend="127.0.0.1:9"):
    with main._ACTIVE_COMFY_LOCK:
        main._ACTIVE_COMFY_TASKS[prompt_id] = {"backend": backend, "caller": caller}


class TestCancelMultiSlot:
    """/api/generate/cancel 多槽化行为契约（P1-2）。

    登记表 _ACTIVE_COMFY_TASKS: prompt_id -> {backend, caller}。
    cancel 按调用方（token→username）取消自己的全部任务；调用方无任务
    且全局唯一时宽松兜底（兼容未带 token 的老客户端）；多任务异构时
    绝不误取消他人任务。
    """

    def test_empty_registry(self, app_env, comfy_registry):
        r = app_env.post("/api/generate/cancel")
        assert r.status_code == 200
        assert r.json()["success"] is False

    def test_anonymous_multi_task_not_cancelled(self, app_env, comfy_registry, monkeypatch):
        """无 token 且全局多任务：不取消任何人的（防误伤）。"""
        main = comfy_registry
        _register_comfy_task(main, "p_alice", "alice")
        _register_comfy_task(main, "p_bob", "bob")
        calls = []
        monkeypatch.setattr(main.requests, "post", lambda url, **kw: calls.append(("post", url)))
        monkeypatch.setattr(main.requests, "delete", lambda url, **kw: calls.append(("delete", url)))
        r = app_env.post("/api/generate/cancel")
        assert r.json()["success"] is False
        assert calls == [], "不应向 ComfyUI 发任何中断请求"
        assert len(main._ACTIVE_COMFY_TASKS) == 2

    def test_anonymous_single_task_fallback(self, app_env, comfy_registry, monkeypatch):
        """无 token 且全局唯一：宽松取消（老客户端单任务场景）。"""
        main = comfy_registry
        _register_comfy_task(main, "p_only", "alice", backend="127.0.0.1:8188")
        calls = []
        monkeypatch.setattr(main.requests, "post", lambda url, **kw: calls.append(("post", url)))
        monkeypatch.setattr(main.requests, "delete", lambda url, **kw: calls.append(("delete", url)))
        r = app_env.post("/api/generate/cancel")
        body = r.json()
        assert body["success"] is True
        assert body["prompt_ids"] == ["p_only"]
        assert body["prompt_id"] == "p_only"  # 向后兼容旧字段
        assert ("post", "http://127.0.0.1:8188/interrupt") in calls
        assert ("delete", "http://127.0.0.1:8188/queue") in calls

    def test_caller_cancels_own_tasks_only(self, app_env, comfy_registry, monkeypatch):
        """带 token：只取消自己的全部任务（同用户多任务一次全取消），他人不动。"""
        main = comfy_registry
        monkeypatch.setattr(
            main, "get_username_by_token",
            lambda t: "alice" if t == "tok_alice" else None,
        )
        _register_comfy_task(main, "p_a1", "alice")
        _register_comfy_task(main, "p_a2", "alice")
        _register_comfy_task(main, "p_bob", "bob")
        calls = []
        monkeypatch.setattr(main.requests, "post", lambda url, **kw: calls.append(("post", url)))
        monkeypatch.setattr(main.requests, "delete", lambda url, **kw: calls.append(("delete", url)))
        r = app_env.post("/api/generate/cancel", params={"token": "tok_alice"})
        body = r.json()
        assert body["success"] is True
        assert set(body["prompt_ids"]) == {"p_a1", "p_a2"}
        assert set(main._ACTIVE_COMFY_TASKS) == {"p_bob"}, "他人任务不应被取消"
        assert len([c for c in calls if c[0] == "post"]) == 2

    def test_caller_key_resolution(self, comfy_registry):
        """_comfy_caller_key：username > client_id > anon。"""
        main = comfy_registry
        assert main._comfy_caller_key(types.SimpleNamespace(client_id=""), "") == "anon"
        assert main._comfy_caller_key(types.SimpleNamespace(client_id="cid-1"), "") == "client:cid-1"
        # 假 token 在隔离 users.json 中解析为 None → 回落 client_id
        req = types.SimpleNamespace(client_id="cid-2")
        assert main._comfy_caller_key(req, "no-such-token") == "client:cid-2"


class TestHistoryWritePath:
    """save_to_history 缓存化回归（P1-2 顺带优化）。

    写入侧改走进程内缓存（_load_history_cached 活引用写穿透），
    锁定的行为契约：落盘与缓存一致、幂等更新、头部插入、5000 条封顶。
    """

    def test_save_writes_through_cache(self, app_env, comfy_registry):
        main = comfy_registry
        hf = main.HISTORY_FILE  # tmp_path 隔离
        assert not Path(hf).exists()
        main.save_to_history({"images": ["/output/x.png"], "type": "zimage", "prompt": "p1"})
        on_disk = json.loads(Path(hf).read_text(encoding="utf-8"))
        assert len(on_disk) == 1
        # 写穿透：缓存与磁盘一致，无需失效重读
        assert len(main._HISTORY_CACHE["data"]) == 1
        assert main._HISTORY_CACHE["path"] == hf
        # 幂等：同首图 + 同 type → 更新而非插入
        main.save_to_history({"images": ["/output/x.png"], "type": "zimage", "prompt": "p2-updated"})
        on_disk = json.loads(Path(hf).read_text(encoding="utf-8"))
        assert len(on_disk) == 1
        assert on_disk[0]["prompt"] == "p2-updated"
        # 新首图 → 插入头部
        main.save_to_history({"images": ["/output/y.png"], "type": "zimage"})
        on_disk = json.loads(Path(hf).read_text(encoding="utf-8"))
        assert len(on_disk) == 2
        assert on_disk[0]["images"][0] == "/output/y.png"
        # timestamp 缺省自动补
        assert isinstance(on_disk[0].get("timestamp"), (int, float))

    def test_history_cap_5000(self, app_env, comfy_registry):
        """5000 条封顶：缓存预填后插入仍截断，头部为最新。"""
        main = comfy_registry
        with main.HISTORY_LOCK:
            main._HISTORY_CACHE = {
                "path": main.HISTORY_FILE,
                "data": [{"images": [f"/output/old{i}.png"], "type": "zimage"} for i in range(5000)],
            }
        main.save_to_history({"images": ["/output/new.png"], "type": "zimage"})
        on_disk = json.loads(Path(main.HISTORY_FILE).read_text(encoding="utf-8"))
        assert len(on_disk) == 5000
        assert on_disk[0]["images"][0] == "/output/new.png"
        assert len(main._HISTORY_CACHE["data"]) == 5000, "缓存应与磁盘同步截断"


# ─── 集成用例（-m integration 运行，ComfyUI 不在线则 skip）─────────────

COMFYUI_PROBE = "http://127.0.0.1:8188/system_stats"


def _comfyui_alive() -> bool:
    import requests

    try:
        return requests.get(COMFYUI_PROBE, timeout=3).status_code == 200
    except Exception:
        return False


@pytest.mark.integration
def test_generate_end_to_end(app_env):
    """真实生图：提交 z-image 工作流 → 校验 URL/落盘/PNG 有效性。"""
    if not _comfyui_alive():
        pytest.skip("ComfyUI(8188) 不在线")

    token = _register(app_env, "gen_user")
    r = app_env.post(
        "/api/generate",
        params={"token": token},
        json={
            "prompt": "a cat on the windowsill, afternoon sunlight",
            "workflow_json": "text2image/z-image.json",
            "type": "zimage",
            "width": 512,
            "height": 512,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("images"), f"生图未返回图片: {json.dumps(body, ensure_ascii=False)[:300]}"
    assert body.get("error") in (None, ""), body.get("error")

    img_url = body["images"][0]
    assert img_url.startswith("/output/"), img_url

    main = _import_main()
    disk = Path(main.OUTPUT_DIR) / img_url[len("/output/"):]
    assert disk.exists(), f"图片未落盘: {disk}"
    assert disk.stat().st_size > 1024, "图片过小，疑似损坏"
    assert disk.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", "非有效 PNG"


@pytest.mark.parametrize("feature, expected", [("", "online"), ("  zimage  ", "zimage")])
@pytest.mark.parametrize("with_reference", [False, True])
@pytest.mark.parametrize("as_chat_task", [False, True])
def test_online_image_result_feature(monkeypatch, feature, expected, with_reference, as_chat_task):
    """成功落盘后必须正常返回，结果分类与落盘分类一致。"""
    import asyncio

    main = _import_main()
    saved = []
    monkeypatch.setattr(main, "_resolve_image_provider", lambda _: {
        "image_models": ["test-image"], "protocol": "openai",
    })

    refs = [{"url": "/output/reference.png", "name": "参考图"}] if with_reference else []

    async def generate(prompt, size, quality, model, references, **kwargs):
        assert model == "gpt-image-2.5"
        assert size == "2048x1536"
        assert references == refs
        return {"type": "base64", "value": "mock"}, {}

    async def save(image, **kwargs):
        saved.append(kwargs)
        return "/output/mock.png"

    monkeypatch.setattr(main, "generate_ai_image", generate)
    monkeypatch.setattr(main, "save_ai_image_to_output", save)
    payload = main.OnlineImageRequest(prompt="test", feature=feature,
        model="gpt-image-2.5", size="2048x1536", reference_images=refs)
    if as_chat_task:
        tasks = _import_router_module("canvas_tasks")
        monkeypatch.setattr(main, "CANVAS_TASKS", {"test": {"status": "queued"}})
        finished = []
        monkeypatch.setattr(main, "finish_chat_generation", lambda *args, **kwargs: finished.append((args, kwargs)))
        asyncio.run(tasks.run_canvas_image_task("test", payload, username="test-user", user_id="test-user"))
        assert main.CANVAS_TASKS["test"]["status"] == "succeeded"
        assert finished[0][0][2] == ["/output/mock.png"]
        assert "error" not in finished[0][1]
        result = main.CANVAS_TASKS["test"]["result"]
    else:
        result = asyncio.run(main.build_online_image_result(payload, username="test-user"))
    assert result["images"] == ["/output/mock.png"]
    assert result["type"] == expected
    assert saved[0]["feature"] == expected
