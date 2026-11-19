import asyncio
import unittest
from unittest.mock import patch

import httpx

from core.model_availability_cloud import probe_provider


class CloudAvailabilityTests(unittest.TestCase):
    def test_transient_network_failure_keeps_enabled_models_selectable(self):
        provider = {
            'id': 'webapi', 'protocol': 'webai2api', 'enabled': True,
            'base_url': 'http://localhost:8000/v1',
            'image_models': ['bt_nano_banana/nano-banana-2'],
        }
        class Context:
            def get_provider_api_key(self, provider_id):
                return ''

        for error in (httpx.ReadTimeout('slow gateway'), httpx.ConnectError('restarting')):
            with self.subTest(error=type(error).__name__):
                with patch('httpx.AsyncClient.get', side_effect=error):
                    entries = asyncio.run(probe_provider(Context(), provider, asyncio.Semaphore(1)))
                self.assertTrue(entries['provider:webapi']['available'])
                self.assertTrue(entries['image:webapi/bt_nano_banana/nano-banana-2']['available'])


if __name__ == '__main__':
    unittest.main()
