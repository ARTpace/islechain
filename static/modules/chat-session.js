/* SSE transport only: rendering, persistence and generation decisions belong to callers. */
(function (root) {
    'use strict';
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
    root.ChatSession = {readEvents};
})(window);
