"""Frozen scene graphs run in disposable, opaque sandbox frames."""
import html
import json
from pathlib import Path
try:
    from core.game_web_template import node_preview
except ModuleNotFoundError:
    from web_bundle import node_preview


def validate_sources(graph):
    import shutil
    import subprocess
    from fastapi import HTTPException
    node=shutil.which('node')
    if not node:raise HTTPException(503,'场景语法检查需要 Node.js')
    source='\n;\n'.join('(function(){\n'+n.source+'\n});' for n in graph.nodes)
    try:result=subprocess.run([node,'--max-old-space-size=64','--check','--input-type=commonjs'],input=source.encode(),capture_output=True,timeout=10)
    except subprocess.TimeoutExpired as exc:raise HTTPException(408,'场景语法检查超时') from exc
    if result.returncode:raise HTTPException(422,'场景代码语法错误：'+result.stderr.decode(errors='replace')[-1000:])


def graph_page(title, graph, config):
    config={**config,'sceneGraph':graph}
    root=Path(__file__).parents[1]
    if not (root/'templates/game-runtime/scenes.js').is_file():root=Path(__file__).parent
    runtime=(root/'templates/game-runtime/scenes.js').read_text('utf-8')
    # No same-origin permission: scene code cannot access the editor or sibling scenes.
    graph_json=json.dumps(config,ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    assets_runtime=(root/'templates/game-runtime/assets.js').read_text('utf-8')
    if config.get('engine')=='three':
        assets_runtime=(root/'templates/game-web-3d/three-runtime.js').read_text('utf-8')+'\n'+assets_runtime
    child_prefix=node_preview('scene-preview').decode()
    data=json.dumps({'assetsRuntime':assets_runtime,'preview':child_prefix},ensure_ascii=False).replace('<','\\u003c')
    embedded_style='nav{display:none!important}' if config.get('embedded') else ''
    return (f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>{html.escape(title)}</title><style>html,body{{margin:0;height:100%;background:#10191e;color:#ddd;font:14px system-ui}}body{{display:flex;flex-direction:column}}iframe{{flex:1;width:100%;border:0;min-height:0}}nav{{padding:6px;display:flex;gap:8px;align-items:center}}button{{cursor:pointer}}#status{{flex:1}}{embedded_style}</style></head><body><nav><span id="status"></span><button id="restart">重开</button><button id="save">保存</button><button id="load">载入</button></nav><iframe title="可玩场景" sandbox="allow-scripts"></iframe>
<script>window.GAME_CONFIG={graph_json};window.SCENE_RUNTIME={data};</script><script>{runtime}</script></body></html>""").encode('utf-8')
