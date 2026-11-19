const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = {}, frames = [];
const window = {
    document: {querySelectorAll: () => frames, addEventListener: (name, fn) => events['doc:'+name] = fn,
        removeEventListener: name => delete events['doc:'+name]},
    addEventListener: (name, fn) => events[name] = fn,
    removeEventListener: name => delete events[name]
};
vm.runInNewContext(fs.readFileSync('static/modules/page-lifecycle.js', 'utf8'), {window});
const life = window.PageLifecycle;
assert.equal(life.canDispose(), false, 'unknown pages must not be evicted');
let activated = 0, deactivated = 0, disposed = 0, busy = false;
const unregister = life.register({activate: () => activated++, deactivate: () => deactivated++,
    dispose: () => disposed++, canDispose: () => !busy});
assert.equal(activated, 1);
life.setActive(false); life.setActive(false);
assert.equal(deactivated, 1, 'duplicate transitions do not duplicate hooks');
let childActive;
const child = {tagName: 'IFRAME', id: 'frame-child', classList: {contains: () => true},
    contentWindow: {PageLifecycle: {setActive: value => childActive = value, canDispose: () => !busy}}};
frames.push(child);
events['doc:load']({target: child});
assert.equal(childActive, false, 'late iframe loads inherit inactive parent');
life.setActive(true);
assert.equal(childActive, true);
busy = true;
assert.equal(life.canDispose(), false);
assert.equal(life.canReleaseFrame(child), false);
assert.equal(life.canReleaseFrame({contentWindow: {}}), false);
busy = false;
assert.equal(life.canReleaseFrame(child), true);
events.pagehide({persisted: true});
assert.equal(disposed, 0, 'bfcache keeps mounted components');
events.pagehide({persisted: false});
assert.equal(disposed, 1);
assert.equal(Object.keys(events).length, 0);
unregister();
console.log('Cached-frame activation, task protection and cleanup passed');
