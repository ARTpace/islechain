"""Model discovery uses mocked HTTP only; never imports the application entry point."""
import asyncio
from unittest.mock import patch

import httpx
import pytest
from fastapi import HTTPException

from providers.upstream import fetch_models_from_upstream, group_models
from tools.api_compat import sanitize_api_key


def test_catalog_preserves_declared_types_and_legacy_names():
    result = group_models(['gpt-chat', 'flux-image', 'sora-video', 'gpt-chat'])
    assert result['total'] == 3
    assert result['chat_models'] == ['gpt-chat']
    assert result['image_models'] == ['flux-image']
    assert result['video_models'] == ['sora-video']
    assert sanitize_api_key(' key中文 ') == 'key'


def test_discovery_refresh_and_error_mapping():
    requests = []

    def handle(request):
        requests.append(request)
        assert request.headers['Authorization'] == 'Bearer test'
        return httpx.Response(200, json={'data': [{'id': 'flux-image'}, {'id': 'gpt-chat'}]})

    client = httpx.AsyncClient
    with patch('providers.upstream.httpx.AsyncClient', side_effect=lambda **kw: client(
        **kw, transport=httpx.MockTransport(handle)
    )):
        result = asyncio.run(fetch_models_from_upstream('https://example.test/v1', 'test', True, 'a/b'))
    assert result['total'] == 2
    assert requests[0].url.params['refresh'] == 'true'
    assert requests[0].url.params['model'] == 'a/b'

    for base, key in [('', 'test'), ('file://local', 'test'), ('https://example.test', '')]:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(fetch_models_from_upstream(base, key))
        assert exc.value.status_code == 400

    with patch('providers.upstream.httpx.AsyncClient', side_effect=lambda **kw: client(
        **kw, transport=httpx.MockTransport(lambda request: httpx.Response(401, text='denied'))
    )):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(fetch_models_from_upstream('https://example.test', 'test'))
        assert exc.value.status_code == 401
