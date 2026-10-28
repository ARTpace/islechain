import asyncio
import time
import unittest

from tools.performance_timing import PerformanceTimingMiddleware


class PerformanceTimingTests(unittest.TestCase):
    def test_timing_detects_blocking_and_preserves_streaming_body(self):
        async def check(blocking):
            sent = []
            async def app(scope, receive, send):
                if blocking:
                    time.sleep(0.2)
                else:
                    await asyncio.sleep(0.2)
                await send({'type': 'http.response.start', 'status': 200, 'headers': [(b'server-timing', b'upstream;dur=2')]})
                await send({'type': 'http.response.body', 'body': b'first', 'more_body': True})
                await send({'type': 'http.response.body', 'body': b'last', 'more_body': False})
            async def send(message):
                sent.append(message)
            async def receive():
                return {'type': 'http.disconnect'}
            await PerformanceTimingMiddleware(app, 'test-boot')(
                {'type': 'http', 'method': 'GET', 'path': '/test'}, receive, send)
            headers = sent[0]['headers']
            timings = ', '.join(v.decode() for k, v in headers if k.lower() == b'server-timing')
            self.assertIn('upstream;dur=2', timings)
            self.assertIn((b'x-artcanvas-boot', b'test-boot'), headers)
            self.assertEqual([row.get('body') for row in sent[1:]], [b'first', b'last'])
            self.assertTrue(sent[1]['more_body'])
            lag = float(timings.split('loop;dur=')[1])
            if blocking:
                self.assertGreater(lag, 80)
            else:
                self.assertLess(lag, 80)
        asyncio.run(check(False))
        asyncio.run(check(True))


if __name__ == '__main__':
    unittest.main()
