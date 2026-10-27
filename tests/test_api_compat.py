import unittest

from tools.api_compat import api_root, models_endpoint, model_items


class ApiCompatTests(unittest.TestCase):
    def test_official_roots(self):
        for url in ('https://api.groq.com/openai/v1',
                    'https://generativelanguage.googleapis.com/v1beta/openai',
                    'https://example.com/v4'):
            self.assertEqual(api_root(url + '/'), url)
        self.assertEqual(api_root('https://example.com'), 'https://example.com/v1')

    def test_cloudflare_catalog_uses_canonical_names(self):
        base = 'https://api.cloudflare.com/client/v4/accounts/account123/ai/v1'
        self.assertEqual(models_endpoint(base), base[:-3] +
                         '/models/search?task=Text%20Generation&per_page=50')
        self.assertEqual(model_items({'result': [{'id': 'internal-id', 'name': '@cf/model'}]}, True),
                         [{'id': '@cf/model', 'type': 'text'}])

    def test_standard_catalog(self):
        items = [{'id': 'chat-model'}]
        self.assertEqual(model_items({'data': items}), items)
        self.assertEqual(model_items({'result': 'invalid'}), [])


if __name__ == '__main__':
    unittest.main()
