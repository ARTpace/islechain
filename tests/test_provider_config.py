"""Provider storage compatibility, recommendations and public credential projection."""
import json
from pathlib import Path

from providers.catalog import builtin_default_models
from providers.config import ProviderStore, normalize_provider, public_provider


def test_empty_store_does_not_install_recommendations(tmp_path):
    store = ProviderStore(tmp_path / 'user' / 'providers.json', tmp_path / 'app')
    assert store.load() == []
    store.save([])
    assert store.load() == []


def test_legacy_migration_preserves_user_changes(tmp_path):
    app = tmp_path / 'app'
    app.mkdir()
    (app / 'api_providers.json').write_text(json.dumps([{'id': 'legacy'}]), encoding='utf-8')
    store = ProviderStore(tmp_path / 'user' / 'providers.json', app)
    assert store.load() == [{'id': 'legacy'}]
    store.save([{'id': 'custom', 'custom_field': 'preserved'}])
    assert store.load() == [{'id': 'custom', 'custom_field': 'preserved'}]
    assert (app / 'api_providers.json').exists()


def test_existing_modelscope_defaults_are_persisted(tmp_path):
    store = ProviderStore(tmp_path / 'providers.json', tmp_path / 'app')
    store.save([{'id': 'modelscope'}])
    providers = store.load()
    assert providers[0]['ms_loras']
    assert json.loads(Path(store.path).read_text(encoding='utf-8')) == providers
    providers[0]['ms_loras'][0]['name'] = 'changed locally'
    assert store.load()[0]['ms_loras'][0]['name'] != 'changed locally'


def test_normalization_and_visitor_key_masking(monkeypatch):
    monkeypatch.delenv('CUSTOM_API_KEY', raising=False)
    provider = normalize_provider({'id': ' custom ', 'name': ' Custom ', 'protocol': 'codex',
                                   'image_request_mode': 'invalid', 'chat_models': ['chat'],
                                   'model_labels': {'chat': ' Name ', 'not-selected': 'Hidden'}})
    assert provider['model_labels'] == {'chat': 'Name'}
    assert provider['image_request_mode'] == 'openai'
    result = public_provider(provider, read_key=lambda _: '123456789secret', visitor=True)
    assert result['has_key'] is True
    assert result['key_preview'] == ''
    assert result['image_models'] == ['gpt-image-2']
    assert '123456789secret' not in repr(result)
    assert public_provider(provider, read_key=lambda _: '123456789secret')['key_preview'] == '1234••••cret'


def test_model_catalog_returns_independent_lists():
    first = builtin_default_models('codex')
    first[0].clear()
    assert builtin_default_models('codex')[0] == ['gpt-image-2']


def test_provider_route_preserves_extensions_and_primary_selection(monkeypatch):
    import ast
    import asyncio
    from types import SimpleNamespace

    from fastapi import HTTPException

    import core.model_availability as availability
    from providers.config import provider_key_env

    monkeypatch.setattr(availability, 'invalidate', lambda: None)
    source = ast.parse(Path('routers/config.py').read_text(encoding='utf-8'))
    node = next(item for item in source.body if isinstance(item, ast.AsyncFunctionDef) and item.name == 'save_providers')
    node.decorator_list = []
    node.args.args[0].annotation = None
    saved, env = [], []
    old = [{'id': 'custom', 'rh_workflows': [{'id': 'kept'}], 'model_capabilities': {'image': {'type': 'image'}}}]
    context = {
        'provider_store': lambda: SimpleNamespace(load=lambda: old, save=lambda items: saved.append(items)),
        'normalize_provider': normalize_provider, 'provider_key_env': provider_key_env,
        'visible_provider': lambda provider: public_provider(provider, read_key=lambda _: ''),
        'HTTPException': HTTPException,
        '_main': SimpleNamespace(update_env_values=lambda values: env.append(values), reload_env_globals=lambda: None)
    }
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<provider-route>', 'exec'), context)
    def payload(data):
        return SimpleNamespace(primary=data.get('primary', False), api_key=None,
                               dict=lambda **kwargs: dict(data))
    result = asyncio.run(context['save_providers']([payload({'id': 'custom', 'primary': True}),
                                                   payload({'id': 'other', 'primary': True})]))
    assert [provider['primary'] for provider in result['providers']] == [False, True]
    assert saved[0][0]['rh_workflows'] == old[0]['rh_workflows']
    assert saved[0][0]['model_capabilities'] == old[0]['model_capabilities']
    assert env == [], 'omitted keys must not overwrite saved credentials'
    result = asyncio.run(context['save_providers']([]))
    assert result == {'providers': []}
    assert saved[-1] == []
