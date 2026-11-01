import tempfile
from pathlib import Path
import unittest
from PIL import Image
from core.unified_asset_storage import invalid_local_images


class InvalidImageTests(unittest.TestCase):
    def test_missing_corrupt_and_empty_url_are_invalid_but_remote_and_other_media_are_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            Image.new('RGB', (4, 4)).save(root / 'valid.png')
            (root / 'broken.png').write_bytes(b'not an image')
            items = [dict(id=name, url='/assets/' + name, kind='image')
                     for name in ('valid.png', 'broken.png', 'missing.png')]
            items += [dict(id='empty', url='', kind='image'),
                      dict(id='remote', url='https://example.com/missing.png', kind='image'),
                      dict(id='video', url='/assets/missing.mp4', kind='video'),
                      dict(id='repo', url='/assets/missing.png', kind='image', repository_source='repo')]
            library = {'categories': [{'items': items}]}
            resolve = lambda url: root / url.removeprefix('/assets/')
            result = invalid_local_images(library, resolve, lambda url: 'image')
            self.assertEqual({x['id'] for x in result}, {'broken.png', 'missing.png', 'empty'})
            self.assertEqual(len(library['categories'][0]['items']), 7)
            self.assertTrue((root / 'broken.png').exists())
            Image.new('RGB', (4, 4)).save(root / 'broken.png')
            self.assertNotIn('broken.png', {x['id'] for x in invalid_local_images(library, resolve, lambda url:'image')})


if __name__ == '__main__':
    unittest.main()
