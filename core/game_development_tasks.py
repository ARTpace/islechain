"""持久开发任务；复用候选工具，不因网页断开而取消或在重启后重放付费调用。"""
import asyncio
import json
import os
import time
from contextvars import ContextVar

from fastapi import HTTPException

from core.game_projects import atomic_write, json_bytes, uid

CURRENT_TASK = ContextVar('game_development_task', default='')
ACTIVE = {'running', 'pausing', 'cancelling'}


def project_lock(workspace, name='worker.lock'):
    stream = workspace.path(f'development-tasks/{name}').open('a+b')
    try:
        stream.seek(0, 2)
        if not stream.tell():
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except OSError:
        stream.close()
        raise HTTPException(409, '项目已有开发任务正在执行') from None


def unlock(stream):
    stream.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_UN)
    finally:
        stream.close()


def task_path(workspace, task_id):
    return workspace.path(f'development-tasks/{task_id}.json')


def records(workspace):
    return [json.loads(p.read_bytes()) for p in workspace.path('development-tasks').glob('*.json')]


def assert_idle(workspace):
    """旧的逐步调用同样遵守项目任务归属，不允许绕过后台互斥。"""
    if not CURRENT_TASK.get():
        tasks.recover(workspace)
    for task in records(workspace):
        if task['status'] in ACTIVE and task['taskId'] != CURRENT_TASK.get():
            raise HTTPException(409, '项目有后台开发任务，请先暂停任务')


class DevelopmentTasks:
    def __init__(self):
        self.workers = {}

    @staticmethod
    def save(workspace, task, kind, message):
        task['updatedAt'] = time.time()
        task['cursor'] += 1
        task['events'].append(dict(cursor=task['cursor'], kind=kind, message=message,
                                   timestamp=task['updatedAt']))
        task['events'] = task['events'][-256:]
        atomic_write(task_path(workspace, task['taskId']), json_bytes(task))

    def recover(self, workspace):
        """仅在拿到 OS 排他锁后判定遗留任务中断，不能误判另一个进程。"""
        directory = workspace.path('development-tasks')
        directory.mkdir(parents=True, exist_ok=True)
        try:
            lock = project_lock(workspace)
        except HTTPException:
            return
        try:
            for task in records(workspace):
                if task['status'] in ACTIVE:
                    task['status'] = 'interrupted'
                    path = workspace.path(f"code-candidates/{task['candidateId']}.json")
                    if path.is_file():
                        candidate = json.loads(path.read_bytes())
                        if candidate['status'] == 'generating':
                            candidate['status'] = 'interrupted'
                            candidate['stepId'] = uid('step')
                            candidate.pop('leaseUntil', None)
                            atomic_write(path, json_bytes(candidate))
                    self.save(workspace, task, 'interrupted', '执行进程已退出；保留候选，需显式继续，不自动重放模型调用')
        finally:
            unlock(lock)

    def start(self, workspace, candidate, request_id, runner, *, resume=None):
        self.recover(workspace)
        all_tasks = records(workspace)
        if resume is None:
            previous = next((t for t in all_tasks if t['requestId'] == request_id), None)
            if previous:
                if previous['candidateId'] != candidate['candidateId']:
                    raise HTTPException(409, '请求 ID 已用于另一个候选')
                return previous
            if len(all_tasks) >= 100:
                raise HTTPException(413, '开发任务达到100条，不自动删除历史')
        elif resume['status'] not in ('paused', 'interrupted', 'failed'):
            raise HTTPException(409, '只有暂停、中断或失败的任务可以继续')
        if candidate['status'] in ('ready', 'applied', 'unchanged', 'stale'):
            raise HTTPException(409, '候选已结束或失效，不能启动开发')
        assert_idle(workspace)
        lock = project_lock(workspace)
        task = dict(resume) if resume else dict(
            taskId=uid('devtask'), candidateId=candidate['candidateId'], requestId=request_id,
            createdAt=time.time(), cursor=0, events=[])
        task.update(status='running', candidateStatus=candidate['status'],
                    step=candidate.get('stepCount', candidate.get('completedFiles', 0)))
        key = str(task_path(workspace, task['taskId']))
        try:
            self.save(workspace, task, 'started', '后台开发已开始；关闭网页不停止任务')
            worker = asyncio.create_task(self.run(workspace, task, runner, lock))
            self.workers[key] = worker
        except BaseException:
            unlock(lock)
            raise
        return task

    async def run(self, workspace, task, runner, lock):
        context = CURRENT_TASK.set(task['taskId'])
        key = str(task_path(workspace, task['taskId']))
        try:
            async with asyncio.timeout(1800):
                while True:
                    with workspace.repository.locked():
                        task = json.loads(task_path(workspace, task['taskId']).read_bytes())
                        if task['status'] in ('pausing', 'cancelling'):
                            task['status'] = 'paused' if task['status'] == 'pausing' else 'cancelled'
                            self.save(workspace, task, task['status'], '已停止；候选及已完成步骤保留')
                            return
                    candidate = await runner()
                    with workspace.repository.locked():
                        task = json.loads(task_path(workspace, task['taskId']).read_bytes())
                        task.update(candidateStatus=candidate['status'],
                                    step=candidate.get('stepCount', candidate.get('completedFiles', 0)))
                        if task['status'] not in ('pausing', 'cancelling'):
                            status = candidate['status']
                            task['status'] = ('completed' if status in ('ready', 'unchanged') else
                                              status if status in ('failed', 'stale', 'interrupted') else 'running')
                        self.save(workspace, task, 'step', '候选状态：' + candidate['status'])
                    if task['status'] not in ACTIVE:
                        return
        except asyncio.CancelledError:
            task = json.loads(task_path(workspace, task['taskId']).read_bytes())
            task['status'] = ('paused' if task['status'] == 'pausing' else
                              'cancelled' if task['status'] == 'cancelling' else 'interrupted')
            self.save(workspace, task, task['status'], '执行已停止；未自动采用代码或重试模型调用')
            raise
        except TimeoutError:
            task['status'] = 'failed'
            self.save(workspace, task, 'failed', '后台任务超过30分钟；保留进度，请缩小任务')
        except HTTPException as exc:
            task['status'] = 'stale' if exc.status_code == 409 else 'failed'
            self.save(workspace, task, task['status'], '输入已变化或操作被拒绝；请检查候选后继续')
        except Exception:
            task['status'] = 'failed'
            self.save(workspace, task, 'failed', '开发步骤未完成；保留候选，详细诊断见候选记录')
        finally:
            try:
                from core.game_candidate_runtime import close_agent_game
                candidate_path = workspace.path(f"code-candidates/{task['candidateId']}.json")
                if candidate_path.is_file():
                    candidate = json.loads(candidate_path.read_bytes())
                    if candidate.get('agentSession'):
                        await asyncio.shield(close_agent_game(workspace, candidate))
                        with workspace.repository.locked():
                            atomic_write(candidate_path, json_bytes(candidate))
            except Exception:
                with workspace.repository.locked():
                    task = json.loads(task_path(workspace, task['taskId']).read_bytes())
                    task['cleanupPending'] = True
                    self.save(workspace, task, 'cleanup-pending', '所属试玩清理未完成，不关闭其他项目会话')
            finally:
                CURRENT_TASK.reset(context)
                self.workers.pop(key, None)
                unlock(lock)

    def stop(self, workspace, task, cancel=False):
        if task['status'] not in ACTIVE:
            return task
        task['status'] = 'cancelling' if cancel else 'pausing'
        self.save(workspace, task, 'stop-requested', '请求停止；上游请求可能已经计费，不自动重发')
        worker = self.workers.get(str(task_path(workspace, task['taskId'])))
        if worker:
            # Let the worker enter its try/finally even when paused immediately after start.
            asyncio.get_running_loop().call_soon(worker.cancel)
        return task

    async def close(self):
        await asyncio.sleep(0)
        workers = list(self.workers.values())
        for worker in workers:
            worker.cancel()
        if workers:
            await asyncio.gather(*workers, return_exceptions=True)


tasks = DevelopmentTasks()
