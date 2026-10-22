"""在临时源码副本导入应用，阻断外网和进程启动，不复制真实用户数据。"""
import asyncio
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def worker(folder):
    os.chdir(folder)
    sys.path.insert(0, folder)

    def denied(*args, **kwargs):
        raise RuntimeError("隔离验收禁止网络或外部进程")

    original_connect = socket.socket.connect

    def guarded_connect(sock, address):
        # Windows 事件循环内部 socketpair 需要回环连接；仍阻断外部网络。
        if isinstance(address, tuple) and address[0] in ("127.0.0.1", "::1"):
            return original_connect(sock, address)
        return denied()

    socket.socket.connect = guarded_connect
    socket.create_connection = denied
    subprocess.Popen = denied
    import main
    routes = [(sorted(getattr(r, "methods", []) or []), getattr(r, "path", "")) for r in main.app.routes]
    print("ISOLATED_IMPORT_OK", len(routes))
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    response = client.get("/api/auth/me", params={"token": "invalid-test-token"})
    assert response.status_code == 401, response.status_code
    print("INVALID_AUTH_OK", response.status_code)
    # 仅使用临时副本中的虚拟用户数据，不读写工作区凭据。
    main.save_users({"isolated-user": {"password": main.hash_password("test-password"), "token": "isolated-test-token", "is_admin": False}})
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer isolated-test-token"})
    assert response.status_code == 200, f"Bearer 认证失败: {response.status_code}"
    for password in ("test-password", "长密码" * 30):
        encoded = main.hash_password(password)
        assert main.verify_password(encoded, password)
        assert not main.verify_password(encoded, password + "wrong")
    assert not main.verify_password(None, "password")
    print("AUTH_COMPATIBILITY_OK")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        worker(sys.argv[1])
    else:
        with tempfile.TemporaryDirectory(prefix="art-canvas-import-") as folder:
            target = Path(folder)
            for path in ROOT.glob("*.py"):
                if path.name in {"main.py", "preset_manager.py", "smart_tts.py", "smart_prompt.py", "genre_registry.py", "random_source.py", "wildcard_engine.py"}:
                    shutil.copy2(path, target / path.name)
            for name in ("prompt",):
                shutil.copytree(ROOT / name, target / name, ignore=shutil.ignore_patterns("__pycache__"))
            (target / "static").mkdir()
            (target / "prompt/static").mkdir(parents=True, exist_ok=True)
            result = subprocess.run([sys.executable, str(Path(__file__).resolve()), folder], timeout=45)
            raise SystemExit(result.returncode)
