import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from core import node_catalog
from core.comfy_workflow_builds import ComfyBuilds
from core.node_plugin_builds import NodePluginBuilds


def sample():
    return {'typeId': 'data.lines', 'version': '1.0.0', 'title': '整理文本行',
            'fields': [{'id': 'text', 'label': '内容', 'component': 'textarea', 'default': ''}],
            'execution': {'kind': 'host.pipeline', 'textField': 'text', 'steps': [
                {'operation': 'trim'}, {'operation': 'unique_lines'}, {'operation': 'sort_lines'}]}}


class PluginBuildTests(unittest.TestCase):
    def test_named_port_sdk_and_candidate_tool_schema(self):
        contract = node_catalog.sdk()['namedPortWorkerContract']
        self.assertEqual(contract['protocolVersion'], 3)
        tool = next(tool for tool in self.service.tools()
                    if tool['function']['name'] == 'canvas_create_plugin_candidate')
        items = tool['function']['parameters']['properties']['tests']['items']
        self.assertIn('portInputs', items['properties'])
        self.assertIn('expectedPorts', items['properties'])
        self.assertFalse(items['additionalProperties'])

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        mock = patch.object(node_catalog, 'catalog_path', return_value=self.root / 'catalog.json')
        mock.start()
        self.addCleanup(mock.stop)
        self.service = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, 'alice', 'canvas', 'localhost:8188'))

    def test_candidate_execution_test_install_and_immutable_versions(self):
        tests = [{'params': {'text': ' b\na\nb '}, 'expectedText': 'a\nb'}]
        created = self.service.create(sample(), tests)
        self.assertEqual(self.service.create(sample(), tests)['id'], created['id'])
        with self.assertRaises(ValueError):
            self.service.install(created['id'], created['revision'])
        passed = self.service.test(created['id'])
        self.assertEqual(passed['status'], 'passed')
        installed = self.service.install(created['id'], created['revision'])
        self.assertEqual(node_catalog.execute(installed['definition'], {'text': 'z\nz\na'}, [])['outputs']['text'], 'a\nz')
        changed = sample()
        changed['title'] = '不能覆盖'
        other = self.service.create(changed, tests)
        self.service.test(other['id'])
        with self.assertRaises(ValueError):
            self.service.install(other['id'], other['revision'])
        restored = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, 'alice', 'canvas', 'localhost:8188'))
        self.assertEqual(restored.read(created['id'])['status'], 'passed')

    def test_failed_test_is_not_installable_and_isolation(self):
        created = self.service.create(sample(), [{'expectedText': 'wrong'}])
        self.assertEqual(self.service.test(created['id'])['status'], 'failed')
        with self.assertRaises(ValueError):
            self.service.install(created['id'], created['revision'])
        for user, canvas in (('bob', 'canvas'), ('alice', 'other')):
            other = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, user, canvas, 'localhost:8188'))
            with self.assertRaises(ValueError):
                other.read(created['id'])
        with self.assertRaises(ValueError):
            self.service.read('../outside')

    def test_tampering_requires_new_candidate(self):
        created = self.service.create(sample(), [{'expectedText': ''}])
        self.service.test(created['id'])
        path = self.service.path(created['id'])
        record = json.loads(path.read_text(encoding='utf-8'))
        record['definition']['title'] = 'changed'
        path.write_text(json.dumps(record), encoding='utf-8')
        with self.assertRaises(ValueError):
            self.service.install(created['id'], created['revision'])

    def test_ui_contract_rejects_executable_or_network_markup(self):
        valid = sample()
        valid['ui'] = {'html': '<section class="panel"><label>内容<textarea data-field="text"></textarea></label></section>',
                       'css': '.panel { color: red; }'}
        self.assertIn('ui', node_catalog.definition(valid))
        for markup in ('<script>alert(1)</script>', '<img src="https://example.com">',
                       '<input data-field="text" onclick="bad()">', '<iframe></iframe>',
                       '<input data-field="missing">', '<div>', '<meta http-equiv="refresh" content="0;url=https://example.com">'):
            value = copy.deepcopy(valid)
            value['ui']['html'] = markup
            with self.subTest(markup=markup), self.assertRaises(ValueError):
                node_catalog.definition(value)
        self.assertNotIn('ui', node_catalog.definition(sample()))

    def test_pipeline_limits_and_json_errors(self):
        value = sample()
        value['execution']['steps'] = [{'operation': 'json_format'}]
        with self.assertRaises(ValueError):
            node_catalog.execute(value, {'text': '{bad'}, [])
        value['execution']['steps'] = [{'operation': 'replace', 'value': 'a', 'replacement': 'b' * 4000}]
        with self.assertRaises(ValueError):
            node_catalog.execute(value, {'text': 'a' * 100}, [])

    def test_trusted_worker_real_process_and_untrusted_gate(self):
        value = sample()
        value['execution'] = {'kind': 'worker.python', 'textField': 'text', 'code':
            'import json,sys,os\nr=json.load(sys.stdin)\nassert "ART_CANVAS_SECRET_TEST" not in os.environ\n'
            'print(json.dumps({"protocolVersion":1,"outputs":{"text":r["params"]["text"][::-1]}}))'}
        created = self.service.create(value, [{'params': {'text': 'abc'}, 'expectedText': 'cba'}])
        with self.assertRaises(ValueError):
            self.service.test(created['id'])
        with self.assertRaises(ValueError):
            node_catalog.execute(value, {'text': 'abc'}, [])
        self.service.approve_worker(created['id'], created['revision'])
        with patch.dict('os.environ', {'ART_CANVAS_SECRET_TEST': 'do-not-inherit'}):
            tested = self.service.test(created['id'])
        self.assertEqual(tested['status'], 'passed', tested['report'])
        artifact = self.service.install(created['id'], created['revision'])
        self.assertEqual(node_catalog.execute(artifact['definition'], {'text': 'xyz'}, [])['outputs']['text'], 'zyx')

    def test_worker_timeout_cancel_crash_and_protocol(self):
        value = sample()
        value['execution'] = {'kind': 'worker.python', 'textField': 'text', 'code': 'import time;time.sleep(20)', 'timeoutSeconds': 1}
        with self.assertRaisesRegex(ValueError, '超时'):
            node_catalog.execute(value, {}, [], trusted=True)
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaisesRegex(ValueError, '取消'):
            node_catalog.execute(value, {}, [], trusted=True, cancel_event=cancelled)
        for code, message in [('raise RuntimeError("worker-crashed")', '执行失败'),
                              ('print("not-json")', '有效 JSON'), ('print("x"*70000)', '64 KiB')]:
            value['execution']['code'] = code
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, message):
                node_catalog.execute(value, {}, [], trusted=True)

    def test_disable_and_migrate_preserve_old_versions_and_validate_types(self):
        first = node_catalog.install(sample())
        second = sample()
        second['version'] = '2.0.0'
        second['fields'].append({'id': 'count', 'label': '数量', 'component': 'number', 'default': 1})
        node_catalog.install(second)
        node_catalog.set_enabled(first['typeId'], first['version'], False, 2)
        self.assertNotIn('data.lines@1.0.0', node_catalog.public_catalog()['hashes'])
        self.assertEqual(len(node_catalog.read_catalog()['definitions']), 2)
        node_catalog.set_enabled(first['typeId'], first['version'], True, 3)
        self.assertEqual(node_catalog.public_catalog()['hashes']['data.lines@1.0.0'], node_catalog.digest(first))
        self.assertEqual(node_catalog.migrate_params(second, {'text': 'keep', 'removed': 'old'}), {'text': 'keep', 'count': 1})
        with self.assertRaises(ValueError):
            node_catalog.migrate_params(second, {'count': 'wrong-type'})
