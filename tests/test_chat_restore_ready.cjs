const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('static/app/zimage.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.lastIndexOf("            if (document.readyState === 'loading')");
const end = html.indexOf('\n        }\n    </script>', start);
for (const readyState of ['loading', 'interactive', 'complete']) {
    let restored = 0;
    let onReady;
    vm.runInNewContext(html.slice(start, end), {
        document: { readyState, addEventListener(name, fn, options) {
            assert.equal(name, 'DOMContentLoaded');
            assert.equal(options.once, true);
            onReady = fn;
        } },
        restoreChat() { restored++; }
    });
    if (readyState === 'loading') {
        assert.equal(restored, 0, '组件未就绪时不得恢复图片');
        onReady();
    }
    assert.equal(restored, 1);
}
assert.match(html, /async function restoreChat\(\)[\s\S]*?await loadConversation\(id\)/);
console.log('对话刷新恢复时序检查通过');
