import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.node_credentials import protect, unprotect
from core import node_http, node_catalog
from tests.test_node_http import sample
import httpx


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI requires Windows')
class CredentialTests(unittest.TestCase):
    def test_real_dpapi_roundtrip_tamper_and_scope(self):
        secret = 'actual-test-secret-12345'
        record = protect(secret, 'alice:definition')
        self.assertNotIn(secret, json.dumps(record))
        self.assertEqual(unprotect(record, 'alice:definition'), secret)
        with self.assertRaises(ValueError):
            unprotect(record, 'bob:definition')
        with self.assertRaises(ValueError):
            unprotect(record, 'alice:changed-definition')
        record['ciphertext'] = record['ciphertext'][:-8] + 'AAAAAAAA'
        with self.assertRaises(ValueError):
            unprotect(record, 'alice:definition')

    def test_old_binding_migrates_before_request_and_failure_is_closed(self):
        item = node_catalog.definition(sample());digest = node_catalog.digest(item)
        secret = 'old-private-token'
        original = httpx.Client
        def handler(request):
            self.assertEqual(request.headers['Authorization'], 'Bearer ' + secret)
            self.assertNotIn(secret, path.read_text(encoding='utf-8'))
            return httpx.Response(200, json={'result': {'text': 'ok'}})
        with tempfile.TemporaryDirectory() as folder, patch('core.node_http.user_data_dir', return_value=folder):
            path = node_http.credential_path('alice', digest)
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'token': secret}), encoding='utf-8')
            with patch('core.node_http.httpx.Client', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw)):
                self.assertEqual(node_catalog.execute(item, {}, [], worker_owner='alice')['outputs']['text'], 'ok')
            self.assertEqual(json.loads(path.read_text())['storage'], 'windows-dpapi-v1')
            path.write_text(json.dumps({'token': secret}), encoding='utf-8')
            with patch('core.node_http.protect', side_effect=ValueError('unavailable')), patch('core.node_http.httpx.Client') as client:
                with self.assertRaises(ValueError):
                    node_catalog.execute(item, {}, [], worker_owner='alice')
                client.assert_not_called()
            with patch('core.node_http.protect', side_effect=ValueError('unavailable')):
                with self.assertRaises(ValueError):
                    node_http.save_credential('alice', item, 'new-token')
            self.assertEqual(json.loads(path.read_text())['token'], secret)


if __name__ == '__main__':
    unittest.main()
