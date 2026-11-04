import io
import json
import stat
import unittest
import zipfile

from core.node_plugin_package import export_package, import_package


def sample():
    return {'typeId': 'test.package', 'version': '1.0.0', 'title': '打包测试',
            'fields': [{'id': 'text', 'label': '文本', 'component': 'textarea', 'default': ''}],
            'execution': {'kind': 'host.text', 'textField': 'text', 'operation': 'uppercase'}}


class PackageTests(unittest.TestCase):
    def package(self, files):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, value in files:
                archive.writestr(name, value)
        return stream.getvalue()

    def files(self):
        with zipfile.ZipFile(io.BytesIO(export_package(sample(), [{'expectedText': ''}]))) as archive:
            return [(name, archive.read(name)) for name in archive.namelist()]

    def test_round_trip_preserves_identity_and_test_data_without_authorization(self):
        item, tests = import_package(export_package(sample(), [{'params': {'text': 'hi'}, 'expectedText': 'HI'}]))
        self.assertEqual(item['typeId'], 'test.package')
        self.assertEqual(tests[0]['expectedText'], 'HI')
        self.assertNotIn('trustedRevision', item)

    def test_paths_symlinks_duplicates_and_expansion_are_rejected(self):
        link = zipfile.ZipInfo('worker/main.py')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for extra in [('../escape.py', b'bad'), ('C:/escape.py', b'bad'), ('node.json', b'{}'),
                      (link, b'../../target'), ('ui/style.css', b'x' * 65537)]:
            with self.subTest(name=str(extra[0])), self.assertRaises(ValueError):
                import_package(self.package([*self.files(), extra]))

    def test_hashes_identity_permissions_and_host_compatibility(self):
        for key, changed in [('apiVersion', 2), ('definitionHash', 'wrong'),
                             ('permissions', ['network']), ('id', 'wrong')]:
            files = self.files()
            manifest = json.loads(dict(files)['manifest.json'])
            manifest[key] = changed
            files = [(name, json.dumps(manifest).encode() if name == 'manifest.json' else data) for name, data in files]
            with self.subTest(key=key), self.assertRaises(ValueError):
                import_package(self.package(files))
        files = [(name, b'{}' if name == 'node.json' else data) for name, data in self.files()]
        with self.assertRaises(ValueError):
            import_package(self.package(files))

    def test_broken_archive_and_size_limits(self):
        for data in (b'not zip', b'x' * 262145):
            with self.assertRaises(ValueError):
                import_package(data)
