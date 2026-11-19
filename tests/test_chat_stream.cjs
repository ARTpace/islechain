const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const timers = new Map();
let timerId = 0;
const context = {
    window: {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/modules/chat-transcript.js', 'utf8'), context);
function flush() {
    let budget = 100;
    while (timers.size) {
        assert(budget-- > 0, 'stream must eventually settle');
        const [id, fn] = timers.entries().next().value;
        timers.delete(id); fn();
    }
}
async function run() {
    const a = [], b = [];
    let updates = 0;
    const first = context.window.ChatTranscript.createReplyStream({paint:text=>a.push(text),onUpdate:()=>updates++});
    const second = context.window.ChatTranscript.createReplyStream({paint:text=>b.push(text)});
    first.push('第一条🐱回复'); second.push('另一个会话');
    const finished = first.finish();
    flush(); await finished;
    assert.equal(a.at(-1), '第一条🐱回复');
    assert.equal(b.at(-1), '另一个会话');
    assert.equal(updates, a.length);
    assert(a.every(text=>!/[\uD800-\uDBFF]$/.test(text)), 'do not split emoji');
    first.push('替换后的内容');
    flush();
    assert.equal(a.at(-1), '替换后的内容', 'a rewritten response resets displayed text');
    first.push('替换后的内容，继续');
    const cancelled = first.finish();
    const before = a.length;
    first.stop(); await cancelled;
    flush();
    assert.equal(a.length, before, 'cancel must prevent pending paints');
    assert.equal(timers.size, 0);
    await second.finish();
    console.log('Reply stream: isolated instances, Unicode, rewrites, finish and cancellation passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
