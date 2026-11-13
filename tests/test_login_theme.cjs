// 登录页昼夜边界、跨日与后台恢复；不触碰账号或工作台主题存储。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/login-theme.js', 'utf8');
let now;
let callback;
let delay;
let activeTimers = 0;
const events = {};
const root = { dataset: {}, classList: { toggle(name, enabled) { root[name] = enabled; } } };
const meta = {};
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
const context = {
 Date: Clock,
 document: { documentElement: root, hidden: false, querySelector: () => meta, addEventListener: (name, fn) => { events[name] = fn; } },
 window: {
  setTimeout(fn, ms) { callback = fn; delay = ms; activeTimers++; return 1; },
  clearTimeout(id) { if (id) activeTimers--; },
  addEventListener(name, fn) { events[name] = fn; }
 }
};
now = new Date(2026, 10, 11, 17, 59, 59).getTime();
vm.runInNewContext(source, context);
assert.equal(root.dataset.loginTheme, 'day');
assert.equal(delay, 1000);
for (const [hour, minute, second, expected] of [[18,0,0,'night'], [23,59,59,'night'], [0,0,0,'night'], [5,59,59,'night'], [6,0,0,'day'], [12,0,0,'day']]) {
 now = new Date(2026, 10, 12, hour, minute, second).getTime();
 callback();
 assert.equal(root.dataset.loginTheme, expected);
 assert.equal(root['studio-theme-dark'], expected === 'night');
 assert.equal(meta.content, expected === 'night' ? 'dark' : 'only light');
 assert.equal(activeTimers, 1);
 assert.ok(delay > 0 && delay <= 60000);
 if (hour === 5) assert.equal(delay, 1000);
}
now = new Date(2026, 10, 12, 19).getTime();
events.visibilitychange();
assert.equal(root.dataset.loginTheme, 'night');
now = new Date(2026, 10, 13, 9).getTime();
events.pageshow();
assert.equal(root.dataset.loginTheme, 'day');
events.focus();
assert.equal(activeTimers, 1);
assert.ok(!source.includes('localStorage'));
const html = fs.readFileSync('static/login.html', 'utf8');
assert.ok(html.indexOf('/static/js/login-theme.js') < html.indexOf('rel="stylesheet"'));
console.log('login theme: local-time boundaries, midnight, resume and early initialization passed');
