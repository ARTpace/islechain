"""后台开发任务 API；授权与候选执行仍走原有项目边界。"""
import importlib
import json

from fastapi import APIRouter, HTTPException, Query, Request

from core.game_development_tasks import records, task_path, tasks
from core.game_project_models import Contract, Identifier
from core.game_workspace import Workspace

code = importlib.import_module('routers.game_code_candidates')

router = APIRouter(prefix='/api/game-projects/{project_id}/development-tasks', tags=['game-development-tasks'])


class Start(Contract):
    candidateId: Identifier
    requestId: Identifier


def workspace_for(project_id, token, writable=False):
    repository = code.projects.store()
    project = repository.read(project_id, code.projects.identity(token), writable=writable)
    return Workspace(repository, project)


def candidate_for(workspace, candidate_id):
    path = code.path_for(workspace, candidate_id)
    if not path.is_file():
        raise HTTPException(404, '候选不存在')
    candidate = json.loads(path.read_bytes())
    if candidate.get('kind') not in ('maintenance', 'engineering'):
        raise HTTPException(422, '此候选不支持连续开发')
    code.engineering_current(candidate, workspace.project, workspace)
    return candidate


def task_for(workspace, task_id):
    path = task_path(workspace, task_id)
    if not path.is_file():
        raise HTTPException(404, '开发任务不存在')
    return json.loads(path.read_bytes())


def runner_for(project_id, candidate_id, token, http_request):
    async def step():
        repository = code.projects.store()
        with repository.locked():
            workspace = workspace_for(project_id, token, True)
            candidate = candidate_for(workspace, candidate_id)
            code.guard_game_mcp(candidate, http_request, token)
        if candidate['kind'] == 'maintenance':
            return await code.maintenance_work(project_id, candidate_id,
                code.WorkRequest(step=candidate['stepCount']), token, http_request)
        return await code.engineering_next(project_id, candidate_id,
            code.NextFile(completed=candidate['completedFiles']), token, http_request)
    return step


@router.get('')
async def list_tasks(project_id: Identifier, token: str = ''):
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id, token)
        tasks.recover(workspace)
        return [{key: task[key] for key in ('taskId', 'candidateId', 'status', 'step', 'updatedAt')}
                for task in sorted(records(workspace), key=lambda t: t['createdAt'], reverse=True)]


@router.post('')
async def start_task(project_id: Identifier, request: Start, http_request: Request, token: str = ''):
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id, token, True)
        candidate = candidate_for(workspace, request.candidateId)
        code.guard_game_mcp(candidate, http_request, token)
        return tasks.start(workspace, candidate, request.requestId,
            runner_for(project_id, request.candidateId, token, http_request))


@router.get('/{task_id}')
async def read_task(project_id: Identifier, task_id: Identifier, token: str = '',
                    after: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100)):
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id, token)
        tasks.recover(workspace)
        task = task_for(workspace, task_id)
        events = task['events']
        selected = [event for event in events if event['cursor'] > after][:limit]
        return dict(**{key: value for key, value in task.items() if key != 'events'}, events=selected,
                    nextCursor=selected[-1]['cursor'] if selected else after,
                    eventsTruncated=bool(events and after < events[0]['cursor'] - 1))


@router.post('/{task_id}/resume')
async def resume_task(project_id: Identifier, task_id: Identifier, http_request: Request, token: str = ''):
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id, token, True)
        tasks.recover(workspace)
        task = task_for(workspace, task_id)
        candidate = candidate_for(workspace, task['candidateId'])
        code.guard_game_mcp(candidate, http_request, token)
        return tasks.start(workspace, candidate, task['requestId'],
            runner_for(project_id, task['candidateId'], token, http_request), resume=task)


@router.post('/{task_id}/{action}')
async def stop_task(project_id: Identifier, task_id: Identifier, action: str, token: str = ''):
    if action not in ('pause', 'cancel'):
        raise HTTPException(404, '未知任务操作')
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id, token, True)
        tasks.recover(workspace)
        return tasks.stop(workspace, task_for(workspace, task_id), cancel=action == 'cancel')
