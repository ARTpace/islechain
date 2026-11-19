const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-conversations.js', 'utf8'), {window, AbortController});
(async () => {
    const requests = [], applied = [];
    let owner = 'one', busy = false;
    const loader = window.ChatConversations.createLoader({
        fetch: (url, options) => new Promise(resolve => requests.push({url, options, resolve})),
        getHeaders: () => ({user: owner}), getOwner: () => owner, isBusy: () => busy,
        onLoaded: (data, id) => applied.push(id)
    });
    const respond = index => requests[index].resolve({ok: true, json: async () => ({conversation: {}})});
    const first = loader.load('first');
    const second = loader.load('second');
    assert.equal(requests[0].options.signal.aborted, true);
    respond(1); await second;
    respond(0); await first;
    assert.deepEqual(applied, ['second'], 'late response cannot replace latest selection');
    const third = loader.load('third'); loader.cancel(); respond(2); await third;
    assert.deepEqual(applied, ['second'], 'new conversation invalidates pending load');
    const fourth = loader.load('fourth'); owner = 'two'; respond(3); await fourth;
    assert.deepEqual(applied, ['second'], 'account changes invalidate old responses');
    const fifth = loader.load('fifth'); busy = true; respond(4); await fifth;
    assert.deepEqual(applied, ['second'], 'a running generation cannot be overwritten');
    assert.equal(await loader.load('blocked'), false);
    assert.equal(requests.length, 5);
    busy = false;
    const failure = loader.load('missing'); requests[5].resolve({ok: false});
    assert.equal(await failure, false);
    console.log('Conversation selection, new chat, account and task isolation passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
