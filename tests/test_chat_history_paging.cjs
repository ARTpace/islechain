const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
const start = html.indexOf('            let historyOffset = 0;');
const end = html.indexOf('            async function loadConversation(', start);
let open = false, more = null, markup = '', pending;
const requests = [];
const panel = {
    style: {},
    classList: { toggle() { return open = !open; }, contains() { return open; } },
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; more = null; },
    querySelector() { return more; },
    querySelectorAll() { return []; },
    insertAdjacentHTML(_, value) { markup += value; },
    appendChild(node) { more = node; }
};
const context = {
    document: {
        getElementById: id => id === 'chatHistory' ? panel : null,
        createElement: () => ({ dataset: {}, remove() { more = null; } })
    },
    fetch: async url => { requests.push(url); return pending; },
    chatHeaders: () => ({}), conversationId: '', escapeChat: String,
    splitChatReply: text => ({ reply: text }), visibleReply: String
};
vm.runInNewContext(html.slice(start, end), context);
function response(start, has_more) {
    return { ok: true, json: async () => ({ has_more, conversations: Array.from({ length: 20 }, (_, i) => ({ id: start + i, title: `row${start+i}` })) }) };
}
(async () => {
    pending = response(0, true);
    await context.openHistory();
    assert.match(requests[0], /limit=20&offset=0$/);
    assert.ok(more);
    pending = response(20, false);
    await context.openHistory(true);
    assert.match(requests[1], /offset=20$/);
    assert.match(markup, /row0/);
    assert.match(markup, /row39/);
    assert.equal(more, null);
    await context.openHistory(); // close
    let resolve;
    pending = new Promise(done => { resolve = done; });
    const request = context.openHistory();
    await context.openHistory(); // close while request is in flight
    const before = markup;
    resolve(response(0, true));
    await request;
    assert.equal(markup, before, 'closed-menu responses must not replace contents');
    console.log('History pages append, stop at last page and ignore stale requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
