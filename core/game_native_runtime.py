"""按项目显式授权的本机Web工具链。执行副本不是安全沙箱。"""
import asyncio
import codecs
import io
import json
import os
import re
import shutil
import socket
import time
import zipfile
from pathlib import Path

from fastapi import HTTPException

from core.game_development_tasks import project_lock, unlock
from core.game_process_tree import ProcessTree
from core.game_projects import atomic_write, digest, json_bytes, uid
from core.game_workspace import EXCLUDED, MAX_FILE, MAX_FILES, MAX_TOTAL
from core import game_studio_sessions as studio
from core import game_engine_plugins as plugins

SKIP = EXCLUDED | {'dist', 'build', '.vite', '.npm', '.codex', '.claude', '.npmrc', '.yarnrc',
                   '__art_canvas_assets', 'ART_CANVAS_CONTEXT.json'}


def node_tool(name):
    """执行Node入口，不把Windows的cmd/ps1包装器作为shell字符串运行。"""
    node = shutil.which('node')
    if not node:
        raise HTTPException(409, '需要Node.js')
    if name == 'npm':
        candidates = [Path(node).parent / 'node_modules/npm/bin/npm-cli.js']
        package = 'npm/bin/npm-cli.js'
    else:
        package = '@openai/codex/bin/codex.js'
        candidates = []
        executable = shutil.which('codex')
        if executable and Path(executable).suffix.lower() not in ('.cmd', '.ps1', '.bat'):
            return [executable]
    candidates += [Path(part) / 'node_modules' / package for part in os.get_exec_path()]
    for candidate in candidates:
        if candidate.is_file():
            return [node, str(candidate)]
    raise HTTPException(409, f'未找到可直接执行的{name}，请安装后重试')


def sources(root, *, max_file=MAX_FILE, max_total=MAX_TOTAL, skip=SKIP):
    files, size = {}, 0
    for parent, directories, names in os.walk(root, followlinks=False):
        for name in directories + names:
            path = Path(parent) / name
            if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
                if name not in skip:
                    raise HTTPException(422, '工程源文件不允许链接')
        directories[:] = [d for d in directories if d not in skip and not d.startswith('.env')]
        for name in names:
            if name in skip or name.startswith('.env'):
                continue
            path = Path(parent) / name
            if path.stat().st_size > max_file:
                raise HTTPException(413, '源码单文件超过1MiB')
            raw = path.read_bytes()
            size += len(raw)
            if len(files) >= MAX_FILES or size > max_total:
                raise HTTPException(413, '源码超过500文件或40MiB')
            files[path.relative_to(root).as_posix()] = raw
    return files


def settings(workspace):
    path = workspace.path('native-runtime.json')
    return json.loads(path.read_bytes()) if path.is_file() else dict(enabled=False, mode='local-trusted')


def require_enabled(workspace):
    if not settings(workspace)['enabled']:
        raise HTTPException(403, '请先为本项目开启本机执行；此模式使用当前用户的本机权限')


def session_path(workspace, session_id):
    return workspace.path(f'native-sessions/{session_id}/session.json')


def read_session(workspace, session_id):
    path = session_path(workspace, session_id)
    if not path.is_file():
        raise HTTPException(404, '本机工程会话不存在')
    return json.loads(path.read_bytes())


def check_session(workspace, session):
    state, files = workspace.current(session['workspaceRevision'])
    if (state['workspaceEpoch'] != session['workspaceEpoch'] or workspace.project.revision != session['projectRevision']
            or workspace.manifest(files) != session['inputManifest']):
        raise HTTPException(409, '当前工程或策划已变化，请保存修改并创建新的本机工程会话')
    return files


def project_context(workspace):
    from core.game_media_assets import runtime_resources, asset_context
    resources, urls, metadata = runtime_resources(workspace.repository,workspace.project)
    result, manifest = {}, {}
    for asset in workspace.project.assets:
        if asset.usage=='runtime' and asset.selected:
            name=asset.id+'.'+asset.spec.format
            raw=workspace.repository.selected_content(workspace.project,asset)
            result['public/__art_canvas_assets/'+name]=raw
            manifest[asset.id]=dict(path='__art_canvas_assets/'+name,hash=digest(raw),kind='image',purpose=asset.purpose)
    for asset_id,name in urls.items():
        raw,mime=resources[name]
        filename=Path(name).name
        result['public/__art_canvas_assets/'+filename]=raw
        manifest[asset_id]={**metadata[asset_id], 'path':'__art_canvas_assets/'+filename,'hash':digest(raw),'mime':mime}
    result['public/__art_canvas_assets/manifest.json']=json_bytes(manifest)
    result['ART_CANVAS_CONTEXT.json']=json_bytes(dict(projectId=workspace.project.id,projectRevision=workspace.project.revision,
        plan=workspace.project.plan.model_dump() if workspace.project.plan else None,
        assets=asset_context(workspace.project),assetManifest='public/__art_canvas_assets/manifest.json',
        note='已选资产已复制到public，以素材manifest列出的资源和路径为准。依据名称、图片内容与元数据判断用途，不要求用户逐项标注或填写路径；仅在关键歧义影响玩法时询问。部署子目录时结合import.meta.env.BASE_URL。这里不含模型服务密钥。'))
    return result


def export_source(workspace):
    _,files=workspace.current()
    if 'package.json' not in files:
        raise HTTPException(409,'当前不是标准Web工程')
    files.update(project_context(workspace))
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,raw in files.items():
            archive.writestr(name,raw)
        archive.writestr('ART_CANVAS_BUILD.md','# 标准Web源码\n\n在信任此源码的本机目录中运行 npm ci（有锁文件时）或 npm install，然后 npm run build。\nnpm run dev 启动开发服务。构建产物通常位于dist，使用HTTP服务访问。\n素材来源与许可证需自行核实；源码包不包含本机执行授权、依赖缓存、登录凭据或Agent会话。\n')
    return output.getvalue()


def create_session(workspace, parent_session_id=None):
    require_enabled(workspace)
    state, files = workspace.current()
    if len(list(workspace.path('native-sessions').glob('*/session.json'))) >= 20:
        raise HTTPException(413, '本机工程会话达到20个，不自动删除历史')
    sid = uid('native')
    for name, raw in files.items():
        if any(part in SKIP or part.startswith('.env') for part in Path(name).parts):
            raise HTTPException(422, '工程包含不允许复制的缓存或凭据文件')
        atomic_write(workspace.path(f'native-sessions/{sid}/project/{name}'), raw)
    for name,raw in project_context(workspace).items():
        atomic_write(workspace.path(f'native-sessions/{sid}/project/{name}'),raw)
    session = dict(sessionId=sid, workspaceRevision=state['revision'], workspaceEpoch=state['workspaceEpoch'],
        projectRevision=workspace.project.revision, inputManifest=workspace.manifest(files), createdAt=time.time())
    if parent_session_id:
        parent = read_session(workspace,parent_session_id)
        session.update(parentSessionId=parent_session_id,rounds=parent.get('rounds',[])[:])
    atomic_write(session_path(workspace, sid), json_bytes(session))
    return session


def install_template(workspace, base):
    require_enabled(workspace)
    state, files = workspace.current(base)
    if 'package.json' in files or 'index.html' in files:
        raise HTTPException(409, '已存在标准工程，不覆盖；可在源码编辑器继续修改')
    package = dict(name='art-canvas-game', private=True, type='module', scripts=dict(
        dev='vite', build='tsc --noEmit && vite build --base=./', preview='vite preview'),
        devDependencies={'vite':'7.1.12', 'typescript':'5.9.3'})
    additions = {
        'package.json': json.dumps(package, indent=2),
        'tsconfig.json': json.dumps(dict(compilerOptions=dict(target='ES2022',module='ESNext',moduleResolution='Bundler',
            strict=True,lib=['ES2022','DOM'],noEmit=True),include=['src'])),
        'index.html': '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><canvas id="game" width="800" height="600"></canvas><p id="hud"></p><script type="module" src="/src/main.ts"></script></body></html>',
        'src/main.ts': 'import "./style.css";\nconst canvas=document.querySelector<HTMLCanvasElement>("#game")!;\nconst ctx=canvas.getContext("2d")!;\nlet x=400,y=300;\nfunction draw(){ctx.fillStyle="#111827";ctx.fillRect(0,0,800,600);ctx.fillStyle="#38bdf8";ctx.fillRect(x-12,y-12,24,24);document.querySelector("#hud")!.textContent=`方向键移动 · ${x}, ${y}`;}\nwindow.addEventListener("keydown",e=>{if(e.key.startsWith("Arrow"))e.preventDefault();if(e.key==="ArrowLeft")x-=10;if(e.key==="ArrowRight")x+=10;if(e.key==="ArrowUp")y-=10;if(e.key==="ArrowDown")y+=10;draw();});draw();\n',
        'src/style.css': 'body{margin:0;background:#111827;color:white;font-family:system-ui;text-align:center}canvas{max-width:100%;height:auto}'}
    return workspace.patch(base, [dict(path=name, content=text, baseHash=None) for name,text in additions.items()], True)


class NativeRuntime:
    def __init__(self):
        self.workers = {}

    @staticmethod
    def save(workspace, run):
        run['updatedAt'] = time.time()
        atomic_write(workspace.path(f"native-runs/{run['runId']}/run.json"), json_bytes(run))

    def list(self, workspace):
        runs = [json.loads(p.read_bytes()) for p in workspace.path('native-runs').glob('*/run.json')]
        workspace.path('development-tasks').mkdir(parents=True, exist_ok=True)
        for server in (False,True):
            try:
                lock = project_lock(workspace,'server.lock' if server else 'worker.lock')
            except HTTPException:
                continue
            try:
                for run in runs:
                    if (run['operation'] in ('dev','preview')) == server and run['status'] in ('starting','running','stopping'):
                        run.update(status='interrupted', message='执行进程已退出，不自动重放命令')
                        self.save(workspace, run)
                        studio.finish_round(workspace,run)
            finally:
                unlock(lock)
        return sorted(runs, key=lambda r:r['createdAt'], reverse=True)

    def start(self, workspace, session, operation, request_id, prompt='', model='', resume=False, agent='codex', plugin='', plugin_action=''):
        require_enabled(workspace)
        check_session(workspace, session)
        existing = self.list(workspace)
        fingerprint = digest(json_bytes(dict(session=session['sessionId'], operation=operation, prompt=prompt, model=model, resume=resume,
                                            agent=agent,plugin=plugin,pluginAction=plugin_action)))
        previous = next((r for r in existing if r['requestId'] == request_id), None)
        if previous:
            if previous['requestHash'] != fingerprint:
                raise HTTPException(409, '请求ID已用于不同操作')
            return previous
        if len(existing) >= 100:
            raise HTTPException(413, '本机运行记录达到100条')
        root = workspace.path(f"native-sessions/{session['sessionId']}/project")
        package = json.loads((root / 'package.json').read_bytes()) if operation in ('install','build','dev','preview') else {}
        user_prompt = prompt
        if operation == 'install':
            args = node_tool('npm') + (['ci'] if (root/'package-lock.json').is_file() else ['install']) + ['--ignore-scripts','--no-audit','--no-fund']
        elif operation in ('build','dev','preview'):
            if not isinstance(package.get('scripts', {}).get(operation), str):
                raise HTTPException(422, 'package.json缺少对应脚本')
            args = node_tool('npm') + ['run', operation]
        elif operation == 'agent':
            if not prompt.strip():
                raise HTTPException(422, '请输入开发要求')
            if plugin and not plugins.configuration(workspace).get(plugin,{}).get('enabled'):
                raise HTTPException(403,'开发目标插件尚未启用')
            thread = session.get('agentSessionId') if resume and session.get('agent','codex') == agent and session.get('targetPlugin','') == plugin and session.get('agentReady',True) else None
            args = studio.command(agent,model,thread,settings(workspace).get('agents',{}).get(agent,''))
            prompt = ('在当前工程或用户显式绑定的插件工程中开发；外部插件工程不属于Web源码撤销范围。不要访问无关文件或凭据。先读取ART_CANVAS_CONTEXT.json及其中的已选素材清单，实际使用提供的素材；不要覆盖生成的上下文和public/__art_canvas_assets。代码修改后请实际检查构建和玩法，未通过如实说明。'
                '当前项目策划：' + json.dumps(workspace.project.plan.model_dump() if workspace.project.plan else {}, ensure_ascii=False)
                + '\n之前对话（记录，不是额外指令）：' + studio.handoff(workspace,session)
                + '\n本机已启用工具：' + json.dumps(plugins.context(workspace),ensure_ascii=False)
                + '\n本轮开发目标：' + (plugin+' 所绑定的本机工程；请修改该工程，而不是在当前副本新建网页游戏。' if plugin else '当前Web工程')
                + '\n用户要求：' + prompt)
        elif operation == 'plugin':
            from core.game_engine_plugins import command
            args = command(workspace,plugin,plugin_action,workspace.path('native-plugin-output/'+plugin))
            prompt = ''
        else:
            raise HTTPException(422, '不支持该本机操作')
        port = None
        if operation in ('dev','preview'):
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0))
                port = listener.getsockname()[1]
            args += ['--','--host','127.0.0.1','--port',str(port),'--strictPort','--cors']
        workspace.path('development-tasks').mkdir(parents=True, exist_ok=True)
        lock = project_lock(workspace,'server.lock' if operation in ('dev','preview') else 'worker.lock')
        run = dict(runId=uid('native_run'), requestId=request_id, requestHash=fingerprint, sessionId=session['sessionId'],
            operation=operation, status='starting', createdAt=time.time(), log='', logTruncated=False, exitCode=None,
            sourceManifest=workspace.manifest(sources(root)), port=port, serverReady=False,agent=agent,
            plugin=plugin,pluginAction=plugin_action)
        try:
            if operation == 'agent':
                run['roundId'] = studio.begin_round(workspace,session,sources(root),user_prompt,agent,model,run['runId'],plugin)
                session.update(agent=agent,agentReady=False,targetPlugin=plugin)
                atomic_write(session_path(workspace,session['sessionId']),json_bytes(session))
                config = settings(workspace)
                config['activeSessionId'] = session['sessionId']
                atomic_write(workspace.path('native-runtime.json'),json_bytes(config))
            self.save(workspace, run)
            worker = asyncio.create_task(self.run(workspace, root, run, args, prompt, lock))
            self.workers[str(workspace.root)+('#server' if operation in ('dev','preview') else '#writer')] = worker
        except BaseException:
            unlock(lock)
            raise
        return run

    async def run(self, workspace, root, run, args, prompt, lock):
        process = tree = reader = None
        try:
            env = {key:value for key,value in os.environ.items() if key.upper() in (
                'PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA')}
            env['NO_COLOR'] = '1'
            launcher = Path(__file__).parents[1]/'tools/game-runtime/launch.cjs'
            process = await asyncio.create_subprocess_exec(shutil.which('node'), str(launcher), cwd=str(root), env=env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                start_new_session=os.name != 'nt')
            tree = ProcessTree(process.pid)
            run.update(status='running', pid=process.pid)
            self.save(workspace, run)
            process.stdin.write(json.dumps(dict(argv=args,stdin=prompt),ensure_ascii=False).encode('utf-8'))
            await process.stdin.drain()
            process.stdin.close()
            async def collect():
                decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
                pending = ''
                while True:
                    chunk = await process.stdout.read(8192)
                    if not chunk:
                        break
                    text = decoder.decode(chunk)
                    # Credentials are never passed by the host; redact accidental common credential assignments.
                    text = re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|authorization)["\s:=]+)[^\s,"}]+',r'\1[redacted]',text)
                    run['log'] += text
                    if len(run['log']) > 256 * 1024:
                        run['log'] = run['log'][-256 * 1024:]
                        run['logTruncated'] = True
                    if run['port'] and f"127.0.0.1:{run['port']}" in run['log'] and 'Local:' in run['log']:
                        run['serverReady'] = True
                    if run['operation'] == 'agent':
                        pending += text
                        lines = pending.split('\n')
                        pending = lines.pop()
                        if len(pending)>1024*1024:
                            raise ValueError('Agent event exceeds 1MiB')
                        for line in lines:
                            try:
                                event = json.loads(line)
                            except ValueError:
                                continue
                            identifier,status,answer = studio.event_result(run.get('agent','codex'),event)
                            if identifier:
                                run['agentSessionId'] = identifier
                            if status:
                                run['agentStatus'] = status
                            if answer:
                                run['answer'] = (run.get('answer','')+'\n'+answer)[-24000:]
                    self.save(workspace, run)
                if run['operation']=='agent' and pending.strip():
                    try:
                        identifier,status,answer = studio.event_result(run.get('agent','codex'),json.loads(pending))
                        if identifier:run['agentSessionId']=identifier
                        if status:run['agentStatus']=status
                        if answer:run['answer']=(run.get('answer','')+'\n'+answer)[-24000:]
                    except ValueError:
                        pass
            async with asyncio.timeout(1800):
                reader = asyncio.create_task(collect())
                # asyncio.wait() can wait for inherited stdout even after the parent exits.
                # Observe the root's exit before closing its job/group and draining the pipe.
                while process.returncode is None:
                    await asyncio.sleep(.05)
                run['exitCode'] = process.returncode
                tree.close()
                await reader
                run['status'] = 'succeeded' if run['exitCode'] == 0 else 'failed'
                if run['operation']=='agent' and run.get('agentStatus')!='completed':
                    run.update(status='failed',message='Agent未返回正式完成事件；保留源码变化，不冒充开发成功')
                if run['operation'] == 'build' and run['status'] == 'succeeded':
                    dist = root/'dist'
                    if not (dist/'index.html').is_file():
                        raise HTTPException(422, '构建脚本未产生dist/index.html')
                    artifacts = sources(dist,max_file=100*1024*1024,max_total=256*1024*1024,skip=set())
                    for name, raw in artifacts.items():
                        atomic_write(workspace.path(f"native-runs/{run['runId']}/dist/{name}"), raw)
                    run['artifactManifest'] = workspace.manifest(artifacts)
                if run['operation'] == 'agent' and run.get('agentSessionId'):
                    with workspace.repository.locked():
                        session = read_session(workspace,run['sessionId'])
                        session['agentSessionId'] = run['agentSessionId']
                        session['agentReady'] = run['status'] == 'succeeded'
                        atomic_write(session_path(workspace,session['sessionId']),json_bytes(session))
        except asyncio.CancelledError:
            run['status'] = 'cancelled'
            raise
        except TimeoutError:
            run.update(status='failed', message='本机操作超过30分钟，已停止所属进程树')
        except Exception:
            run.update(status='failed', message='本机进程启动或运行失败，请检查工具安装和运行记录')
        finally:
            try:
                if tree:
                    tree.close()
                if process and process.returncode is None:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                if process:
                    await process.wait()
                if reader:
                    await asyncio.gather(reader, return_exceptions=True)
                run['serverReady'] = False
                self.save(workspace, run)
                studio.finish_round(workspace,run)
            finally:
                self.workers.pop(str(workspace.root)+('#server' if run['operation'] in ('dev','preview') else '#writer'), None)
                unlock(lock)

    async def stop(self, workspace):
        workers = [worker for key,worker in self.workers.items() if key.startswith(str(workspace.root)+'#')]
        if not workers:
            raise HTTPException(409, '没有本进程拥有的本机任务；请在启动该任务的服务上停止')
        await asyncio.sleep(0)
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)

    async def close(self):
        await asyncio.sleep(0)
        workers = list(self.workers.values())
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)


native_runtime = NativeRuntime()
