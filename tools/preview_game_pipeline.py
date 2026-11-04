"""隔离人工验收入口：临时账号/画布、模拟图片通道，不读写真实用户数据。

运行 python tools/preview_game_pipeline.py --port 18765；访问终端打印的地址。
关闭服务后临时数据清理；可用于后续重复人工验收，不启动生产服务。
"""
import argparse
import asyncio
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid


def run(port, workbench=False, broken_source=False, runtime_source=False, model3d=False, extra_nodes=False, mcp=False, node_plugins=False):
    with tempfile.TemporaryDirectory(prefix='game-pipeline-preview-') as directory:
        os.environ['ART_CANVAS_HOME'] = directory
        os.environ['PYTHONIOENCODING'] = 'utf-8'
        sys.path.insert(0, str(Path(__file__).parents[1]))
        import core.user_paths
        core.user_paths.migrate_project_user_data = lambda *a, **k: []
        import core.media_migration
        core.media_migration.migrate = lambda *a, **k: {}
        import main
        from core import lan_sharing
        lan_sharing.LOCAL_PORT = port
        from fastapi.responses import RedirectResponse
        from PIL import Image, ImageDraw
        import uvicorn
        import httpx

        owner, token = 'pipeline-preview', uuid.uuid4().hex
        main.save_users({owner: {'token': token}})
        main.load_api_providers = lambda: [dict(id='preview', name='隔离模拟图片（非真实模型）', enabled=True, primary=True,
            api_key='mock-only', base_url='https://mock.invalid', protocol='openai',
            image_models=['mock-image'], chat_models=['mock-plan'])]
        main.migrate_api_providers_from_app_dir = lambda: None
        os.environ[main.provider_key_env('preview')] = 'mock-only'
        main.resolve_chat_provider = lambda *a: ('https://mock.invalid/v1', {}, 'mock-plan')
        if mcp:
            from core.mcp_tools import save_server
            save_server({'id': 'local-test', 'transport': 'stdio', 'command': sys.executable,
                'args': [str(Path(__file__).parents[1] / 'tests/mcp_stdio_fixture.py')],
                'enabledTools': ['add', 'peek', 'picture', 'slow', 'smash'], 'trustTools': False})
        example_data = json.loads((Path(__file__).parents[1] / 'docs/examples/game-project.json').read_text('utf-8'))
        original_post = httpx.AsyncClient.post

        async def mock_llm(client, url, **kwargs):
            if str(url).startswith('https://mock.invalid/'):
                messages = kwargs['json']['messages']
                if '根据 instruction 编辑游戏策划资料' in messages[0]['content']:
                    content = messages[1]['content']
                    context = json.loads(content if isinstance(content, str) else content[0]['text'])
                    source = context['source']
                    if 'columns' in source:
                        source['rows'].append({'id': 'mock_enemy', 'cells': {source['columns'][0]['id']: '模拟敌人'}})
                        text = json.dumps(source, ensure_ascii=False)
                    else:
                        text = source['lastSavedContent'] + '\n\n## AI 补充\n玩家收集零件修复飞船，完成后进入下一关。'
                    return httpx.Response(200, request=httpx.Request('POST', url),
                        json={'choices': [{'finish_reason': 'stop', 'message': {'content': text}}]})
                if '输出资产条目' in messages[0]['content']:
                    data = example_data['assets']
                else:
                    data = json.loads(json.dumps(example_data['plan']))
                    for entity in data['characters'] + data['scenes']:
                        entity['assetIds'] = []
                return httpx.Response(200, request=httpx.Request('POST', url),
                    json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(data, ensure_ascii=False)}}]})
            return await original_post(client, url, **kwargs)

        from contextlib import asynccontextmanager
        original_stream = httpx.AsyncClient.stream
        @asynccontextmanager
        async def mock_stream(client, method, url, **kwargs):
            if str(url).startswith('https://mock.invalid/'):
                messages = kwargs['json']['messages']
                tools = kwargs['json'].get('tools', [])
                if any(tool['function']['name'] == 'canvas_read' for tool in tools):
                    user_text = next((message['content'] for message in reversed(messages) if message['role']=='user'), '')
                    if '故障验收' in user_text:
                        yield httpx.Response(503, json={'error': 'isolated failure fixture'})
                        return
                    completed = {call['function']['name'] for message in messages for call in message.get('tool_calls', [])}
                    external = next((tool['function']['name'] for tool in tools if tool['function']['name'].startswith('mcp_')), None)
                    if 'canvas_read' not in completed:
                        name, arguments = 'canvas_read', {}
                    elif external and external not in completed:
                        name, arguments = external, {'left': 2, 'right': 5}
                    elif 'canvas_propose_workflow' not in completed:
                        name, arguments = 'canvas_propose_workflow', {'summary': '离线模拟：角色美术生成工作流',
                            'nodes': [{'id': 'art_prompt', 'type': 'prompt', 'x': 0, 'y': 0, 'fields': {'text': '像素风森林精灵，透明背景，游戏角色素材'}},
                                {'id': 'art_generator', 'type': 'generator', 'x': 440, 'y': 0}, {'id': 'art_output', 'type': 'output', 'x': 880, 'y': 0}],
                            'connections': [{'from': 'art_prompt', 'to': 'art_generator'}, {'from': 'art_generator', 'to': 'art_output'}]}
                        current = next((json.loads(message['content']) for message in reversed(messages)
                            if message.get('role')=='tool' and 'connectionRules' in message.get('content','')), {})
                        selected = current.get('selectedNodeIds', [])
                        target = next((node for node in current.get('nodes', []) if node['id'] in selected and node['type']=='prompt'), None)
                        if target and ('改' in user_text or '修改' in user_text):
                            arguments = {'summary': '将引用的角色提示词修改为像素风，保留已有连线。', 'nodes': [], 'connections': [],
                                'updates': [{'id': target['id'], 'fields': {'text': '像素风森林精灵，绿色斗篷，透明背景，游戏角色素材'}}]}
                    else:
                        name, arguments = None, None
                    message = {'role': 'assistant', 'content': '离线模拟验收：工作流候选已生成，尚未执行生图。'}
                    if name:
                        message.update(content=None, tool_calls=[{'id': uuid.uuid4().hex, 'type': 'function',
                            'function': {'name': name, 'arguments': json.dumps(arguments, ensure_ascii=False)}}])
                    yield httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': message}], 'usage': {'total_tokens': 0}})
                    return
                context = json.loads(kwargs['json']['messages'][1]['content'])
                if 'maxSteps' in context:
                    if runtime_source:
                        suite=[dict(name='重开后计数归零',actions=[dict(type='click',selector='#restart')],assertions=[dict(kind='contains',selector='#hud',text='计数 0')]),
                            dict(name='点击画布计数增加',actions=[dict(type='click',selector='canvas')],assertions=[dict(kind='contains',selector='#hud',text='计数 1')])]
                        actions=[dict(action='playtest',tests=suite),dict(action='read',path='game.js',limit=40),
                            dict(action='create',path='src/state.js',content='window.Game={count:0};'),
                            dict(action='edit',path='game.js',old='window.Game={count:0};\n',new=''),
                            dict(action='read',path='game.js',limit=40),dict(action='edit',path='game.js',old='missingCounter',new='0'),
                            dict(action='read',path='game.js',limit=40),dict(action='move',path='game.js',destination='src/main.js'),
                            dict(action='create',path='src/obsolete.js',content='// obsolete'),dict(action='read',path='src/obsolete.js'),
                            dict(action='delete',path='src/obsolete.js'),dict(action='playtest'),dict(action='finish',summary='修复重开运行错误，拆分状态模块并移动入口；原两条行为用例均已重放通过。')]
                    elif context.get('engineeringPlan'):
                        actions=[dict(action='playtest',tests=[dict(name='点击画布增加计数',actions=[dict(type='click',selector='canvas')],assertions=[dict(kind='contains',selector='#hud',text='计数 1')])]),dict(action='finish',summary='多文件样例点击回归通过')]
                    elif context['mode'] == 'repair':
                        actions = [dict(action='search',query='PREVIEW_BROKEN'),dict(action='read',path='game.js',start=1,limit=10),
                            dict(action='edit',path='game.js',old='const PREVIEW_BROKEN = ;',new='const PREVIEW_REPAIRED = true;'),
                            dict(action='playtest',tests=[dict(name='重开显示生命',actions=[dict(type='click',selector='#restart')],assertions=[dict(kind='contains',selector='#hud',text='生命')])]),
                            dict(action='finish',summary='修复隔离测试预置的语法错误，保留其他实现。')]
                    else:
                        actions = [dict(action='search',query='hud.textContent'),dict(action='read',path='game.js',start=60,limit=10),
                            dict(action='edit',path='game.js',old='生命 ${state.hp}',new='当前生命 ${state.hp}'),
                            dict(action='playtest',tests=[dict(name='新提示在重开后生效',actions=[dict(type='click',selector='#restart')],assertions=[dict(kind='contains',selector='#hud',text='当前生命')])]),
                            dict(action='finish',summary='只修改 HUD 的生命提示，保留玩法、存档和其他用户代码。')]
                    data = actions[context['step']]
                elif 'schema' in context:
                    data = dict(summary='模拟多文件游戏：计数与重开', entry='src/main.js', files=[
                        dict(path='style.css', purpose='界面样式', interface='Canvas 样式', dependsOn=[]),
                        dict(path='src/state.js', purpose='计数状态', interface='window.Game.count', dependsOn=[]),
                        dict(path='src/main.js', purpose='绘制与操作', interface='点击增加计数，重开归零', dependsOn=['src/state.js'])])
                else:
                    name = context['target']['path']
                    sources = {'style.css':'body{background:#15202b;color:#fff}canvas{background:#26394a;max-width:100%}',
                        'src/state.js':'window.Game={count:0};',
                        'src/main.js':'''(()=>{const c=document.querySelector('canvas'),x=c.getContext('2d'),h=document.querySelector('#hud');function draw(){x.clearRect(0,0,c.width,c.height);x.fillStyle='#7ee6bb';x.font='30px sans-serif';x.fillText('Click canvas: '+Game.count,60,100);h.textContent='模块已加载 · 计数 '+Game.count;}c.onclick=()=>{Game.count++;draw();};document.querySelector('#restart').onclick=()=>{Game.count=0;draw();};draw();})();'''}
                    data = dict(changes=[dict(path=name,content=sources[name])])
                yield httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(data,ensure_ascii=False)}}]})
            else:
                async with original_stream(client, method, url, **kwargs) as response:
                    yield response
        httpx.AsyncClient.stream = mock_stream
        httpx.AsyncClient.post = mock_llm
        canvas = main.new_canvas('隔离验收 · 游戏项目', owner=owner)
        canvas['kind'] = 'game'
        main.save_canvas(canvas)
        from routers.game_projects import CreateProject, create_project
        from core.game_projects import initial_game_workflow
        project = create_project(CreateProject(title=canvas['title'], canvasId=canvas['id']), token)['project']
        canvas['nodes'], canvas['connections'] = initial_game_workflow(project['id'])
        main.save_canvas(canvas)

        if workbench:
            from routers.game_projects import store
            from core.game_project_models import Plan, Asset
            from core.game_workspace import Workspace
            from core.game_web_builds import WebBuilds
            repository = store()
            with repository.locked():
                current = repository.read(project['id'], owner)
                current.plan = Plan.model_validate(example_data['plan'])
                current.assets = [Asset.model_validate(a) for a in example_data['assets']]
                current.planConfirmed = True
                current = repository.save(current)
                workspace = Workspace(repository, current)
                state = workspace.create()
                state = WebBuilds(repository, current).install_template(state['revision'])
                WebBuilds(repository, current).build(state['revision'])
                if runtime_source:
                    from core.game_projects import digest
                    source=workspace.read('game.js')['content']
                    code='''window.Game={count:0};
(()=>{const c=document.querySelector('canvas'),x=c.getContext('2d'),h=document.querySelector('#hud');
function draw(){x.fillStyle='#162934';x.fillRect(0,0,800,600);x.fillStyle='#80e5bc';x.font='30px sans-serif';x.fillText('Click: '+Game.count,60,100);h.textContent='计数 '+Game.count;}
c.onclick=()=>{Game.count++;draw();};document.querySelector('#restart').onclick=()=>{Game.count=missingCounter;draw();};draw();})();
'''
                    workspace.patch(state['revision'],[dict(path='game.js',baseHash=digest(source.encode()),content=code)],True)
                if broken_source:
                    from core.game_projects import digest
                    source = workspace.read('game.js')['content']
                    workspace.patch(state['revision'], [dict(path='game.js', baseHash=digest(source.encode()),
                        content='const PREVIEW_BROKEN = ;\n' + source)], True)
        if model3d:
            from routers.game_projects import store
            from core import game_model3d as model_engine
            from core.game_projects import atomic_write, json_bytes, digest
            from core.game_project_models import RuntimeAsset
            from core.game_media_assets import inspect_media
            sample = Path(__file__).parents[1] / 'docs/examples/model3d/robot.glb'
            os.environ['NODE_OPTIONS'] = '--require=' + str(Path(__file__).parents[1] / 'tests/model3d-provider-fixture.cjs')
            os.environ['ART_MODEL3D_FIXTURE_FILE'] = str(sample)
            os.environ['ART_MODEL3D_FIXTURE_LOG'] = str(Path(directory) / 'model3d-requests.jsonl')
            repository = store()
            with repository.locked():
                current = repository.read(project['id'], owner)
                raw = sample.read_bytes(); kind, mime, metadata = inspect_media(sample.name, raw)
                relative = 'assets/demo-robot/model.glb'
                atomic_write(repository.directory(current.id) / relative, raw)
                current.mediaAssets.append(RuntimeAsset(id='demo-robot', name='示例机器人.glb', kind=kind, mime=mime,
                    purpose='原创演示模型', relativePath=relative, contentHash=digest(raw), sizeBytes=len(raw), metadata=metadata))
                repository.save(current)
                atomic_write(model_engine.config_path(repository, owner), json_bytes([dict(id='offline-meshy', name='离线模拟 Meshy（不计费）',
                    protocol='meshy', baseUrl='https://3d-fixture.invalid/meshy/v1', apiKey='offline-test-only', enabled=True, authentication='api_key', models=None, headers={})]))
            canvas['nodes'] = [dict(id='demo-model', type='gameModelAsset', projectId=current.id, modelAssetId='demo-robot', x=60, y=80),
                dict(id='demo-generate', type='gameModel3d', projectId=current.id, modelOperation='text', modelPrompt='A friendly robot', x=560, y=80),
                dict(id='demo-animate', type='gameAnimate3d', projectId=current.id, x=1060, y=80)]
            canvas['connections'] = [dict(id='demo-link', **{'from':'demo-model','to':'demo-animate'})]
            main.save_canvas(canvas)
        if extra_nodes:
            os.environ['NODE_OPTIONS']='--require='+str(Path(__file__).parents[1]/'tests/audio-provider-fixture.cjs')
            from routers.game_projects import store
            from routers.game_audio import config_path
            from core.game_projects import atomic_write,json_bytes
            repository=store()
            current=repository.read(project['id'],owner)
            atomic_write(config_path(repository,owner),json_bytes([dict(id='offline-audio',name='隔离模拟音频',protocol='volcengine-seed-audio',baseUrl='https://audio-fixture.invalid/create',apiKey='offline-audio-key',enabled=True)]))
            canvas['nodes']=[dict(id='extra-'+kind,type=kind,projectId=current.id,x=60+(i%3)*490,y=80+(i//3)*460,audioConnection='offline-audio',audioPrompt='轻柔森林环境声',audioSettings={'format':'wav'}) for i,kind in enumerate(['gameSpeech','gameSoundEffect','gameMusic','gameAudioScene','gameFile','gameFolder'])]
            first="const c=document.querySelector('canvas'),x=c.getContext('2d');x.fillStyle='#16364a';x.fillRect(0,0,800,600);x.fillStyle='white';x.font='32px sans-serif';x.fillText('森林入口 · 点击前进',50,140);c.onclick=()=>GameScene.emit('next',{score:(GameScene.state.score||0)+1});"
            second="const c=document.querySelector('canvas'),x=c.getContext('2d');x.fillStyle='#1d493e';x.fillRect(0,0,800,600);x.fillStyle='white';x.font='32px sans-serif';x.fillText('森林深处 · 得分 '+GameScene.state.score,50,140);document.querySelector('#hud').textContent='得分 '+GameScene.state.score;c.onclick=()=>GameScene.emit('next');"
            canvas['nodes'] += [dict(id='scene-a',type='gameScene',projectId=current.id,title='森林入口',sceneSource=first,sceneSignals=['next'],x=60,y=1000),dict(id='scene-b',type='gameScene',projectId=current.id,title='森林深处',sceneSource=second,sceneSignals=['next'],x=550,y=1000)]
            canvas['connections']=[dict(id='scene-edge',**{'from':'scene-a','to':'scene-b'},sceneSignal='next')]
            main.save_canvas(canvas)
        if node_plugins:
            from core import node_catalog
            from core.node_media import NodeMedia
            from core.node_audio import fixture_audio
            from core.node_video import fixture_video
            media = NodeMedia(owner)
            audio = media.save(fixture_audio({'frames': 800}), audio=True)
            video = media.save(fixture_video({'width': 64, 'height': 48, 'frames': 4}), video=True)
            canvas['nodes'], canvas['connections'] = [], []
            for index, (name, kind, reference, input_port) in enumerate([
                    ('node-audio-wav', 'audio', audio, 'sound'), ('node-video', 'video', video, 'clip')]):
                example = json.loads((Path(__file__).parents[1] / 'docs/examples' / (name + '.json')).read_text('utf-8'))
                item = node_catalog.install(example['definition'], trusted=True)
                source, target = 'source-' + kind, 'target-' + kind
                canvas['nodes'].extend([
                    dict(id=source, type='image', mediaKind=kind, url=reference['url'], name=kind + '素材', x=60, y=80 + index*500, w=320),
                    dict(id=target, type='extension', nodeDefinition=json.dumps(item, ensure_ascii=False),
                         definitionHash=node_catalog.digest(item), extensionParams={'text': ''}, x=540, y=80+index*500, w=380)])
                canvas['connections'].append(dict(id='link-'+kind, **{'from': source, 'to': target},
                                                  bindings=[{'source': kind, 'target': input_port}]))
            main.save_canvas(canvas)

        async def simulate(payload, username=None, on_progress=None):
            await asyncio.sleep(.1)
            for ref in payload.reference_images:
                path = main.output_file_from_url(ref.url)
                if not path or not Path(path).is_file():
                    raise ValueError('参考图未能读取')
            pair = payload.size.lower().split('x')
            width, height = (int(pair[0]), int(pair[1])) if len(pair) == 2 else (256, 256)
            image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rounded_rectangle((width*.15, height*.15, width*.85, height*.85), radius=max(4, width//8), fill=(73, 122, 87, 255))
            draw.ellipse((width*.35, height*.3, width*.65, height*.6), fill=(230, 200, 112, 255))
            buffer = io.BytesIO(); image.save(buffer, 'PNG')
            filename = 'mock_' + uuid.uuid4().hex + '.png'
            folder, _ = main.get_user_output_dir(owner)
            Path(folder, filename).write_bytes(buffer.getvalue())
            url = main.build_output_url(None, filename, owner)
            return dict(images=[url], model='mock-image', provider_id='preview',
                        params=dict(size=payload.size), timestamp=0)

        main.build_online_image_result = simulate

        @main.app.get('/pipeline-preview')
        def preview():
            response = RedirectResponse('/static/game-workbench.html?projectId=' + project['id'] if workbench and not model3d
                                        else '/static/canvas.html?id=' + canvas['id'])
            response.set_cookie('xy_auth_token', token, httponly=True, samesite='lax')
            return response

        # 提供样例按钮测试数据；仅此隔离服务器注册，不进入业务路由。
        @main.app.get('/pipeline-preview-example')
        def example():
            return json.loads((Path(__file__).parents[1] / 'docs/examples/game-project.json').read_text('utf-8'))

        print(f'ISOLATED_PREVIEW http://127.0.0.1:{port}/pipeline-preview', flush=True)
        uvicorn.run(main.app, host='127.0.0.1', port=port, lifespan='off', log_level='warning')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18765)
    parser.add_argument('--workbench', action='store_true', help='预置已确认策划、文件工程和灰盒构建')
    parser.add_argument('--broken-source', action='store_true', help='仅隔离工程：预置可供修复的 JS 语法错误')
    parser.add_argument('--runtime-source',action='store_true',help='仅隔离工程：预置点击重开才触发的运行错误')
    parser.add_argument('--model3d', action='store_true', help='预置三个 3D 节点和仅离线模拟的 3D 服务')
    parser.add_argument('--extra-nodes',action='store_true',help='预置音频、文件和可玩场景节点；所有音频调用均离线模拟')
    parser.add_argument('--mcp', action='store_true', help='离线模型工作流与真实本机 MCP 测试服务，不读取用户素材')
    parser.add_argument('--node-plugins', action='store_true', help='预置通用音视频节点与合成素材，不调用外部服务')
    options = parser.parse_args()
    run(options.port, options.workbench, options.broken_source, options.runtime_source, options.model3d, options.extra_nodes, options.mcp, options.node_plugins)
