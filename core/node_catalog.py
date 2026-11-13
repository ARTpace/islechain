"""Versioned declarative nodes. No plugin code is evaluated by this first adapter."""

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from threading import RLock
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.node_plugin_ui import normalize_form
from core.node_ports import NodePorts
from core.node_http import HTTPExecution
from core.user_paths import user_data_dir

Identifier = Annotated[str, Field(pattern=r'^[a-z][a-z0-9_.-]{0,79}$')]
_LOCK = RLock()
COMPONENTS = ('text', 'textarea', 'number', 'slider', 'dropdown', 'boolean')
BUILTIN_NODES = [
    {'typeId': 'prompt', 'title': '文本 / 提示词', 'componentVersion': '1.0.0',
     'fields': [{'id': 'text', 'label': '文本', 'component': 'textarea', 'default': ''}],
     'outputs': [{'id': 'text', 'type': 'STRING'}],
     'description': '已有文本节点；普通文本输入和提示词直接复用此节点，不创建替代插件。'},
    {'typeId': 'comfy', 'title': 'ComfyUI', 'description': '已有工作流节点，通过经过测试的构建产物配置。'},
]


DEFAULT_GROUPS = [
    {'id': 'basic', 'title': '基础', 'members': ['image', 'prompt', 'loop', 'llm', 'gameFile', 'output']},
    {'id': 'generate', 'title': '生成', 'members': ['imageGen', 'generator', 'msgen', 'video', 'ltxDirector', 'minimax', 'gameSpeech', 'gameModelAsset', 'gameModel3d', 'gameAnimate3d']},
    {'id': 'workflow', 'title': '工作流', 'members': ['comfy', 'rh', 'materialPbr']},
    {'id': 'game', 'title': '游戏', 'members': ['gameIdea', 'gamePlan', 'gameAssets', 'gameTable', 'gameDevelop', 'gameTest', 'gameRelease']},
]


class ComponentField(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Identifier
    label: str = Field(min_length=1, max_length=80)
    component: Literal['text', 'textarea', 'number', 'slider', 'dropdown', 'boolean']
    default: str | bool | int | float = ''
    minimum: float | None = Field(default=None, allow_inf_nan=False)
    maximum: float | None = Field(default=None, allow_inf_nan=False)
    step: float = Field(default=1, gt=0, allow_inf_nan=False)
    options: list[str] = Field(default_factory=list, max_length=100)

    def validate_value(self, value):
        if self.component == 'boolean':
            if type(value) is not bool:
                raise ValueError(f'{self.id}: 需要布尔值')
        elif self.component in ('number', 'slider'):
            if type(value) not in (int, float) or not float('-inf') < value < float('inf'):
                raise ValueError(f'{self.id}: 需要有限数值')
            if self.minimum is not None and value < self.minimum:
                raise ValueError(f'{self.id}: 小于最小值')
            if self.maximum is not None and value > self.maximum:
                raise ValueError(f'{self.id}: 大于最大值')
        elif not isinstance(value, str) or len(value) > 16000:
            raise ValueError(f'{self.id}: 文本过长或类型无效')
        elif self.component == 'dropdown' and value not in self.options:
            raise ValueError(f'{self.id}: 不在选项中')
        return value

    @model_validator(mode='after')
    def valid(self):
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError('参数范围无效')
        if any(len(option) > 200 for option in self.options):
            raise ValueError('选项过长')
        self.validate_value(self.default)
        return self


class TextExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['host.text'] = 'host.text'
    operation: Literal['identity', 'uppercase', 'lowercase', 'replace'] = 'identity'
    textField: Identifier
    prefixField: Identifier | None = None
    suffixField: Identifier | None = None
    findField: Identifier | None = None
    replaceField: Identifier | None = None


class PipelineStep(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['trim', 'uppercase', 'lowercase', 'replace', 'prefix', 'suffix',
                       'sort_lines', 'unique_lines', 'reverse_lines', 'json_format', 'sha256']
    value: str = Field(default='', max_length=4000)
    replacement: str = Field(default='', max_length=4000)


class PipelineExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['host.pipeline']
    textField: Identifier
    steps: list[PipelineStep] = Field(min_length=1, max_length=24)


class NodeUI(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['isolated.form', 'isolated.worker'] = 'isolated.form'
    html: str = Field(min_length=1, max_length=8000)
    css: str = Field(default='', max_length=4000)
    height: int = Field(default=260, ge=100, le=800)
    script: str = Field(default='', max_length=6000)


class PythonDependency(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
    version: str = Field(pattern=r'^[0-9][A-Za-z0-9.]{0,79}$')

    @model_validator(mode='after')
    def normalized(self):
        self.name = re.sub(r'[-_.]+', '-', self.name).lower()
        return self


class PythonExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['worker.python']
    textField: Identifier
    code: str = Field(min_length=1, max_length=8000)
    timeoutSeconds: int = Field(default=15, ge=1, le=30)
    media: bool = False
    dependencies: list[PythonDependency] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def unique_dependencies(self):
        if len({item.name for item in self.dependencies}) != len(self.dependencies):
            raise ValueError('Python依赖包名称重复，请显式固定唯一版本')
        self.dependencies.sort(key=lambda item: item.name)
        return self


class ComfyExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['comfy.workflow']
    workflowName: str = Field(pattern=r'^custom/ai-[a-f0-9]{32}\.json$')
    buildId: str = Field(pattern=r'^[a-f0-9]{32}$')
    revision: str = Field(min_length=1, max_length=128)


class CliExecution(BaseModel):
    """本机受控 CLI（目前只有 Unity -executeMethod）。

    参数不写在定义里，由节点字段提供；后端固定 argv 前缀并逐项校验，
    不经过 shell，也不接受任意命令。与 host.http / worker.python 的区别：
    不要求 HTTPS、不需要 trusted hash、不受 30 秒 worker 上限约束。
    """
    model_config = ConfigDict(extra='forbid')
    kind: Literal['host.cli'] = 'host.cli'


class NodeDefinition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal[1] = 1
    componentVersion: Literal['1.0.0'] = '1.0.0'
    typeId: Identifier
    version: str = Field(pattern=r'^\d{1,4}\.\d{1,4}\.\d{1,4}$')
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=400)
    keywords: list[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=12)
    fields: list[ComponentField] = Field(min_length=0, max_length=40)
    execution: Annotated[TextExecution | PipelineExecution | PythonExecution | HTTPExecution | ComfyExecution | CliExecution, Field(discriminator='kind')]
    ui: NodeUI | None = None
    ports: NodePorts | None = None

    @model_validator(mode='after')
    def valid(self):
        fields = {field.id: field for field in self.fields}
        if not fields and not isinstance(self.execution, ComfyExecution):
            raise ValueError('节点至少需要一个参数')
        if len(fields) != len(self.fields):
            raise ValueError('参数 ID 重复')
        if isinstance(self.execution, HTTPExecution) and any(field not in fields for field in self.execution.bodyFields.values()):
            raise ValueError('API请求字段必须引用已声明参数')
        for key, value in self.execution.model_dump().items():
            if key.endswith('Field') and value is not None:
                if value not in fields or fields[value].component not in ('text', 'textarea', 'dropdown'):
                    raise ValueError('文本执行绑定必须引用已有文本字段')
        if isinstance(self.execution, TextExecution) and self.execution.operation == 'replace' and not self.execution.findField:
            raise ValueError('替换操作需要 findField')
        if self.ports is not None:
            if not isinstance(self.execution, PythonExecution):
                raise ValueError('命名端口仅用于worker.python执行器')
            if any(port.type in ('image', 'mask', 'audio', 'video') for port in [*self.ports.inputs, *self.ports.outputs]) and not self.execution.media:
                raise ValueError('图片/蒙版端口必须声明execution.media=true')
        if self.ui is not None:
            self.ui.html = normalize_form(self.ui.html, fields)
            if bool(self.ui.script) != (self.ui.kind == 'isolated.worker'):
                raise ValueError('isolated.worker 必须提供 script，isolated.form 不接受脚本')
        return self


def definition(value):
    node = NodeDefinition.model_validate(value)
    result = node.model_dump(mode='json')
    if result['ui'] is None:
        del result['ui']  # Preserve existing definition hashes and saved nodes.
    if result['ports'] is None:
        del result['ports']
    if isinstance(node.execution, HTTPExecution) and node.execution.polling is None:
        result['execution'].pop('polling', None)
    if isinstance(node.execution, PythonExecution) and not node.execution.media:
        result['execution'].pop('media', None)  # Existing text-worker hashes must stay unchanged.
    if isinstance(node.execution, PythonExecution) and not node.execution.dependencies:
        result['execution'].pop('dependencies', None)
    if len(json.dumps(result, ensure_ascii=False)) > 16000:
        raise ValueError('节点定义超过 16000 字符')
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def permissions(value):
    execution = value['execution']
    if execution['kind'] == 'host.http':
        return ['http-post', 'credential-reference']
    if execution['kind'] == 'host.cli':
        return ['local-process']
    return (['trusted-code'] + (['python-dependencies'] if execution.get('dependencies') else [])
            if execution['kind'] == 'worker.python' else [])


def catalog_path():
    return Path(user_data_dir()) / 'node-plugins' / 'catalog.json'


def read_catalog():
    path = catalog_path()
    if not path.exists():
        return {'definitions': [], 'groups': json.loads(json.dumps(DEFAULT_GROUPS)), 'revision': 0, 'menuGroupsInitialized': True}
    catalog = json.loads(path.read_text(encoding='utf-8'))
    # Keep existing group IDs and memberships; add missing built-in categories in memory.
    for default in ([] if catalog.get('menuGroupsInitialized') else DEFAULT_GROUPS):
        if not any(group['id'] == default['id'] or group['title'] == default['title'] for group in catalog.get('groups', [])):
            catalog.setdefault('groups', []).append(json.loads(json.dumps(default)))
    catalog['menuGroupsInitialized'] = True
    return catalog


def public_catalog():
    catalog = read_catalog()
    return {**catalog, 'hashes': {f"{item['typeId']}@{item['version']}": digest(item)
                                for item in catalog['definitions']
                                if f"{item['typeId']}@{item['version']}" not in catalog.get('disabled', [])}}


def set_enabled(type_id, version, enabled, revision):
    if type(enabled) is not bool:
        raise ValueError('启用状态必须为布尔值')
    with _LOCK:
        catalog = read_catalog()
        if catalog['revision'] != revision:
            raise ValueError('目录版本已变化，请刷新后重试')
        if not any(item['typeId'] == type_id and item['version'] == version for item in catalog['definitions']):
            raise ValueError('节点版本不存在')
        key = f'{type_id}@{version}'
        disabled = set(catalog.get('disabled', []))
        if enabled:
            disabled.discard(key)
        else:
            disabled.add(key)
        catalog['disabled'] = sorted(disabled)
        catalog['revision'] += 1
        _write(catalog)
    return public_catalog()


def migrate_params(value, params):
    node = NodeDefinition.model_validate(value)
    if not isinstance(params, dict):
        raise ValueError('参数必须为对象')
    # Keep removed fields in the canvas's version snapshot; never silently coerce incompatible data.
    return {field.id: field.validate_value(params.get(field.id, field.default)) for field in node.fields}


def _write(value):
    path = catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def install(value, *, trusted=False):
    item = definition(value)
    with _LOCK:
        catalog = read_catalog()
        same = next((entry for entry in catalog['definitions']
                     if (entry['typeId'], entry['version']) == (item['typeId'], item['version'])), None)
        if same and same != item:
            raise ValueError('同版本定义不可覆盖，请增加版本号')
        if not same:
            if len(catalog['definitions']) >= 500:
                raise ValueError('节点版本数量达到上限')
            catalog['definitions'].append(item)
            catalog['revision'] += 1
            _write(catalog)
        if trusted and item['execution']['kind'] == 'worker.python' and digest(item) not in catalog.get('trustedHashes', []):
            catalog['trustedHashes'] = [*catalog.get('trustedHashes', []), digest(item)]
            catalog['revision'] += 1
            _write(catalog)
        return item


class NodeGroup(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Identifier
    title: str = Field(min_length=1, max_length=60)
    members: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(default_factory=list, max_length=500)


def save_groups(groups, revision):
    if not isinstance(groups, list) or len(groups) > 60:
        raise ValueError('分组数量无效')
    items = [NodeGroup.model_validate(item).model_dump() for item in groups]
    if len({item['id'] for item in items}) != len(items):
        raise ValueError('分组 ID 重复')
    with _LOCK:
        catalog = read_catalog()
        if revision != catalog['revision']:
            raise ValueError('节点目录已更新，请刷新后重试')
        catalog['groups'] = items
        catalog['revision'] += 1
        _write(catalog)
        return catalog


def execute(value, params, inputs, *, trusted=False, cancel_event=None, worker_deadline=None,
            media=None, media_inputs=None, worker_owner=None, port_inputs=None, http_fixture=None, run_id=None):
    node = NodeDefinition.model_validate(value)
    if not isinstance(params, dict) or set(params) - {field.id for field in node.fields}:
        raise ValueError('包含未知参数')
    if not isinstance(inputs, list) or len(inputs) > 24 or any(not isinstance(v, str) or len(v) > 16000 for v in inputs):
        raise ValueError('文本输入格式无效')
    if media_inputs is not None and (not isinstance(media_inputs, list) or len(media_inputs) > 8):
        raise ValueError('图片输入必须是最多8个资源ID的列表')
    values = {field.id: field.validate_value(params.get(field.id, field.default)) for field in node.fields}
    binding = node.execution
    if isinstance(binding, ComfyExecution):
        raise ValueError('封装工作流由 ComfyUI 任务队列执行，请从画布运行')
    if port_inputs is not None and node.ports is None:
        raise ValueError('当前节点未声明命名端口')
    if node.ports is not None and (inputs or media_inputs):
        raise ValueError('命名端口节点不接受未映射的旧文本/图片集合')
    if media_inputs and (not isinstance(binding, PythonExecution) or not binding.media):
        raise ValueError('此节点没有声明图片输入协议')
    if isinstance(binding, CliExecution):
        # host.cli 执行器按 typeId 分发：unity.cli 走 batchmode，uloop.cli 走已打开的编辑器主线程。
        if node.typeId == 'uloop.cli':
            from core import uloop_cli
            text = uloop_cli.run(values, cancel_event, inputs)
        else:
            from core import unity_cli
            text = unity_cli.run(values, cancel_event)
        return {'status': 'succeeded', 'outputs': {'text': text},
                'definitionHash': digest(definition(value))}
    if isinstance(binding, PythonExecution):
        normalized = definition(value)
        if not trusted and digest(normalized) not in read_catalog().get('trustedHashes', []):
            raise ValueError('独立 worker 可访问当前用户文件、网络和进程，必须先授权该固定版本代码')
        from core.node_worker import execute_worker
        site = None
        if binding.dependencies:
            from core.node_python_env import PythonEnvironment
            site = PythonEnvironment(worker_owner, normalized).ready()
        output = execute_worker(binding, values, inputs, cancel_event, worker_deadline,
                                media=media, media_inputs=media_inputs, site=site, ports=node.ports, port_inputs=port_inputs)
        return {'status': 'succeeded', 'outputs': output if binding.media or node.ports is not None else {'text': output},
                'definitionHash': digest(normalized)}
    parts = [*inputs, values[binding.textField]]
    if sum(map(len, parts)) + len(parts) - 1 > 16000:
        raise ValueError('合并文本超过 16000 字符')
    text = '\n'.join(parts)
    if isinstance(binding, HTTPExecution):
        from core.node_http import execute_http
        if cancel_event is not None and cancel_event.is_set():
            raise ValueError('API请求开始前已取消')
        text = execute_http(binding, values, text, worker_owner, digest(definition(value)), http_fixture,
                            run_id=run_id, cancel=cancel_event)
        if cancel_event is not None and cancel_event.is_set():
            raise ValueError('已停止等待；远端请求可能已执行，结果未发布')
        return {'status': 'succeeded', 'outputs': {'text': text}, 'definitionHash': digest(definition(value))}
    if isinstance(binding, PipelineExecution):
        for step in binding.steps:
            if step.operation == 'trim':
                text = text.strip()
            elif step.operation == 'uppercase':
                text = text.upper()
            elif step.operation == 'lowercase':
                text = text.lower()
            elif step.operation == 'replace':
                if not step.value:
                    raise ValueError('查找内容不能为空')
                if len(text) + text.count(step.value) * (len(step.replacement) - len(step.value)) > 16000:
                    raise ValueError('替换结果超过 16000 字符')
                text = text.replace(step.value, step.replacement)
            elif step.operation in ('prefix', 'suffix'):
                text = step.value + text if step.operation == 'prefix' else text + step.value
            elif step.operation in ('sort_lines', 'unique_lines', 'reverse_lines'):
                lines = text.splitlines()
                lines = sorted(lines) if step.operation == 'sort_lines' else list(dict.fromkeys(lines)) if step.operation == 'unique_lines' else lines[::-1]
                text = '\n'.join(lines)
            elif step.operation == 'json_format':
                try:
                    text = json.dumps(json.loads(text), ensure_ascii=False, indent=2, allow_nan=False)
                except (ValueError, RecursionError):
                    raise ValueError('输入不是可格式化的有限 JSON') from None
            elif step.operation == 'sha256':
                text = hashlib.sha256(text.encode()).hexdigest()
            if len(text) > 16000:
                raise ValueError('处理结果超过 16000 字符')
        return {'status': 'succeeded', 'outputs': {'text': text}, 'definitionHash': digest(definition(value))}
    if binding.operation == 'uppercase':
        text = text.upper()
    elif binding.operation == 'lowercase':
        text = text.lower()
    elif binding.operation == 'replace':
        find = values[binding.findField]
        if not find:
            raise ValueError('查找内容不能为空')
        replacement = values[binding.replaceField] if binding.replaceField else ''
        if len(text) + text.count(find) * (len(replacement) - len(find)) > 16000:
            raise ValueError('替换结果超过 16000 字符')
        text = text.replace(find, replacement)
    text = (values[binding.prefixField] if binding.prefixField else '') + text
    text += values[binding.suffixField] if binding.suffixField else ''
    if len(text) > 16000:
        raise ValueError('结果超过 16000 字符，请缩小输入')
    return {'status': 'succeeded', 'outputs': {'text': text}, 'definitionHash': digest(definition(value))}


def sdk():
    return {'apiVersion': 1, 'componentVersion': '1.0.0', 'components': list(COMPONENTS),
            'workerChecklist': [
                'execution.textField必须引用fields中已声明的text/textarea/dropdown字段，即使是纯图片worker也要声明该字段。',
                'Pillow随运行时提供，from PIL import Image不需要查询或安装依赖。其他依赖只能放execution.dependencies，不能放definition根级。',
                '无ports：图片协议v2，测试expectedText+imageInputs+expectedImages；有ports：协议v3，测试仅params/portInputs/expectedPorts，禁止expectedText/inputs/imageInputs/expectedImages。',
                'stdout必须是单个JSON：{"protocolVersion":对应版本,"outputs":{声明的输出}}；图片输出必须是images-out/文件名，不是裸文件名。最多8张输出，参数上限必须与此一致。',
                'definition传对象，不要JSON.stringify；timeoutSeconds最多30。Windows保存路径与stdout协议路径分开，stdout用"images-out/"+文件名，不用os.path.join。',
                'worker用于算法处理，不包含AI生图模型；Pillow示意图不等于真实人像生成。需要真实人像时使用可用的ComfyUI工作流或已配置生图能力。'],
            'namedImageExample': {
                'definition': {'typeId': 'example.image-copy', 'version': '1.0.0', 'title': '图片处理示例',
                    'fields': [{'id': 'text', 'label': '备注', 'component': 'text', 'default': ''}],
                    'ports': {'inputs': [{'id': 'image', 'label': '输入图', 'type': 'image'}],
                              'outputs': [{'id': 'images', 'label': '结果图', 'type': 'image', 'multiple': True}]},
                    'execution': {'kind': 'worker.python', 'textField': 'text', 'media': True,
                        'code': 'import json,sys,os\nfrom PIL import Image\nr=json.load(sys.stdin)\nos.makedirs(r["outputDir"],exist_ok=True)\np=r["outputDir"]+"/result.png"\nImage.open(r["ports"]["image"]["path"]).save(p)\nprint(json.dumps({"protocolVersion":3,"outputs":{"images":[p]}}))'}},
                'tests': [{'params': {}, 'portInputs': {'image': {'width': 32, 'height': 24, 'color': '#ff0000'}},
                           'expectedPorts': {'images': [{'width': 32, 'height': 24}]}}]},
            'builtinNodes': BUILTIN_NODES,
            'executors': ['host.text', 'host.pipeline', 'worker.python', 'host.http', 'host.cli'], 'definitionSchema': NodeDefinition.model_json_schema(),
            'uiModes': ['builtin.components', 'isolated.form', 'isolated.worker'],
            'uiContract': 'ui.html使用data-field绑定声明字段，data-action通知隔离UI Worker。isolated.form中data-action="run"可直接运行当前节点；isolated.worker接收init/change/action/state，返回render/change；真实点击action后5秒内可返回一次{type:"execute",params:{字段ID:值}}请求运行当前节点。只能使用已声明且通过类型/范围校验的参数；自动init/state不得触发执行，运行中拒绝重复任务。state包含status(idle/running/succeeded/failed)、error、text、images(只读资源URL)，应在2秒内响应，例如返回render。宿主显示可信图片预览，UI脚本不得自行加载图片或网络。CSS动画与白名单表单可用，SVG/Canvas/任意DOM/原生调用仍不可用。Comfy节点自定义ui放入comfy_create_build候选，不要另造Pillow假人像；真实生图走已测试Comfy工作流。',
            'uiExecuteExample': {'kind': 'isolated.worker', 'height': 300,
                'html': '<button data-action="generate">抽取并生成</button>', 'css': 'button{padding:12px;width:100%}',
                'script': 'onmessage=({data:d})=>{if(d.type==="action"&&d.action==="generate"){postMessage({type:"execute",params:d.params});}else{postMessage({type:"render",html:"<button data-action=generate>抽取并生成</button>"});}};'},
            'workerContract': {'protocolVersion': 1, 'stdin': {'params': 'object', 'inputs': 'string[]'},
                'stdout': {'protocolVersion': 1, 'outputs': {'text': 'string <=16000 chars'}},
                'runtime': '随应用分发的 Python；不查找 PATH；15 秒默认、最多 30 秒、stdout/stderr 各 64KiB。',
                'permissions': '仅支持明确授权可信代码；进程隔离不是 OS 沙箱，可访问当前用户文件/网络/进程。不会将宿主环境变量凭据传入 worker。'},
            'imageWorkerContract': {'enable': 'execution.media=true；旧文本 worker 不变', 'protocolVersion': 2,
                'stdin': {'params': 'object', 'inputs': 'string[]', 'images': '[{id,path,width,height,sha256}]', 'outputDir': 'images-out'},
                'stdout': {'protocolVersion': 2, 'outputs': {'text': 'string <=16000 chars', 'images': ['images-out/result.png']}},
                'limits': '最多8张输入/输出，单图8MiB/1600万像素，输出总量32MiB；静态PNG/JPEG/WebP/BMP，宿主归一化PNG。Pillow随桌面运行时提供。',
                'tests': 'imageInputs:[{width:1..512,height:1..512,color:"#ff0000"}]生成测试素材；expectedImages:[{width,height,sha256?}]比较真实输出，expectedText仍必填。'},
            'namedPortWorkerContract': {'enable': '声明ports.inputs/outputs；仅worker.python，图片/蒙版还需execution.media=true',
                'protocolVersion': 3,
                'declaration': '端口包含id、label、type、multiple（默认false）、required（默认true）；类型为text/number/boolean/json/image/mask/audio/video。',
                'stdin': {'protocolVersion': 3, 'params': 'object', 'inputs': [],
                    'ports': '{端口ID:单值或数组}；图片/蒙版为含path的本地资源描述，mask归一化为灰度PNG', 'outputDir': '图片模式下为images-out'},
                'stdout': {'protocolVersion': 3, 'outputs': '{输出端口ID:单值或数组}；图片/蒙版值为images-out/内的相对文件名'},
                'tests': '使用portInputs和expectedPorts，键为端口ID；图片/蒙版输入为width/height/color素材，预期为width/height/可选sha256。音频输入使用frames/sampleRate/channels生成静音WAV，预期为frames/sampleRate/channels/可选sha256。视频素材用width/height/frames（偶数尺寸16—256、最多24帧）；预期比较width/height/frames/可选sha256。不可混用旧inputs/imageInputs。',
                'connections': 'bindings:[{source:输出端口ID,target:输入端口ID,index?:0..7}]；集合到单值必须选索引，同一连线可传多个端口；单值目标不得重复绑定。'},
            'pythonDependencies': {'declaration': 'execution.dependencies:[{name:"包名",version:"固定版本"}]，最多16项，包括所有生效的传递依赖',
                'source': '只从PyPI官方选择当前Python/系统兼容的wheel，校验下载SHA256；拒绝源码包、URL依赖及extras。',
                'discovery': 'canvas_find_python_package(name,version)只读查询；version为空取当前发布版本。canvas_resolve_python_dependencies可自动解析固定直接依赖，返回最多16包的完整固定清单，再新建候选。',
                'installation': '固定候选可信代码授权包含所列第三方依赖。测试前在账号+定义+Python版本的独立目录准备环境，失败不安装节点。',
                'limits': '180秒，wheel总下载量128MiB，解压总量512MiB，至少1152MiB可用空间（含pip暂存）；不修改宿主/ComfyUI依赖，不执行安装脚本或.pth；无法满足时说明缺口。'},
            'httpContract': {'kind': 'host.http', 'method': 'POST', 'url': '固定HTTPS地址，无query/fragment/userinfo；不跟随重定向，不自动重试',
                'request': 'textField指定合并上游文本的参数；bodyFields为请求JSON字段到参数ID的映射',
                'response': 'responsePath为JSON对象键数组，提取最多16000字符文本；响应最多1MiB',
                'async': '可选polling:{url:同源含{jobId}的HTTPS路径,jobIdPath:[键],statusPath:[键],success:[状态],failure:[状态],intervalSeconds:1..30,maxPolls:1..100}；POST只提交一次，持久任务ID后GET轮询；预算跨恢复累计。',
                'recovery': '运行ID持久保存；原ID参数不得变化，结果可重读，结果不明不重发POST。Idempotency-Key仅在远端支持时生效；停止等待不取消远端任务。',
                'credentials': 'credentialRef只是用途名称，真实Bearer密钥由用户在节点面板绑定，按账号与完整定义哈希隔离；Windows使用当前系统用户DPAPI加密，其他平台尚不支持绑定；AI和导出包不接收密钥',
                'tests': '每条候选测试必须带httpResponse（模拟响应对象）及expectedText；候选测试不发送网络请求，不代表真实API已验证。安装后用户绑定凭据并显式运行。'},
            'limits': '扩展节点支持命名文本/数字/布尔/JSON/静态图片/蒙版/音频/视频端口；MP3/AAC转16位PCM WAV；视频限H.264/AAC MP4、8MiB/30秒/900帧/1920x1080。独立依赖仅支持显式固定的PyPI wheel清单。新原生能力需宿主适配。'}
