"""Offline bridge checks: never launch browsers or consume website credits."""
import base64
import importlib
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main  # Load the owning app before its routers (existing circular dependency).

routes = importlib.import_module("routers.rodin3d")
JOB = "b" * 32
SOURCE = "a" * 32
GLB = b"glTF" + (2).to_bytes(4, "little") + (12).to_bytes(4, "little")


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    output = tmp_path / "output"
    output.mkdir()
    monkeypatch.setattr(routes, "TASK_DIR", tmp_path / "tasks")
    monkeypatch.setattr(routes._main, "OUTPUT_DIR", str(output))
    monkeypatch.setattr(routes, "_load_config", lambda: {"base_url": "http://bridge.invalid", "api_key": "test-only"})
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app), output


def upstream(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://bridge.invalid")


def image_body(size=(128, 128), **values):
    image = BytesIO()
    Image.new("RGB", size, "red").save(image, format="PNG")
    return {"provider": "hunyuan", "image": "data:image/png;base64," + base64.b64encode(image.getvalue()).decode(), **values}


@pytest.mark.parametrize("dry_run", [True, False])
def test_tripo_website_forwards_only_supported_options(bridge, dry_run):
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(202, json={"id": JOB, "status": "queued"})

    body = image_body(provider="tripo", dry_run=dry_run, max_credits=50,
                      face_count=20000, topology="quad", idempotency_key="tripo-request")
    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)), patch.object(routes, "_bump_stats") as stats:
        response = bridge[0].post("/api/rodin3d/generate", json=body)
    assert response.status_code == 200, response.text
    assert len(sent) == 1
    assert sent[0]["model"] == "tripo_3d/h3.1"
    assert sent[0]["params"] == {"version": "h3.1", "max_credits": 50}
    assert sent[0]["dry_run"] is dry_run
    assert stats.call_count == (0 if dry_run else 1)
    assert routes._load_task(JOB)["provider"] == "tripo"


@pytest.mark.parametrize("values,status", [
    ({"dry_run": False}, 400), ({"prompt": "unsupported"}, 400),
    ({"max_credits": -1}, 422), ({"max_credits": True}, 422),
])
def test_tripo_website_rejects_missing_budget_and_invalid_options(bridge, values, status):
    with patch.object(routes, "_client") as remote:
        assert bridge[0].post("/api/rodin3d/generate", json=image_body(provider="tripo", **values)).status_code == status
        remote.assert_not_called()


def test_tripo_website_connection_loss_does_not_retry(bridge):
    calls = []

    def handle(request):
        calls.append(request.method)
        raise httpx.ReadError("connection lost", request=request)

    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)):
        response = bridge[0].post("/api/rodin3d/generate", json=image_body(provider="tripo", dry_run=False, max_credits=50))
    assert response.status_code == 502
    assert calls == ["POST"]


@pytest.mark.parametrize("dry_run", [True, False])
def test_image_low_poly_forwarding_and_history_metadata(bridge, dry_run):
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(202, json={"id": JOB, "status": "queued"})

    body = image_body(topology="triangle", face_count=15000, idempotency_key="image-request")
    if not dry_run:
        body["dry_run"] = False
    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)), patch.object(routes, "_bump_stats") as stats:
        response = bridge[0].post("/api/rodin3d/generate", json=body)
    assert response.status_code == 200, response.text
    assert len(sent) == 1
    assert sent[0]["model"] == "hunyuan_3d/image-to-low-poly"
    assert sent[0]["params"] == {"topology": "triangle", "face_count": 15000}
    assert sent[0]["dry_run"] is dry_run
    assert sent[0]["idempotency_key"] == "image-request"
    assert stats.call_count == (0 if dry_run else 1)
    task = routes._load_task(JOB)
    assert task["provider"] == "hunyuan" and task["operation"] == "image-to-low-poly"
    assert task["dry_run"] is dry_run


@pytest.mark.parametrize("values,status", [
    ({"face_count": 99}, 422), ({"face_count": 60001}, 422),
    ({"face_count": True}, 422), ({"topology": "bad"}, 422),
    ({"provider": "bad"}, 422), ({"prompt": "text"}, 400),
    ({"resume_url": "https://example.com"}, 400),
])
def test_image_low_poly_rejects_invalid_options_before_submission(bridge, values, status):
    with patch.object(routes, "_client") as remote:
        assert bridge[0].post("/api/rodin3d/generate", json=image_body(**values)).status_code == status
        remote.assert_not_called()


def test_image_low_poly_rejects_small_corrupt_and_oversize_images(bridge):
    client, _ = bridge
    with patch.object(routes, "_client") as remote:
        assert client.post("/api/rodin3d/generate", json=image_body((127, 128))).status_code == 400
        bad = image_body(image="data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n").decode())
        assert client.post("/api/rodin3d/generate", json=bad).status_code == 400
        with patch.object(routes, "_read_image", return_value=(b"x" * (10 * 1024 * 1024 + 1), "png")):
            assert client.post("/api/rodin3d/generate", json=image_body()).status_code == 400
        remote.assert_not_called()


def test_image_low_poly_connection_loss_is_not_retried(bridge):
    calls = []

    def handle(request):
        calls.append(request.method)
        raise httpx.ReadError("connection lost", request=request)

    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)):
        result = bridge[0].post("/api/rodin3d/generate", json=image_body(dry_run=False))
    assert result.status_code == 502
    assert "勿直接重复提交" in result.json()["detail"]
    assert calls == ["POST"]


def test_legacy_rodin_generation_keeps_model_and_paid_flag(bridge):
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(202, json={"id": JOB, "status": "queued"})

    body = image_body()
    body.pop("provider")
    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)), patch.object(routes, "_bump_stats"):
        response = bridge[0].post("/api/rodin3d/generate", json=body)
    assert response.status_code == 200
    assert sent[0]["model"] == "rodin_3d/gen2.5"
    assert sent[0]["dry_run"] is False


def test_upload_defaults_to_free_precheck_and_preserves_identity(bridge):
    client, _ = bridge
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        assert request.url.path == "/v1/3d/tasks"
        return httpx.Response(202, json={"id": JOB, "status": "queued"})

    body = {"filename": "prop.obj", "base64": base64.b64encode(b"v 0 0 0\n").decode(), "idempotency_key": "same-request"}
    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)):
        response = client.post("/api/rodin3d/topology", json=body)
    assert response.status_code == 200, response.text
    assert sent == [{"model": "hunyuan_3d/low-poly", "idempotency_key": "same-request", "dry_run": True,
                     "input": {"filename": "prop.obj", "base64": body["base64"]}, "params": {"topology": "quad"}}]
    assert routes._load_task(JOB)["provider"] == "hunyuan"
    assert client.get("/api/rodin3d/history").json() == {"items": []}


def test_current_model_explicit_generation_and_triangle(bridge):
    client, output = bridge
    (output / "source.glb").write_bytes(GLB)
    routes._store_task(SOURCE, {"id": SOURCE, "file_url": "/output/source.glb"})
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(202, json={"id": JOB, "status": "queued"})

    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)):
        response = client.post("/api/rodin3d/topology", json={"source_task_id": SOURCE, "topology": "triangle", "dry_run": False, "face_count": 20000})
    assert response.status_code == 200, response.text
    assert sent[0]["input"] == {"filename": "source.glb", "base64": base64.b64encode(GLB).decode()}
    assert sent[0]["params"] == {"topology": "triangle", "face_count": 20000}
    assert sent[0]["dry_run"] is False
    assert routes._load_task(JOB)["source_task_id"] == SOURCE


@pytest.mark.parametrize("count", [99, 60001, 100.5, "20000", True])
def test_invalid_target_face_count_does_not_reach_provider(bridge, count):
    with patch.object(routes, "_client") as remote:
        response = bridge[0].post("/api/rodin3d/topology", json={"filename": "prop.obj", "base64": "eA==", "face_count": count})
        assert response.status_code == 422
        remote.assert_not_called()


@pytest.mark.parametrize("body", [
    {"filename": "image.png", "base64": "eA=="},
    {"filename": "bad.glb", "base64": "eA=="},
    {"filename": "prop.obj", "base64": "!not-base64!"},
    {"filename": "prop.obj", "base64": ""},
    {"filename": "prop.obj", "base64": "eA==", "topology": "unknown"},
    {"source_task_id": "../outside"},
    {"source_task_id": SOURCE, "filename": "prop.obj", "base64": "eA=="},
])
def test_rejects_invalid_inputs_before_provider(bridge, body):
    with patch.object(routes, "_client") as remote:
        assert bridge[0].post("/api/rodin3d/topology", json=body).status_code == 400
        remote.assert_not_called()


def test_current_model_boundary_missing_and_oversize(bridge):
    client, output = bridge
    assert client.post("/api/rodin3d/topology", json={"source_task_id": SOURCE}).status_code == 409
    routes._store_task(SOURCE, {"file_url": "/output/../outside.glb"})
    assert client.post("/api/rodin3d/topology", json={"source_task_id": SOURCE}).status_code == 404
    with (output / "large.glb").open("wb") as file:
        file.truncate(24 * 1024 * 1024 + 1)
    routes._store_task(SOURCE, {"file_url": "/output/large.glb"})
    assert client.post("/api/rodin3d/topology", json={"source_task_id": SOURCE}).status_code == 400


@pytest.mark.parametrize("status", ["validated", "needs_review"])
def test_precheck_and_uncertain_status_never_download_or_resubmit(bridge, status):
    client, _ = bridge
    routes._store_task(JOB, {"id": JOB, "provider": "hunyuan", "operation": "low-poly", "dry_run": status == "validated"})
    requests = []

    def handle(request):
        requests.append(request.method)
        return httpx.Response(200, json={"id": JOB, "status": status})

    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)), patch.object(routes, "_materialize") as download:
        result = client.get("/api/rodin3d/task/" + JOB).json()
    assert result["provider"] == "hunyuan" and result["status"] == status
    assert requests == ["GET"]
    download.assert_not_called()


def test_topology_file_history_and_legacy_rodin_share_existing_routes(bridge):
    client, output = bridge
    routes._store_task(JOB, {"id": JOB, "provider": "hunyuan", "operation": "low-poly"})
    routes._store_task(SOURCE, {"id": SOURCE, "file_url": "/output/legacy.glb"})
    (output / "legacy.glb").write_bytes(GLB)
    media = SimpleNamespace(resolve_media_dir=lambda **kwargs: (str(output), "/output"))

    def handle(request):
        return httpx.Response(200, json={"id": JOB, "status": "succeeded", "output": {"faces": 18, "vertices": 12}})

    response = httpx.Response(200, content=GLB)
    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)), \
            patch.object(routes._main, "media_paths", media), patch.object(routes.httpx, "Client") as download:
        download.return_value.__enter__.return_value.get.return_value = response
        result = client.get("/api/rodin3d/task/" + JOB).json()
    assert result["faces"] == 18 and result["vertices"] == 12
    assert result["file_url"].startswith("/output/hunyuan3d_")
    assert client.get("/api/rodin3d/task/" + JOB + "/file").content == GLB
    assert client.get("/api/rodin3d/task/" + SOURCE + "/file").content == GLB
    history = {item["id"]: item for item in client.get("/api/rodin3d/history").json()["items"]}
    assert history[JOB]["provider"] == "hunyuan"
    assert history[SOURCE]["provider"] == "hyper3d"


def test_connection_loss_does_not_retry(bridge):
    def handle(request):
        raise httpx.ReadError("connection lost", request=request)

    with patch.object(routes, "_client", side_effect=lambda _: upstream(handle)) as remote:
        response = bridge[0].post("/api/rodin3d/topology", json={"filename": "prop.obj", "base64": "eA==", "dry_run": False})
    assert response.status_code == 502
    assert "勿直接重复提交" in response.json()["detail"]
    assert remote.call_count == 1
