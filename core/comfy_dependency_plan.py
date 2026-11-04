"""Read-only dependency plans from the selected instance's Manager mapping.

Mapping entries are discovery evidence, never permission to execute repository code.
"""

from core.node_catalog import digest


async def manager_mapping(service):
    try:
        return await service.request('GET', '/v2/customnode/getmappings', params={'mode': 'local'}), '/v2'
    except ValueError as exc:
        if 'HTTP 404:' not in str(exc):
            raise
    return await service.request('GET', '/customnode/getmappings', params={'mode': 'local'}), ''


async def installation_preflight(service):
    """Fail closed when either inference or Manager has active/unknown work."""
    try:
        queue = await service.request('GET', '/queue')
        try:
            manager = await service.request('GET', '/v2/manager/queue/status')
        except ValueError as exc:
            if 'HTTP 404:' not in str(exc):
                raise
            manager = await service.request('GET', '/manager/queue/status')
        if isinstance(manager, dict) and 'pending_count' not in manager:
            counts = [manager.get(key) for key in ('total_count', 'done_count', 'in_progress_count')]
            if all(type(value) is int and value >= 0 for value in counts):
                manager['pending_count'] = counts[0] - counts[1] - counts[2]
    except ValueError:
        return {'status': 'unavailable', 'reason': '无法确认推理或插件安装队列状态'}
    if (not isinstance(queue, dict) or not isinstance(manager, dict)
            or any(not isinstance(queue.get(key), list) for key in ('queue_running', 'queue_pending'))
            or any(type(manager.get(key)) is not int or manager[key] < 0
                   for key in ('in_progress_count', 'pending_count'))
            or type(manager.get('is_processing')) is not bool):
        return {'status': 'unavailable', 'reason': '队列接口响应格式不支持'}
    busy = bool(queue['queue_running'] or queue['queue_pending'] or manager['in_progress_count']
                or manager['pending_count'] or manager['is_processing'])
    return {'status': 'busy' if busy else 'idle',
            'inferenceRunning': len(queue['queue_running']), 'inferencePending': len(queue['queue_pending']),
            'managerRunning': manager['in_progress_count'], 'managerPending': manager['pending_count']}


async def dependency_plan(service, node_types):
    if (not isinstance(node_types, list) or not 1 <= len(node_types) <= 12
            or any(not isinstance(kind, str) or not kind or len(kind) > 256 for kind in node_types)):
        raise ValueError('必须提供 1—12 个有效节点类型')
    kinds = sorted(set(node_types))
    installed = await service.node_info(kinds)
    missing = [kind for kind in kinds if kind not in installed]
    plan = {'instance': service.target, 'requested': kinds, 'missing': missing,
            'source': '/v2/customnode/getmappings?mode=local', 'dependencies': [],
            'status': 'satisfied' if not missing else 'blocked', 'executable': False}
    if missing:
        try:
            mapping, prefix = await manager_mapping(service)
        except ValueError:
            plan['reason'] = 'Manager v2 映射接口不可用；未尝试安装或重启'
        else:
            plan['source'] = prefix + '/customnode/getmappings?mode=local'
            plan['managerPrefix'] = prefix
            if not isinstance(mapping, dict):
                raise ValueError('Manager 节点映射响应格式无效')
            for kind in missing:
                candidates = []
                for pack, entry in mapping.items():
                    if (isinstance(entry, list) and len(entry) == 2 and isinstance(entry[0], list)
                            and kind in entry[0] and isinstance(entry[1], dict)):
                        candidates.append({'pack': pack, 'version': None})
                candidates.sort(key=lambda item: item['pack'])
                plan['dependencies'].append({'nodeType': kind, 'candidates': candidates,
                                             'status': 'unknown' if not candidates else
                                             'ambiguous' if len(candidates) > 1 else 'needs_verification'})
            plan['reason'] = '映射仅用于发现；插件来源、固定版本与环境影响尚未验证，禁止直接安装'
    plan['revision'] = digest(plan)
    return plan
