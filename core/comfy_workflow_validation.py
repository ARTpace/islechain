"""Validate API graphs and bindings against the selected ComfyUI instance."""

import json
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from core.node_catalog import ComponentField, Identifier, NodeUI, digest


class ComfyField(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: Identifier
    name: str = Field(min_length=1, max_length=80)
    node: str = Field(min_length=1, max_length=80)
    input: str = Field(min_length=1, max_length=80)
    type: Literal['text', 'textarea', 'number', 'slider', 'dropdown', 'boolean'] = 'text'
    default: str | bool | int | float
    min: float | None = Field(default=None, allow_inf_nan=False)
    max: float | None = Field(default=None, allow_inf_nan=False)
    step: float = Field(default=1, gt=0, allow_inf_nan=False)
    options: list[str] = Field(default_factory=list, max_length=100)
    standalone: Literal[True] = True


class BuildRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=80)
    workflow: dict[str, Any]
    fields: list[ComfyField] = Field(default_factory=list, max_length=40)
    ui: NodeUI | None = None


def input_specs(info):
    inputs = info.get('input', {})
    return {**inputs.get('required', {}), **inputs.get('optional', {})}


def enum_options(spec):
    """Both legacy nodes and the current Comfy schema expose finite choices."""
    if not isinstance(spec, (list, tuple)) or not spec:
        return None
    if isinstance(spec[0], list):
        return spec[0]
    if spec[0] == 'COMBO' and len(spec) > 1 and isinstance(spec[1], dict):
        choices = spec[1].get('options')
        if isinstance(choices, list) and not spec[1].get('multiselect', False):
            return choices
    return None


def check_scalar(value, spec, label):
    kind = spec[0]
    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
    choices = enum_options(spec)
    if choices is not None:
        if not any(type(value) is type(choice) and value == choice for choice in choices):
            raise ValueError(f'{label}: 枚举或模型名称不可用')
    elif kind == 'STRING':
        if not isinstance(value, str) or len(value) > 16000:
            raise ValueError(f'{label}: 文本无效或过长')
    elif kind == 'BOOLEAN':
        if type(value) is not bool:
            raise ValueError(f'{label}: 需要布尔值')
    elif kind in ('INT', 'FLOAT'):
        if type(value) not in (int, float) or not math.isfinite(value) or (kind == 'INT' and type(value) is not int):
            raise ValueError(f'{label}: 数值类型无效')
        if value < options.get('min', -math.inf) or value > options.get('max', math.inf):
            raise ValueError(f'{label}: 数值超出范围')
    else:
        raise ValueError(f'{label}: {kind} 输入必须连接上游节点，首版不支持此类常量')


def validate_build(value, object_info):
    request = BuildRequest.model_validate(value)
    graph = request.workflow
    if not 1 <= len(graph) <= 256 or len(json.dumps(value, allow_nan=False).encode()) > 512000:
        raise ValueError('工作流必须包含 1—256 个节点且不超过 512 KiB')
    used = {}
    for node_id, node in graph.items():
        if not node_id or len(node_id) > 80 or not isinstance(node, dict) or set(node) - {'class_type', 'inputs', '_meta'}:
            raise ValueError('不是有效的 ComfyUI API 工作流')
        kind = node.get('class_type')
        if not isinstance(kind, str) or kind not in object_info:
            raise ValueError(f'缺少 ComfyUI 节点插件：{str(kind)[:100]}')
        used[kind] = object_info[kind]
    edges = {node_id: [] for node_id in graph}
    output_nodes = []
    for node_id, node in graph.items():
        info = used[node['class_type']]
        if info.get('output_node'):
            output_nodes.append(node_id)
        inputs = node.get('inputs')
        if not isinstance(inputs, dict):
            raise ValueError(f'{node_id}: 缺少 inputs')
        specs = input_specs(info)
        if set(info.get('input', {}).get('required', {})) - set(inputs):
            raise ValueError(f'{node_id}: 缺少必填输入')
        for name, value in inputs.items():
            label = f'{node_id}.{name}'
            if name not in specs:
                raise ValueError(f'{label}: 节点未声明该输入，动态输入需专门适配')
            if isinstance(value, list):
                if len(value) != 2 or not isinstance(value[0], str) or type(value[1]) is not int or value[0] not in graph:
                    raise ValueError(f'{label}: 连线引用无效')
                source, slot = value
                outputs = used[graph[source]['class_type']].get('output', [])
                if not 0 <= slot < len(outputs):
                    raise ValueError(f'{label}: 输出索引无效')
                target_type, source_type = specs[name][0], outputs[slot]
                if isinstance(target_type, list):
                    target_type = 'COMBO'
                if not isinstance(source_type, str) or not isinstance(target_type, str):
                    raise ValueError(f'{label}: 不支持的类型定义')
                if '*' not in (source_type, target_type) and not set(source_type.split(',')) & set(target_type.split(',')):
                    raise ValueError(f'{label}: 连线类型不兼容')
                edges[node_id].append(source)
            else:
                check_scalar(value, specs[name], label)
    if not output_nodes:
        raise ValueError('工作流缺少输出节点')
    visiting, visited = set(), set()

    def visit(node_id):
        if node_id in visiting:
            raise ValueError('工作流包含循环；循环插件需专门适配')
        if node_id in visited:
            return
        visiting.add(node_id)
        for source in edges[node_id]:
            visit(source)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in graph:
        visit(node_id)
    ids, bindings = set(), set()
    for field in request.fields:
        binding = (field.node, field.input)
        if field.id in ids or binding in bindings:
            raise ValueError('参数 ID 或绑定重复')
        ids.add(field.id)
        bindings.add(binding)
        target = graph.get(field.node)
        if not target or field.input not in target['inputs'] or isinstance(target['inputs'][field.input], list):
            raise ValueError('参数只能绑定已有常量输入')
        spec = input_specs(used[target['class_type']])[field.input]
        check_scalar(field.default, spec, field.id)
        if isinstance(spec[0], str) and spec[0] in ('INT', 'FLOAT'):
            limits = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            field.min = field.min if field.min is not None else limits.get('min')
            field.max = field.max if field.max is not None else limits.get('max')
            if (field.min is not None and field.min < limits.get('min', -math.inf)
                    or field.max is not None and field.max > limits.get('max', math.inf)):
                raise ValueError(f'{field.id}: 控件范围超出 ComfyUI 限制')
            if spec[0] == 'INT' and any(v is not None and not float(v).is_integer() for v in (field.min, field.max, field.step)):
                raise ValueError(f'{field.id}: 整数控件的范围和步长必须为整数')
        ComponentField(id=field.id, label=field.name, component=field.type, default=field.default,
                       minimum=field.min, maximum=field.max, step=field.step, options=field.options)
        kind = spec[0]
        compatible = (enum_options(spec) is not None and field.type == 'dropdown'
                      or kind == 'STRING' and field.type in ('text', 'textarea')
                      or kind in ('INT', 'FLOAT') and field.type in ('number', 'slider')
                      or kind == 'BOOLEAN' and field.type == 'boolean') if isinstance(kind, str) else field.type == 'dropdown'
        if not compatible:
            raise ValueError(f'{field.id}: 控件类型与 ComfyUI 输入不兼容')
        for option in field.options:
            check_scalar(option, spec, field.id)
        target['inputs'][field.input] = field.default
    if request.ui is not None:
        from core.node_plugin_ui import normalize_form
        request.ui.html = normalize_form(request.ui.html, {f.id: f for f in request.fields})
        if bool(request.ui.script) != (request.ui.kind == 'isolated.worker'):
            raise ValueError('isolated.worker必须提供script，isolated.form不接受脚本')
    result = request.model_dump(mode='json')
    if request.ui is None:
        result.pop('ui', None)
    return result, digest(used)
