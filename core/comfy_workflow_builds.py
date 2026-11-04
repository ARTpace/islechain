"""Durable ComfyUI candidates; testing stays on the selected instance."""

import asyncio
import contextlib
import hashlib
import io
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import quote, urlencode

import httpx
from PIL import Image

from core.comfy_dependency_plan import dependency_plan, installation_preflight
from core.comfy_node_index import NodeIndex
from core.comfy_workflow_validation import BuildRequest, validate_build
from core.node_catalog import digest

_TASKS = {}
_INDEX_CACHE = {}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class ComfyBuilds:
    """One host user's canvas context. Paths and target never come from model arguments."""

    def __init__(self, root, workflow_root, owner, canvas_id, target, timeout=600):
        self.root = Path(root) / hashlib.sha256(owner.encode()).hexdigest()
        self.owner = owner
        self.workflow_root = Path(workflow_root)
        self.canvas_id, self.target = canvas_id, target
        self.timeout = timeout

    def path(self, build_id):
        if not isinstance(build_id, str) or len(build_id) != 32 or any(c not in '0123456789abcdef' for c in build_id):
            raise ValueError('构建 ID 无效')
        return self.root / (build_id + '.json')

    def read(self, build_id):
        path = self.path(build_id)
        if not path.exists():
            raise ValueError('构建不存在或不属于当前用户')
        record = json.loads(path.read_text(encoding='utf-8'))
        if record['canvasId'] != self.canvas_id:
            raise ValueError('构建不属于当前画布')
        return record

    def save(self, record):
        record['updatedAt'] = time.time()
        write_json(self.path(record['id']), record)

    async def request(self, method, path, *, value=None, params=None, binary=False, index=False):
        if not self.target or '/' in self.target or '@' in self.target:
            raise ValueError('未配置有效的 ComfyUI 实例地址')
        try:
            async with (
                httpx.AsyncClient(timeout=30, trust_env=False, follow_redirects=False) as client,
                client.stream(method, f'http://{self.target}{path}', json=value, params=params) as response,
            ):
                limit = (128 if index else 32 if binary else 16) * 1024 * 1024
                data = bytearray()
                parser, size = NodeIndex() if index else None, 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > limit:
                        raise ValueError('ComfyUI 响应超过大小限制')
                    if parser and 200 <= response.status_code < 300:
                        parser.feed(chunk)
                    else:
                        data.extend(chunk)
                if not 200 <= response.status_code < 300:
                    raise ValueError(f'ComfyUI HTTP {response.status_code}: {bytes(data[:1000]).decode("utf-8", "replace")}')
                return parser.feed(b'', final=True) if parser else bytes(data) if binary else json.loads(data)
        except httpx.HTTPError as exc:
            raise ValueError(f'ComfyUI 连接失败：{type(exc).__name__}') from None

    async def inspect(self, node_types=None, search=''):
        if not isinstance(search, str) or len(search) > 80:
            raise ValueError('节点搜索词无效')
        if node_types:
            if not isinstance(node_types, list) or len(node_types) > 12 or any(not isinstance(item, str) for item in node_types):
                raise ValueError('每次最多查询 12 种节点定义')
            selected = await self.node_info(node_types)
            if len(json.dumps(selected).encode()) > 100000:
                raise ValueError('节点定义过大，请缩小查询范围')
            return {'instance': self.target, 'nodes': selected, 'missing': [kind for kind in node_types if kind not in selected]}
        cached = _INDEX_CACHE.get(self.target)
        if not cached or time.time() - cached[0] > 30:
            cached = (time.time(), await self.request('GET', '/object_info', index=True))
            _INDEX_CACHE[self.target] = cached
        names = [kind for kind in cached[1] if search.lower() in kind.lower()]
        return {'instance': self.target, 'nodeTypes': names[:200], 'totalMatches': len(names),
                'note': '使用 node_types 查询选中节点的真实输入、模型选项和输出。'}

    def templates(self, name='', search=''):
        if not isinstance(search, str) or len(search) > 80 or not isinstance(name, str):
            raise ValueError('模板查询参数无效')
        root = self.workflow_root.resolve()
        if not name:
            names = [path.relative_to(self.workflow_root).as_posix() for path in self.workflow_root.rglob('*.json')
                     if not path.name.endswith('.config.json') and search.lower() in path.as_posix().lower()]
            return {'templates': sorted(names)[:100], 'totalMatches': len(names)}
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.suffix != '.json' or path.name.endswith('.config.json'):
            raise ValueError('模板路径无效')
        if path.stat().st_size > 512000:
            raise ValueError('模板过大，请选择较小的 API 工作流')
        workflow = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(workflow, dict) or not workflow or any(not isinstance(node, dict) or 'class_type' not in node for node in workflow.values()):
            raise ValueError('首版仅支持 ComfyUI API 格式模板')
        private = {'api_key', 'api_token', 'access_token', 'password', 'authorization', 'secret', 'token'}
        if any(key.lower() in private or key.lower().endswith('_api_key')
               for node in workflow.values() for key in node.get('inputs', {})):
            raise ValueError('模板包含凭据字段，当前不向模型发送此类模板')
        return {'name': name, 'workflow': workflow}

    async def node_info(self, kinds):
        semaphore = asyncio.Semaphore(4)

        async def one(kind):
            async with semaphore:
                return await self.request('GET', '/object_info/' + quote(kind, safe=''))

        items = await asyncio.gather(*(one(kind) for kind in dict.fromkeys(kinds)))
        return {key: value for item in items for key, value in item.items()}

    async def create(self, value, *, repair_parent=None, hypothesis=''):
        request = BuildRequest.model_validate(value)
        if not 1 <= len(request.workflow) <= 256:
            raise ValueError('工作流必须包含 1—256 个节点')
        kinds = [node.get('class_type') for node in request.workflow.values() if isinstance(node, dict)]
        if len(kinds) != len(request.workflow) or any(not isinstance(kind, str) or not kind or len(kind) > 200 for kind in kinds):
            raise ValueError('工作流节点类型无效')
        info = await self.node_info(kinds)
        candidate, fingerprint = validate_build(value, info)
        revision = digest({'candidate': candidate, 'environment': fingerprint, 'instance': self.target})
        parent = root = None
        if repair_parent is not None:
            parent = self.read(repair_parent)
            if (parent['status'] != 'failed' or not parent.get('error') or parent['instance'] != self.target
                    or not isinstance(hypothesis, str) or not 1 <= len(hypothesis.strip()) <= 1000):
                raise ValueError('修复必须引用当前实例的明确失败记录，并提供修改假设')
            if digest(parent['candidate']) == digest(candidate):
                raise ValueError('修复候选没有实质修改，不能重复消耗测试预算')
            root = self.read(parent.get('repairRoot') or parent['id'])
            if len(root.get('repairChildren', [])) >= 3:
                raise ValueError('同一构建已达到 3 次修复预算，请交付阻碍并调整需求')
        # ponytail: reuse an identical candidate instead of submitting duplicate tests on model retries.
        for path in self.root.glob('*.json'):
            item = json.loads(path.read_text(encoding='utf-8'))
            if item['canvasId'] == self.canvas_id and item['revision'] == revision:
                return self.summary(item)
        build_id = uuid.uuid4().hex
        record = {'id': build_id, 'canvasId': self.canvas_id, 'instance': self.target,
                  'candidate': candidate, 'revision': revision, 'environment': fingerprint,
                  'outputNodes': [node_id for node_id, node in candidate['workflow'].items()
                                  if info[node['class_type']].get('output_node')],
                  'status': 'draft', 'promptId': '', 'createdAt': time.time(), 'report': None, 'error': ''}
        if root is not None:
            # No await between budget reservation and candidate persistence.
            root = self.read(root['id'])
            children = root.get('repairChildren', [])
            if len(children) >= 3:
                raise ValueError('同一构建已达到 3 次修复预算')
            record.update({'repairRoot': root['id'], 'repairParent': parent['id'], 'repairAttempt': len(children) + 1,
                           'repairHypothesis': hypothesis.strip(), 'sourceError': parent['error']})
            root['repairChildren'] = [*children, build_id]
            self.save(root)
        self.save(record)
        return self.summary(record)

    def summary(self, record):
        return {'title': record['candidate']['title'], **{key: record.get(key) for key in (
            'id', 'canvasId', 'instance', 'revision', 'status', 'promptId', 'report', 'error',
            'createdAt', 'updatedAt', 'workflowName')}}

    def read_candidate(self, build_id, node_ids=None):
        record = self.read(build_id)
        candidate = record['candidate']
        if node_ids is not None:
            if (not isinstance(node_ids, list) or not 1 <= len(node_ids) <= 12
                    or any(not isinstance(item, str) or item not in candidate['workflow'] for item in node_ids)):
                raise ValueError('每次读取 1—12 个已有工作流节点')
            candidate = {**candidate, 'workflow': {key: candidate['workflow'][key] for key in node_ids}}
        elif len(json.dumps(candidate, ensure_ascii=False).encode()) > 100000:
            return {'summary': self.summary(record), 'nodeIds': list(candidate['workflow']),
                    'note': '候选较大，请按 node_ids 分批读取'}
        return {'summary': self.summary(record), 'candidate': candidate,
                'repair': {key: record.get(key) for key in ('repairRoot', 'repairParent', 'repairAttempt', 'repairHypothesis', 'sourceError')},
                'remainingRepairs': 3 - len(self.read(record.get('repairRoot') or build_id).get('repairChildren', []))}

    async def current_environment(self, record):
        if record['instance'] != self.target:
            raise ValueError('ComfyUI 实例已切换，请重新构建')
        info = await self.node_info([node['class_type'] for node in record['candidate']['workflow'].values()])
        _, fingerprint = validate_build(record['candidate'], info)
        if fingerprint != record['environment']:
            raise ValueError('工作流依赖或模型选项已变化，请重新构建并测试')

    async def start(self, build_id):
        record = self.read(build_id)
        if record['status'] != 'draft':
            return await self.get(build_id)
        await self.current_environment(record)
        # No await between the final state check, write and task registration.
        record = self.read(build_id)
        if record['status'] != 'draft':
            return self.summary(record)
        record['status'] = 'queued'
        self.save(record)
        self.spawn(build_id, submit=True)
        return self.summary(record)

    def spawn(self, build_id, submit=False):
        task_key = str(self.path(build_id))
        if task_key in _TASKS:
            return
        task = asyncio.create_task(self.run(build_id, submit))
        _TASKS[task_key] = task
        task.add_done_callback(lambda _: _TASKS.pop(task_key, None))

    async def run(self, build_id, submit=False):
        record = self.read(build_id)
        try:
            if submit:
                record['status'] = 'submitting'
                self.save(record)
                response = await self.request('POST', '/prompt', value={'prompt': record['candidate']['workflow'], 'client_id': build_id})
                if isinstance(response.get('prompt_id'), str):
                    record['promptId'] = response['prompt_id']
                if not response.get('prompt_id') or response.get('node_errors'):
                    record['status'] = 'failed'
                    if record['promptId']:
                        await self.request('POST', '/queue', value={'delete': [record['promptId']]})
                    raise ValueError('ComfyUI 拒绝工作流：' + json.dumps(response, ensure_ascii=False)[:2000])
                record['promptId'] = response['prompt_id']
                if self.read(build_id)['status'] == 'cancelled':
                    record['status'] = 'cancelled'
                    record['error'] = '提交期间已取消；仅删除此任务的排队项，不全局中断 GPU'
                    self.save(record)
                    await self.request('POST', '/queue', value={'delete': [record['promptId']]})
                    return
                record['status'] = 'running'
                record['startedAt'] = time.time()
                self.save(record)
            while time.time() - record.get('startedAt', record['createdAt']) < self.timeout:
                latest = self.read(build_id)
                if latest['status'] == 'cancelled':
                    return
                history = await self.request('GET', '/history/' + record['promptId'])
                result = history.get(record['promptId'])
                if result:
                    if result.get('status', {}).get('status_str') == 'error':
                        raise ValueError('ComfyUI 执行错误：' + json.dumps(result.get('status'), ensure_ascii=False)[:2000])
                    if not result.get('status', {}).get('completed'):
                        await asyncio.sleep(1)
                        continue
                    outputs = await self.verify_outputs(result)
                    if set(record.get('outputNodes', [])) - {item['node'] for item in outputs}:
                        raise ValueError('部分输出节点没有返回可验证图片，首版不能将此工作流判定为完全通过')
                    record['report'] = {'passed': True, 'scope': '所提交配置的真实执行及图片技术检查，不包含视觉语义质量验收',
                                        'outputs': outputs, 'elapsedSeconds': round(time.time() - record['startedAt'], 2),
                                        'workflowHash': digest(record['candidate']['workflow'])}
                    record['status'] = 'succeeded'
                    self.save_unless_cancelled(record)
                    return
                await asyncio.sleep(1)
            raise ValueError('测试超时；任务可能仍在 ComfyUI 队列或执行中，不会自动重复提交')
        except asyncio.CancelledError:
            # Persisted promptId allows a new service process to resume monitoring.
            raise
        except Exception as exc:
            record['status'] = 'uncertain' if not record['promptId'] and record['status'] == 'submitting' else 'failed'
            record['error'] = str(exc)[:2200]
            self.save_unless_cancelled(record)

    def save_unless_cancelled(self, record):
        if self.read(record['id'])['status'] != 'cancelled':
            self.save(record)

    async def verify_outputs(self, history):
        outputs = []
        for node_id, value in history.get('outputs', {}).items():
            for item in value.get('images', []):
                if len(outputs) >= 8:
                    raise ValueError('首版最多验证 8 张输出图片，请缩小测试批量')
                params = {key: item.get(key, '' if key != 'type' else 'output') for key in ('filename', 'subfolder', 'type')}
                if not all(isinstance(value, str) for value in params.values()) or not params['filename']:
                    raise ValueError('图片引用无效')
                raw = await self.request('GET', '/view', params=params, binary=True)
                with Image.open(io.BytesIO(raw)) as image:
                    image.verify()
                with Image.open(io.BytesIO(raw)) as image:
                    if image.width * image.height > 64000000:
                        raise ValueError('输出图片像素超出测试上限')
                    image.load()
                    outputs.append({'node': node_id, **params, 'width': image.width, 'height': image.height,
                                    'sha256': hashlib.sha256(raw).hexdigest(),
                                    'preview': '/api/comfyui/view?' + urlencode(params)})
        if not outputs:
            raise ValueError('测试未返回可解码图片；首版仅交付图片工作流')
        return outputs

    async def get(self, build_id, wait_seconds=0):
        record = self.read(build_id)
        if record['status'] in ('queued', 'submitting', 'running', 'paused') and str(self.path(build_id)) not in _TASKS:
            if record['promptId']:
                if record['instance'] == self.target:
                    record['status'] = 'running'
                    record['error'] = ''
                    self.save(record)
                    self.spawn(build_id)
                else:
                    record['status'] = 'paused'
                    record['error'] = '目标实例已切换，恢复原实例后可继续监控；不会重复提交'
                    self.save(record)
            else:
                record['status'] = 'uncertain'
                record['error'] = '服务中断且无法确认是否提交，禁止自动重复提交；请检查 ComfyUI 队列'
                self.save(record)
        if wait_seconds:
            task = _TASKS.get(str(self.path(build_id)))
            if task:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(asyncio.shield(task), max(0, min(8, wait_seconds)))
        return self.summary(self.read(build_id))

    async def cancel(self, build_id):
        record = self.read(build_id)
        if record['status'] in ('draft', 'queued', 'submitting', 'running', 'paused', 'uncertain'):
            record['status'] = 'cancelled'
            record['error'] = '已停止测试监控；执行中的 GPU 任务不会被全局中断'
            self.save(record)
            if record['promptId']:
                if record['instance'] == self.target:
                    await self.request('POST', '/queue', value={'delete': [record['promptId']]})
        return self.summary(self.read(build_id))

    async def publish(self, build_id, revision):
        record = self.read(build_id)
        if record['status'] != 'succeeded' or revision != record['revision']:
            raise ValueError('只有通过测试的指定构建版本可以交付')
        await self.current_environment(record)
        name = f'custom/ai-{build_id}.json'
        target = self.workflow_root / name
        candidate = record['candidate']
        config = {'title': candidate['title'], 'fields': candidate['fields'],
                  'ai_build': {'id': build_id, 'revision': revision, 'instance': record['instance'],
                               'workflowHash': digest(candidate['workflow']), 'report': record['report']}}
        if target.exists() and json.loads(target.read_text(encoding='utf-8')) != candidate['workflow']:
            raise ValueError('已发布工作流被修改，禁止覆盖')
        write_json(target.with_suffix('.config.json'), config)
        write_json(target, candidate['workflow'])
        record['workflowName'] = name
        self.save(record)
        return {'workflowName': name, 'title': candidate['title'], 'revision': revision,
                'params': {field['id']: field['default'] for field in candidate['fields']}}

    def list(self):
        records = [json.loads(path.read_text(encoding='utf-8')) for path in self.root.glob('*.json')]
        records = sorted((r for r in records if r['canvasId'] == self.canvas_id), key=lambda r: r['createdAt'], reverse=True)
        return [self.summary(record) for record in records[:30]]

    async def check_node(self, fields):
        record = self.read(fields['comfyBuildId'])
        if record['status'] != 'succeeded' or record['revision'] != fields['comfyRevision']:
            raise ValueError('工作流未通过测试或候选版本已失效')
        return record

    async def plan_dependencies(self, node_types):
        plan = await dependency_plan(self, node_types)
        # ponytail: reuse atomic JSON persistence, isolate plans from inference builds.
        plan_id = uuid.uuid4().hex
        record = {'id': plan_id, 'canvasId': self.canvas_id, 'createdAt': time.time(), 'plan': plan}
        write_json(self.root / 'dependency-plans' / self.path(plan_id).name, record)
        return {'planId': plan_id, **plan}

    async def get_dependency_plan(self, plan_id):
        path = self.root / 'dependency-plans' / self.path(plan_id).name
        if not path.exists():
            raise ValueError('依赖计划不存在或不属于当前用户')
        record = json.loads(path.read_text(encoding='utf-8'))
        if record['canvasId'] != self.canvas_id:
            raise ValueError('依赖计划不属于当前画布')
        plan = record['plan']
        if plan['instance'] != self.target:
            return {'planId': plan_id, 'plan': plan, 'status': 'instance_changed', 'executable': False}
        current = await dependency_plan(self, plan['requested'])
        return {'planId': plan_id, 'plan': plan, 'currentPlan': current,
                'status': 'unchanged' if current['revision'] == plan['revision'] else 'stale',
                'preflight': await installation_preflight(self), 'executable': False}

    def tools(self):
        specs = [
            ('comfy_list_builds', '列出当前用户当前画布的工作流构建，恢复测试与失败记录。',
             {'type': 'object', 'properties': {}, 'additionalProperties': False}),
            ('comfy_cancel_build', '取消本构建的排队任务并停止监控，不全局中断其他 GPU 任务。',
             {'type': 'object', 'properties': {'build_id': {'type': 'string'}}, 'required': ['build_id'], 'additionalProperties': False}),
            ('comfy_read_build_candidate', '恢复构建 API 图和参数，读取失败证据及剩余修复预算；较大图按 node_ids 分批读取。',
             {'type': 'object', 'properties': {'build_id': {'type': 'string'}, 'node_ids': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 12}}, 'required': ['build_id'], 'additionalProperties': False}),
            ('comfy_repair_build', '依据明确失败记录和修改假设创建新候选；同一构建最多修复三次，不覆盖旧版本、不自动提交推理。',
             {'type': 'object', 'properties': {'parent_id': {'type': 'string'}, 'hypothesis': {'type': 'string'}, 'candidate': BuildRequest.model_json_schema()}, 'required': ['parent_id', 'hypothesis', 'candidate'], 'additionalProperties': False}),
            ('comfy_get_dependency_plan', '恢复保存的依赖计划，检查来源映射是否变化以及实例队列；不安装、不重启。',
             {'type': 'object', 'properties': {'plan_id': {'type': 'string'}}, 'required': ['plan_id'], 'additionalProperties': False}),
            ('comfy_plan_dependencies', '查询缺失节点对应的 Manager 插件候选及阻碍；只读，不安装、不重启。歧义或未知来源不能自行猜测。',
             {'type': 'object', 'properties': {'node_types': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1, 'maxItems': 12}}, 'required': ['node_types'], 'additionalProperties': False}),
            ('comfy_read_template', '优先查询和复用已有工作流；不传 name 列出模板，可按 search 筛选；传 name 读取 API 图。',
             {'type': 'object', 'properties': {'name': {'type': 'string'}, 'search': {'type': 'string'}}, 'additionalProperties': False}),
            ('comfy_inspect_environment', '查询当前 ComfyUI 可用节点；使用 node_types 获取真实定义及模型枚举。',
             {'type': 'object', 'properties': {'search': {'type': 'string'}, 'node_types': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 12}}, 'additionalProperties': False}),
            ('comfy_create_build', '保存并完整校验 API 工作流和参数映射候选；不会安装插件或启动推理。fields 的 default 是测试和交付初始值，提示词字段保持 standalone。', BuildRequest.model_json_schema()),
            ('comfy_start_test', '提交一次真实推理测试，立即返回构建 ID；后台继续运行，不重复提交。',
             {'type': 'object', 'properties': {'build_id': {'type': 'string'}}, 'required': ['build_id'], 'additionalProperties': False}),
            ('comfy_get_build', '查询真实测试报告；最多等待 8 秒。未完成时告知后台继续，可从构建列表恢复。',
             {'type': 'object', 'properties': {'build_id': {'type': 'string'}, 'wait_seconds': {'type': 'number', 'minimum': 0, 'maximum': 8}}, 'required': ['build_id'], 'additionalProperties': False}),
            ('comfy_propose_node', '为已通过真实测试的工作流提出一个已有 ComfyUI 节点候选；采用时才发布工作流并配置参数。',
             {'type': 'object', 'properties': {'build_id': {'type': 'string'}}, 'required': ['build_id'], 'additionalProperties': False}),
        ]
        return [{'type': 'function', 'function': {'name': name, 'description': description, 'parameters': schema}}
                for name, description, schema in specs]

    async def call(self, name, arguments):
        if name == 'comfy_list_builds':
            return {'builds': self.list()}
        if name == 'comfy_cancel_build':
            return await self.cancel(arguments.get('build_id'))
        if name == 'comfy_read_build_candidate':
            return self.read_candidate(arguments.get('build_id'), arguments.get('node_ids'))
        if name == 'comfy_repair_build':
            self.path(arguments.get('parent_id'))
            return await self.create(arguments.get('candidate'), repair_parent=arguments.get('parent_id'), hypothesis=arguments.get('hypothesis'))
        if name == 'comfy_plan_dependencies':
            return await self.plan_dependencies(arguments.get('node_types'))
        if name == 'comfy_get_dependency_plan':
            return await self.get_dependency_plan(arguments.get('plan_id'))
        if name == 'comfy_read_template':
            return self.templates(arguments.get('name', ''), arguments.get('search', ''))
        if name == 'comfy_inspect_environment':
            return await self.inspect(arguments.get('node_types'), arguments.get('search', ''))
        if name == 'comfy_create_build':
            return await self.create(arguments)
        if name == 'comfy_start_test':
            return await self.start(arguments['build_id'])
        if name == 'comfy_get_build':
            wait = arguments.get('wait_seconds', 0)
            if type(wait) not in (float, int) or not 0 <= wait <= 8:
                raise ValueError('等待时长必须为 0—8 秒')
            return await self.get(arguments['build_id'], wait)
        if name == 'comfy_propose_node':
            record = self.read(arguments['build_id'])
            fields = {'comfyBuildId': record['id'], 'comfyRevision': record['revision']}
            await self.check_node(fields)
            return {'proposal': {'summary': '创建已测试的 ComfyUI 节点：' + record['candidate']['title'],
                                 'nodes': [{'id': 'comfy-' + record['id'][:8], 'type': 'comfy', 'fields': fields}],
                                 'connections': []}}
        raise ValueError('未知 ComfyUI 构建工具')


def pinned_instance(workflow_root, name, instances):
    """Only published AI graphs opt out of legacy load balancing."""
    if not name.startswith('custom/ai-'):
        return None
    suffix = name.removeprefix('custom/ai-').removesuffix('.json')
    if len(suffix) != 32 or any(c not in '0123456789abcdef' for c in suffix) or not name.endswith('.json'):
        return None  # Existing custom workflows may legitimately use an ai- prefix.
    path = Path(workflow_root) / name.replace('.json', '.config.json')
    if not path.exists():
        raise ValueError('AI 工作流发布配置缺失')
    target = json.loads(path.read_text(encoding='utf-8')).get('ai_build', {}).get('instance')
    if target not in instances:
        raise ValueError('已验证的 ComfyUI 实例不再可用，请重新测试工作流')
    return target
