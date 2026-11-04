import asyncio
import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from core.comfy_installs import _TASKS, ComfyInstalls
from core.comfy_workflow_builds import ComfyBuilds

SOURCE = 'https://github.com/example/nodes'


class SocketContext:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class InstallTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.context = ComfyBuilds(directory.name, directory.name, 'alice', 'canvas', 'localhost:8188')
        self.installs = ComfyInstalls(self.context)
        self.installed, self.calls, self.busy, self.registered = {}, [], False, False
        self.versions = [{'version': '1.2.0', 'status': 'NodeVersionStatusActive'},
                         {'version': '9.0.0', 'status': 'NodeVersionStatusPending'},
                         {'version': 'latest', 'status': 'NodeVersionStatusActive'}]
        self.context.node_info = AsyncMock(side_effect=lambda kinds: {'Missing': {}} if self.registered else {})
        self.context.request = AsyncMock(side_effect=self.request)
        self.installs.wait_result = AsyncMock(return_value='success')
        self.patch = patch('core.comfy_installs.websockets.connect', return_value=SocketContext())
        self.patch.start()
        self.addCleanup(self.patch.stop)

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path.startswith('/v2/'):
            raise ValueError('ComfyUI HTTP 404: Not Found')
        if path == '/customnode/getmappings':
            return {SOURCE: [['Missing'], {}]}
        if path == '/customnode/getlist':
            return {'node_packs': {'example-pack': {'repository': SOURCE, 'files': [SOURCE]}}}
        if path == '/customnode/versions/example-pack':
            return self.versions
        if path == '/customnode/installed':
            return self.installed.copy()
        if path == '/queue':
            return {'queue_running': [['other-job']] if self.busy else [], 'queue_pending': []}
        if path == '/manager/queue/status':
            return {'total_count': 0, 'done_count': 0, 'in_progress_count': 0, 'is_processing': False}
        if path == '/manager/queue/install':
            body = kwargs['value']
            self.installed[body['id']] = {'ver': body['selected_version'], 'enabled': True}
            return b''
        if path == '/manager/queue/start':
            return b''
        if path == '/externalmodel/getlist':
            return {'models': [{'name': 'Fixture Model', 'type': 'checkpoints', 'base': 'SDXL',
                'save_path': 'default', 'filename': 'fixture.safetensors', 'size': '1MB',
                'url': 'https://huggingface.co/example/model/resolve/main/fixture.safetensors'}]}
        if path == '/manager/queue/install_model':
            self.registered = True
            return b''
        raise AssertionError((method, path))

    async def prepare(self):
        plan = await self.context.plan_dependencies(['Missing'])
        return await self.installs.prepare(plan['planId'])

    async def finish(self, record, **kwargs):
        await self.installs.start(record['id'], record['revision'], **kwargs)
        task = _TASKS.get(str(self.installs.path(record['id'])))
        if task:
            await task
            await asyncio.sleep(0)
        return await self.installs.get(record['id'])

    async def test_pinned_legacy_install_stages_without_running_scripts(self):
        record = await self.prepare()
        self.assertEqual(record['packages'][0]['version'], '1.2.0')
        self.assertNotIn('snapshot', record)
        result = await self.finish(record)
        self.assertEqual(result['status'], 'staged')
        submitted = [call for call in self.calls if call[1] == '/manager/queue/install']
        self.assertEqual(len(submitted), 1)
        self.assertTrue(submitted[0][2]['value']['skip_post_install'])
        self.assertFalse(self.installs.lease(self.context.target).exists())
        await self.installs.start(record['id'], record['revision'])
        self.assertEqual(len([call for call in self.calls if call[1] == '/manager/queue/install']), 1)

    async def test_authorized_full_install_requires_registration_after_restart(self):
        record = await self.prepare()
        result = await self.finish(record, allow_scripts=True)
        self.assertEqual(result['status'], 'restart_required')
        self.registered = True
        self.assertEqual((await self.installs.reconcile(record['id']))['status'], 'succeeded')

    async def test_busy_conflict_and_cross_canvas_do_not_submit(self):
        record = await self.prepare()
        self.busy = True
        with self.assertRaises(ValueError):
            await self.installs.start(record['id'], record['revision'])
        self.assertFalse(self.installs.lease(self.context.target).exists())
        self.installs.acquire(self.installs.read(record['id']))
        with self.assertRaises(ValueError):
            await self.installs.start(record['id'], record['revision'])
        self.installs.release(self.installs.read(record['id']))
        self.context.canvas_id = 'other'
        with self.assertRaises(ValueError):
            await self.installs.get(record['id'])
        self.assertFalse(any(method == 'POST' for method, _, _ in self.calls))

    async def test_unknown_result_keeps_lease_and_never_retries(self):
        record = await self.prepare()
        self.installs.wait_result.side_effect = TimeoutError('lost result')
        result = await self.finish(record, allow_scripts=True)
        self.assertEqual(result['status'], 'uncertain')
        self.assertTrue(self.installs.lease(self.context.target).exists())
        await self.installs.start(record['id'], record['revision'], allow_scripts=True)
        self.assertEqual(len([call for call in self.calls if call[1] == '/manager/queue/install']), 1)
        self.assertEqual((await self.installs.reconcile(record['id']))['status'], 'restart_required')
        self.assertFalse(self.installs.lease(self.context.target).exists())

    async def test_declared_failure_is_not_success(self):
        record = await self.prepare()
        self.installs.wait_result.return_value = 'pip installation failed'
        self.assertEqual((await self.finish(record, allow_scripts=True))['status'], 'failed')
        self.assertFalse(self.installs.lease(self.context.target).exists())

    async def test_pending_only_versions_and_existing_packages_are_blocked(self):
        self.versions = [{'version': '9.0.0', 'status': 'NodeVersionStatusPending'}]
        with self.assertRaises(ValueError):
            await self.prepare()
        self.versions = [{'version': '1.0.0', 'status': 'NodeVersionStatusActive'}]
        self.installed['example-pack'] = {'ver': '0.1.0'}
        with self.assertRaises(ValueError):
            await self.prepare()

    async def test_legacy_result_filters_other_tasks(self):
        socket = type('Socket', (), {'recv': AsyncMock(side_effect=[
            json.dumps({'type': 'cm-queue-status', 'data': {'nodepack_result': {'other': 'success'}}}),
            json.dumps({'type': 'cm-queue-status', 'data': {'nodepack_result': {'mine': 'success'}}})])})()
        self.assertEqual(await ComfyInstalls.wait_result(self.installs, socket, 'mine', ''), 'success')

    async def test_catalog_model_download_and_loader_verification(self):
        async def node_info(kinds):
            return {'CheckpointLoaderSimple': {'input': {'required': {'ckpt_name': [
                ['fixture.safetensors'] if self.registered else [], {}]}}}}
        self.context.node_info.side_effect = node_info
        matches = await self.installs.find_models('fixture')
        self.assertEqual(matches['totalMatches'], 1)
        record = await self.installs.prepare_model(matches['models'][0]['modelKey'], 'CheckpointLoaderSimple', 'ckpt_name')
        self.assertEqual((await self.finish(record, allow_scripts=True))['status'], 'succeeded')
        self.assertTrue(any(path == '/manager/queue/install_model' for _, path, _ in self.calls))
        with self.assertRaises(ValueError):
            await self.installs.prepare_model('a' * 64, 'CheckpointLoaderSimple', 'ckpt_name')

    async def test_model_source_head_requires_lfs_content_hash(self):
        import httpx
        matches = await self.installs.find_models('fixture')
        key = matches['models'][0]['modelKey']
        client = httpx.AsyncClient
        requests = []
        headers = {'x-linked-etag': 'a' * 64, 'x-linked-size': '1024'}
        def respond(request):
            requests.append(request)
            return httpx.Response(302, headers=headers)
        with patch('core.comfy_installs.httpx.AsyncClient', side_effect=lambda **kwargs:
                   client(transport=httpx.MockTransport(respond), **kwargs)):
            result = await self.installs.inspect_model_source(key)
            self.assertEqual(result['sha256'], 'a' * 64)
            self.assertEqual(result['bytes'], 1024)
            headers['x-linked-etag'] = 'a' * 40
            with self.assertRaisesRegex(ValueError, 'LFS SHA256'):
                await self.installs.inspect_model_source(key)
        self.assertEqual([request.method for request in requests], ['HEAD', 'HEAD'])

    async def test_failed_retry_needs_fresh_approval_and_refuses_partial_install(self):
        record = await self.prepare()
        record.update(status='failed', error='connection failed', approvedRevision=record['revision'])
        self.installs.save(record)
        result = await self.installs.retry_failed(record['id'])
        self.assertEqual(result['status'], 'prepared')
        self.assertNotIn('approvedRevision', result)
        self.assertEqual(result['attempts'][0]['error'], 'connection failed')
        record.update(status='failed')
        self.installs.save(record)
        self.installed = {'example-pack': {'ver': '1.2.0', 'enabled': True}}
        with self.assertRaisesRegex(ValueError, '已有插件落盘'):
            await self.installs.retry_failed(record['id'])
        self.registered = True
        record['allowScripts'] = True
        self.installs.save(record)
        result = await self.installs.reconcile(record['id'])
        self.assertEqual(result['status'], 'succeeded')

    async def test_model_registration_accepts_current_combo_schema(self):
        self.context.node_info.side_effect = None
        self.context.node_info.return_value = {'Loader': {'input': {'required': {
            'model': ['COMBO', {'options': ['fixture.safetensors']}]}}}}
        record = {'modelBinding': {'nodeType': 'Loader', 'input': 'model', 'value': 'fixture.safetensors'}}
        self.assertTrue(await self.installs.model_registered(record))
        record['modelBinding']['value'] = 'missing.safetensors'
        self.assertFalse(await self.installs.model_registered(record))

    async def test_verified_model_plan_download_receipt_and_tampering(self):
        import hashlib
        from pathlib import Path
        from core.comfy_model_download import download
        import httpx
        async def node_info(kinds):
            return {'CheckpointLoaderSimple': {'input': {'required': {'ckpt_name': [
                ['fixture.safetensors'] if self.registered else [], {}]}}}}
        self.context.node_info.side_effect = node_info
        root = Path(self.context.root) / 'managed-comfy'
        root.mkdir(parents=True)
        payload = b'verified-model-fixture'
        sha = hashlib.sha256(payload).hexdigest()
        matches = await self.installs.find_models('fixture')
        with patch('core.comfy_model_download.managed_root', return_value=root):
            record = await self.installs.prepare_verified_model(matches['models'][0]['modelKey'],
                'CheckpointLoaderSimple', 'ckpt_name', sha, 100)
            tampered = dict(record)
            tampered['downloadPolicy'] = {**record['downloadPolicy'], 'maxBytes': 200}
            self.installs.save(tampered)
            with self.assertRaisesRegex(ValueError, '清单内容已变化'):
                await self.installs.start(record['id'], record['revision'], allow_scripts=True)
            self.installs.save(record)
            uncertain = {**record, 'status': 'uncertain'}
            self.installs.save(uncertain)
            with self.assertRaisesRegex(ValueError, '模型文件不存在'):
                await self.installs.reconcile(record['id'])
            self.installs.save(record)
            original = httpx.AsyncClient
            class Stream(httpx.AsyncByteStream):
                async def __aiter__(self):yield payload
            async def handler(request):return httpx.Response(200, stream=Stream())
            async def real_download(*args):
                result = await download(*args)
                self.registered = True
                return result
            with patch('core.comfy_model_download.httpx.AsyncClient', side_effect=lambda **kw:
                       original(transport=httpx.MockTransport(handler), **kw)), patch(
                       'core.comfy_model_download.download', side_effect=real_download):
                result = await self.finish(record, allow_scripts=True)
            self.assertEqual(result['status'], 'succeeded')
            self.assertEqual(result['downloadReceipt']['sha256'], sha)
            self.assertEqual((root / 'models/checkpoints/fixture.safetensors').read_bytes(), payload)
            self.assertFalse(any(path == '/manager/queue/install_model' for _, path, _ in self.calls))
            recovered = self.installs.read(record['id'])
            recovered['status'] = 'uncertain'
            del recovered['downloadReceipt']
            self.installs.save(recovered)
            with patch('core.comfy_model_download.httpx.AsyncClient', side_effect=AssertionError('no resubmit')):
                result = await self.installs.reconcile(record['id'])
            self.assertEqual(result['status'], 'succeeded')
            self.assertIn('recheckedAt', result['downloadReceipt'])
            recovered = self.installs.read(record['id'])
            recovered['status'] = 'verification_required'
            self.installs.save(recovered)
            (root / 'models/checkpoints/fixture.safetensors').write_bytes(b'x' * len(payload))
            with self.assertRaisesRegex(ValueError, 'SHA256不匹配'):
                await self.installs.reconcile(record['id'])
            self.assertEqual(self.installs.read(record['id'])['status'], 'verification_required')

    async def test_restart_only_uses_owned_callback_and_revalidates(self):
        record = await self.prepare()
        await self.finish(record, allow_scripts=True)
        async def restart(target):
            self.assertEqual(target, 'localhost:8188')
            self.registered = True
        self.installs.restart_owned = AsyncMock(side_effect=restart)
        await self.installs.restart(record['id'])
        await _TASKS[str(self.installs.path(record['id']))]
        await asyncio.sleep(0)
        self.assertEqual((await self.installs.get(record['id']))['status'], 'succeeded')
        self.assertFalse(self.installs.lease(self.context.target).exists())

    async def test_cancel_before_submission_does_not_start_manager(self):
        record = await self.prepare()
        await self.installs.start(record['id'], record['revision'])
        result = await self.installs.cancel_monitoring(record['id'])
        self.assertEqual(result['status'], 'cancelled')
        self.assertFalse(any(method == 'POST' for method, _, _ in self.calls))


class LiveManagerTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(os.environ.get('ART_CANVAS_TEST_MANAGER'), 'opt-in read-only Manager integration')
    async def test_running_protocol_mapping_preflight_and_model_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ComfyBuilds(directory, directory, 'test-owner', 'test-canvas', os.environ['ART_CANVAS_TEST_MANAGER'])
            plan = await service.plan_dependencies(['ArtCanvasIntentionallyMissingReadOnlyTest'])
            restored = await service.get_dependency_plan(plan['planId'])
            self.assertEqual(restored['status'], 'unchanged')
            self.assertEqual(plan['dependencies'][0]['status'], 'unknown')
            self.assertIn(restored['preflight']['status'], ('busy', 'idle'))
            self.assertIn(plan['managerPrefix'], ('', '/v2'))
            models = await ComfyInstalls(service).find_models('sdxl')
            self.assertIsInstance(models['models'], list)
