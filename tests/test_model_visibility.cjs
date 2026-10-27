// 检查偏好持久化、跨页面通知、菜单过滤及全部隐藏后的恢复。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const memory = new Map();
const events = {};
const window = {
    addEventListener: (name, callback) => (events[name] ||= []).push(callback),
    dispatchEvent: event => (events[event.type] || []).forEach(callback => callback(event)),
};
const storage = {
    getItem: key => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
};
const context = vm.createContext({window, localStorage: storage, Event: class {constructor(type) {this.type = type;}}});
const shared = fs.readFileSync(path.join(root, 'static/modules/model-visibility.js'), 'utf8');
vm.runInContext(shared, context);
const visibility = window.ModelVisibility;
assert.equal(visibility.isVisible('text:Qwen'), true);
let notifications = 0;
visibility.subscribe(() => notifications++);
visibility.setVisible('text:Qwen', false);
assert.equal(visibility.isVisible('text:Qwen'), false);
assert.equal(notifications, 1);
const second = vm.createContext({window: {...window}, localStorage: storage});
vm.runInContext(shared, second);
assert.equal(second.window.ModelVisibility.isVisible('text:Qwen'), false);
window.dispatchEvent({type:'storage', key:'comfy_hidden_models'});
assert.equal(notifications, 2);

function functionSource(source, name, next = '\n        function ') {
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf(next, start + 1);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}
const textPage = fs.readFileSync(path.join(root, 'static/app/zimage.html'), 'utf8');
const editPage = fs.readFileSync(path.join(root, 'static/app/klein.html'), 'utf8');
for (const page of [textPage, editPage]) {
    for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2]);
    }
}
new vm.Script(fs.readFileSync(path.join(root, 'static/modules/settings.js'), 'utf8'));
Object.assign(context, {
    ModelVisibility: visibility,
    BUILTIN_WF_META: [
        {name:'text2image/qwen.json', title:'Qwen', has_unet:true},
        {name:'text2image/moss.json', title:'MOSS', has_unet:true},
        {name:'text2image/moss-base.json', title:'MOSS', has_unet:true},
        {name:'video/tool.json', title:'Tool', has_unet:true},
    ],
    currentWorkflow: 'text2image/qwen.json',
    renderModelMenu() {}, renderUnifiedModelMenu() {}, updateUnifiedModelLabel() {},
    _wfMeta: () => context.BUILTIN_WF_META.find(model => model.name === context.currentWorkflow),
    switchWorkflow: name => {context.currentWorkflow = name;},
});
vm.runInContext(functionSource(textPage, 'localWorkflowItems'), context);
vm.runInContext(functionSource(textPage, 'syncVisibleModels'), context);
assert.deepEqual(Array.from(context.localWorkflowItems(), model => model.title), ['MOSS']);
context.syncVisibleModels();
assert.equal(context.currentWorkflow, 'text2image/moss.json');
visibility.setVisible('text:MOSS', false);
context.syncVisibleModels();
assert.equal(context.currentWorkflow, '');
visibility.setVisible('text:Qwen', true);
context.syncVisibleModels();
assert.equal(context.currentWorkflow, 'text2image/qwen.json');

const buttons = Object.fromEntries(Object.keys(visibility.editModels).map(model => [
    'btnModel' + model.charAt(0).toUpperCase() + model.slice(1),
    {style:{}, classList:{toggle() {}}},
]));
Object.assign(context, {
    activeModels:['qwen21'], document:{getElementById: id => buttons[id]}, refreshSlotLabels() {},
});
vm.runInContext(functionSource(editPage, 'applyModelVisibility', '        ModelVisibility.subscribe'), context);
visibility.setVisible('edit:qwen21', false);
context.applyModelVisibility();
assert.equal(buttons.btnModelQwen21.style.display, 'none');
assert.equal(context.activeModels.includes('qwen21'), false);
for (const model of Object.keys(visibility.editModels)) visibility.setVisible('edit:' + model, false);
context.applyModelVisibility();
assert.equal(context.activeModels.length, 0);
visibility.setVisible('edit:moss', true);
context.applyModelVisibility();
assert.deepEqual(Array.from(context.activeModels), ['moss']);
assert.equal(buttons.btnModelMoss.style.display, '');
console.log('模型显示设置：持久化、页面通知、菜单过滤、隐藏当前模型及全部隐藏后恢复通过。');
