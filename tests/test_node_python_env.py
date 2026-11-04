import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from core import node_catalog
from core.comfy_workflow_builds import ComfyBuilds
from core.node_plugin_builds import NodePluginBuilds
from core.node_plugin_package import export_package, import_package
from core.node_python_env import PythonEnvironment, _allowed_url, _verify_wheel, inspect_package


def wheel(version='1.0.0', requires=(), extra=None):
    stream = io.BytesIO()
    metadata = f'Metadata-Version: 2.1\nName: demo-pkg\nVersion: {version}\nRequires-Python: >=3.9\n'
    metadata += ''.join('Requires-Dist: ' + requirement + '\n' for requirement in requires)
    prefix = f'demo_pkg-{version}.dist-info/'
    files = {'demo_pkg/__init__.py': 'VALUE=' + repr(version), prefix + 'METADATA': metadata,
             prefix + 'WHEEL': 'Wheel-Version: 1.0\nGenerator: art-canvas-tests\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
             prefix + 'RECORD': ''}
    files.update(extra or {})
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return stream.getvalue()


def sample(version='1.0.0'):
    return {'typeId': 'python.environment-test', 'version': version, 'title': '独立环境测试',
            'fields': [{'id': 'text', 'label': '内容', 'component': 'text', 'default': ''}],
            'execution': {'kind': 'worker.python', 'textField': 'text', 'dependencies': [{'name': 'demo-pkg', 'version': version}],
                          'code': 'import json,importlib.util,demo_pkg;assert importlib.util.find_spec("pydantic") is None;print(json.dumps({"protocolVersion":1,"outputs":{"text":demo_pkg.VALUE}}))'}}


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        environment = patch.dict(os.environ, {'ART_CANVAS_HOME': directory.name})
        environment.start()
        self.addCleanup(environment.stop)
        self.wheels = {'1.0.0': wheel(), '2.0.0': wheel('2.0.0')}
        self.packages, self.downloads = [], []
        lookup = patch('core.node_python_env.inspect_package', side_effect=self.inspect)
        lookup.start()
        self.addCleanup(lookup.stop)
        fetch = patch('core.node_python_env._fetch', side_effect=self.fetch)
        fetch.start()
        self.addCleanup(fetch.stop)

    def inspect(self, name, version, *args):
        raw = self.wheels[version]
        package = {'name': name, 'version': version, 'filename': f'demo_pkg-{version}-py3-none-any.whl',
                   'url': f'https://files.pythonhosted.org/{version}.whl', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        self.packages.append(package)
        return {'package': package}

    def fetch(self, url, limit, cancel, deadline, destination=None):
        raw = self.wheels[url.rsplit('/', 1)[-1].removesuffix('.whl')]
        self.assertLessEqual(len(raw), limit)
        self.downloads.append(url)
        if destination:
            destination.write(raw)
        return b'' if destination else raw, len(raw), hashlib.sha256(raw).hexdigest()

    def service(self):
        return NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root / 'workflows', 'alice', 'canvas', 'localhost:8188'))

    def test_real_offline_wheel_install_worker_isolation_versions_and_restart_reuse(self):
        sentinel = self.root / 'pth-was-executed'
        self.wheels['1.0.0'] = wheel(extra={'demo-hook.pth': 'import pathlib; pathlib.Path(' + repr(str(sentinel)) + ').write_text("bad")\n'})
        service = self.service()
        first = service.create(sample(), [{'expectedText': '1.0.0'}])
        with self.assertRaisesRegex(ValueError, '授权'):
            service.test(first['id'])
        self.assertFalse(self.downloads)
        service.approve_worker(first['id'], first['revision'])
        tested = service.test(first['id'])
        self.assertEqual(tested['status'], 'passed', tested['report'])
        self.assertEqual(tested['report']['environment']['status'], 'ready')
        self.assertFalse(sentinel.exists(), '.pth scripts must not execute during installation or worker startup')
        installed = service.install(first['id'], first['revision'])['definition']
        self.assertEqual(node_catalog.execute(installed, {}, [], worker_owner='alice')['outputs']['text'], '1.0.0')
        second = service.create(sample('2.0.0'), [{'expectedText': '2.0.0'}])
        service.approve_worker(second['id'], second['revision'])
        self.assertEqual(service.test(second['id'])['status'], 'passed')
        self.assertNotEqual(PythonEnvironment('alice', installed).path, PythonEnvironment('alice', sample('2.0.0')).path)
        self.assertEqual(node_catalog.execute(installed, {}, [], worker_owner='alice')['outputs']['text'], '1.0.0')
        downloads = len(self.downloads)
        self.assertEqual(PythonEnvironment('alice', installed).ensure()['status'], 'ready')
        self.assertEqual(len(self.downloads), downloads, 'completed environments must not be downloaded again')
        with self.assertRaisesRegex(ValueError, '未就绪'):
            node_catalog.execute(installed, {}, [], worker_owner='bob')
        self.assertNotIn('python', service.environment(first['id']), 'do not expose runtime absolute paths to the model')

    def test_missing_transitive_dependency_and_hash_mismatch_do_not_install_node(self):
        self.wheels['1.0.0'] = wheel(requires=['missing-dep>=2'])
        service = self.service()
        record = service.create(sample(), [{'expectedText': '1.0.0'}])
        service.approve_worker(record['id'], record['revision'])
        result = service.test(record['id'])
        self.assertEqual(result['status'], 'failed')
        self.assertIn('missing-dep', result['report']['results'][0]['error'])
        self.assertEqual(service.environment(record['id'])['status'], 'failed')
        with self.assertRaises(ValueError):
            service.install(record['id'], record['revision'])
        environment = PythonEnvironment('bob', sample())
        actual = self.fetch
        def wrong_hash(*args, **kwargs):
            data, size, _ = actual(*args, **kwargs)
            return data, size, '0' * 64
        with patch('core.node_python_env._fetch', side_effect=wrong_hash), self.assertRaisesRegex(ValueError, 'SHA256'):
            environment.ensure()
        self.assertFalse(environment.path.exists())
        self.assertFalse(environment.lock.exists())

    def test_cancel_concurrent_and_damaged_environments_fail_closed(self):
        environment = PythonEnvironment('alice', sample())
        environment.root.mkdir(parents=True)
        environment.lock.write_text('{}')
        with self.assertRaisesRegex(ValueError, '不重复安装'):
            environment.ensure()
        self.assertFalse(self.downloads)
        environment.lock.unlink()
        event = threading.Event()
        event.set()
        with self.assertRaisesRegex(ValueError, '已取消'):
            environment.ensure(event)
        self.assertEqual(environment.status()['status'], 'cancelled')
        self.assertFalse(environment.path.exists())
        environment.path.mkdir()
        with self.assertRaisesRegex(ValueError, '不完整'):
            environment.ensure()

    def test_dependency_declarations_and_package_permissions_preserve_old_definitions(self):
        item = sample()
        item['execution']['dependencies'].append({'name': 'Demo_Pkg', 'version': '2.0.0'})
        with self.assertRaisesRegex(ValueError, '重复'):
            node_catalog.definition(item)
        for name, version in (('--target', '1.0'), ('https://example.com', '1.0'), ('demo', '>=1'), ('demo', '1.*')):
            item = sample()
            item['execution']['dependencies'] = [{'name': name, 'version': version}]
            with self.subTest(name=name, version=version), self.assertRaises(ValueError):
                node_catalog.definition(item)
        item = sample()
        restored, _ = import_package(export_package(item, [{'expectedText': '1.0.0'}]))
        self.assertEqual(restored['execution']['dependencies'], [{'name': 'demo-pkg', 'version': '1.0.0'}])
        self.assertEqual(node_catalog.permissions(restored), ['trusted-code', 'python-dependencies'])
        item['execution'].pop('dependencies')
        normalized = node_catalog.definition(item)
        self.assertNotIn('dependencies', normalized['execution'])
        item['execution']['dependencies'] = []
        self.assertEqual(node_catalog.digest(node_catalog.definition(item)), node_catalog.digest(normalized))

    def test_wheel_paths_urls_and_active_requirements_are_verified(self):
        for url in ('http://pypi.org/simple', 'https://evil.example/a.whl', 'https://pypi.org@evil.example/a.whl',
                    'https://pypi.org:8000/a.whl', 'https://files.pythonhosted.org/a#secret'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                _allowed_url(url)
        package = self.inspect('demo-pkg', '1.0.0')['package']
        for raw in (wheel(extra={'../secret.py': 'bad'}), wheel(requires=['dep @ https://evil.example/dep.whl']),
                    wheel(requires=['dep[test]>=1']), wheel(requires=['dep>=2'])):
            path = self.root / package['filename']
            path.write_bytes(raw)
            with self.assertRaises(ValueError):
                _verify_wheel(path, package, {'demo-pkg': '1.0.0', 'dep': '1.0.0'})
        path.write_bytes(wheel(requires=['ignored>=2; python_version < "3.0"', 'dep>=1; python_version >= "3.0"']))
        self.assertGreater(_verify_wheel(path, package, {'demo-pkg': '1.0.0', 'dep': '1.0.0'}), 0)


class DiscoveryTests(unittest.TestCase):
    def test_pypi_package_selects_compatible_wheel_and_returns_requirements(self):
        data = {'info': {'name': 'demo-pkg', 'version': '1.0.0', 'requires_dist': ['other>=1']},
                'urls': [{'packagetype': 'bdist_wheel', 'filename': 'demo_pkg-1.0.0-py3-none-any.whl',
                          'url': 'https://files.pythonhosted.org/demo.whl', 'size': 100, 'digests': {'sha256': 'a' * 64}}]}
        with patch('core.node_python_env._fetch', return_value=(json.dumps(data).encode(), 100, 'a' * 64)):
            result = inspect_package('Demo_Pkg', '1.0.0')
        self.assertEqual(result['package']['name'], 'demo-pkg')
        self.assertEqual(result['requiresDist'], ['other>=1'])

    @unittest.skipUnless(os.environ.get('ART_CANVAS_TEST_PYPI'), 'opt in to real PyPI download into a temporary environment')
    def test_real_pypi_wheel_installs_and_executes_without_host_dependency_changes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'ART_CANVAS_HOME': directory}):
            item = sample()
            item['execution']['dependencies'] = [{'name': 'humanize', 'version': '4.12.3'}]
            item['execution']['code'] = 'import humanize,json,importlib.util;assert importlib.util.find_spec("pydantic") is None;print(json.dumps({"protocolVersion":1,"outputs":{"text":humanize.intcomma(1234567)}}))'
            environment = PythonEnvironment('live-test', item)
            self.assertEqual(environment.ensure()['status'], 'ready')
            result = node_catalog.execute(item, {}, [], trusted=True, worker_owner='live-test')
            self.assertEqual(result['outputs']['text'], '1,234,567')


if __name__ == '__main__':
    unittest.main()
