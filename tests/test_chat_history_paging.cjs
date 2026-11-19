const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/generation-workspace.html', 'utf8');

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
    chatHeaders: () => ({}), chatUserId: () => 'user', conversationId: '', escapeChat: String, Date,
    splitChatReply: text => ({ reply: text }), visibleReply: String
};
context.window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-conversations.js', 'utf8'), context);
const history = context.window.ChatConversations.create({
    document: context.document, fetch: context.fetch, getOwner: context.chatUserId,
    getHeaders: context.chatHeaders, getConversationId: () => '',
    preview: String, escapeChat: String
});
context.openHistory = history.open;
context.invalidateHistory = history.invalidate;
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
    const count = requests.length;
    const cachedMarkup = markup;
    await context.openHistory(); // cached reopen, retaining all loaded pages
    assert.equal(requests.length, count);
    assert.equal(markup, cachedMarkup);
    await context.openHistory(); // close
    context.invalidateHistory();
    let resolve;
    pending = new Promise(done => { resolve = done; });
    const request = context.openHistory();
    assert.equal(markup, cachedMarkup, 'refresh retains visible rows');
    await context.openHistory(); // close while request is in flight
    const before = markup;
    resolve(response(0, true));
    await request;
    assert.equal(markup, before, 'closed-menu responses must not replace contents');
    console.log('History cache reopens without requests, retains pages, refreshes on changes and ignores stale requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
