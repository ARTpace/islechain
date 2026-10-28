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
