const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
const start = html.indexOf('        function chooseReplacementModel(');
const end = html.indexOf('        async function resolveWorkflowModels', start);
const ctx = {};
vm.runInNewContext(html.slice(start, end), ctx);
const choose = ctx.chooseReplacementModel;
assert.equal(choose('anima\\old.safetensors', ['anima/new.safetensors']), 'anima/new.safetensors');
assert.equal(choose('Krea2/old_turbo.safetensors', ['anima/turbo.safetensors', 'Krea2/base.safetensors']), '');
assert.equal(choose('old.safetensors', ['anima/new.safetensors']), '');
assert.equal(choose('anima/base.safetensors', ['anima/turbo.safetensors', 'ANIMA/BASE.safetensors']), 'ANIMA/BASE.safetensors');
assert.equal(choose('anima/base.safetensors', []), '');
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["'](?:module|application\/json)/.test(m[1])) new Function(m[2]);
}
console.log('缺失模型替换与脚本语法检查通过');
