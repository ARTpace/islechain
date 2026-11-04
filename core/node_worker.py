"""Trusted-only JSON worker using the application's bundled Python, never PATH."""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from core.game_process_tree import ProcessTree

_RUNS = {}
_LOCK = threading.Lock()


def register(owner, run_id, event=None):
    if not isinstance(run_id, str) or len(run_id) > 50 or not run_id or any(c not in '0123456789abcdef-' for c in run_id):
        raise ValueError('worker 运行 ID 无效')
    with _LOCK:
        if len(_RUNS) >= 16 or (owner, run_id) in _RUNS:
            raise ValueError('worker 任务重复或达到并发上限')
        event = event if event is not None else threading.Event()
        _RUNS[owner, run_id] = event
        return event


def cancel(owner, run_id):
    with _LOCK:
        event = _RUNS.get((owner, run_id))
        if event is None:
            raise ValueError('worker 任务不存在或不属于当前用户')
        event.set()


def unregister(owner, run_id):
    with _LOCK:
        _RUNS.pop((owner, run_id), None)


def execute_worker(binding, values, inputs, cancel_event=None, deadline_override=None, *, media=None, media_inputs=None, site=None,
                   ports=None, port_inputs=None):
    if getattr(sys, 'frozen', False):
        raise ValueError('当前单文件宿主未配置独立 Python；请使用附带 Python 运行时的桌面发行包')
    if binding.media and media is None:
        raise ValueError('图片 worker 需要账号资源上下文，请通过节点候选测试或画布执行')
    with tempfile.TemporaryDirectory(prefix='art-node-worker-') as directory:
        root = Path(directory)
        script, request, output, errors = [root / name for name in ('worker.py', 'request.json', 'output.json', 'stderr.log')]
        script.write_text(binding.code, encoding='utf-8')
        payload = {'protocolVersion': 3 if ports is not None else 2 if binding.media else 1, 'params': values, 'inputs': inputs}
        if ports is not None:
            from core.node_ports import prepare_inputs
            payload['ports'] = prepare_inputs(ports, port_inputs or {}, media, root)
            if binding.media:
                payload['outputDir'] = 'images-out'
        elif binding.media:
            payload.update(images=media.stage(media_inputs or [], root), outputDir='images-out')
        request.write_text(json.dumps(payload,
                                     ensure_ascii=False, allow_nan=False), encoding='utf-8')
        environment = {key: value for key, value in os.environ.items()
                       if key.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')}
        environment['PYTHONIOENCODING'] = 'utf-8'
        process, tree = None, None
        try:
            with request.open('rb') as stdin, output.open('wb') as stdout, errors.open('wb') as stderr:
                from core.node_python_env import isolated_command
                command = isolated_command(site, script) if site is not None else [sys.executable, '-I', '-X', 'utf8', str(script)]
                process = subprocess.Popen(command,
                    stdin=stdin, stdout=stdout, stderr=stderr, cwd=root, env=environment,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                    start_new_session=os.name != 'nt')
                tree = ProcessTree(process.pid)
                deadline = time.monotonic() + binding.timeoutSeconds
                if deadline_override is not None:
                    deadline = min(deadline, deadline_override)
                while process.poll() is None:
                    if cancel_event is not None and cancel_event.is_set():
                        raise ValueError('worker 已取消')
                    if time.monotonic() > deadline:
                        raise ValueError('worker 执行超时')
                    if output.stat().st_size > 65536 or errors.stat().st_size > 65536:
                        raise ValueError('worker 输出超过 64 KiB 限制')
                    if binding.media:
                        files = list((root / 'images-out').iterdir())
                        if len(files) > 8 or any(path.is_symlink() or not path.is_file() for path in files):
                            raise ValueError('worker 图片输出目录只允许最多8个普通文件')
                        if sum(path.stat().st_size for path in files) > 32 * 1024 * 1024:
                            raise ValueError('worker 图片输出超过32MiB')
                    time.sleep(0.03)
            if output.stat().st_size > 65536 or errors.stat().st_size > 65536:
                raise ValueError('worker 输出超过 64 KiB 限制')
            if cancel_event is not None and cancel_event.is_set():
                raise ValueError('worker 已取消')
            if process.returncode:
                raise ValueError('worker 执行失败：' + errors.read_text(encoding='utf-8', errors='replace')[-1000:])
            try:
                result = json.loads(output.read_text(encoding='utf-8'))
            except (ValueError, RecursionError):
                raise ValueError('worker 未返回有效 JSON') from None
            if ports is not None:
                if not isinstance(result, dict) or type(result.get('protocolVersion')) is not int or result['protocolVersion'] != 3:
                    raise ValueError('命名端口worker必须返回协议v3')
                from core.node_ports import finish_outputs
                tree.close()
                tree = None
                return finish_outputs(ports, result.get('outputs'), media, root, cancel_event)
            if (not isinstance(result, dict) or type(result.get('protocolVersion')) is not int
                    or result['protocolVersion'] != (2 if binding.media else 1)
                    or not isinstance(result.get('outputs'), dict)
                    or set(result['outputs']) != ({'text', 'images'} if binding.media else {'text'})
                    or not isinstance(result['outputs']['text'], str) or len(result['outputs']['text']) > 16000):
                raise ValueError('worker 输出不符合声明的文本/图片端口协议')
            if binding.media:
                if cancel_event is not None and cancel_event.is_set():
                    raise ValueError('worker 已取消，图片未发布')
                # End owned descendants before reading files they may still be changing.
                tree.close()
                tree = None
                return {'text': result['outputs']['text'], 'images': media.publish(result['outputs']['images'], root, cancel_event)}
            return result['outputs']['text']
        finally:
            if tree is not None:
                tree.close()
            if process is not None:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
            # Windows signals process exit before all inherited file handles finish closing.
            # Wait only for this job's own scratch files, preserving the original timeout/error.
            deadline = time.monotonic() + 2
            for path in (request, output, errors, script):
                while True:
                    try:
                        path.unlink(missing_ok=True)
                        break
                    except PermissionError:
                        if time.monotonic() >= deadline:
                            raise ValueError('worker 已停止，但临时文件句柄未在 2 秒内释放') from None
                        time.sleep(0.02)
