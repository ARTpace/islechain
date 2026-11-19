const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/generation-workspace.html', 'utf8');
assert.match(html, /nsfwEnabled:\s*false/);
// 禁用后既不构建按钮，也不初始化过滤器、恢复旧过滤偏好。
const extras = fs.readFileSync('static/modules/gallery/toolbar-extras.js', 'utf8');
const disabled = { window: { GalleryDisplay: { Base: {} } }, console };
disabled.window.window = disabled.window;
vm.runInNewContext(extras, { ...disabled, globalThis: disabled.window });
const toolbarExtras = disabled.window.GalleryDisplay.ToolbarExtras;
toolbarExtras._config = { nsfwEnabled: false };
assert(!toolbarExtras._buildButtons().some(button => button.id === 'nsfw-toggle'));
const host = () => ({ appendChild(button) { button.parentElement = this; } });
const topbar = host(), header = host(), toolbar = host();
let open = false, observer;
const drawer = {
    classList: { contains: () => open, toggle() { return open = !open; } },
    querySelector: selector => selector === '.history-bulk-toolbar' ? toolbar : header,
};
const galleryBtn = { classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; } };
const ctx = { drawer, galleryBtn, topbar, MutationObserver: class {
    constructor(fn) { observer = fn; }
    observe() {}
} };
const start = html.indexOf('            function syncGalleryDrawer()');
vm.runInNewContext(html.slice(start, html.indexOf('            const seen =', start)), ctx);
assert.equal(galleryBtn.parentElement, topbar);
galleryBtn.onclick();
assert.equal(galleryBtn.parentElement, toolbar);
assert.equal(galleryBtn['aria-expanded'], 'true');
galleryBtn.onclick();
assert.equal(galleryBtn.parentElement, topbar);
assert.equal(galleryBtn['aria-expanded'], 'false');
open = true; observer();
assert.equal(galleryBtn.parentElement, toolbar);
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc\s*=|type\s*=\s*["'](?:module|application\/json)/.test(script[1])) new Function(script[2]);
}
console.log('图库开关迁移、外部打开同步和页面脚本语法检查通过');
