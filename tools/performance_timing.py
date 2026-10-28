"""加载诊断：请求响应头耗时、事件循环延迟，兼容流式响应。"""
import asyncio
import logging
import re
import time

from starlette.datastructures import MutableHeaders


class PerformanceTimingMiddleware:
    def __init__(self, app, boot_id):
        self.app = app
        self.boot_id = boot_id

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('method') not in {'GET', 'HEAD'}:
            return await self.app(scope, receive, send)
        start = checkpoint = time.perf_counter()
        lag = 0.0
        headers_ms = None

        def sample():
            nonlocal lag
            lag = max(lag, time.perf_counter() - checkpoint - 0.1, 0.0)

        async def heartbeat():
            nonlocal checkpoint
            while True:
                await asyncio.sleep(0.1)
                sample()
                checkpoint = time.perf_counter()

        async def timed_send(message):
            nonlocal headers_ms
            if message['type'] == 'http.response.start':
                sample()
                headers_ms = (time.perf_counter() - start) * 1000
                headers = MutableHeaders(scope=message)
                headers.append('Server-Timing', f'app;dur={headers_ms:.1f}, loop;dur={lag * 1000:.1f}')
                headers['X-ArtCanvas-Boot'] = self.boot_id
                headers['X-ArtCanvas-Perf'] = '20261027-2'
            await send(message)

        monitor = asyncio.create_task(heartbeat())
        try:
            await self.app(scope, receive, timed_send)
        finally:
            sample()
            monitor.cancel()
            try:
                await monitor
            except asyncio.CancelledError:
                pass
            total_ms = (time.perf_counter() - start) * 1000
            if total_ms >= 500:
                path = re.sub(r'(/api/conversations/)[^/]+', r'\1:id', scope['path'])
                logging.getLogger('uvicorn.error').warning(
                    '[LoadPerf] %s %s headers_ms=%s total_ms=%.1f loop_lag_ms=%.1f boot=%s',
                    scope['method'], path, headers_ms, total_ms, lag * 1000, self.boot_id)
