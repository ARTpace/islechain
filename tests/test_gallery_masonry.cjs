const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
let pending;
const node = (height, card = true) => ({
    style: {}, hidden: false, classList: {contains: name => name === 'masonry-item' && card},
    getBoundingClientRect: () => ({height})
});
const cards = [node(100), node(160), node(90)];
const grid = {children: cards, clientWidth: 420, style: {}, classList: {add() {}}, addEventListener() {}, removeEventListener() {}};
class Observer {observe() {} unobserve() {} disconnect() {}}
const context = {
    window: {GalleryDisplay: {Base: {}}}, console,
    document: {querySelector: () => grid, body: {}},
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame(fn) {pending = fn; return 1;}, cancelAnimationFrame() {},
    getComputedStyle: n => n === grid ? {columnCount: '2', columnGap: '20px'} : {display: n.hidden ? 'none' : 'block'}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/modules/gallery/gallery-core.js', 'utf8'), context);
const core = context.window.GalleryDisplay.GalleryCore;
core.mountMasonry(); pending();
const before = cards.map(n => ({...n.style}));
grid.children.push(node(80)); core._masonryCleanup(); core.mountMasonry(); pending();
cards.slice(0, 3).forEach((n, i) => assert.deepStrictEqual(n.style, before[i]));
assert.equal(grid.children[3].style.top, '180px');
const separator = node(20, false); grid.children.push(separator, node(60));
core._masonryCleanup(); core.mountMasonry(); pending();
assert.equal(separator.style.width, '420px');
assert.equal(grid.children.at(-1).style.top, `${parseFloat(separator.style.top) + 40}px`);
core.destroy();
console.log('瀑布流追加位置稳定、最短列追加、日期分组检查通过');
