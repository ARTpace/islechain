const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/index.html', 'utf8');
const saved = new Map();
const nav = { children: [], appendChild(node) {
    this.children = this.children.filter(child => child !== node);
    this.children.push(node);
} };
const apps = { id: 'nav-comfy', parentNode: nav };
const nodes = new Map();
const context = { window: {}, localStorage: {
    getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value)
}, document: {
    querySelector: selector => selector === '.sidebar-nav' ? nav : nodes.get(selector.match(/data-module="([^"]+)"/)?.[1]),
    getElementById: id => id === 'nav-comfy' ? apps : null
} };
vm.createContext(context);
const start = html.indexOf('        window.FeatureModules = {');
vm.runInContext(html.slice(start, html.indexOf('        FeatureModules.ready =', start)), context);
const mods = context.window.FeatureModules;
mods.groups[0].items.forEach(item => nodes.set(item.id, { id: item.id, parentNode: nav }));
nav.children = [...nodes.values(), apps];
mods.access = { visitor: false, guest_disabled: [] };
const groupsBefore = JSON.stringify(mods.groups);
mods.moveTo('apps', 'chat-gen', false);
assert.equal(nav.children[0], apps);
assert.equal(mods.orderedGroups(true)[0].items[0].id, 'apps');
assert.equal(mods.firstOn(), 'chat-gen');
assert(!mods.orderedGroups()[0].items.some(item => item.id === 'apps'));
mods.move('apps', 1);
assert.equal(nav.children[1], apps);
mods.moveTo('apps', 'asset-manager', true);
assert.equal(nav.children.at(-1), apps);
assert.equal(mods.orderedGroups(true)[0].items.at(-1).id, 'apps');
assert.equal(JSON.stringify(mods.groups), groupsBefore);
assert.equal(saved.get(mods.key), undefined);
assert.deepEqual(mods.access.guest_disabled, []);
console.log('应用排序、导航同步、持久化读取与权限隔离检查通过');

// 不发送任何原生 drag/drop 事件，验证 WebView 指针拖动路径。
const handlers = new Map();
nav.addEventListener = (type, fn) => handlers.set(type, fn);
nav.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
nav.scrollTop = 0;
for (const node of nav.children) {
    node.dataset = { module: node.id };
    node.events = {};
    node.matches = () => true;
    node.addEventListener = (type, fn) => { node.events[type] = fn; };
    node.classList = { add() {}, remove() {} };
    node.getBoundingClientRect = () => ({ top: 100, height: 40 });
    node.closest = () => node;
    node.setPointerCapture = () => {};
    node.hasPointerCapture = () => true;
    node.releasePointerCapture = () => {};
}
let releaseClick;
context.setTimeout = fn => { releaseClick = fn; };
const target = nodes.get('chat-gen');
context.document.elementFromPoint = () => target;
vm.runInContext(fs.readFileSync('static/js/sidebar-order.js', 'utf8'), context);
assert(nav.children.every(node => !node.draggable));
let prevented = 0;
const event = { button: 0, pointerId: 1, clientX: 20, clientY: 101, preventDefault() { prevented++; }, stopImmediatePropagation() {} };
handlers.get('click')(event);
assert.equal(prevented, 0);
apps.events.pointerdown(event);
apps.events.pointermove({...event, clientY: 103});
assert.equal(prevented, 0);
apps.events.pointermove({...event, clientY: 110});
apps.events.pointerup({...event, type: 'pointerup'});
assert.equal(nav.children[0], apps);
assert.equal(mods.orderedGroups(true)[0].items[0].id, 'apps');
handlers.get('click')(event);
assert.equal(prevented, 2);
releaseClick();
handlers.get('click')(event);
assert.equal(prevented, 2);
// 取消拖动不能修改排序。
const savedOrder = saved.get('studio_feature_module_order');
apps.events.pointerdown(event);
apps.events.pointermove({...event, clientY: 130});
apps.events.pointercancel({...event, type: 'pointercancel'});
assert.equal(saved.get('studio_feature_module_order'), savedOrder);
mods.applyOrder();
assert.equal(nav.children[0], apps);
console.log('指针拖动、阈值、点击隔离、取消和顺序恢复检查通过');
