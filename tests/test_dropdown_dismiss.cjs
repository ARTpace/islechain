const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/zimage.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('        function dismissStudioMenus(event) {');
const end = html.indexOf('        function ensurePromptPickerShell()', start);
let handler;
let keyHandler;
let historyClosed = 0;
let aiClosed = 0;
const modelMenu = { hidden: false };
vm.runInNewContext(html.slice(start, end), {
    document: {
        addEventListener(name, fn, capture) {
            if (name === 'keydown') { keyHandler = fn; return; }
            assert.equal(capture, true); handler = fn;
        },
        getElementById(id) {
            if (id === 'chatHistory') return { classList: { remove() { historyClosed++; } } };
            if (id === 'chatModelMenu') return modelMenu;
            return null;
        },
        querySelector() { return { classList: { remove() { aiClosed++; } } }; },
        querySelectorAll() { return []; }
    }
});
handler({ composedPath: () => [{ matches: selector => selector === '.chat-model-control' }] });
assert.equal(modelMenu.hidden, false, '点击模型菜单内部不关闭自身');
assert.equal(historyClosed, 1, '点击模型控件关闭历史菜单');
assert.equal(aiClosed, 1, '点击模型控件关闭 AI 设定菜单');
handler({ composedPath: () => [] });
assert.equal(modelMenu.hidden, true, '点击空白关闭模型菜单');
modelMenu.hidden = false;
keyHandler({ key: 'Escape', isComposing: true });
assert.equal(modelMenu.hidden, false, '中文输入法组词时不关闭菜单');
keyHandler({ key: 'Escape' });
assert.equal(modelMenu.hidden, true, 'Esc 关闭模型菜单');
console.log('下拉菜单互斥与空白关闭检查通过');
