const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
const start = html.indexOf("document.addEventListener('click', (event) => {", html.indexOf('function ensurePromptPickerShell'));
const end = html.indexOf("window.addEventListener('resize', placePromptPickerIfOpen)", start);
let handler;
let closed = 0;
const shell = { classList: { contains: () => true } };
vm.runInNewContext(html.slice(start, end), {
    document: { addEventListener: (_, fn) => { handler = fn; } },
    shell, promptPickerIgnoreClick: false, closePromptPicker: () => closed++
});
// 重绘后已脱离面板的侧栏、卡片仍属于原始点击路径。
handler({ target: { closest: () => null }, composedPath: () => [{}, shell] });
assert.equal(closed, 0);
handler({ target: { closest: selector => selector === '#promptPickerBtn' ? null : {} }, composedPath: () => [] });
assert.equal(closed, 0);
handler({ target: { closest: () => null }, composedPath: () => [] });
assert.equal(closed, 1);
console.log('提示词面板关闭事件回归检查通过');

// 可用高度不足时不能强制撑出视口；超宽/偏移输入栏也不能挤出右边界。
const placement = html.slice(html.indexOf('function placePromptPicker(animate)'), html.indexOf('function promptPickerMount()'));
let rect = { left: 100, top: 150, bottom: 250, width: 1000 };
const panel = { style: {}, classList: { contains: () => true } };
const viewport = { offsetLeft: 0, offsetTop: 0, width: 400, height: 600 };
const context = {
    document: {
        getElementById: id => id === 'promptPickerShell' ? panel : { getBoundingClientRect: () => rect },
        body: { classList: { contains: () => true }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400 }), offsetWidth: 400, clientHeight: 600 }
    },
    getComputedStyle: () => ({ transform: 'none' }),
    window: { innerWidth: 400, innerHeight: 600, visualViewport: viewport }
};
vm.createContext(context);
vm.runInContext(placement + ';placePromptPicker(false);', context);
assert.equal(panel.style.left, '12px');
assert.equal(panel.style.width, '376px');
assert.equal(panel.style.height, '130px');
assert.equal(panel.style.bottom, '458px');
// 输入栏增高后重新计算，面板下沿始终距离输入栏 8px。
rect.top = 90;
vm.runInContext('placePromptPickerIfOpen()', context);
assert.equal(panel.style.height, '70px');
assert.equal(panel.style.bottom, '518px');
viewport.width = 280;
vm.runInContext('placePromptPickerIfOpen()', context);
assert.equal(panel.style.width, '256px');
// 全页放大时 fixed 的包含块是 body，写入值需除以缩放倍数。
context.getComputedStyle = () => ({ transform: 'matrix(1.25, 0, 0, 1.25, 0, 0)' });
context.document.body.offsetWidth = 320;
context.document.body.clientHeight = 480;
vm.runInContext('placePromptPickerIfOpen()', context);
assert.equal(Number.parseFloat(panel.style.width) * 1.25, 256);
assert.equal(Number.parseFloat(panel.style.left) * 1.25, 12);
assert.equal(Number.parseFloat(panel.style.height) * 1.25, 70);
assert.ok(Math.abs((480 - Number.parseFloat(panel.style.bottom)) * 1.25 - 82) < 0.001);
console.log('提示词面板响应式定位回归检查通过');
