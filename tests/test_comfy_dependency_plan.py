import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from core.comfy_dependency_plan import dependency_plan, installation_preflight
from core.comfy_workflow_builds import ComfyBuilds


class DependencyPlanTests(unittest.IsolatedAsyncioTestCase):
    def service(self, mapping=None, installed=None):
        return SimpleNamespace(target='localhost:8188', node_info=AsyncMock(return_value=installed or {}),
                               request=AsyncMock(return_value=mapping or {}))

    async def test_installed_never_contacts_manager(self):
        service = self.service(installed={'Known': {}})
        plan = await dependency_plan(service, ['Known'])
        self.assertEqual(plan['status'], 'satisfied')
        service.request.assert_not_called()

    async def test_exact_match_ambiguity_unknown_and_stable_revision(self):
        service = self.service({'pack-b': [['Shared'], {}], 'pack-a': [['Shared', 'Unique'], {}],
                                'regex-pack': [[], {'nodename_pattern': '.*'}], 'bad': None})
        plan = await dependency_plan(service, ['Unknown', 'Unique', 'Shared'])
        self.assertEqual([item['status'] for item in plan['dependencies']],
                         ['ambiguous', 'needs_verification', 'unknown'])
        self.assertFalse(plan['executable'])
        again = await dependency_plan(service, ['Shared', 'Unique', 'Unknown', 'Shared'])
        self.assertEqual(plan['revision'], again['revision'])
        service.request.assert_awaited_with('GET', '/v2/customnode/getmappings', params={'mode': 'local'})

    async def test_unavailable_manager_is_explicit_blocker(self):
        service = self.service()
        service.request.side_effect = ValueError('HTTP 404')
        plan = await dependency_plan(service, ['Missing'])
        self.assertEqual(plan['status'], 'blocked')
        self.assertIn('不可用', plan['reason'])

    async def test_invalid_arguments_make_no_requests(self):
        service = self.service()
        for value in (None, [], ['x'] * 13, [None], [''], ['x' * 257]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                await dependency_plan(service, value)
        service.node_info.assert_not_called()

    async def test_malformed_response_is_rejected(self):
        service = self.service()
        service.request.return_value = []
        with self.assertRaises(ValueError):
            await dependency_plan(service, ['Missing'])

    async def test_preflight_busy_idle_and_unknown(self):
        service = self.service()
        for running, count, expected in (([], 0, 'idle'), ([['job']], 0, 'busy'), ([], 1, 'busy')):
            service.request.side_effect = [
                {'queue_running': running, 'queue_pending': []},
                {'in_progress_count': count, 'pending_count': 0, 'is_processing': False}]
            self.assertEqual((await installation_preflight(service))['status'], expected)
        service.request.side_effect = [{}, {}]
        self.assertEqual((await installation_preflight(service))['status'], 'unavailable')
        service.request.side_effect = ValueError('unavailable')
        self.assertEqual((await installation_preflight(service))['status'], 'unavailable')

    async def test_durable_plan_isolation_stale_and_instance_change(self):
        with tempfile.TemporaryDirectory() as root:
            service = ComfyBuilds(root, root, 'alice', 'canvas', 'localhost:8188')
            service.node_info = AsyncMock(return_value={})
            service.request = AsyncMock(return_value={'pack': [['Missing'], {}]})
            saved = await service.plan_dependencies(['Missing'])
            restored = ComfyBuilds(root, root, 'alice', 'canvas', 'localhost:8188')
            restored.node_info = AsyncMock(return_value={'Missing': {}})
            restored.request = AsyncMock(side_effect=[
                {'queue_running': [], 'queue_pending': []},
                {'in_progress_count': 0, 'pending_count': 0, 'is_processing': False}])
            result = await restored.get_dependency_plan(saved['planId'])
            self.assertEqual(result['status'], 'stale')
            self.assertEqual(result['plan']['revision'], saved['revision'])
            self.assertEqual(result['currentPlan']['status'], 'satisfied')
            self.assertEqual(restored.list(), [])
            for owner, canvas in (('bob', 'canvas'), ('alice', 'other')):
                other = ComfyBuilds(root, root, owner, canvas, 'localhost:8188')
                with self.assertRaises(ValueError):
                    await other.get_dependency_plan(saved['planId'])
            restored.target = 'localhost:8189'
            restored.node_info.reset_mock()
            self.assertEqual((await restored.get_dependency_plan(saved['planId']))['status'], 'instance_changed')
            restored.node_info.assert_not_called()
            with self.assertRaises(ValueError):
                await restored.get_dependency_plan('../outside')
