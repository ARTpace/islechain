"""Pinned Manager installs with explicit trust, durable receipts and instance leases."""

import asyncio
import contextlib
import hashlib
import inspect
import json
import os
import re
import time
import uuid
from urllib.parse import quote, urlsplit

import websockets
import httpx

from core.comfy_dependency_plan import dependency_plan, installation_preflight
from core.comfy_workflow_builds import write_json
from core.comfy_workflow_validation import enum_options
from core.node_catalog import digest

_TASKS = {}
SEMVER = re.compile(r'^\d{1,4}\.\d{1,4}\.\d{1,4}$')
WS_OPTIONS = {'proxy': None} if 'proxy' in inspect.signature(websockets.connect).parameters else {}


class ComfyInstalls:
    def __init__(self, context):
        self.context = context
        self.root = context.root / 'installs'

    def path(self, install_id):
        return self.root / self.context.path(install_id).name

    def read(self, install_id):
        path = self.path(install_id)
        if not path.exists():
            raise ValueError('安装记录不存在或不属于当前用户')
        record = json.loads(path.read_text(encoding='utf-8'))
        if record['canvasId'] != self.context.canvas_id:
            raise ValueError('安装记录不属于当前画布')
        return record

    def save(self, record):
        record['updatedAt'] = time.time()
        write_json(self.path(record['id']), record)

    @staticmethod
    def public(record):
        return {key: value for key, value in record.items() if key != 'snapshot'}

    def lease(self, instance):
        name = hashlib.sha256(instance.encode()).hexdigest() + '.json'
        return self.context.root.parent / 'instance-leases' / name

    def acquire(self, record):
        path = self.lease(record['instance'])
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise ValueError('该实例已有安装或待核对任务，不能并行安装') from None
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump({'record': str(self.path(record['id']))}, stream)

    def release(self, record):
        path = self.lease(record['instance'])
        if path.exists() and json.loads(path.read_text(encoding='utf-8')).get('record') == str(self.path(record['id'])):
            path.unlink()

    async def prepare(self, plan_id):
        checked = await self.context.get_dependency_plan(plan_id)
        if checked['status'] != 'unchanged':
            raise ValueError('依赖计划已变化，请重新生成')
        plan = checked['plan']
        if not plan['missing']:
            raise ValueError('节点已注册，不需要安装插件')
        prefix = plan.get('managerPrefix', '/v2')
        catalog = await self.context.request('GET', prefix + '/customnode/getlist',
                                             params={'mode': 'local', 'skip_update': 'true'})
        packs = catalog.get('node_packs') if isinstance(catalog, dict) else None
        if not isinstance(packs, dict):
            raise ValueError('当前 Manager 不提供可验证的插件目录，不能自动安装')
        packages = {}
        for dep in plan['dependencies']:
            if len(dep['candidates']) != 1:
                raise ValueError('存在未知或歧义插件，不能自动选择安装来源')
            source = dep['candidates'][0]['pack']
            matches = [(key, value) for key, value in packs.items() if isinstance(value, dict)
                       and (key == source or value.get('repository') == source or source in (value.get('files') or []))]
            if len(matches) != 1:
                raise ValueError('插件映射与目录无法唯一对应')
            plugin_id, metadata = matches[0]
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', plugin_id):
                raise ValueError('首版自动安装仅支持 Registry 稳定版插件，不支持任意 Git URL')
            versions = await self.context.request('GET', prefix + '/customnode/versions/' + quote(plugin_id, safe=''))
            if not isinstance(versions, list):
                raise ValueError('Registry 版本列表格式不支持')
            active = [item['version'] for item in versions if isinstance(item, dict)
                      and isinstance(item.get('version'), str) and SEMVER.fullmatch(item['version'])
                      and item.get('status') == 'NodeVersionStatusActive']
            if not active:
                raise ValueError('插件没有可安装的已发布稳定版本')
            version = max(active, key=lambda item: tuple(map(int, item.split('.'))))
            repository = metadata.get('repository')
            if not isinstance(repository, str) or not repository.startswith('https://github.com/'):
                raise ValueError('插件缺少可追溯的 HTTPS 源仓库')
            packages[plugin_id] = {'id': plugin_id, 'version': version, 'source': source, 'repository': repository}
        snapshot = await self.context.request('GET', prefix + '/customnode/installed')
        if not isinstance(snapshot, dict):
            raise ValueError('无法读取插件安装快照')
        for plugin_id in packages:
            if plugin_id in snapshot:
                raise ValueError('目标插件已经存在但节点未注册，请先处理导入错误，不自动升级或覆盖')
        candidate = {'instance': self.context.target, 'dependencyRevision': plan['revision'],
                     'requested': plan['requested'], 'managerPrefix': prefix,
                     'packages': sorted(packages.values(), key=lambda item: item['id'])}
        revision = digest(candidate)
        for path in self.root.glob('*.json'):
            old = json.loads(path.read_text(encoding='utf-8'))
            if old['canvasId'] == self.context.canvas_id and old['revision'] == revision:
                return self.public(old)
        record = {'id': uuid.uuid4().hex, 'canvasId': self.context.canvas_id, **candidate, 'revision': revision,
                  'status': 'prepared', 'createdAt': time.time(), 'snapshot': snapshot, 'results': {},
                  'error': '', 'risk': '插件为第三方可执行代码。完整安装可能运行安装脚本并修改 Python 环境；仅对可信插件授权。'}
        self.save(record)
        return self.public(record)

    async def start(self, install_id, revision, *, allow_scripts=False):
        record = self.read(install_id)
        if revision != record['revision'] or record['instance'] != self.context.target:
            raise ValueError('安装版本或实例已变化')
        if record['status'] != 'prepared':
            return self.public(record)
        keys = ('instance', 'managerPrefix', 'kind', 'modelKey', 'model', 'modelBinding', 'packages') if record.get('kind') == 'model' else (
            'instance', 'dependencyRevision', 'requested', 'managerPrefix', 'packages')
        if record.get('downloadPolicy'):
            keys = (*keys, 'downloadPolicy')
        if digest({key: record[key] for key in keys}) != revision:
            raise ValueError('固定安装清单内容已变化，请重新生成并授权')
        if allow_scripts is True:
            record['approvedRevision'] = revision
            self.save(record)
        self.acquire(record)
        try:
            if (await installation_preflight(self.context))['status'] != 'idle':
                raise ValueError('实例正在处理任务或状态未知，暂不安装')
            if record.get('kind') == 'model':
                if record.get('downloadPolicy'):
                    from core.comfy_model_download import managed_root
                    if str(managed_root(record['instance'])) != record['downloadPolicy']['root']:
                        raise ValueError('受管模型目录已变化，请重新生成计划')
                catalog = await self.models(record['managerPrefix'])
                if not any(digest(item) == record['modelKey'] for item in catalog):
                    raise ValueError('模型来源已变化，请重新生成下载计划')
                if await self.model_registered(record):
                    raise ValueError('模型已经可用，不重复下载')
            else:
                current = await dependency_plan(self.context, record['requested'])
                if current['revision'] != record['dependencyRevision']:
                    raise ValueError('依赖来源已变化，请重新生成安装计划')
                # Never silently update someone else's package.
                installed = await self.context.request('GET', record['managerPrefix'] + '/customnode/installed')
                if not isinstance(installed, dict) or any(item['id'] in installed for item in record['packages']):
                    raise ValueError('插件安装状态已变化，请重新检查')
            record['allowScripts'] = allow_scripts is True
            record['status'] = 'queued'
            self.save(record)
            key = str(self.path(install_id))
            task = asyncio.create_task(self.run(install_id))
            _TASKS[key] = task
            task.add_done_callback(lambda finished: _TASKS.pop(key, None))
        except BaseException:
            self.release(record)
            raise
        return self.public(record)

    async def run(self, install_id):
        try:
            async with asyncio.timeout(1200):
                await self.run_install(install_id)
        except TimeoutError:
            record = self.read(install_id)
            record['status'], record['error'] = 'uncertain', '安装监控超过 20 分钟预算，未全局中断 Manager；请核对原任务'
            self.save(record)

    async def run_install(self, install_id):
        record = self.read(install_id)
        prefix = record['managerPrefix']
        try:
            if record.get('downloadPolicy'):
                from core.comfy_model_download import download, managed_root
                policy = record['downloadPolicy']
                root = managed_root(record['instance'])
                if str(root) != policy['root']:
                    raise ValueError('受管目录已变化')
                record['status'] = 'installing'
                self.save(record)
                record['downloadReceipt'] = await download(root, record['model'], policy['sha256'], policy['maxBytes'])
                record['status'] = 'succeeded' if await self.model_registered(record) else 'verification_required'
                record['error'] = '' if record['status'] == 'succeeded' else '文件哈希已验证，但加载器尚未枚举；请核对目录和刷新实例'
                self.save(record)
                self.release(record)
                return
            # Subscribe before submitting; legacy Manager has no per-task HTTP history.
            async with websockets.connect(f'ws://{record["instance"]}/ws?clientId=art-install-{install_id}',
                                          open_timeout=10, max_size=2 * 1024 * 1024, **WS_OPTIONS) as socket:
                for item in record['packages']:
                    task_id = 'art-' + install_id + '-' + item['id']
                    record['status'] = 'submitting'
                    record['activeTask'] = task_id
                    self.save(record)
                    params = {'id': item['id'], 'version': item['version'], 'selected_version': item['version'],
                              'channel': 'default', 'mode': 'local', 'skip_post_install': not record['allowScripts'],
                              'ui_id': task_id}
                    path, body = prefix + '/manager/queue/install', params
                    operation = 'install'
                    if record.get('kind') == 'model':
                        params = {**record['model'], 'ui_id': task_id}
                        path, body, operation = prefix + '/manager/queue/install_model', params, 'install-model'
                    if prefix:
                        path = prefix + '/manager/queue/task'
                        body = {'ui_id': task_id, 'client_id': 'art-install-' + install_id, 'kind': operation, 'params': params}
                    await self.context.request('POST', path, value=body, binary=True)
                    record['status'] = 'installing'
                    self.save(record)
                    await self.context.request('GET' if prefix else 'POST', prefix + '/manager/queue/start', binary=True)
                    result = await self.wait_result(socket, task_id, prefix)
                    record['results'][item['id']] = result
                    self.save(record)
                    if result not in ('success', 'skip', 'skipped'):
                        raise ValueError('Manager 插件安装失败：' + str(result)[:500])
            if record.get('kind') == 'model':
                record['status'] = 'succeeded' if await self.model_registered(record) else 'verification_required'
                record['error'] = '' if record['status'] == 'succeeded' else '下载任务结束，但指定加载器尚未枚举到模型；不能视为可运行'
                self.save(record)
                self.release(record)
                return
            installed = await self.context.request('GET', prefix + '/customnode/installed')
            if not isinstance(installed, dict) or any(not isinstance(installed.get(item['id']), dict)
                    or installed[item['id']].get('ver') != item['version'] for item in record['packages']):
                raise ValueError('Manager 返回成功，但固定版本安装证据不匹配')
            registered = await self.context.node_info(record['requested'])
            record['missingAfterInstall'] = [kind for kind in record['requested'] if kind not in registered]
            record['status'] = ('succeeded' if not record['missingAfterInstall'] else 'restart_required') if record['allowScripts'] else 'staged'
            record['error'] = '' if record['allowScripts'] else '插件代码已暂存，依赖及安装脚本未执行；不能视为完整安装'
            self.save(record)
            self.release(record)
        except asyncio.CancelledError:
            if record.get('downloadPolicy') and not record.get('downloadReceipt'):
                record['status'], record['error'] = 'cancelled', '受管下载已取消，未发布模型文件'
                self.save(record)
                self.release(record)
                raise
            record['status'] = 'uncertain'
            record['error'] = '安装监控已中断，不能自动重复提交；实例安装锁保留'
            self.save(record)
            raise
        except Exception as exc:
            known_failure = bool(record.get('downloadPolicy') and not record.get('downloadReceipt')) or record['status'] == 'queued' or any(
                value not in ('success', 'skip', 'skipped') for value in record['results'].values())
            record['status'] = 'failed' if known_failure else 'uncertain'
            record['error'] = str(exc)[:1000]
            self.save(record)
            if record['status'] == 'failed':
                self.release(record)

    async def wait_result(self, socket, task_id, prefix):
        async with asyncio.timeout(600):
            while True:
                message = await socket.recv()
                if not isinstance(message, str):
                    continue
                event = json.loads(message)
                data = event.get('data', {})
                if not isinstance(data, dict):
                    continue
                if event.get('type') == 'cm-queue-status':
                    result = data.get('nodepack_result', {}).get(task_id) or data.get('model_result', {}).get(task_id)
                    if result is not None:
                        return result
                if prefix and event.get('type') in ('cm-task-completed', 'cm_task_completed') and data.get('ui_id') == task_id:
                    return data.get('result', 'unknown')

    async def get(self, install_id, wait_seconds=0):
        record = self.read(install_id)
        task = _TASKS.get(str(self.path(install_id)))
        if task is not None and wait_seconds:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(asyncio.shield(task), min(8, max(0, wait_seconds)))
            record = self.read(install_id)
        if record['instance'] != self.context.target:
            return {**self.public(record), 'status': 'paused', 'error': '请恢复原 ComfyUI 实例后核对安装状态'}
        if record['status'] in ('queued', 'submitting', 'installing') and str(self.path(install_id)) not in _TASKS:
            record['status'] = 'uncertain'
            record['error'] = '服务重启后安装结果待核对，不自动重复提交'
            self.save(record)
        if record['status'] == 'restarting' and str(self.path(install_id)) not in _TASKS:
            record['status'], record['error'] = 'restart_required', '服务已重启，请核对原实例；不会自动再次重启'
            self.save(record)
        if record['status'] == 'restart_required':
            try:
                result = await self.reconcile(install_id)
                if result['status'] == 'succeeded':
                    return result
            except ValueError:
                pass
            if str(self.path(install_id)) in _TASKS:
                return {**self.public(record), 'status': 'restarting'}
        return self.public(record)

    async def cancel_monitoring(self, install_id):
        record = self.read(install_id)
        if record['instance'] != self.context.target:
            raise ValueError('请先恢复原实例再操作安装监控')
        task = _TASKS.get(str(self.path(install_id)))
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        current = self.read(install_id)
        if current['status'] == 'queued' and not current.get('activeTask'):
            current['status'], current['error'] = 'cancelled', '尚未提交 Manager 的安装已取消'
            self.save(current)
            self.release(current)
        return self.public(self.read(install_id))

    async def restart(self, install_id):
        record = self.read(install_id)
        if record['status'] != 'restart_required' or record['instance'] != self.context.target:
            raise ValueError('只有当前原实例的待重启安装记录可以启动受管重启')
        record['restartApprovedRevision'] = record['revision']
        self.save(record)
        self.acquire(record)
        try:
            if (await installation_preflight(self.context))['status'] != 'idle':
                raise ValueError('实例忙碌或状态未知，不能重启')
            record['status'] = 'restarting'
            self.save(record)
            key = str(self.path(install_id))
            task = asyncio.create_task(self.restart_work(install_id))
            _TASKS[key] = task
            task.add_done_callback(lambda finished: _TASKS.pop(key, None))
        except BaseException:
            self.release(record)
            raise
        return self.public(record)

    async def restart_owned(self, target):
        from routers.comfyui import restart_owned_comfy
        return await restart_owned_comfy(target)

    async def restart_work(self, install_id):
        record = self.read(install_id)
        try:
            await self.restart_owned(record['instance'])
            deadline = time.monotonic() + 120
            record['status'] = 'restart_required'
            self.save(record)
            while time.monotonic() < deadline:
                try:
                    result = await self.reconcile(install_id)
                    if result['status'] == 'succeeded':
                        return
                except ValueError:
                    pass
                await asyncio.sleep(2)
            record['error'] = '受管实例已重启，但 120 秒内尚未完成注册验证；请核对日志'
        except asyncio.CancelledError:
            record['error'] = '受管重启监控中断，不会自动重复重启'
            raise
        except Exception as exc:
            record['error'] = str(exc)[:1000]
        finally:
            # Do not overwrite a successful reconcile receipt with an older local record.
            if self.read(install_id)['status'] != 'succeeded':
                record['status'] = 'restart_required'
                self.save(record)
            self.release(record)

    async def reconcile(self, install_id):
        record = self.read(install_id)
        if record['instance'] != self.context.target:
            raise ValueError('请先恢复原实例')
        if record['status'] not in ('failed', 'uncertain', 'restart_required', 'staged', 'verification_required'):
            return await self.get(install_id)
        if (await installation_preflight(self.context))['status'] != 'idle':
            raise ValueError('队列仍忙碌或状态未知，不能解除安装锁')
        if record.get('kind') == 'model':
            if record.get('downloadPolicy'):
                from core.comfy_model_download import managed_root, verify_existing
                policy = record['downloadPolicy']
                root = managed_root(record['instance'])
                if str(root) != policy['root']:
                    raise ValueError('受管模型目录已变化，请恢复原实例目录')
                record['downloadReceipt'] = await verify_existing(root, record['model'], policy['sha256'], policy['maxBytes'])
                record['downloadReceipt']['recheckedAt'] = time.time()
                self.save(record)
            if not await self.model_registered(record):
                raise ValueError('指定加载器仍未枚举到模型，保留待核对状态')
            record['status'], record['error'] = 'succeeded', ''
            self.save(record)
            self.release(record)
            return self.public(record)
        installed = await self.context.request('GET', record['managerPrefix'] + '/customnode/installed')
        if not isinstance(installed, dict) or any(not isinstance(installed.get(item['id']), dict)
                or installed[item['id']].get('ver') != item['version'] for item in record['packages']):
            raise ValueError('固定版本安装证据不完整；保留待核对状态和实例锁')
        info = await self.context.node_info(record['requested'])
        record['missingAfterInstall'] = [kind for kind in record['requested'] if kind not in info]
        record['status'] = ('succeeded' if not record['missingAfterInstall'] else 'restart_required') if record.get('allowScripts') else 'staged'
        record['error'] = '' if record.get('allowScripts') else '依赖及安装脚本未执行'
        self.save(record)
        if record['status'] == 'succeeded' or str(self.path(install_id)) not in _TASKS:
            self.release(record)
        return self.public(record)

    async def models(self, prefix):
        catalog = await self.context.request('GET', prefix + '/externalmodel/getlist', params={'mode': 'local'})
        if not isinstance(catalog, dict) or not isinstance(catalog.get('models'), list):
            raise ValueError('Manager 模型目录格式不支持')
        selected = []
        keys = ('name', 'type', 'base', 'save_path', 'filename', 'url', 'size', 'description', 'reference')
        for item in catalog['models']:
            if not isinstance(item, dict):
                continue
            filename, url = item.get('filename', ''), item.get('url', '')
            if (not isinstance(filename, str) or not re.fullmatch(r'[\w .-]{1,160}\.safetensors', filename)
                    or '..' in filename or not isinstance(url, str) or len(url) > 2000):
                continue
            parsed = urlsplit(url)
            if (parsed.scheme != 'https' or parsed.username or parsed.password
                    or parsed.hostname not in ('huggingface.co', 'civitai.com', 'github.com', 'raw.githubusercontent.com')):
                continue
            if not isinstance(item.get('save_path'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', item['save_path']):
                continue
            if any(not isinstance(item.get(key, ''), str) or len(item.get(key, '')) > 4000 for key in keys):
                continue
            selected.append({key: item.get(key, '') for key in keys})
        return selected

    async def retry_failed(self, install_id):
        record = self.read(install_id)
        if record['status'] not in ('failed', 'cancelled') or record['instance'] != self.context.target:
            raise ValueError('仅原实例已明确失败或取消的任务可重新准备')
        if str(self.path(install_id)) in _TASKS or (await installation_preflight(self.context))['status'] != 'idle':
            raise ValueError('实例仍有任务或状态未知，不能重试')
        if record.get('kind') == 'model':
            if await self.model_registered(record):
                raise ValueError('模型已经枚举，请先核对而不是重复下载')
            if record.get('downloadPolicy'):
                from core.comfy_model_download import destination, managed_root
                root = managed_root(record['instance'])
                if str(root) != record['downloadPolicy']['root']:
                    raise ValueError('受管目录变化，必须重新准备计划')
                destination(root, record['model'])  # Refuse to overwrite partial or complete target files.
        else:
            installed = await self.context.request('GET', record['managerPrefix'] + '/customnode/installed')
            if not isinstance(installed, dict) or any(item['id'] in installed for item in record['packages']):
                raise ValueError('已有插件落盘，请核对注册/导入错误；不自动覆盖或重装')
        record.setdefault('attempts', []).append({'status': record['status'], 'error': record.get('error', ''), 'at': time.time()})
        record['attempts'] = record['attempts'][-10:]
        record['status'], record['error'], record['results'] = 'prepared', '', {}
        for key in ('approvedRevision', 'restartApprovedRevision', 'activeTask', 'downloadReceipt'):
            record.pop(key, None)
        self.save(record)
        self.release(record)
        return self.public(record)

    async def find_models(self, search):
        if not isinstance(search, str) or not 1 <= len(search) <= 80:
            raise ValueError('模型搜索词必须为 1—80 字符')
        prefix = '/v2'
        try:
            models = await self.models(prefix)
        except ValueError as exc:
            if 'HTTP 404:' not in str(exc):
                raise
            prefix, models = '', await self.models('')
        matches = [item for item in models if search.lower() in (item['name'] + ' ' + item['filename']).lower()]
        return {'managerPrefix': prefix, 'models': [{'modelKey': digest(item), **item} for item in matches[:15]],
                'totalMatches': len(matches), 'note': '仅 Registry 目录中的 HTTPS safetensors；源清单摘要不是文件内容哈希，真实可用性仍需推理测试。'}

    async def prepare_model(self, model_key, node_type, input_name):
        if (not isinstance(model_key, str) or len(model_key) != 64 or
                not isinstance(node_type, str) or not 1 <= len(node_type) <= 200 or
                not isinstance(input_name, str) or not 1 <= len(input_name) <= 100):
            raise ValueError('模型来源或加载器参数无效')
        prefix = '/v2'
        try:
            models = await self.models(prefix)
        except ValueError as exc:
            if 'HTTP 404:' not in str(exc):
                raise
            prefix, models = '', await self.models('')
        matches = [item for item in models if digest(item) == model_key]
        if len(matches) != 1:
            raise ValueError('模型源清单已变化或不存在')
        model = matches[0]
        candidate = {'instance': self.context.target, 'managerPrefix': prefix, 'kind': 'model', 'modelKey': model_key,
                     'model': model, 'modelBinding': {'nodeType': node_type, 'input': input_name, 'value': model['filename']},
                     'packages': [{'id': model_key[:16], 'version': model['filename'], 'repository': model['url']}]}
        if await self.model_registered(candidate):
            raise ValueError('指定模型已经可用，不需要下载')
        record = {'id': uuid.uuid4().hex, 'canvasId': self.context.canvas_id, **candidate,
                  'revision': digest(candidate), 'status': 'prepared', 'createdAt': time.time(), 'results': {}, 'error': '',
                  'risk': '将由当前实例 Manager 下载模型，大小参考：' + model['size'] + '。源清单未提供内容哈希，下载结束不等于推理测试通过。'}
        self.save(record)
        return record

    async def prepare_verified_model(self, model_key, node_type, input_name, sha256, max_bytes):
        from core.comfy_model_download import managed_root, validate_limits
        validate_limits(sha256, max_bytes)
        root = managed_root(self.context.target)
        record = await self.prepare_model(model_key, node_type, input_name)
        record['downloadPolicy'] = {'root': str(root), 'sha256': sha256, 'maxBytes': max_bytes}
        record['revision'] = digest({key: record[key] for key in (
            'instance', 'managerPrefix', 'kind', 'modelKey', 'model', 'modelBinding', 'packages', 'downloadPolicy')})
        record['risk'] = (f'宿主下载到本工具启动的ComfyUI；最多{max_bytes}字节；'
                          f'SHA256必须为{sha256}。不覆盖已有模型；来源哈希须人工核对。')
        self.save(record)
        return record

    async def inspect_model_source(self, model_key):
        prefix = '/v2'
        try:
            models = await self.models(prefix)
        except ValueError as exc:
            if 'HTTP 404:' not in str(exc):
                raise
            models = await self.models('')
        matches = [model for model in models if digest(model) == model_key]
        if len(matches) != 1:
            raise ValueError('模型目录来源已变化')
        model = matches[0]
        parsed = urlsplit(model['url'])
        if parsed.hostname != 'huggingface.co' or '/resolve/' not in parsed.path:
            raise ValueError('当前仅自动读取公开HuggingFace resolve来源的LFS SHA256，其他源需人工核对')
        try:
            async with httpx.AsyncClient(timeout=15, trust_env=False, follow_redirects=False) as client:
                response = await client.head(model['url'])
            if response.status_code not in (200, 302, 307):
                raise ValueError('模型源HEAD未返回可核验元数据')
            sha = response.headers.get('x-linked-etag', '').strip('"').lower()
            size = response.headers.get('x-linked-size', '')
            if not re.fullmatch(r'[a-f0-9]{64}', sha) or not size.isdigit() or not 0 < int(size) <= 100 * 1024**3:
                raise ValueError('模型源未提供LFS SHA256与有效大小；不把Git ETag当内容SHA256')
            return {'modelKey': model_key, 'sha256': sha, 'bytes': int(size), 'source': model['url'],
                    'evidence': '公开HuggingFace响应x-linked-etag/x-linked-size；下载仍逐字节校验，无模型内容下载'}
        except httpx.HTTPError:
            raise ValueError('读取模型源元数据失败，未下载模型') from None

    async def model_registered(self, record):
        binding = record['modelBinding']
        info = await self.context.node_info([binding['nodeType']])
        inputs = info.get(binding['nodeType'], {}).get('input', {})
        definition = {**inputs.get('required', {}), **inputs.get('optional', {})}.get(binding['input'])
        choices = enum_options(definition)
        if choices is None:
            raise ValueError('目标加载器参数不是受支持的模型枚举')
        return binding['value'] in choices

    def list(self):
        records = [json.loads(path.read_text(encoding='utf-8')) for path in self.root.glob('*.json')]
        return sorted((self.public(record) for record in records if record['canvasId'] == self.context.canvas_id),
                      key=lambda record: record['createdAt'], reverse=True)[:30]

    def tools(self):
        specs = [
            ('comfy_list_installs', '列出当前画布插件安装与模型下载记录，用于恢复后台任务。', {}),
            ('comfy_find_models', '只读搜索 Manager 模型目录，返回可追溯 modelKey；不接受任意下载 URL。', {'search': {'type': 'string'}}),
            ('comfy_inspect_model_source', '只读读取目录中公开HuggingFace模型的LFS SHA256及大小，不下载模型；其他来源需人工核对。', {'model_key': {'type': 'string'}}),
            ('comfy_prepare_model', '固定目录模型和目标加载器参数，形成下载计划；不下载。',
             {'model_key': {'type': 'string'}, 'node_type': {'type': 'string'}, 'input_name': {'type': 'string'}}),
            ('comfy_prepare_verified_model', '为本工具启动的本机实例创建容量及SHA256固定的下载计划；哈希必须来自可信发布源，不可编造。不下载。',
             {'model_key': {'type': 'string'}, 'node_type': {'type': 'string'}, 'input_name': {'type': 'string'},
              'sha256': {'type': 'string'}, 'max_bytes': {'type': 'integer'}}),
            ('comfy_prepare_install', '从无歧义依赖计划选择 Registry 已发布稳定版并固定安装清单，不安装。', {'plan_id': {'type': 'string'}}),
            ('comfy_install_dependencies', '安装固定清单，需要用户对第三方代码授权；未完成不能声称安装成功。',
             {'install_id': {'type': 'string'}, 'revision': {'type': 'string'}}),
            ('comfy_get_install', '查询安装记录及真实节点注册；不会重复提交安装。', {'install_id': {'type': 'string'}}),
            ('comfy_reconcile_install', '核对失败或中断任务的实际安装、文件哈希和注册状态，不重新提交安装。', {'install_id': {'type': 'string'}}),
            ('comfy_retry_failed_install', '仅明确失败且未安装目标的空闲原实例重新准备；清除旧授权，执行前须再次授权。不覆盖部分安装。', {'install_id': {'type': 'string'}}),
            ('comfy_restart_install', '仅重启本工具启动且当前空闲的原实例并验证；外部启动实例不会被强杀。', {'install_id': {'type': 'string'}}),
            ('comfy_cancel_install', '停止此任务的安装监控；已提交给 Manager 的安装不会被全局中断，保留待核对锁。', {'install_id': {'type': 'string'}}),
        ]
        return [{'type': 'function', 'function': {'name': name, 'description': description,
                'parameters': {'type': 'object', 'properties': properties, 'required': list(properties),
                               'additionalProperties': False}}} for name, description, properties in specs]

    async def call(self, name, args):
        if name == 'comfy_list_installs':
            return {'installs': [await self.get(item['id']) for item in self.list()]}
        if name == 'comfy_find_models':
            return await self.find_models(args.get('search'))
        if name == 'comfy_inspect_model_source':
            return await self.inspect_model_source(args.get('model_key'))
        if name == 'comfy_prepare_model':
            return await self.prepare_model(args.get('model_key'), args.get('node_type'), args.get('input_name'))
        if name == 'comfy_prepare_verified_model':
            return await self.prepare_verified_model(args.get('model_key'), args.get('node_type'), args.get('input_name'),
                                                     args.get('sha256'), args.get('max_bytes'))
        if name == 'comfy_prepare_install':
            return await self.prepare(args['plan_id'])
        if name == 'comfy_get_install':
            return await self.get(args['install_id'])
        if name == 'comfy_reconcile_install':
            return await self.reconcile(args['install_id'])
        if name == 'comfy_retry_failed_install':
            return await self.retry_failed(args['install_id'])
        if name == 'comfy_cancel_install':
            return await self.cancel_monitoring(args['install_id'])
        raise ValueError('安装执行必须经过宿主授权入口')
