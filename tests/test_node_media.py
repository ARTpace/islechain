import base64
import hashlib
import importlib
import io
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from PIL import Image

from core import node_catalog
from core.canvas_agent import validate_proposal
from core.comfy_workflow_builds import ComfyBuilds
from core.node_media import ImageFixture, NodeMedia, fixture_image, image_bytes
from core.node_plugin_builds import NodePluginBuilds
from core.node_plugin_package import export_package, import_package


def image_node():
    return {'typeId': 'image.resize-test', 'version': '1.0.0', 'title': '图片缩放',
            'fields': [{'id': 'text', 'label': '说明', 'component': 'text', 'default': ''}],
            'execution': {'kind': 'worker.python', 'textField': 'text', 'media': True, 'code': '''
import json,sys
from PIL import Image
r=json.load(sys.stdin)
assert r['protocolVersion']==2
assert 'images-in/' in r['images'][0]['path']
with Image.open(r['images'][0]['path']) as image:
    image.resize((6,4)).save('images-out/result.png')
print(json.dumps({'protocolVersion':2,'outputs':{'text':'done','images':['images-out/result.png']}}))
'''}}


class MediaTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        env = patch.dict(os.environ, {'ART_CANVAS_HOME': directory.name})
        env.start()
        self.addCleanup(env.stop)
        self.media = NodeMedia('alice')
        self.raw = fixture_image({'width': 8, 'height': 12, 'color': '#123456'})

    def test_import_ownership_integrity_and_data_url(self):
        item = self.media.import_data('data:image/png;base64,' + base64.b64encode(self.raw).decode())
        self.assertEqual((item['width'], item['height']), (8, 12))
        self.assertTrue(item['url'].startswith('/output/node-'))
        raw, record = self.media.read(item['id'])
        self.assertEqual(hashlib.sha256(raw).hexdigest(), item['sha256'])
        self.assertNotIn('relativePath', item)
        with self.assertRaisesRegex(ValueError, '当前账号'):
            NodeMedia('bob').read(item['id'])
        for bad in ('../secret', 'https://example.com/a.png', 'a' * 31):
            with self.assertRaises(ValueError):
                self.media.read(bad)
        (self.media.output_root / record['relativePath']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '已变化'):
            self.media.read(item['id'])

    def test_invalid_large_animated_or_unsafe_input_is_rejected(self):
        for data in ('file:///secret', 'https://example.com/a.png', 'data:image/png;base64,!',
                     'data:text/html;base64,AA==', 'data:image/png;base64,' + base64.b64encode(b'bad').decode()):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.media.import_data(data)
        stream = io.BytesIO()
        with Image.new('RGB', (4097, 4097)) as large:
            large.save(stream, 'PNG')
        with self.assertRaisesRegex(ValueError, '像素'):
            image_bytes(stream.getvalue())
        with self.assertRaises(ValueError):
            ImageFixture.model_validate({'width': True, 'height': 4, 'color': '#ffffff'})

    def test_publish_checks_every_file_before_publishing_and_rejects_links(self):
        scratch = self.root / 'scratch'
        output = scratch / 'images-out'
        output.mkdir(parents=True)
        (output / 'valid.png').write_bytes(self.raw)
        (output / 'bad.png').write_bytes(b'not an image')
        for paths in (['images-out/valid.png', 'images-out/bad.png'], ['../secret'], ['/secret.png'],
                      ['images-out/../secret.png'], ['images-out\\valid.png'], ['images-out/valid.png'] * 2):
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                self.media.publish(paths, scratch)
        self.assertFalse(self.media.root.exists(), 'an invalid batch must publish nothing')
        os.link(output / 'valid.png', output / 'linked.png')
        with self.assertRaisesRegex(ValueError, '硬链接'):
            self.media.publish(['images-out/linked.png'], scratch)
        (output / 'linked.png').unlink()
        with patch.object(Path, 'is_symlink', return_value=True), self.assertRaisesRegex(ValueError, '链接'):
            self.media.publish(['images-out/valid.png'], scratch)
        published = self.media.publish(['images-out/valid.png'], scratch)
        self.assertEqual(len(published), 1)
        self.media.remove(published[0]['id'])

    def test_real_worker_image_pipeline_candidate_package_and_hash_compatibility(self):
        context = ComfyBuilds(self.root / 'builds', self.root / 'workflows', 'alice', 'canvas', 'localhost:8188')
        service = NodePluginBuilds(context)
        value = image_node()
        tests = [{'expectedText': 'done', 'imageInputs': [{'width': 8, 'height': 12, 'color': '#123456'}],
                  'expectedImages': [{'width': 6, 'height': 4}]}]
        candidate = service.create(value, tests)
        with self.assertRaisesRegex(ValueError, '授权'):
            service.test(candidate['id'])
        service.approve_worker(candidate['id'], candidate['revision'])
        tested = service.test(candidate['id'])
        self.assertEqual(tested['status'], 'passed', tested['report'])
        self.assertEqual(len(tested['report']['results'][0]['images']), 1)
        installed = service.install(candidate['id'], candidate['revision'])['definition']
        restored, restored_tests = import_package(export_package(installed, tests))
        self.assertEqual(restored, installed)
        self.assertEqual(restored_tests, tests)
        source = self.media.save(self.raw)
        result = node_catalog.execute(installed, {}, ['input text'], media=self.media, media_inputs=[source['id']])
        image = result['outputs']['images'][0]
        raw, _ = self.media.read(image['id'])
        with Image.open(io.BytesIO(raw)) as output:
            self.assertEqual(output.size, (6, 4))
            self.assertEqual(output.getpixel((0, 0)), (18, 52, 86, 255))
        with self.assertRaisesRegex(ValueError, '当前账号'):
            node_catalog.execute(installed, {}, [], media=NodeMedia('bob'), media_inputs=[source['id']])
        # New optional media support must not invalidate installed text-worker definitions.
        value['execution'].pop('media')
        normalized = node_catalog.definition(value)
        self.assertNotIn('media', normalized['execution'])
        self.assertEqual(node_catalog.digest(node_catalog.definition(normalized)), node_catalog.digest(normalized))

    def test_image_expectations_are_required_and_failures_cannot_install(self):
        service = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, 'alice', 'canvas', 'localhost:8188'))
        with self.assertRaisesRegex(ValueError, 'expectedImages'):
            service.create(image_node(), [{'expectedText': 'done'}])
        tests = [{'expectedText': 'done', 'imageInputs': [{'width': 8, 'height': 12, 'color': '#000000'}],
                  'expectedImages': [{'width': 99, 'height': 4}]}]
        created = service.create(image_node(), tests)
        service.approve_worker(created['id'], created['revision'])
        self.assertEqual(service.test(created['id'])['status'], 'failed')
        with self.assertRaises(ValueError):
            service.install(created['id'], created['revision'])

    def test_worker_bad_paths_protocol_and_invalid_images_fail_before_publication(self):
        source = self.media.save(self.raw)
        for images, protocol in ((['../secret.png'], 2), (['images-out/a.png'], 1), (['images-out/a.png'], 2)):
            value = image_node()
            value['execution']['code'] = (
                "import json;from pathlib import Path;Path('images-out/a.png').write_bytes(b'bad');print("
                + repr(json.dumps({'protocolVersion': protocol, 'outputs': {'text': '', 'images': images}})) + ')')
            with self.subTest(images=images, protocol=protocol), self.assertRaises(ValueError):
                node_catalog.execute(value, {}, [], trusted=True, media=self.media, media_inputs=[source['id']])
        self.assertEqual(len(list(self.media.root.glob('*.json'))), 1, 'only the imported input should remain')

    def test_ai_proposal_conditional_image_links_require_actual_image_definition(self):
        snapshot = {'nodes': [{'id': 'image', 'type': 'image'}, {'id': 'out', 'type': 'output'}],
                    'connections': [], 'connectionRules': [['prompt', 'extension']]}
        def proposal(value):
            return {'summary': '处理已有图片', 'nodes': [{'id': 'worker', 'type': 'extension',
                    'fields': {'nodeDefinition': json.dumps(value)}}],
                    'connections': [{'from': 'image', 'to': 'worker'}, {'from': 'worker', 'to': 'out'}]}
        self.assertEqual(len(validate_proposal(proposal(image_node()), snapshot)['connections']), 2)
        text_node = image_node()
        text_node['execution'].pop('media')
        with self.assertRaisesRegex(ValueError, '不支持直接连接'):
            validate_proposal(proposal(text_node), snapshot)

    def test_cancel_during_image_publication_rolls_back_partial_batch(self):
        scratch = self.root / 'cancel-scratch'
        output = scratch / 'images-out'
        output.mkdir(parents=True)
        (output / 'a.png').write_bytes(self.raw)
        event = threading.Event()
        original = self.media.save
        def cancel_after_save(raw):
            result = original(raw)
            event.set()
            return result
        with patch.object(self.media, 'save', side_effect=cancel_after_save), self.assertRaisesRegex(ValueError, '已取消'):
            self.media.publish(['images-out/a.png'], scratch, event)
        self.assertFalse(list(self.media.root.glob('*.json')))

    def test_shipped_image_example_runs_with_its_declared_tests(self):
        value = json.loads((Path(__file__).resolve().parent.parent / 'docs/examples/node-plugin-image.json').read_text(encoding='utf-8'))
        service = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, 'alice', 'canvas', 'localhost:8188'))
        record = service.create(value['definition'], value['tests'])
        service.approve_worker(record['id'], record['revision'])
        result = service.test(record['id'])
        self.assertEqual(result['status'], 'passed', result['report'])


class MediaRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_import_run_cancel_contract_and_cross_account_handles(self):
        routes = importlib.import_module('routers.mcp_tools')
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[routes.local_request] = lambda: 'alice'
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'ART_CANVAS_HOME': directory}):
            value = node_catalog.install(image_node(), trusted=True)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
                raw = fixture_image({'width': 2, 'height': 3, 'color': '#ff0000'})
                response = await client.post('/api/mcp/node-run', json={'action': 'import-image',
                    'data': 'data:image/png;base64,' + base64.b64encode(raw).decode()})
                self.assertEqual(response.status_code, 200, response.text)
                resource = response.json()
                request = {'typeId': value['typeId'], 'version': value['version'], 'definitionHash': node_catalog.digest(value),
                           'params': {}, 'inputs': [], 'imageInputs': [resource['id']], 'runId': 'a' * 32}
                response = await client.post('/api/mcp/node-run', json=request)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['outputs']['images'][0]['width'], 6)
                app.dependency_overrides[routes.local_request] = lambda: 'bob'
                response = await client.post('/api/mcp/node-run', json=request)
                self.assertEqual(response.status_code, 400)
                self.assertIn('当前账号', response.text)


if __name__ == '__main__':
    unittest.main()
