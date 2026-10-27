// LoRA 兼容别名在内联脚本中绑定，模块必须先执行。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '../static/app/zimage.html'), 'utf8');
const script = page.match(/<script\b[^>]*src="\/static\/modules\/lora-manager\.js[^>]*><\/script>/);
assert.ok(script);
assert.doesNotMatch(script[0], /\b(?:defer|async)\b/, 'LoRA 模块必须先于内联别名执行');
const start = page.indexOf("        if (typeof LoraManager !== 'undefined') {");
const end = page.indexOf('\n            var _loraSyncTriggerWords', start);
assert.ok(script.index < start && end > start);
const workflow = {};
let injected;
const context = vm.createContext({ window: {}, LoraManager: {state: {}, injectNodes: value => { injected = value; }} });
vm.runInContext(page.slice(start, end) + '\n}', context);
context.injectLoraNodes(workflow);
assert.equal(injected, workflow);
console.log('LoRA 加载顺序及生成注入调用检查通过');
