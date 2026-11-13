"""Local Designer MCP adapter. Never retries a mutating call."""
import json
import urllib.request


class Designer:
    def __init__(self):
        self.session = None

    def rpc(self, method, params=None, *, timeout=8, notification=False):
        payload = {'jsonrpc': '2.0', 'method': method}
        if not notification:
            payload['id'] = 1
        if params is not None:
            payload['params'] = params
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        if self.session:
            headers['Mcp-Session-Id'] = self.session
        request = urllib.request.Request('http://127.0.0.1:9765/mcp', json.dumps(payload).encode(), headers)
        # Do not follow redirects/proxies from this privileged loopback adapter.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=timeout) as response:
            self.session = response.headers.get('Mcp-Session-Id') or self.session
            if notification:
                return None
            raw = response.read(2*1024*1024).decode()
            if 'text/event-stream' in response.headers.get('Content-Type', ''):
                messages = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith('data:') and line[5:].strip()]
                result = next((m for m in messages if m.get('id') == 1), {})
            else:
                result = json.loads(raw)
        if result.get('error'):
            raise ValueError('Designer MCP 返回错误')
        return result.get('result', {})

    def tool(self, name, arguments, *, timeout=8):
        result = self.rpc('tools/call', {'name': name, 'arguments': arguments}, timeout=timeout)
        if result.get('isError'):
            raise ValueError('Designer 工具执行失败')
        content = next((c['text'] for c in result.get('content', []) if c.get('type') == 'text'), '{}')
        value = json.loads(content)
        if value.get('error') or value.get('success') is False:
            raise ValueError('Designer 未完成请求')
        return value

    def connect(self):
        self.rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                               'clientInfo': {'name': 'art-canvas-materials', 'version': '1'}})
        self.rpc('notifications/initialized', notification=True)
        self.tool('load_skill', {'skill_name': 'designer-session'})
        hits = self.tool('search', {'query': 'designer'}).get('hits', [])
        slugs = [h.get('tool_slug', '') for h in hits if 'create_imported_pbr_material' in h.get('tool_slug', '')]
        if len(slugs) != 1:
            raise ValueError('请启动 Designer 并启用 MCP 插件（需要唯一的 Designer 连接）')
        self.slug = slugs[0]
        return self.slug

    def create(self, directory, maps):
        root = directory.resolve()
        arguments = {'package_path': str(root/'material.sbs'), 'output_dir': str(root/'designer_render'),
                     'graph_identifier': 'canvas_material', 'open_in_editor': True}
        for parameter, name in [('base_color_path', 'basecolor'), ('normal_path', 'normal'),
                                ('height_path', 'height'), ('ambient_occlusion_path', 'ao'),
                                ('roughness_path', 'roughness'), ('metallic_path', 'metallic')]:
            arguments[parameter] = str((maps/(name+'.png')).resolve())
        return self.tool('call', {'tool_slug': self.slug, 'arguments': arguments}, timeout=30)
