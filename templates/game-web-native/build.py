"""源码包离线打包入口：Python 3.12+，无第三方依赖，不执行游戏源码。"""
import base64
import hashlib
import json
from pathlib import Path

from web_bundle import make_page


def build():
    root = Path(__file__).resolve().parent
    source = json.loads((root / 'source-manifest.json').read_text(encoding='utf-8'))
    def read(name):
        path = (root / name).resolve()
        if not path.is_relative_to(root) or path.is_symlink():
            raise ValueError('源码路径越界')
        if path.stat().st_size > 40 * 1024 * 1024:
            raise ValueError('源码文件超限')
        return path.read_bytes()
    for name, expected in source['files'].items():
        if hashlib.sha256(read(name)).hexdigest() != expected:
            raise ValueError(f'源码或资源已变化：{name}；确认修改后更新清单 hash 再打包')
    assets, resources = {}, {}
    for asset in source['assets']:
        if asset.get('external'):
            name = 'resources/' + Path(asset['sourcePath']).name
            assets[asset['assetId']] = name
            resources[name] = read(asset['sourcePath'])
        else:
            assets[asset['assetId']] = 'data:' + asset['mime'] + ';base64,' + base64.b64encode(read(asset['sourcePath'])).decode()
    config = dict(projectId=source['projectId'], buildId='source-development', saveSlot='play',
                  content=json.loads(read('game/content/game-data.json')), assets=assets,
                  engine=source.get('engine','canvas'),assetInfo=source.get('assetInfo',{}))
    def combine(names, separator):
        if not names or any(name not in source['files'] for name in names):
            raise ValueError('加载清单引用了未校验源码')
        return separator.join(read(name).decode('utf-8') for name in names)
    if source.get('playableGraph'):
        from scenes_bundle import graph_page
        graph=source['playableGraph']
        for scene in graph['nodes']:
            path=scene.pop('sourcePath')
            if path not in source['files']:raise ValueError('场景源码未校验')
            scene['source']=read(path).decode('utf-8')
        page=graph_page(source['title'],graph,config)
    else:
        page = make_page(source['title'], config, combine(source.get('scripts', ['game/game.js']), '\n;\n'),
                         combine(source.get('styles', ['game/style.css']), '\n'), 'source-development')
    output = root / 'dist'
    output.mkdir(exist_ok=True)
    (output / 'index.html').write_bytes(page)
    for name,raw in resources.items():
        path = output / name
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(raw)
    print('Built dist/index.html; development only; gameplay verification still required.')


if __name__ == '__main__':
    build()
