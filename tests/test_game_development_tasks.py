"""后台任务的真实候选集成与进程归属；模型使用离线 fixture。"""
import asyncio
import importlib
import json
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from core.game_development_tasks import DevelopmentTasks, assert_idle, project_lock, task_path, unlock
from core.game_projects import atomic_write, json_bytes
# routers.game_development_tasks 已在 _SUBROUTERS 中，`from routers import X`
# 会拿到 APIRouter；这里需要模块对象（api.router / api.code.*）。
api = importlib.import_module('routers.game_development_tasks')
from test_game_code_maintenance import env, setup, start

ROOT = '/api/game-projects/p1/development-tasks'


def test_route_runs_without_frontend_steps_and_is_idempotent(env, monkeypatch):
    state, calls = setup(env, monkeypatch, [dict(action='search', query='count'), dict(action='finish', summary='无需改动')])
    candidate = start(env, state).json()
    env[0].app.include_router(api.router)
    body = dict(candidateId=candidate['candidateId'], requestId='background1')
    with TestClient(env[0].app) as client:
        response = client.post(ROOT + '?token=alice', json=body)
        assert response.status_code == 200, response.text
        task_id = response.json()['taskId']
        for _ in range(100):
            result = client.get(ROOT + '/' + task_id + '?token=alice&limit=1').json()
            if result['status'] not in ('running', 'pausing', 'cancelling'):
                break
            time.sleep(.01)
        assert result['status'] == 'completed', result
        assert result['step'] == 2 and len(calls) == 2
        assert len(result['events']) == 1
        following = client.get(ROOT + '/' + task_id + '?token=alice&after=1').json()
        assert all(event['cursor'] > 1 for event in following['events'])
        assert client.post(ROOT + '?token=alice', json=body).json()['taskId'] == task_id
        assert len(calls) == 2
        assert client.get(ROOT + '/' + task_id + '?token=bob').status_code == 403
        assert client.post(ROOT + '/' + task_id + '/resume?token=bob').status_code == 403
        assert client.get(ROOT + '?token=alice').json()[0]['taskId'] == task_id
        assert env[1].read('game.js')['content'] == 'window.Game={count:0};'


def test_single_writer_pause_resume_and_shutdown(env, monkeypatch):
    state, _ = setup(env, monkeypatch, [])
    candidate = start(env, state).json()

    async def scenario():
        manager = DevelopmentTasks()
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        async def slow():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        task = manager.start(env[1], candidate, 'pause1', slow)
        await asyncio.wait_for(entered.wait(), 2)
        with pytest.raises(HTTPException) as error:
            assert_idle(env[1])
        assert error.value.status_code == 409
        with pytest.raises(HTTPException):
            DevelopmentTasks().start(env[1], candidate, 'competing', slow)
        manager.stop(env[1], task)
        worker = next(iter(manager.workers.values()))
        await asyncio.gather(worker, return_exceptions=True)
        assert cancelled.is_set()
        saved = json.loads(task_path(env[1], task['taskId']).read_bytes())
        assert saved['status'] == 'paused'
        async def finish():
            return dict(status='ready', stepCount=3)
        resumed = manager.start(env[1], candidate, 'pause1', finish, resume=saved)
        assert resumed['taskId'] == task['taskId']
        await asyncio.gather(*manager.workers.values())
        assert json.loads(task_path(env[1], task['taskId']).read_bytes())['status'] == 'completed'
        running = manager.start(env[1], candidate, 'shutdown1', slow)
        await manager.close()
        assert json.loads(task_path(env[1], running['taskId']).read_bytes())['status'] == 'interrupted'
    asyncio.run(scenario())


def test_recover_requires_worker_lock_and_never_replays(env, monkeypatch):
    state, _ = setup(env, monkeypatch, [])
    candidate = start(env, state).json()
    candidate.update(status='generating', leaseUntil=time.time() + 300, stepId='old-step')
    atomic_write(api.code.path_for(env[1], candidate['candidateId']), json_bytes(candidate))
    directory = env[1].path('development-tasks')
    directory.mkdir(exist_ok=True)
    task = dict(taskId='crashed', candidateId=candidate['candidateId'], requestId='crashed1',
                status='running', createdAt=time.time(), cursor=0, events=[])
    manager = DevelopmentTasks()
    manager.save(env[1], task, 'started', 'started')
    lock = project_lock(env[1])
    try:
        manager.recover(env[1])
        assert json.loads(task_path(env[1], 'crashed').read_bytes())['status'] == 'running'
    finally:
        unlock(lock)
    manager.recover(env[1])
    saved = json.loads(task_path(env[1], 'crashed').read_bytes())
    assert saved['status'] == 'interrupted' and not manager.workers
    recovered = json.loads(api.code.path_for(env[1], candidate['candidateId']).read_bytes())
    assert recovered['status'] == 'interrupted' and recovered['stepId'] != 'old-step'
    assert 'leaseUntil' not in recovered


def test_cancel_immediately_after_start_releases_lock(env, monkeypatch):
    state, _ = setup(env, monkeypatch, [])
    candidate = start(env, state).json()
    async def scenario():
        manager = DevelopmentTasks()
        async def unexpected():
            raise AssertionError('取消后不得调用模型')
        task = manager.start(env[1], candidate, 'cancel1', unexpected)
        worker = next(iter(manager.workers.values()))
        manager.stop(env[1], task, cancel=True)
        await asyncio.gather(worker, return_exceptions=True)
        assert json.loads(task_path(env[1], task['taskId']).read_bytes())['status'] == 'cancelled'
        lock = project_lock(env[1])
        unlock(lock)
    asyncio.run(scenario())
