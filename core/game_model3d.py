"""Durable, project-owned 3D jobs using the original ohmygame provider adapters."""
import json
import os
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

from core.game_projects import atomic_write, digest, json_bytes, safe_path, uid

WORKER = Path(__file__).resolve().parents[1] / 'tools/model3d/worker.cjs'
ENDPOINTS = {'meshy': 'https://api.meshy.ai/openapi/v1', 'tripo': 'https://openapi.tripo3d.ai/v3', 'hyper3d': 'https://api.hyper3d.com/api/v2'}
_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix='game-3d')
_ACTIVE, _GUARD = {}, threading.RLock()
_CATALOG = None


def node_binary():
    node = shutil.which('node')
    if not node:
        raise HTTPException(503, '3D 服务需要 Node.js 20 或更新版本，请安装后重启后端')
    return node


def config_path(repository, owner):
    return safe_path(repository.root, 'model3d-connections/' + digest(owner.encode()) + '.json')


def connections(repository, owner):
    path = config_path(repository, owner)
    return json.loads(path.read_bytes()) if path.is_file() else []


def public_connection(value):
    return {**{k: v for k, v in value.items() if k != 'apiKey'}, 'hasKey': bool(value.get('apiKey'))}


def catalog():
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = execute(dict(command='catalog'), timeout=20)
    return _CATALOG


def execute(payload, timeout=120, worker=None):
    try:
        result = subprocess.run([node_binary(), str(worker or WORKER)], input=json_bytes(payload), capture_output=True,
                                timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, '3D 服务请求超时') from exc
    lines = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    final = next((line for line in reversed(lines) if 'result' in line or 'error' in line), {})
    if 'error' in final or 'result' not in final:
        error = str(final.get('error', '3D 运行程序未正常完成'))
        connection = payload.get('connection', {})
        for secret in [connection.get('apiKey'), *connection.get('headers', {}).values()]:
            if secret:
                error = error.replace(secret, '[已隐藏]')
        raise HTTPException(502, error[:1000])
    return final['result']


def job_directory(repository, project, job_id):
    return safe_path(repository.directory(project.id), ('audio-jobs/' if job_id.startswith('audio-') else 'model3d-jobs/') + job_id)


def read_job(repository, project, job_id):
    path = job_directory(repository, project, job_id) / 'job.json'
    if not path.is_file():
        raise HTTPException(404, '3D 任务不存在')
    key = str(path)
    with _GUARD:
        job = json.loads(path.read_bytes())
        if job['status'] in ('queued', 'running') and key not in _ACTIVE:
            job['status'] = 'interrupted'
            job['message'] = '后端已重启；可恢复同一任务，不自动重新付费提交'
            atomic_write(path, json_bytes(job))
    return job


def public_job(job):
    return {k: v for k, v in job.items() if k not in ('payload', 'connectionHash')}


def launch(repository, project, job, connection):
    directory = job_directory(repository, project, job['jobId'])
    path = directory / 'job.json'
    key = str(path)
    with _GUARD:
        if key in _ACTIVE:
            raise HTTPException(409, '任务已在执行')
        if sum(1 for active in _ACTIVE.values() if active['owner'] == project.owner) >= 2 or len(_ACTIVE) >= 3:
            raise HTTPException(409, '3D 任务并发已满，请等待或取消现有任务')
        control = {'stop': threading.Event(), 'process': None, 'owner': project.owner}
        _ACTIVE[key] = control
        job.update(status='queued', message='等待音频服务' if job['jobId'].startswith('audio-') else '等待 3D 服务', updatedAt=time.time())
        atomic_write(path, json_bytes(job))
    _POOL.submit(run_job, directory, job, connection, control)
    return public_job(job)


def cancel(repository, project, job):
    path = job_directory(repository, project, job['jobId']) / 'job.json'
    with _GUARD:
        control = _ACTIVE.get(str(path))
        if control:
            control['stop'].set()
            if control['process'] and control['process'].poll() is None:
                control['process'].terminate()
        elif job['status'] not in ('succeeded', 'adopted'):
            job.update(status='cancelled', message='已停止本地等待；远端任务可能仍运行，可恢复同一任务', updatedAt=time.time())
            atomic_write(path, json_bytes(job))
    return public_job(job)


def run_job(directory, job, connection, control):
    path = directory / 'job.json'
    process = None
    secrets = [connection.get('apiKey', ''), *connection.get('headers', {}).values()]
    def save(**values):
        with _GUARD:
            job.update(**values, updatedAt=time.time())
            atomic_write(path, json_bytes(job))
    try:
        if control['stop'].is_set():
            return
        payload = {**job['payload'], 'connection': connection, 'directory': str(directory),
                   'recoveryId': job['jobId'], 'output': str(directory / job.get('outputName', 'output.glb'))}
        payload['images'] = [{**image, 'path': str(directory / image['path'])} for image in payload.get('images', [])]
        if payload.get('source'):
            payload['source'] = str(directory / payload['source'])
        process = subprocess.Popen([node_binary(), str(Path(__file__).resolve().parents[1] / 'tools/audio/worker.cjs' if job['jobId'].startswith('audio-') else WORKER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        with _GUARD:
            control['process'] = process
            if control['stop'].is_set():
                process.terminate()
        save(status='running', message='已连接音频服务' if job['jobId'].startswith('audio-') else '已连接 3D 服务')
        process.stdin.write(json_bytes(payload)); process.stdin.close()
        final = None
        for raw in iter(process.stdout.readline, b''):
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError('3D 服务状态响应过大')
            event = json.loads(raw)
            if 'result' in event or 'error' in event:
                final = event
            elif 'stage' in event:
                save(stage=event['stage'], message='处理阶段：' + str(event['stage']))
            elif 'status' in event:
                save(progress=event.get('progress'), message='服务状态：' + str(event['status']))
        process.wait(timeout=10)
        if control['stop'].is_set():
            return
        if not final or 'error' in final:
            raise ValueError((final or {}).get('error', '3D 工作进程退出；可恢复同一任务'))
        from core.game_media_assets import inspect_media
        kind, mime, metadata = inspect_media(job.get('outputName', 'output.glb'), (directory / job.get('outputName', 'output.glb')).read_bytes())
        save(status='succeeded', progress=100, message='生成完成，等待采用',
             metadata={**metadata, **final['result'].get('metadata', {})}, requestId=final['result'].get('requestId'))
    except Exception as exc:
        message = str(exc.detail if isinstance(exc, HTTPException) else exc)
        for secret in secrets:
            if secret:
                message = message.replace(secret, '[已隐藏]')
        journal = directory / (job['jobId'] + '.json')
        uncertain = (directory / (job.get('outputName', 'output.glb') + '.submitted')).is_file()
        if journal.is_file():
            try:
                uncertain = any(not entry.get('credentials') for entry in json.loads(journal.read_bytes()).values())
            except (ValueError, AttributeError):
                uncertain = True
        save(status='failed', message=message[:1000], submissionUncertain=uncertain)
    finally:
        if process and process.poll() is None:
            process.kill(); process.wait(timeout=10)
        if control['stop'].is_set():
            save(status='cancelled', message='已停止本地等待；远端任务可能仍运行，可恢复同一任务')
        with _GUARD:
            _ACTIVE.pop(str(path), None)
