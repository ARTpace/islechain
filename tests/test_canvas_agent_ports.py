import copy
import json
import unittest

from core.canvas_agent import PROPOSAL_SCHEMA, validate_proposal
from core.mcp_tools import MCPError


def port(name, kind='image', multiple=False):
    return {'id': name, 'label': name, 'type': kind, 'multiple': multiple}


def node(name, inputs=None, outputs=None):
    definition = {'typeId': 'test.' + name, 'version': '1.0.0', 'title': name,
                  'fields': [{'id': 'text', 'label': 'text', 'component': 'text', 'default': ''}],
                  'execution': {'kind': 'worker.python', 'textField': 'text', 'media': True,
                                'code': 'print("{}")'},
                  'ports': {'inputs': inputs or [], 'outputs': outputs or [port('result')]}}
    return {'id': name, 'type': 'extension', 'nodeDefinition': json.dumps(definition)}


class AgentPortTests(unittest.TestCase):
    def test_builtin_audio_nodes_map_to_audio_worker(self):
        target = node('target', inputs=[port('sound', 'audio')])
        for source in [{'id': 'audio', 'type': kind} for kind in ('gameSpeech', 'gameSoundEffect', 'gameMusic', 'gameAudioScene')] + [
                {'id': 'audio', 'type': 'image', 'mediaKind': 'audio'}]:
            snapshot = {'nodes': [source, target], 'connections': [], 'connectionRules': []}
            proposal = {'summary': '连接音频', 'nodes': [], 'connections': [
                {'from': 'audio', 'to': 'target', 'bindings': [{'source': 'audio', 'target': 'sound'}]}]}
            with self.subTest(source=source):
                validate_proposal(proposal, snapshot)

    def setUp(self):
        self.source = node('source', outputs=[port('original'), port('mask', 'mask'), port('scores', 'number', True)])
        self.target = node('target', inputs=[port('photo'), port('alpha', 'mask'), port('score', 'number')])
        self.snapshot = {'nodes': [self.source, self.target], 'connections': [], 'connectionRules': []}
        self.link = {'from': 'source', 'to': 'target', 'bindings': [
            {'source': 'original', 'target': 'photo'}, {'source': 'mask', 'target': 'alpha'},
            {'source': 'scores', 'target': 'score', 'index': 0}]}
        self.proposal = {'summary': '映射端口', 'nodes': [], 'connections': [self.link]}

    def test_schema_and_new_or_existing_mapping(self):
        self.assertIn('bindings', PROPOSAL_SCHEMA['properties']['connections']['items']['properties'])
        self.assertEqual(validate_proposal(copy.deepcopy(self.proposal), self.snapshot)['connections'], [self.link])
        self.snapshot['connections'] = [{'from': 'source', 'to': 'target'}]
        validate_proposal(copy.deepcopy(self.proposal), self.snapshot)
        added = copy.deepcopy(self.target)
        added['fields'] = {'nodeDefinition': added.pop('nodeDefinition')}
        self.snapshot['nodes'] = [self.source]
        self.snapshot['connections'] = []
        self.proposal['nodes'] = [added]
        validate_proposal(copy.deepcopy(self.proposal), self.snapshot)

    def test_invalid_mappings(self):
        cases = []
        for bindings in [None, [], [{'source': 'gone', 'target': 'photo'}],
                         [{'source': 'scores', 'target': 'photo', 'index': 0}],
                         [{'source': 'scores', 'target': 'score'}],
                         [{'source': 'scores', 'target': 'score', 'index': True}],
                         [{'source': 'scores', 'target': 'score', 'index': 8}]]:
            value = copy.deepcopy(self.proposal)
            if bindings is None:
                del value['connections'][0]['bindings']
            else:
                value['connections'][0]['bindings'] = bindings
            cases.append(value)
        value = copy.deepcopy(self.proposal);value['connections'].append(copy.deepcopy(self.link));cases.append(value)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(MCPError):
                validate_proposal(value, self.snapshot)

    def test_cross_edge_single_conflict_and_legacy(self):
        other = copy.deepcopy(self.source);other['id'] = 'other'
        self.snapshot['nodes'].append(other)
        self.snapshot['connections'] = [{'from': 'other', 'to': 'target', 'bindings': [{'source': 'original', 'target': 'photo'}]}]
        with self.assertRaisesRegex(MCPError, '多条连线'):
            validate_proposal(copy.deepcopy(self.proposal), self.snapshot)
        self.snapshot = {'nodes': [{'id': 'text', 'type': 'prompt'}, {'id': 'gen', 'type': 'generator'}], 'connections': []}
        legacy = {'summary': '旧连线', 'nodes': [], 'connections': [{'from': 'text', 'to': 'gen'}]}
        validate_proposal(copy.deepcopy(legacy), self.snapshot)
        legacy['connections'][0]['bindings'] = [{'source': 'text', 'target': 'text'}]
        with self.assertRaisesRegex(MCPError, '命名端口'):
            validate_proposal(legacy, self.snapshot)


if __name__ == '__main__':
    unittest.main()
