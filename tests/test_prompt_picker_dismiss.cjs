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
