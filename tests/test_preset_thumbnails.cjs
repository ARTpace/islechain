const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app/preset-thumbnails.js', 'utf8');
let observer;
class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.observed = new Set(); observer = this; }
    observe(img) { this.observed.add(img); }
    unobserve(img) { this.observed.delete(img); }
    disconnect() { this.observed.clear(); }
}
function image(id) {
    const listeners = {};
    return {
        dataset: { presetSrc: 'https://example.com/' + id + '?stable=1' }, isConnected: true,
        addEventListener(type, fn) { listeners[type] = fn; },
        removeEventListener(type) { delete listeners[type]; },
        finish(type = 'load') { listeners[type](); }
    };
}
let images = Array.from({ length: 8 }, (_, i) => image(i));
const root = { contains: img => images.includes(img), querySelectorAll: () => images.filter(img => img.dataset.presetSrc) };
const context = { IntersectionObserver: Observer };
vm.runInNewContext(source, context);
const loader = context.createPresetThumbnailLoader(root);
loader.watch();
assert.equal(images.filter(img => img.src).length, 0, '观察到附近图片前不发请求');
assert.equal(observer.options.root, root);
assert.equal(observer.options.rootMargin, '400px 0px');
const entry = (img, top, visible = true) => ({ target: img, isIntersecting: visible, boundingClientRect: { top }, rootBounds: { top: -400 } });
observer.callback(images.map((img, i) => entry(img, 700 - i * 100)));
assert.equal(images.filter(img => img.src).length, 4, '最多四张并发');
assert.equal(images[7].src, 'https://example.com/7?stable=1', '优先屏幕附近，URL 保持稳定');
observer.callback([entry(images[0], 700, false)]);
images[7].finish('error');
assert.ok(images[3].src, '失败也会释放队列');
assert.equal(images[0].src, undefined, '移出预加载区域不再排队');
const previous = images;
loader.reset();
images = [image('new')];
loader.watch();
observer.callback([entry(images[0], 0)]);
assert.equal(images[0].src, undefined, '重绘后仍计入旧请求，避免突破并发上限');
previous[6].finish();
assert.ok(images[0].src);
assert.equal(previous[1].src, undefined, '重绘后丢弃旧队列');
const fallback = {};
vm.runInNewContext(source, fallback);
images = Array.from({ length: 6 }, (_, i) => image(i));
const fallbackLoader = fallback.createPresetThumbnailLoader(root);
fallbackLoader.watch();
assert.equal(images.filter(img => img.src).length, 4, '不支持观察器时仍限制并发');
images[0].finish();
assert.ok(images[4].src);
console.log('风格缩略图：按需加载、优先级、并发、失败恢复、重绘清理及兼容回退检查通过');
