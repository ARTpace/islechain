"""受控工程文件、差异、文件恢复点和开发包；不执行工程中的代码。"""
import difflib
import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from core.game_content import GameContent, initial_content
from core.game_projects import atomic_write, digest, json_bytes, safe_path, uid

MAX_FILE = 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
MAX_FILES = 500
EXCLUDED = {'.git', 'node_modules', '.env', '__pycache__', '.cache'}


class Workspace:
    """调用方持有 ProjectStore.locked，身份仍由 ProjectStore.read 校验。"""
    def __init__(self, repository, project):
        self.repository = repository
        self.project = project
        self.root = repository.directory(project.id)

    def path(self, relative):
        # 拒绝链接而不只是 resolve 后检查，包含 Windows junction。
        candidate = self.root / relative
        try:
            safe_path(self.root, relative)
        except ValueError as exc:
            raise HTTPException(422, '需要安全相对路径') from exc
        for part in (candidate, *candidate.parents):
            if part == self.root.parent:
                break
            if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
                raise HTTPException(422, '工程路径不允许符号链接或 junction')
        return candidate

    def state(self):
        path = self.path('workspace.json')
        if not path.exists():
            return dict(schemaVersion=1, revision=0, workspaceEpoch=0, active=None, snapshots=[])
        raw = json.loads(path.read_bytes())
        if raw.get('schemaVersion') != 1:
            raise HTTPException(409, '未知工程版本，仅允许诊断')
        return raw

    def files(self, directory):
        root = self.path(directory)
        result = {}
        total = 0
        if not root.is_dir():
            raise HTTPException(409, '活动工程目录缺失')
        for parent, dirs, names in os.walk(root, followlinks=False):
            for name in dirs + names:
                relative = (Path(parent) / name).relative_to(self.root).as_posix()
                path = self.path(relative)
                if name in EXCLUDED or name.startswith('.env.'):
                    raise HTTPException(422, f'工程包含排除路径：{name}；请移出工程后重试')
                if not path.is_file():
                    continue
                if path.stat().st_size > MAX_FILE:
                    raise HTTPException(413, '单个工程文件超过 1 MiB')
                content = path.read_bytes()
                total += len(content)
                if total > MAX_TOTAL or len(result) >= MAX_FILES:
                    raise HTTPException(413, '工程超过 500 文件或 40 MiB')
                result[path.relative_to(root).as_posix()] = content
        return result

    @staticmethod
    def manifest(files):
        return {name: digest(content) for name, content in sorted(files.items())}

    def current(self, base=None):
        state = self.state()
        if not state['active']:
            raise HTTPException(409, '尚未创建工程')
        if base is not None and state['revision'] != base:
            raise HTTPException(409, '工程修订已变化，请保留草稿并重载')
        return state, self.files(state['active'])

    def overview(self):
        state = self.state()
        files = self.files(state['active']) if state['active'] else {}
        from core.game_native_runtime import settings
        native_enabled = settings(self)['enabled']
        return dict(**state, files=[dict(path=p, hash=digest(c), sizeBytes=len(c)) for p, c in sorted(files.items())],
                    executionAvailable=native_enabled, executionReason=(
                        '已为本项目开启本机可信执行；在标准Web工程面板管理npm、Vite和Codex，不属于安全沙箱' if native_enabled
                        else '当前使用受控执行；标准Web工程可按项目显式开启本机执行'))

    def commit(self, state, files, label, restore=False, validate=True, publish=True):
        if len(state['snapshots']) >= 100:
            raise HTTPException(413, '恢复点达到 100 个；当前不自动清理')
        if validate:
            self.validate_content(files)
        version = uid('workspace')
        directory = f'workspaces/{version}/game'
        snapshot_directory = f'snapshots/{version}/game'
        for name, content in files.items():
            atomic_write(self.path(f'{directory}/{name}'), content)
            atomic_write(self.path(f'{snapshot_directory}/{name}'), content)
        manifest = self.manifest(files)
        record = dict(snapshotId=version, directory=snapshot_directory, manifest=manifest, label=label,
                      project=self.project.model_dump(mode='json'))
        atomic_write(self.path(f'snapshots/{version}/manifest.json'), json_bytes(record))
        next_state = dict(schemaVersion=1, revision=state['revision'] + 1,
                          workspaceEpoch=state['workspaceEpoch'] + int(restore), active=directory,
                          snapshots=state['snapshots'] + [dict(snapshotId=version, label=label)])
        # 唯一提交点：之前的目录始终可用，失败只留下未引用候选目录。
        if publish:
            atomic_write(self.path('workspace.json'), json_bytes(next_state))
            return self.overview()
        return next_state

    def create(self):
        state = self.state()
        if state['active']:
            raise HTTPException(409, '项目已有活动工程')
        return self.commit(state, {
            'README.md': ('# 游戏工程\n\n当前是文件工程，尚未冻结 Phaser/Vite 模板或开放执行。'
                          '\n可通过工作台编辑，也可在外部编辑器打开当前 active 目录。\n').encode(),
            'content/game-data.json': initial_content().model_dump_json(indent=2).encode(),
        }, '创建文件工程')

    def read(self, name):
        state, files = self.current()
        if name not in files:
            raise HTTPException(404, '文件不存在')
        try:
            text = files[name].decode('utf-8')
        except UnicodeDecodeError as exc:
            raise HTTPException(415, '二进制文件不能作为文本编辑') from exc
        return dict(path=name, content=text, hash=digest(files[name]), revision=state['revision'])

    def patch(self, base, changes, apply=False):
        state, files = self.current(base)
        if apply and len(state['snapshots']) > 98:
            raise HTTPException(413, '需要两个恢复点容量，当前不自动清理')
        before = self.manifest(files)
        updated = dict(files)
        diffs = []
        if not changes or len(changes) > 50 or len({c['path'].casefold() for c in changes}) != len(changes):
            raise HTTPException(422, '补丁需包含 1—50 个不重复路径')
        for change in changes:
            name = change['path']
            self.path(f"{state['active']}/{name}")
            if any(p in EXCLUDED or p.startswith('.env.') for p in name.split('/')):
                raise HTTPException(422, '不能写入排除文件')
            original = files.get(name)
            expected = digest(original) if original is not None else None
            if change['baseHash'] != expected:
                raise HTTPException(409, dict(message='文件已被外部修改，候选内容未应用', path=name, actualHash=expected))
            text = change['content']
            if text is None:
                updated.pop(name, None)
            else:
                content = text.encode('utf-8')
                if len(content) > MAX_FILE:
                    raise HTTPException(413, '文件超过 1 MiB')
                updated[name] = content
            try:
                old_text = original.decode('utf-8') if original is not None else ''
            except UnicodeDecodeError as exc:
                raise HTTPException(415, '不能使用文本补丁覆盖二进制文件') from exc
            diffs.append(dict(path=name, diff=''.join(difflib.unified_diff(
                old_text.splitlines(True), (text or '').splitlines(True), fromfile=name, tofile=name))))
        folded = [n.casefold() for n in updated]
        if len(folded) != len(set(folded)):
            raise HTTPException(422, '文件路径存在大小写冲突')
        if not updated or len(updated) > MAX_FILES or sum(map(len, updated.values())) > MAX_TOTAL:
            raise HTTPException(413, '工程为空或超过容量上限')
        new_content = self.validate_content(updated)
        if 'content/game-data.json' in files:
            try:
                old_content = GameContent.model_validate_json(files['content/game-data.json'])
            except ValueError:
                old_content = None  # 外部破坏的数据仍先保留原文件，再允许显式纠正。
            if old_content:
                previous = {d.datasetId:d for d in old_content.datasets}
                for dataset in new_content.datasets:
                    original = previous[dataset.datasetId]
                    changed = dataset.model_dump(exclude={'revision'}) != original.model_dump(exclude={'revision'})
                    if dataset.revision != original.revision + int(changed):
                        raise HTTPException(409, '数据内容修订须递增；建议使用数据编辑接口由后端维护')
        if not apply:
            return dict(revision=state['revision'], changes=diffs)
        # 外部编辑器不遵守宿主锁；采用前再次核对全部输入。
        if self.manifest(self.files(state['active'])) != before:
            raise HTTPException(409, '采用前工程已变化，候选补丁保留在调用方')
        # 保存人工改动的恢复点，再发布新的活动目录。
        preserved = self.commit(state, files, '补丁前保护当前手改', validate=False)
        return self.commit(preserved, updated, '应用定向补丁')

    def restore(self, base, snapshot_id, full_project=False):
        state, current = self.current(base)
        if len(state['snapshots']) > 98:
            raise HTTPException(413, '需要两个恢复点容量，当前不自动清理')
        if snapshot_id not in {s['snapshotId'] for s in state['snapshots']}:
            raise HTTPException(404, '恢复点不存在')
        record = json.loads(self.path(f'snapshots/{snapshot_id}/manifest.json').read_bytes())
        files = self.files(record['directory'])
        if self.manifest(files) != record['manifest']:
            raise HTTPException(409, '恢复点完整性校验失败，不修改活动工程')
        from core.game_project_models import Project
        restored = Project.model_validate(record['project']) if full_project else None
        target_content = Workspace(self.repository, restored or self.project).validate_content(files)
        try:
            previous = {d.datasetId:d for d in GameContent.model_validate_json(current['content/game-data.json']).datasets}
        except ValueError:
            previous = {}
        for dataset in target_content.datasets:
            original = previous.get(dataset.datasetId)
            if original:
                changed = dataset.model_dump(exclude={'revision'}) != original.model_dump(exclude={'revision'})
                dataset.revision = original.revision + int(changed)
        files['content/game-data.json'] = target_content.model_dump_json(indent=2).encode()
        if full_project:
            if (restored.id, restored.owner, restored.canvasId) != (self.project.id, self.project.owner, self.project.canvasId):
                raise HTTPException(409, '恢复点身份不匹配')
            for document in self.project.documents:
                path = self.path(f'documents/{document.id}.md')
                if not path.is_file() or digest(path.read_bytes()) != document.contentHash:
                    raise HTTPException(409, '文档含外部修改或不可读，请先保留并采用文档更改')
            for asset in restored.assets:
                if asset.selected:
                    self.repository.selected_content(restored, asset)
            restored.revision = self.project.revision + 1
            if restored.plan:
                restored.plan.revision = max(restored.plan.revision, self.project.plan.revision if self.project.plan else 0) + 1
            from core.game_media_assets import media_content
            for asset in restored.mediaAssets:
                media_content(self.repository, restored, asset)
            for name in ('documents', 'tables', 'assets', 'mediaAssets'):
                existing = {item.id: item for item in getattr(self.project, name)}
                for item in getattr(restored, name):
                    old_revision = item.revision
                    item.revision = max(item.revision, existing[item.id].revision if item.id in existing else 0) + 1
                    if name == 'assets' and item.review.assetRevision == old_revision:
                        item.review.assetRevision = item.revision
            # 历史输出与候选属于审计事实，不随策划恢复倒退。
            restored.candidates, restored.outputs = self.project.candidates, self.project.outputs
        protected = self.commit(state, current, '恢复前保护当前手改', validate=False)
        if not full_project:
            return self.commit(protected, files, f'恢复文件 {snapshot_id}', restore=True)
        pending = Workspace(self.repository, restored).commit(protected, files, f'完整恢复 {snapshot_id}', restore=True, publish=False)
        journal = dict(schemaVersion=1, projectId=self.project.id, owner=self.project.owner,
            previousProject=self.project.model_dump(mode='json'), nextProject=restored.model_dump(mode='json'),
            previousWorkspace={key: protected[key] for key in ('schemaVersion', 'revision', 'workspaceEpoch', 'active', 'snapshots')},
            nextWorkspace=pending)
        atomic_write(self.path('restore-pending.json'), json_bytes(journal))
        return self.resolve_restore('continue')

    def resolve_restore(self, decision):
        from core.game_project_models import Project
        journal = json.loads(self.path('restore-pending.json').read_bytes())
        if (journal.get('schemaVersion'), journal.get('projectId'), journal.get('owner')) != (1, self.project.id, self.project.owner):
            raise HTTPException(409, '恢复事务身份或版本不匹配')
        if decision not in ('continue', 'rollback'):
            raise HTTPException(422, '需要明确继续或回滚')
        prefix = 'next' if decision == 'continue' else 'previous'
        project = Project.model_validate(journal[prefix + 'Project'])
        if (project.id, project.owner, project.canvasId) != (self.project.id, self.project.owner, self.project.canvasId):
            raise HTTPException(409, '恢复事务项目身份不匹配')
        state = journal[prefix + 'Workspace']
        target_files = self.files(state['active'])
        snapshot = state['snapshots'][-1]['snapshotId']
        manifest = json.loads(self.path(f'snapshots/{snapshot}/manifest.json').read_bytes())
        if self.manifest(target_files) != manifest['manifest']:
            raise HTTPException(409, '恢复候选文件损坏，不提交')
        Workspace(self.repository, project).validate_content(target_files)
        for asset in project.assets:
            if asset.selected:
                self.repository.selected_content(project, asset)
        from core.game_media_assets import media_content
        for asset in project.mediaAssets:
            media_content(self.repository, project, asset)
        if decision == 'rollback':
            project.revision = max(journal['nextProject']['revision'], project.revision) + 1
            state = dict(state, revision=journal['nextWorkspace']['revision'] + 1,
                workspaceEpoch=journal['nextWorkspace']['workspaceEpoch'] + 1,
                snapshots=journal['nextWorkspace']['snapshots'])
        for document in project.documents:
            self.repository.write_document_file(project, document)
        atomic_write(self.path('project.json'), project.model_dump_json(indent=2).encode())
        atomic_write(self.path('workspace.json'), json_bytes(state))
        # 事务存在期间所有普通项目入口拒绝访问；最后删除是唯一开放点。
        self.path('restore-pending.json').unlink()
        self.project = project
        return self.overview()

    def validate_content(self, files):
        if 'content/game-data.json' not in files:
            raise HTTPException(422, '不可删除内容配置，请保留三个数据集')
        try:
            data = GameContent.model_validate_json(files['content/game-data.json'])
            data.validate_assets({a.id for a in self.project.assets if a.usage == 'runtime'} | {a.id for a in self.project.mediaAssets if a.enabled})
        except (ValueError, ValidationError) as exc:
            raise HTTPException(422, str(exc)) from exc
        return data

    def export_source(self):
        state, files = self.current()
        if 'package.json' in files:
            from core.game_native_runtime import export_source
            return export_source(self)
        from core.game_web_builds import TEMPLATE
        from core import game_web_template
        from core.game_multifile import project_sources
        try:
            scripts, styles = project_sources(files)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise HTTPException(422, "工程清单无效，无法导出源码包") from exc
        assets = []
        source_files = {f'game/{name}':content for name, content in files.items()}
        runtime = TEMPLATE.parent
        source_files['templates/game-runtime/assets.js'] = (runtime/'game-runtime/assets.js').read_bytes()
        graph = self.project.playableGraph.model_dump() if self.project.playableGraph else None
        if graph:
            from core import game_scenes
            source_files['templates/game-runtime/scenes.js'] = (runtime/'game-runtime/scenes.js').read_bytes()
            source_files['scenes_bundle.py'] = Path(game_scenes.__file__).read_bytes()
            for scene in graph['nodes']:
                name='game/scenes/'+scene['id']+'.js'
                source_files[name]=scene.pop('source').encode('utf-8')
                scene['sourcePath']=name
        from core.game_project_files import file_content
        for file in self.project.projectFiles:
            source_files['reference-files/'+file.path] = file_content(self.repository,self.project,file)
        has_models = any(a.enabled and a.kind=='model' for a in self.project.mediaAssets)
        if has_models:
            for name in ('three-runtime.js','three-LICENSE.txt'):
                source_files['templates/game-web-3d/'+name] = (runtime/'game-web-3d'/name).read_bytes()
        from core.game_media_assets import runtime_resources
        resources, _, asset_info = runtime_resources(self.repository, self.project)
        for name,(raw,mime) in resources.items():
            source_files['game/'+name] = raw
        for asset in self.project.mediaAssets:
            if asset.enabled:
                name = 'game/resources/'+asset.id+Path(asset.relativePath).suffix.lower()
                assets.append(dict(assetId=asset.id,sourcePath=name,hash=asset.contentHash,mime=asset.mime,external=True))
        for asset in self.project.assets:
            if asset.usage != 'runtime' or not asset.selected:
                continue
            content = self.repository.selected_content(self.project, asset)
            name = f'game/selected-assets/{asset.id}/{asset.selected.selectionId}.{asset.spec.format}'
            if name in source_files:
                raise HTTPException(409, '选用资源导出路径冲突')
            source_files[name] = content
            assets.append(dict(assetId=asset.id, selectionId=asset.selected.selectionId,
                sourcePath=name, hash=asset.selected.contentHash, mime='image/' + asset.spec.format))
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in source_files.items():
                archive.writestr(name, content)
            archive.writestr('source-manifest.json', json_bytes(dict(projectId=self.project.id,
                title=self.project.title, files={name:digest(content) for name,content in source_files.items()}, assets=assets,
                engine='three' if has_models else 'canvas',assetInfo=asset_info,playableGraph=graph,
                scripts=['game/' + name for name in scripts], styles=['game/' + name for name in styles])))
            archive.writestr('build.py', (TEMPLATE / 'build.py').read_bytes())
            archive.writestr('web_bundle.py', Path(game_web_template.__file__).read_bytes())
            archive.writestr('README.md', '# 开发源码包\n\n原生 Canvas 模板安装后，使用 Python 3.12+ 执行 python build.py，打开 dist/index.html。\n打包过程无第三方依赖，不执行游戏 JavaScript。修改源文件后须显式更新 source-manifest.json 中对应 SHA-256。\n游戏仍需试玩验证，素材许可证须由项目补全。\n')
            archive.writestr('manifest.json', json_bytes(dict(projectId=self.project.id,
                revision=state['revision'], workspaceEpoch=state['workspaceEpoch'],
                manifest=self.manifest(files), developmentOnly=True, runnableVerified=False)))
        return stream.getvalue()
