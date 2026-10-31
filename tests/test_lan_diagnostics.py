import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch, MagicMock


class LanDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('lan_under_test', Path(__file__).parents[1] / 'core' / 'lan_sharing.py')
        self.lan = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'main': types.ModuleType('main')}):
            spec.loader.exec_module(self.lan)

    def test_diagnostics_reports_failed_connection_and_unknown_firewall(self):
        with patch.object(self.lan, 'load_config', return_value={'enabled': True, 'port': 7001}), patch.object(self.lan, 'network_addresses', return_value=['192.168.1.2']), patch.object(self.lan.socket, 'create_connection', side_effect=OSError()), patch.object(self.lan.subprocess, 'run', side_effect=OSError()):
            result = self.lan.diagnose()
        self.assertFalse(result['addresses'][0]['reachable'])
        self.assertEqual(result['firewall']['state'], 'unknown')
        self.assertTrue(self.lan._host_only('/api/lan/diagnostics', 'GET'))

    def test_client_status_keeps_note_and_last_seen(self):
        item = {'ip': '192.168.1.2', 'note': '手机', 'lastSeen': 12345}
        with patch.object(self.lan, '_clients', return_value={item['ip']: item}):
            row = self.lan.client_status()['clients'][0]
        self.assertEqual(row['note'], '手机')
        self.assertEqual(row['lastSeen'], 12345)


if __name__ == '__main__':
    unittest.main()
