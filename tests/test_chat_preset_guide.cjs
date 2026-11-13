const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = {window:{},document:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync('static/modules/chat-preset-guide.js', 'utf8'), context);
const guide = context.window.ChatPresetGuide;
const preset = JSON.parse(fs.readFileSync('prompt/presets/preset-scene-nine-grid.json', 'utf8'));
assert.match(guide.missing(preset, '生成九宫格', []), /资产整合图/);
for (const text of ['怎么生成九宫格', '生成九宫格提示词', '不要生图，只写提示词', '你好']) assert.equal(guide.missing(preset, text, []), '', text);
assert.equal(guide.missing(preset, '生成九宫格', [{url:'image'}]), '');
assert.match(guide.missing(preset, '生成九宫格', [{url:'image',name:'布局参考 · layout.jpg'}]), /资产整合图/);
assert.equal(guide.missing(preset, '生成九宫格', [{url:'image',name:'可用资产 · assets.jpg'}]), '');
assert.equal(guide.missing(null, '生成九宫格', []), '');
assert.equal(guide.annotate([{url:'image',name:'原图'}])[0].name, '原图');
for (const name of ['concept','nine-grid','ground','ground-cleanup','local-edit']) {
    const item = JSON.parse(fs.readFileSync('prompt/presets/preset-scene-' + name + '.json', 'utf8'));
    assert.ok(item.guide.example && item.guide.output && item.guide.inputs.length);
    for (const [id] of item.guide.cases || []) assert.ok(fs.existsSync('static/assets/scene-examples/' + id + '.jpg'));
}
console.log('预设缺图提示、提示词/讨论放行、引用保留和案例资源检查通过');
