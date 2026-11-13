"""Durable, tested declarative plugin candidates; no model supplied code execution."""

import asyncio
import copy
import json
import threading
import time
import uuid
from contextlib import ExitStack, suppress

from core import node_catalog
from core.comfy_workflow_builds import write_json
from core.node_media import ImageExpectation, ImageFixture, NodeMedia, fixture_image
from core.node_ports import NodePorts, compare_outputs, test_inputs, validate_values


class NodePluginBuilds:
    def __init__(self, context):
        self.context = context
        self.root = context.root / 'node-candidates'

    def path(self, candidate_id):
        return self.root / self.context.path(candidate_id).name

    def list(self):
        records = [json.loads(path.read_text(encoding='utf-8')) for path in self.root.glob('*.json')]
        selected = sorted((record for record in records if record['canvasId'] == self.context.canvas_id),
                          key=lambda record: record['createdAt'], reverse=True)[:30]
        return [{key: record[key] for key in ('id', 'revision', 'status', 'report', 'createdAt')} |
                {'title': record['definition']['title'], 'executionKind': record['definition']['execution']['kind'],
                 'dependencies': record['definition']['execution'].get('dependencies', [])}
                for record in selected]

    def read(self, candidate_id):
        path = self.path(candidate_id)
        if not path.exists():
            raise ValueError('节点候选不存在或不属于当前用户')
        record = json.loads(path.read_text(encoding='utf-8'))
        if record['canvasId'] != self.context.canvas_id:
            raise ValueError('节点候选不属于当前画布')
        return record

    def create(self, value, tests):
        # 媒体 worker 的文本入口是宿主协议要求，交由宿主补齐机械字段。
        # 不改已有参数类型，不修改代码、测试预期或授权要求。
        repairs = []
        if isinstance(value, str):
            if len(value) > 100000:
                raise ValueError('definition过大；应传节点JSON对象，不是字符串')
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValueError('definition必须是单个JSON对象；不要附带代码围栏或说明') from None
            if not isinstance(value, dict):
                raise ValueError('definition必须是JSON对象，不能是数组或再次编码的字符串')
            repairs.append('已解析被字符串编码的节点定义，未修改代码或测试')
        if isinstance(value, dict):
            execution = value.get('execution', {})
            fields = value.get('fields', [])
            if (isinstance(execution, dict) and execution.get('kind') == 'worker.python'
                    and execution.get('media') is True and value.get('ports')
                    and isinstance(fields, list) and all(isinstance(field, dict) for field in fields)):
                key = execution.get('textField', 'text')
                if isinstance(key, str) and not any(field.get('id') == key for field in fields):
                    value = copy.deepcopy(value)
                    value['fields'] = [*fields, {'id': key, 'label': '文本输入', 'component': 'textarea', 'default': ''}]
                    value['execution']['textField'] = key
                    repairs.append('已补齐媒体worker协议所需的文本输入字段：' + key)
        item = node_catalog.definition(value)
        if not isinstance(tests, list) or not 1 <= len(tests) <= 12:
            raise ValueError('需要 1—12 个带预期输出的测试')
        normalized = []
        image_worker = item['execution'].get('media', False)
        ports = NodePorts.model_validate(item['ports']) if item.get('ports') else None
        for test in tests:
            if ports is not None:
                if not isinstance(test, dict) or set(test) - {'params', 'portInputs', 'expectedPorts'} or 'expectedPorts' not in test:
                    extra = sorted(set(test) - {'params', 'portInputs', 'expectedPorts'}) if isinstance(test, dict) else []
                    raise ValueError('命名端口测试只允许params、portInputs、expectedPorts，expectedPorts必填；'
                                     f'请删除多余字段{extra}。文本预期应声明text输出端口并放入expectedPorts，不使用expectedText。')
                if len(json.dumps(test, ensure_ascii=False, allow_nan=False)) > 48000:
                    raise ValueError('单个测试超过大小上限')
                validate_values(ports.inputs, test.get('portInputs', {}), 'fixture')
                validate_values(ports.outputs, test['expectedPorts'], 'expected')
                normalized.append(test)
                continue
            if (not isinstance(test, dict) or set(test) - {'params', 'inputs', 'expectedText', 'imageInputs', 'expectedImages', 'httpResponse'}
                    or not isinstance(test.get('expectedText'), str) or len(test['expectedText']) > 16000):
                raise ValueError('当前定义没有ports，使用旧版测试：每项必须包含expectedText；'
                                 '图片worker另需imageInputs/expectedImages。若使用expectedPorts，'
                                 '必须先在definition中声明ports，并改用params/portInputs/expectedPorts测试。')
            if len(json.dumps(test, ensure_ascii=False)) > 48000:
                raise ValueError('单个测试超过大小上限')
            if item['execution']['kind'] == 'host.http':
                if not isinstance(test.get('httpResponse'), dict):
                    raise ValueError('API候选必须提供httpResponse响应样例；测试不会调用真实服务')
                json.dumps(test['httpResponse'], allow_nan=False)
            elif 'httpResponse' in test:
                raise ValueError('httpResponse只用于host.http节点')
            if image_worker:
                images, expected = test.get('imageInputs', []), test.get('expectedImages')
                if not isinstance(images, list) or len(images) > 8 or not isinstance(expected, list) or not 1 <= len(expected) <= 8:
                    raise ValueError('图片测试需要0—8个 imageInputs 和1—8个 expectedImages')
                for fixture in images:
                    ImageFixture.model_validate(fixture)
                for output in expected:
                    ImageExpectation.model_validate(output)
            elif 'imageInputs' in test or 'expectedImages' in test:
                raise ValueError('图片测试字段只用于 execution.media=true 的 worker')
            normalized.append(test)
        revision = node_catalog.digest({'definition': item, 'tests': normalized})
        for path in self.root.glob('*.json'):
            saved = json.loads(path.read_text(encoding='utf-8'))
            if saved['canvasId'] == self.context.canvas_id and saved['revision'] == revision:
                return saved
        record = {'id': uuid.uuid4().hex, 'canvasId': self.context.canvas_id, 'revision': revision,
                  'definition': item, 'tests': normalized, 'status': 'draft', 'report': None,
                  'createdAt': time.time()}
        if repairs:
            record['repairs'] = repairs
        write_json(self.path(record['id']), record)
        return record

    def test(self, candidate_id, cancel_event=None):
        record = self.read(candidate_id)
        if record['definition']['execution']['kind'] == 'worker.python':
            if record.get('trustedRevision') != record['revision']:
                raise ValueError('必须先明确授权该固定版本 worker 代码；独立进程不是操作系统沙箱')
            if node_catalog.digest({'definition': record['definition'], 'tests': record['tests']}) != record['revision']:
                raise ValueError('候选内容已变化，请重新创建并授权')
        results, started, environment_failed = [], time.monotonic(), False
        with ExitStack() as cleanup:
            event = None
            if record['definition']['execution']['kind'] == 'worker.python':
                from core import node_worker
                event = node_worker.register(str(self.context.root), candidate_id, cancel_event)
                cleanup.callback(node_worker.unregister, str(self.context.root), candidate_id)
            if record['definition']['execution'].get('dependencies'):
                from core.node_python_env import PythonEnvironment
                try:
                    environment = PythonEnvironment(self.context.owner, record['definition']).ensure(event)
                    record['environment'] = environment
                    started = time.monotonic()  # Installation has its own bounded budget.
                except ValueError as exc:
                    environment_failed = True
                    results.append({'index': 0, 'passed': False, 'error': '独立依赖环境准备失败：' + str(exc)[:1200]})
            for index, test in enumerate(record['tests']):
                if environment_failed:
                    break
                if time.monotonic() - started > 60 or event is not None and event.is_set():
                    results.append({'index': index, 'passed': False, 'error': '候选测试已取消或超过 60 秒预算，其余分支未验证'})
                    break
                try:
                    with ExitStack() as resources:
                        media, handles = None, []
                        ports = NodePorts.model_validate(record['definition']['ports']) if record['definition'].get('ports') else None
                        mapped = None
                        if record['definition']['execution'].get('media'):
                            media = NodeMedia(self.context.owner)
                            for fixture in test.get('imageInputs', []):
                                handle = media.save(fixture_image(fixture))['id']
                                resources.callback(media.remove, handle)
                                handles.append(handle)
                        if ports is not None:
                            mapped = test_inputs(ports, test.get('portInputs', {}), media, resources)
                        result = node_catalog.execute(record['definition'], test.get('params', {}), test.get('inputs', []),
                                                      trusted=record.get('trustedRevision') == record['revision'], cancel_event=event,
                                                      worker_deadline=started + 60, media=media, media_inputs=handles,
                                                      worker_owner=self.context.owner, port_inputs=mapped,
                                                      http_fixture=test.get('httpResponse'))
                        passed = (compare_outputs(ports, result['outputs']['ports'], test['expectedPorts']) if ports is not None
                                  else result['outputs']['text'] == test['expectedText'])
                        report = {'index': index, 'passed': passed, 'actualText': result['outputs']['text']}
                        if ports is not None:
                            report['ports'] = result['outputs']['ports']
                            report['images'] = result['outputs']['images']
                        elif media is not None:
                            actual = result['outputs']['images']
                            expected = test['expectedImages']
                            report['images'] = actual
                            report['passed'] = passed and len(actual) == len(expected) and all(
                                all(actual_image.get(key) == val for key, val in expected_image.items() if val is not None)
                                for actual_image, expected_image in zip(actual, expected, strict=True))
                        results.append(report)
                except (ValueError, TypeError) as exc:
                    results.append({'index': index, 'passed': False, 'error': str(exc)[:500]})
        record['status'] = 'passed' if all(test['passed'] for test in results) else 'failed'
        record['report'] = {'results': results, 'testedAt': time.time(),
                            'scope': '实际执行指定执行器并比较输出；不代表自定义界面交互或未覆盖分支已验证'}
        if record['definition']['execution']['kind'] == 'host.http':
            record['report']['scope'] = '仅使用模拟HTTP响应验证结果提取；未调用真实服务，不代表联网、凭据或服务业务逻辑通过'
        if record['definition']['execution'].get('dependencies'):
            record['report']['environment'] = self.environment(candidate_id)
        write_json(self.path(candidate_id), record)
        return record

    def cancel(self, candidate_id):
        from core import node_worker
        self.read(candidate_id)
        node_worker.cancel(str(self.context.root), candidate_id)
        return {'status': 'cancelling'}

    async def call_async(self, name, args):
        cancelled = threading.Event()
        task = asyncio.create_task(asyncio.to_thread(self.call, name, args, cancelled))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled.set()
            if name == 'canvas_test_plugin':
                with suppress(ValueError):
                    self.cancel(args.get('candidate_id'))
            # The thread owns process cleanup. Shield it so a disconnected chat cannot orphan a worker.
            with suppress(Exception):
                await asyncio.shield(task)
            raise

    def checked(self, candidate_id, revision):
        record = self.read(candidate_id)
        if record['revision'] != revision or record['status'] != 'passed':
            raise ValueError('节点候选版本不匹配或尚未通过测试')
        expected = node_catalog.digest({'definition': record['definition'], 'tests': record['tests']})
        if expected != revision:
            raise ValueError('节点候选内容已变化，请重新创建并测试')
        return record

    def install(self, candidate_id, revision):
        record = self.checked(candidate_id, revision)
        trusted = record.get('trustedRevision') == revision
        if record['definition']['execution']['kind'] == 'worker.python' and not trusted:
            raise ValueError('worker 代码尚未授权')
        item = node_catalog.install(record['definition'], trusted=trusted)
        return {'status': 'installed', 'definition': item, 'definitionHash': node_catalog.digest(item),
                'report': record['report']}

    def approve_worker(self, candidate_id, revision):
        record = self.read(candidate_id)
        if revision != record['revision'] or node_catalog.digest({
                'definition': record['definition'], 'tests': record['tests']}) != revision:
            raise ValueError('worker 候选版本已变化')
        record['trustedRevision'] = revision
        write_json(self.path(candidate_id), record)

    def tools(self):
        specs = [
            ('canvas_resolve_python_dependencies', '只读解析固定直接依赖的传递依赖，最多16包/64次元数据/60秒；返回可审阅的固定版本清单，不安装。',
             {'dependencies': {'type': 'array', 'minItems': 1, 'maxItems': 16, 'items': {
                 'type': 'object', 'properties': {'name': {'type': 'string'}, 'version': {'type': 'string'}},
                 'required': ['name', 'version'], 'additionalProperties': False}}}),
            ('canvas_find_python_package', '只读查询PyPI固定版本和依赖要求；version为空查询当前版本，不安装。',
             {'name': {'type': 'string'}, 'version': {'type': 'string'}}),
            ('canvas_get_plugin_environment', '查询当前账号候选节点的独立Python依赖环境，不安装、不覆盖旧版本。',
             {'candidate_id': {'type': 'string'}}),
            ('canvas_list_plugin_candidates', '列出当前用户当前画布的节点候选与测试状态，用于恢复后台任务。', {}),
            ('canvas_get_plugin_sdk', '读取通用节点 SDK、参数组件、自定义界面及执行器能力。', {}),
            ('canvas_create_plugin_candidate', '创建节点插件候选及测试，不安装。声明ports时测试仅用params/portInputs/expectedPorts，不能带expectedText/inputs/imageInputs；无ports才用expectedText。依赖放execution.dependencies。优先复用已有节点。',
             {'definition': node_catalog.NodeDefinition.model_json_schema(), 'tests': {
                 'type': 'array', 'minItems': 1, 'maxItems': 12, 'items': {
                     'type': 'object', 'properties': {'params': {'type': 'object'},
                         'inputs': {'type': 'array', 'items': {'type': 'string'}}, 'expectedText': {'type': 'string'},
                         'imageInputs': {'type': 'array', 'maxItems': 8, 'items': ImageFixture.model_json_schema()},
                         'expectedImages': {'type': 'array', 'minItems': 1, 'maxItems': 8, 'items': ImageExpectation.model_json_schema()},
                         'portInputs': {'type': 'object', 'description': '命名端口输入；图片/蒙版用width/height/color，音频用frames/sampleRate/channels静音WAV素材，视频用width/height/frames合成H264 MP4素材，集合用数组。'},
                         'httpResponse': {'type': 'object', 'description': 'host.http必填模拟JSON响应，候选测试不发送真实请求。'},
                         'expectedPorts': {'type': 'object', 'description': '命名端口预期输出；图片/蒙版为width/height/可选sha256对象，其他类型为真实预期值。'}},
                     'additionalProperties': False,
                     'oneOf': [
                         {'required': ['expectedText'], 'not': {'anyOf': [
                             {'required': ['expectedPorts']}, {'required': ['portInputs']}]}},
                         {'required': ['expectedPorts'], 'not': {'anyOf': [
                             {'required': [key]} for key in ('expectedText', 'inputs', 'imageInputs', 'expectedImages', 'httpResponse')]}}
                     ]}}}),
            ('canvas_test_plugin', '实际执行候选测试并保存报告，失败不会安装。', {'candidate_id': {'type': 'string'}}),
            ('canvas_install_plugin', '安装已通过测试的固定候选版本，不覆盖旧版本。',
             {'candidate_id': {'type': 'string'}, 'revision': {'type': 'string'}}),
            ('canvas_get_plugin_candidate', '恢复候选定义和测试报告。', {'candidate_id': {'type': 'string'}}),
            ('canvas_propose_plugin', '为已通过测试的插件生成画布节点候选；采用后才配置画布。',
             {'candidate_id': {'type': 'string'}, 'revision': {'type': 'string'}}),
        ]
        return [{'type': 'function', 'function': {'name': name, 'description': description,
                'parameters': {'type': 'object', 'properties': properties, 'required': list(properties),
                               'additionalProperties': False}}} for name, description, properties in specs]

    def call(self, name, args, cancel_event=None):
        if name == 'canvas_resolve_python_dependencies':
            from core.node_dependency_resolution import resolve_dependencies
            return resolve_dependencies(args.get('dependencies'), cancel_event)
        if name == 'canvas_find_python_package':
            from core.node_python_env import inspect_package
            return inspect_package(args['name'], args.get('version', ''), cancel_event)
        if name == 'canvas_get_plugin_environment':
            return self.environment(args['candidate_id'])
        if name == 'canvas_list_plugin_candidates':
            return {'plugins': self.list()}
        if name == 'canvas_get_plugin_sdk':
            return node_catalog.sdk()
        if name == 'canvas_create_plugin_candidate':
            return self.create(args['definition'], args['tests'])
        if name == 'canvas_test_plugin':
            return self.test(args['candidate_id'], cancel_event)
        if name == 'canvas_get_plugin_candidate':
            return self.read(args['candidate_id'])
        if name == 'canvas_install_plugin':
            return self.install(args['candidate_id'], args['revision'])
        if name == 'canvas_propose_plugin':
            record = self.checked(args['candidate_id'], args['revision'])
            prefix = '创建通过模拟响应测试的API节点（未联网）：' if record['definition']['execution']['kind'] == 'host.http' else '创建已测试节点：'
            return {'proposal': {'summary': prefix + record['definition']['title'],
                    'nodes': [{'id': 'plugin-' + record['id'][:8], 'type': 'extension',
                               'fields': {'nodeDefinition': json.dumps(record['definition'], ensure_ascii=False)}}],
                    'connections': []}}
        raise ValueError('未知节点插件工具')

    def environment(self, candidate_id):
        from core.node_python_env import PythonEnvironment
        record = self.read(candidate_id)
        if record['definition']['execution']['kind'] != 'worker.python':
            return {'status': 'not_required', 'scope': '当前声明式执行器不需要独立Python依赖环境'}
        return PythonEnvironment(self.context.owner, record['definition']).status()
