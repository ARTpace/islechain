const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const timers = new Map(), events = {};
let id = 0, calls = 0, resolve, errors = 0;
const window = {
    document: {querySelectorAll:() => [], addEventListener(){}, removeEventListener(){}},
    addEventListener:(name, fn) => events[name]=fn, removeEventListener(){},
    setTimeout:fn => {timers.set(++id, fn); return id;}, clearTimeout:id => timers.delete(id)
};
vm.runInNewContext(fs.readFileSync('static/modules/page-lifecycle.js','utf8'), {window});
const life = window.PageLifecycle;
async function tick() {
    assert.equal(timers.size, 1);
    const [id, fn] = [...timers][0]; timers.delete(id);
    return fn();
}
(async () => {
    const stop = life.poll(() => {calls++; return new Promise(done => resolve=done);}, 100);
    assert.equal(life.canDispose(), false, 'polling does not prove drafts/tasks safe to evict');
    const pending = tick();
    assert.equal(calls, 1); assert.equal(timers.size, 0, 'no overlapping async request');
    life.setActive(false); life.setActive(true);
    assert.equal(timers.size, 0, 'resume waits for the in-flight request');
    resolve(); await pending;
    assert.equal(timers.size, 1);
    life.setActive(false); assert.equal(timers.size, 0);
    life.setActive(true); assert.equal(timers.size, 1);
    stop(); stop(); assert.equal(timers.size, 0);
    life.poll(() => {throw new Error('offline');}, 100, {onError:() => errors++});
    await tick(); assert.equal(errors, 1); assert.equal(timers.size, 1);
    events.pagehide({persisted:false}); assert.equal(timers.size, 0);
    console.log('Inactive polling, async serialization, errors and disposal passed');
})().catch(error => {console.error(error); process.exitCode=1;});
