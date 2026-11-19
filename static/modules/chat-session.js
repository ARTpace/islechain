/* Chat transport and wait lifetime; rendering and generation decisions belong to callers. */
(function (root) {
    'use strict';
    function createWaitMonitor({controller, onWait}) {
        const startedAt = Date.now();
        let lastEventAt = startedAt, timedOut = false, stopped = false;
        let ticker, watchdog;
        function stop() {
            if (stopped) return;
            stopped = true;
            clearInterval(ticker);
            clearInterval(watchdog);
            controller.signal.removeEventListener('abort', stop);
            onWait(null);
        }
        const monitor = {
            activity() { if (!stopped) lastEventAt = Date.now(); },
            stop,
            get timedOut() { return timedOut; }
        };
        if (controller.signal.aborted) { stop(); return monitor; }
        controller.signal.addEventListener('abort', stop, {once: true});
        ticker = setInterval(() => {
            if (!stopped) onWait(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        watchdog = setInterval(() => {
            if (stopped || Date.now() - lastEventAt < 120000) return;
            timedOut = true;
            stop();
            controller.abort();
        }, 5000);
        return monitor;
    }
    async function request({fetch, signal, headers, payload, unavailableError}) {
        let response;
        try {
            response = await fetch('/api/chat/stream', {
                signal, method: 'POST', headers, body: JSON.stringify(payload)
            });
        } catch (error) {
            if (signal?.aborted) throw error;
            throw unavailableError(error?.message || '无法连接对话服务');
        }
        if (response.ok) return response;
        let detail = '对话失败';
        try { detail = (await response.json()).detail || detail; } catch (_) {}
        const text = typeof detail === 'string' ? detail : '对话失败';
        const message = text.match(/"message"\s*:\s*"([^"]+)"/);
        const failure = unavailableError(message ? message[1] : text.slice(0, 180));
        failure.status = response.status;
        // Invalid input and expired local login must never trigger image-generation fallback.
        if (response.status === 422 || ((response.status === 401 || response.status === 403)
            && /登录|login|未授权|unauthorized/i.test(failure.message))) throw new Error(failure.message);
        throw failure;
    }
    async function* readEvents(response, signal) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', completed = false;
        const abort = () => { reader.cancel().catch(() => {}); };
        const check = () => { if (signal?.aborted) throw signal.reason || new Error('请求已取消'); };
        function parse(block) {
            const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).replace(/^ /, '')).join('\n');
            return !data || data.trim() === '[DONE]' ? null : JSON.parse(data);
        }
        signal?.addEventListener('abort', abort, {once: true});
        try {
            check();
            while (true) {
                const {value, done} = await reader.read();
                check();
                buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
                let match;
                while ((match = /\r?\n\r?\n/.exec(buffer))) {
                    const block = buffer.slice(0, match.index);
                    buffer = buffer.slice(match.index + match[0].length);
                    const event = parse(block);
                    if (event) yield event;
                    check();
                }
                if (done) {
                    const event = parse(buffer);
                    if (event) yield event;
                    completed = true;
                    break;
                }
            }
        } finally {
            signal?.removeEventListener('abort', abort);
            if (!completed) await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
    root.ChatSession = {request, readEvents, createWaitMonitor};
})(window);
