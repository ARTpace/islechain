"""本机引擎/创作工具适配：固定 argv，无 shell，复用宿主进程树。"""
import shutil
import json
from pathlib import Path
from fastapi import HTTPException

PLUGINS = {
    'godot': dict(name='Godot', commands=['godot','godot4'], suffixes=['.godot'], actions=['check','run','editor']),
    'unity': dict(name='Unity', commands=['Unity'], suffixes=[], actions=['check','editor']),
    'unreal': dict(name='Unreal Engine', commands=['UnrealEditor'], suffixes=['.uproject'], actions=['run','editor']),
    'cocos': dict(name='Cocos Creator', commands=['CocosCreator','Creator'], suffixes=[], actions=['build','editor']),
    'blender': dict(name='Blender', commands=['blender'], suffixes=['.blend'], actions=['check','render','editor']),
    'aseprite': dict(name='Aseprite', commands=['aseprite'], suffixes=['.aseprite','.ase'], actions=['export','editor']),
    'tiled': dict(name='Tiled', commands=['tiled'], suffixes=['.tmx','.tmj'], actions=['export','editor']),
}


def configuration(workspace):
    return json.loads(workspace.path('native-runtime.json').read_bytes()).get('plugins', {}) if workspace.path('native-runtime.json').is_file() else {}


def tool_path(plugin, configured=''):
    path = configured or next((p for c in PLUGINS[plugin]['commands'] if (p := shutil.which(c))), '')
    candidate = Path(path)
    if not path or not candidate.is_absolute() or not candidate.is_file() or candidate.suffix.lower() in ('.cmd','.bat','.ps1'):
        raise HTTPException(409, '未找到工具，请配置实际可执行文件绝对路径')
    return str(candidate)


def validate(plugin, executable, project):
    if plugin not in PLUGINS:
        raise HTTPException(422, '未知插件')
    tool_path(plugin, executable)
    path = Path(project)
    if not path.is_absolute() or not path.exists():
        raise HTTPException(422, '请选择实际存在的工程文件或目录绝对路径')
    spec = PLUGINS[plugin]
    if spec['suffixes'] and (not path.is_file() or path.suffix.lower() not in spec['suffixes']):
        raise HTTPException(422, '工程文件格式不匹配')
    if plugin in ('unity','cocos') and not path.is_dir():
        raise HTTPException(422, '请选择工程目录')
    if plugin == 'unity' and not (path/'ProjectSettings/ProjectVersion.txt').is_file():
        raise HTTPException(422, '不是 Unity 工程目录')
    if plugin == 'cocos' and not (path/'package.json').is_file():
        raise HTTPException(422, '不是 Cocos 工程目录')
    return dict(executable=executable, project=str(path), enabled=True)


def catalog(workspace):
    configured = configuration(workspace)
    result = []
    for key,spec in PLUGINS.items():
        value = configured.get(key, {})
        try:
            tool_path(key,value.get('executable',''))
            available = True
        except HTTPException:
            available = False
        result.append(dict(id=key, **spec, **value, available=available))
    return result


def command(workspace, plugin, action, output_root):
    config = configuration(workspace).get(plugin)
    if not config or not config.get('enabled'):
        raise HTTPException(403, '请先为本项目配置并启用插件')
    config = validate(plugin, config.get('executable',''), config['project'])
    spec = PLUGINS[plugin]
    if action not in spec['actions']:
        raise HTTPException(422, '插件不支持该操作')
    exe = tool_path(plugin,config['executable'])
    project = config['project']
    output_root.mkdir(parents=True, exist_ok=True)
    if plugin == 'godot':
        args = ['--path',str(Path(project).parent)]
        args += ['--headless','--editor','--quit'] if action == 'check' else ['--editor'] if action == 'editor' else []
    elif plugin == 'unity':
        args = ['-projectPath',project]
        if action == 'check':
            args += ['-batchmode','-quit','-logFile','-']
    elif plugin == 'unreal':
        args = [project] + (['-game'] if action == 'run' else [])
    elif plugin == 'cocos':
        args = ['--project',project]
        if action == 'build':
            args += ['--build',f'platform=web-desktop;buildPath={output_root.as_posix()}']
    elif plugin == 'blender':
        args = [project] if action == 'editor' else ['--background',project]
        if action == 'render':
            args += ['--render-output',str(output_root/'frame_####'),'--render-frame','1']
    elif plugin == 'aseprite':
        args = [project] if action == 'editor' else ['--batch',project,'--sheet',str(output_root/'sprites.png'),'--data',str(output_root/'sprites.json')]
    else:
        args = [project] if action == 'editor' else ['--export-map','json',project,str(output_root/'map.json')]
    return [exe] + args


def context(workspace):
    result = []
    for plugin,config in configuration(workspace).items():
        if plugin not in PLUGINS or not config.get('enabled'):
            continue
        try:
            tools = {action:command(workspace,plugin,action,workspace.path('native-plugin-output/'+plugin))
                     for action in PLUGINS[plugin]['actions']}
            result.append(dict(plugin=plugin, project=config['project'], commands=tools,
                               note='这些是用户显式绑定的本机工程；操作使用本机权限。外部工程不属于Web逐轮撤销范围。'))
        except HTTPException:
            continue
    return result
