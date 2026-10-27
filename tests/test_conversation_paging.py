import ast
import asyncio
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


def load_function(path, name, context):
    tree = ast.parse(Path(path).read_text(encoding='utf-8'))
    node = next(node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), path, 'exec'), context)
    return context[name]


class ConversationPagingTests(unittest.TestCase):
    def test_summary_cache_invalidates_on_write_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            context = dict(os=os, json=json, user_dir=lambda _: directory, _conversation_list_cache={})
            listing = load_function('main.py', 'list_conversations', context)
            path = Path(directory) / 'one.json'
            path.write_text(json.dumps({'id': 'one', 'updated_at': 1, 'messages': []}), encoding='utf-8')
            first = listing('user')
            self.assertIs(listing('user'), first)
            path.write_text(json.dumps({'id': 'one', 'title': 'changed title', 'updated_at': 2}), encoding='utf-8')
            self.assertEqual(listing('user')[0]['title'], 'changed title')
            path.unlink()
            self.assertEqual(listing('user'), [])

    def test_pages_and_legacy_clients(self):
        records = [{'id': str(i)} for i in range(45)]
        context = dict(Request=object, Header=lambda **_: '', _main=SimpleNamespace(
            account_dirname=lambda: 'user', list_conversations=lambda _: records))
        route = load_function('routers/canvas_tasks.py', 'conversations', context)
        page = asyncio.run(route(None, offset=20, limit=20))
        self.assertEqual(page['conversations'], records[20:40])
        self.assertTrue(page['has_more'])
        self.assertFalse(asyncio.run(route(None, offset=40, limit=20))['has_more'])
        self.assertEqual(asyncio.run(route(None))['conversations'], records)


if __name__ == '__main__':
    unittest.main()
