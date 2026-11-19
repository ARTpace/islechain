const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-session.js', 'utf8'), {window, TextDecoder});
function response(text, step = 1) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(new ReadableStream({pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset += step));
    }}));
}
(async () => {
    const events = [];
    for await (const event of window.ChatSession.readEvents(response(':keepalive\r\ndata: {"type":"delta","delta":"你好😀"}\r\n\r\ndata: {"type":"done"}'))) events.push(event);
    assert.equal(events.length, 2);
    assert.equal(events[0].delta, '你好😀');
    assert.equal(events[1].type, 'done', 'final event without separator is retained');
    const multi = [];
    for await (const event of window.ChatSession.readEvents(response('data: {"type":\ndata: "delta"}\n\ndata: [DONE]\n\n'))) multi.push(event);
    assert.equal(multi[0].type, 'delta');
    let cancelled = 0;
    const stream = new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('data: {"type":"delta"}\n\n'));}, cancel() {cancelled++;}});
    const res = new Response(stream);
    for await (const event of window.ChatSession.readEvents(res)) break;
    assert.equal(cancelled, 1, 'early return releases stream');
    assert.equal(res.body.locked, false);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(async () => {for await (const event of window.ChatSession.readEvents(response(''), controller.signal)) {}});
    const bad = response('data: invalid\n\n');
    await assert.rejects(async () => {for await (const event of window.ChatSession.readEvents(bad)) {}});
    assert.equal(bad.body.locked, false, 'parse failures release reader');
    console.log('SSE Unicode, chunk boundaries, CRLF, final event and cancellation passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
