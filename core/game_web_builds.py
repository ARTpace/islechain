"""无第三方依赖的受控 Web 打包；读取文本与已选素材，不运行工程命令。"""
import base64
import io
import json
import zipfile
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException

from core.game_projects import atomic_write, digest, json_bytes, uid
from core.game_workspace import Workspace
from core.game_web_template import make_page
from core.game_multifile import project_sources, MANIFEST
from core.game_media_assets import runtime_resources, inline_resources

TEMPLATE = Path(__file__).parents[1] / 'templates/game-web-native'
PREVIEW_CSP = ("sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
               "style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src data: blob:; "
               "form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'")


def check_sources(files):
    """与正式打包共用：验证清单、模块顺序及语法，不执行源码。"""
    try:
        scripts, styles = project_sources(files)
        script = '\n;\n'.join(files[name].decode('utf-8') for name in scripts)
        style = '\n'.join(files[name].decode('utf-8') for name in styles)
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(422, '工程清单或模块不完整，请检查文件与加载顺序') from exc
    node = shutil.which('node')
    if not node:
        raise HTTPException(409, '缺少 Node，无法执行仅解析、不运行源码的语法检查')
    try:
        syntax = subprocess.run([node, '--max-old-space-size=64', '--check', '--input-type=commonjs'],
            input=script.encode('utf-8'), capture_output=True, timeout=10)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(408, '源码语法检查超时；未执行源码') from exc
    if syntax.returncode:
        raise HTTPException(422, 'JavaScript 语法检查失败：' + syntax.stderr.decode('utf-8', errors='replace')[-1200:])
    return scripts, styles, script, style


class WebBuilds:
    def __init__(self, repository, project):
        self.workspace = Workspace(repository, project)
        self.repository = repository
        self.project = project

    def install_template(self, base):
        state, files = self.workspace.current(base)
        if 'game.js' in files:
            raise HTTPException(409, '工程已有 game.js，不覆盖已有实现')
        changes = [dict(path=name, baseHash=digest(files[name]) if name in files else None,
                        content=(TEMPLATE / name).read_text(encoding='utf-8'))
                   for name in ('game.js', 'style.css', 'README.md')]
        return self.workspace.patch(base, changes, True)

    def install_3d_template(self, base):
        state, files = self.workspace.current(base)
        if not any(a.enabled and a.kind == 'model' for a in self.project.mediaAssets):
            raise HTTPException(409, '请先导入并启用一个 GLB 模型')
        script = (TEMPLATE.parent / 'game-web-3d/game.js').read_text(encoding='utf-8')
        changes = [dict(path='game.js', baseHash=digest(files['game.js']) if 'game.js' in files else None, content=script)]
        if MANIFEST in files:
            manifest = json.loads(files[MANIFEST])
            manifest.update(entry='game.js',scripts=['game.js'])
            changes.append(dict(path=MANIFEST,baseHash=digest(files[MANIFEST]),content=json.dumps(manifest)))
        if 'style.css' not in files:
            changes.append(dict(path='style.css',baseHash=None,content=(TEMPLATE/'style.css').read_text(encoding='utf-8')))
        return self.workspace.patch(base, changes, True)

    def list(self):
        path = self.workspace.path('builds/index.json')
        return json.loads(path.read_bytes()) if path.exists() else []

    def build(self, base, release_candidate=False, licenses=None):
        state, files = self.workspace.current(base)
        record = dict(projectRevision=self.project.revision, workspaceRevision=state['revision'],
            workspaceEpoch=state['workspaceEpoch'], inputManifest=self.workspace.manifest(files))
        try:
            result = self._build(base, release_candidate, licenses)
        except HTTPException as exc:
            record.update(status='failed', diagnostic=exc.detail,
                repairable=exc.status_code == 422 and isinstance(exc.detail, str)
                    and exc.detail.startswith('JavaScript 语法检查失败'))
            atomic_write(self.workspace.path('build-diagnostic.json'), json_bytes(record))
            raise
        record.update(status='passed', diagnostic='', repairable=False, buildId=result['buildId'])
        atomic_write(self.workspace.path('build-diagnostic.json'), json_bytes(record))
        return result

    def _build(self, base, release_candidate=False, licenses=None):
        state, files = self.workspace.current(base)
        if len(self.list()) >= 20:
            raise HTTPException(413, '构建达到 20 条，不自动清理引用产物')
        scripts, styles, script, style = check_sources(files)
        content = self.workspace.validate_content(files)
        licenses = licenses or {}
        bound = {row.values[field.id] for dataset in content.datasets for row in dataset.rows
                 for field in dataset.fields if field.type == 'asset' and row.values.get(field.id)}
        if release_candidate:
            issues = []
            if not self.project.planConfirmed or not self.project.artConfirmed or self.project.planSourceChanged:
                issues.append('策划和美术方向须确认，来源不能待更新')
            for asset in self.project.assets:
                if not asset.required:
                    continue
                if (not asset.selected or asset.needsUpdate or asset.review.status != 'passed'
                        or not asset.review.humanConfirmed or asset.review.assetRevision != asset.revision
                        or asset.review.selectionId != asset.selected.selectionId):
                    issues.append(asset.id + ' 尚未完成选用和人工验收')
                if asset.usage == 'runtime' and asset.id not in bound:
                    issues.append(asset.id + ' 未在内容数据绑定；须审阅实际运行使用情况')
                if not licenses.get(asset.id):
                    issues.append(asset.id + ' 缺少来源和许可证记录')
            if not licenses.get('game'):
                issues.append('缺少游戏源码的许可证声明')
            for asset in self.project.mediaAssets:
                if asset.enabled and not licenses.get(asset.id):
                    issues.append(asset.id + ' 缺少来源和许可证记录')
            if issues:
                raise HTTPException(409, dict(message='尚不能创建正式候选构建', issues=issues))
        tables = {d.datasetId: d for d in content.datasets}
        if not tables['characters'].rows or not tables['levels'].rows:
            raise HTTPException(422, '样例至少需要一名角色和一个关卡')
        target = tables['levels'].rows[0].values.get('target')
        if type(target) is not int or not 1 <= target <= 25:
            raise HTTPException(422, '当前模板收集目标限定 1—25；更大关卡需要修改模板')
        player = tables['characters'].rows[0].values
        if type(player.get('hp')) is not int or not 1 <= player['hp'] <= 10000:
            raise HTTPException(422, '当前模板角色 hp 必须为 1—10000 整数')
        for row in tables['characters'].rows + tables['enemies'].rows:
            speed = row.values.get('speed')
            if type(speed) not in (int, float) or not 0 <= speed <= 2000:
                raise HTTPException(422, '当前模板 speed 必须为 0—2000 数值')
        assets, manifest_assets, missing = {}, [], []
        for asset in self.project.assets:
            if asset.usage != 'runtime':
                continue
            if not asset.selected:
                if asset.required:
                    missing.append(asset.id)
                continue
            raw = self.repository.selected_content(self.project, asset)
            mime = 'image/' + asset.spec.format
            assets[asset.id] = f'data:{mime};base64,' + base64.b64encode(raw).decode()
            manifest_assets.append(dict(assetId=asset.id, selectionId=asset.selected.selectionId,
                hash=asset.selected.contentHash, runtimeDestination=asset.runtimeDestination))
        resources, media_urls, asset_info = runtime_resources(self.repository, self.project)
        assets.update(media_urls)
        for asset in self.project.assets:
            if asset.id in assets:
                asset_info[asset.id] = dict(kind='image',name=asset.name,purpose=asset.purpose,width=asset.spec.width,height=asset.spec.height)
        build_id = uid('build')
        manifest = dict(schemaVersion=1, buildId=build_id, projectId=self.project.id,
            projectRevision=self.project.revision, planRevision=self.project.plan.revision if self.project.plan else None,
            workspaceRevision=state['revision'], workspaceEpoch=state['workspaceEpoch'],
            files=self.workspace.manifest(files), assets=manifest_assets,
            resources={name:dict(hash=digest(raw),mime=mime,sizeBytes=len(raw)) for name,(raw,mime) in resources.items()},
            mediaAssets=[a.model_dump() for a in self.project.mediaAssets if a.enabled],
            template='native-canvas-multifile-v1' if MANIFEST in files else 'native-canvas-v1', scriptFiles=scripts, styleFiles=styles,
            developmentOnly=not release_candidate, releaseCandidate=release_candidate,
            licenses=licenses, missingRequiredAssets=missing,
            unboundRequiredAssets=[a.id for a in self.project.assets if a.required and a.usage == 'runtime' and a.id not in bound],
            syntaxCheck=dict(command='node --check --input-type=commonjs', exitCode=0),
            supportedInput=['keyboard', 'mouse'], unverified=['touch', 'real_mobile', 'other_browsers'])
        manifest['playableGraph'] = self.project.playableGraph.model_dump() if self.project.playableGraph else None
        input_hash = digest(json_bytes(manifest))
        config = dict(projectId=self.project.id, buildId=build_id, saveSlot='play',
                      content=content.model_dump(), assets=assets, assetInfo=asset_info,
                      engine='three' if any(a.enabled and a.kind=='model' for a in self.project.mediaAssets) else 'canvas', releaseCandidate=release_candidate)
        if self.project.playableGraph:
            from core.game_scenes import graph_page, validate_sources
            validate_sources(self.project.playableGraph)
            page = graph_page(self.project.title, self.project.playableGraph.model_dump(), config)
        else:
            page = make_page(self.project.title, config, script, style, build_id)
        if len(page) > 40 * 1024 * 1024:
            raise HTTPException(413, 'Web 包超过 40 MiB')
        if self.workspace.manifest(self.workspace.files(state['active'])) != manifest['files']:
            raise HTTPException(409, '打包过程中源码已变化，不采用构建')
        record = dict(**manifest, inputManifestHash=input_hash, artifactHash=digest(page), sizeBytes=len(page))
        atomic_write(self.workspace.path(f'builds/{build_id}/index.html'), page)
        for name,(raw,_) in resources.items():
            atomic_write(self.workspace.path(f'builds/{build_id}/'+name), raw)
        atomic_write(self.workspace.path(f'builds/{build_id}/manifest.json'), json_bytes(record))
        atomic_write(self.workspace.path('builds/index.json'), json_bytes(self.list() + [record]))
        return record

    def artifact(self, build_id):
        record = next((b for b in self.list() if b['buildId'] == build_id), None)
        if record is None:
            raise HTTPException(404, '构建不存在')
        path = self.workspace.path(f'builds/{build_id}/index.html')
        if not path.is_file() or digest(path.read_bytes()) != record['artifactHash']:
            raise HTTPException(409, '构建产物缺失或损坏')
        return record, path.read_bytes()

    def resources(self, record):
        resources = {}
        for name, info in record.get('resources', {}).items():
            path = self.workspace.path(f'builds/{record["buildId"]}/'+name)
            if not path.is_file() or path.stat().st_size != info['sizeBytes']:
                raise HTTPException(409, '构建资产缺失或大小变化')
            raw = path.read_bytes()
            if digest(raw) != info['hash']:
                raise HTTPException(409, '构建资产校验失败')
            resources[name] = (raw, info['mime'])
        return resources

    def preview(self, build_id):
        record, page = self.artifact(build_id)
        page = inline_resources(page, self.resources(record))
        if len(page) > 384 * 1024 * 1024:
            raise HTTPException(413, '隔离预览资源超过384 MiB')
        return page

    def export(self, build_id):
        record, page = self.artifact(build_id)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('index.html', page)
            archive.writestr('manifest.json', json_bytes(record))
            for name,(raw,_) in self.resources(record).items():
                archive.writestr(name, raw)
            if any(a.get('kind')=='model' for a in record.get('mediaAssets', [])):
                archive.writestr('THIRD_PARTY_NOTICES/three-LICENSE.txt',(TEMPLATE.parent/'game-web-3d/three-LICENSE.txt').read_bytes())
            archive.writestr('README.md', '# Web 游戏开发包\n\n将整个目录部署到静态 HTTP 服务后打开 index.html，勿只复制 HTML。GLB 加载需要 HTTP 来源，直接 file:// 打开可能受浏览器限制。\n资源均随包保存，无需 CDN。仅声明键鼠，尚未通过正式交付验收。\n')
        return stream.getvalue()
