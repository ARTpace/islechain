"""Extract one executable branch from the shared, editable ComfyUI canvas."""
import json
from pathlib import Path


WORKFLOW_PATH = Path(__file__).resolve().parents[1] / 'workflows' / 'cutout' / 'matting.json'


def workflow_methods():
    canvas = json.loads(WORKFLOW_PATH.read_text(encoding='utf-8'))
    return {key: spec['tool'] for key, spec in canvas['extra']['cutout']['branches'].items()
            if spec.get('tool')}


def load_branch(branch, path=None):
    canvas = json.loads(Path(path or WORKFLOW_PATH).read_text(encoding='utf-8'))
    branches = canvas['extra']['cutout']['branches']
    spec = branches[branch]
    nodes = {node['id']: node for node in canvas['nodes']}
    links = {link[0]: link for link in canvas['links']}
    aliases = {node_id: old_id for old_id, node_id in spec['nodes'].items()}
    graph = {}

    def collect(node_id):
        node = nodes[node_id]
        key = aliases.get(node_id, f'cutout_{node_id}')
        if key in graph:
            return key
        names = node.get('properties', {}).get('widget_names', [])
        inputs = dict(zip(names, node.get('widgets_values', [])))
        graph[key] = {'class_type': node['type'], 'inputs': inputs,
                      '_meta': {'title': node.get('title', node['type'])}}
        for socket in node.get('inputs', []):
            if socket.get('link') is not None:
                link = links[socket['link']]
                inputs[socket['name']] = [collect(link[1]), link[2]]
        return key

    # ponytail: output ancestry selects a branch regardless of editor mute state.
    collect(spec['output'])
    return graph
