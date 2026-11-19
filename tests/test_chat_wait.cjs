const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 0, nextId = 0;
const timers = new Map();
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-session.js', 'utf8'), {
    window, TextDecoder, Date: {now: () => now},
    setInterval(fn, ms) { const id = ++nextId; timers.set(id, {fn, ms, at: now + ms}); return id; },
    clearInterval(id) { timers.delete(id); }
});
function advance(ms) {
    const end = now + ms;
    while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (timer.at > end) break;
        now = timer.at;
        timer.at += timer.ms;
        timer.fn();
    }
    now = end;
}
function start(controller = new AbortController()) {
    const updates = [], listeners = new Set();
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (name, fn, options) => { listeners.add(fn); add(name, fn, options); };
    signal.removeEventListener = (name, fn) => { listeners.delete(fn); remove(name, fn); };
    const monitor = window.ChatSession.createWaitMonitor({controller, onWait: value => updates.push(value)});
    return {controller, monitor, updates, listeners};
}
(async () => {
    const normal = start();
    advance(2000);
    assert.equal(normal.updates.at(-1), 2);
    normal.monitor.stop();
    normal.monitor.stop();
    assert.equal(normal.updates.filter(value => value === null).length, 1);
    assert.equal(timers.size, 0);
    assert.equal(normal.listeners.size, 0);
    advance(180000);
    assert.equal(normal.controller.signal.aborted, false, 'completed SSE cannot time out later image generation');

    const fallback = start();
    const queuedCallbacks = [...timers.values()].map(timer => timer.fn);
    fallback.monitor.stop(); // unavailable model hands off to direct image generation
    advance(180000);
    queuedCallbacks.forEach(fn => fn());
    fallback.monitor.activity();
    assert.equal(fallback.controller.signal.aborted, false, 'old callbacks cannot abort a slow fallback');
    assert.equal(timers.size, 0);

    const progressing = start();
    advance(115000); progressing.monitor.activity();
    advance(115000);
    assert.equal(progressing.controller.signal.aborted, false, 'progress resets the idle deadline');
    advance(5000);
    assert.equal(progressing.monitor.timedOut, true);
    assert.equal(progressing.controller.signal.aborted, true);
    assert.equal(progressing.listeners.size, 0);
    assert.equal(timers.size, 0);

    const stopped = start(), unrelated = start();
    stopped.controller.abort();
    assert.equal(stopped.monitor.timedOut, false, 'user cancellation is not an idle timeout');
    assert.equal(stopped.updates.at(-1), null);
    assert.equal(stopped.listeners.size, 0);
    assert.equal(timers.size, 2, 'cancelling one request must not stop another');
    unrelated.monitor.stop();

    const controller = new AbortController(); controller.abort();
    const alreadyStopped = start(controller);
    assert.equal(timers.size, 0, 'cancelled tasks must not start timers');
    assert.equal(alreadyStopped.listeners.size, 0);

    const hanging = start();
    const response = new Response(new ReadableStream());
    const reading = (async () => {
        for await (const event of window.ChatSession.readEvents(response, hanging.controller.signal)) {}
    })();
    advance(120000);
    await assert.rejects(reading);
    assert.equal(response.body.locked, false, 'idle timeout releases a pending SSE read');
    assert.equal(timers.size, 0);
    assert.equal(hanging.listeners.size, 0);
    console.log('Chat wait: progress, timeout, cancellation, fallback isolation and resource cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
