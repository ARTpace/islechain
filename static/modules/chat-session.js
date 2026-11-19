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
    root.ChatSession = {readEvents, createWaitMonitor};
})(window);
