const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
    const listeners = {}, messages = [];
    const prompt = {id:'prompt', value:'原有描述, shared', dispatchEvent(){}};
    const negative = {id:'extraNegativePrompt', value:'原有负面', dispatchEvent(){}};
    const frame = {style:{}, contentWindow:{postMessage:data => messages.push(data)}, addEventListener(){}};
    const document = {
        addEventListener:(name, fn) => {listeners['document:'+name] = fn;},
        createElement:() => frame,
        getElementById:id => ({prompt, extraNegativePrompt:negative, promptPickerBody:{appendChild(){}}})[id],
    };
    const window = {addEventListener:(name, fn) => {listeners[name] = fn;}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/modules/generation-prompt-library.js'), 'utf8'), {
        window, document, location:{origin:'http://localhost'}, Event:class {},
    });
    window.GenerationPromptLibrary.mount('style');
    const toggle = (key, positive, extra = {}) => listeners.message({origin:'http://localhost', source:frame.contentWindow,
        data:{type:'prompt-library:toggle', key, item:{positive, negative:'bad hands'}}, ...extra});
    return {api:window.GenerationPromptLibrary, prompt, negative, frame, toggle, messages, listeners};
}

test('导入与取消只修改本选择器添加的词，保留原有输入和重叠词', () => {
    const c = load();
    c.toggle('a', 'shared, red');
    c.toggle('b', 'red, blue');
    assert.equal(c.prompt.value, '原有描述, shared, red, blue');
    assert.equal(c.negative.value, '原有负面, bad hands');
    c.toggle('a', 'shared, red');
    assert.equal(c.prompt.value, '原有描述, shared, red, blue');
    c.toggle('b', 'red, blue');
    assert.equal(c.prompt.value, '原有描述, shared');
    assert.equal(c.negative.value, '原有负面');
    assert.equal(c.api.count(), 0);
});

test('拒绝其他窗口或来源的导入，切换分类保留已选状态', () => {
    const c = load();
    c.toggle('a', 'red', {origin:'https://other.example'});
    c.toggle('a', 'red', {source:{}});
    assert.equal(c.api.count(), 0);
    c.toggle('a', 'red');
    c.api.mount('artist');
    assert.equal(c.frame.src, '/static/asset-manager.html?picker=prompt');
    assert.deepEqual(Array.from(c.messages.at(-1).keys), ['a']);
    assert.equal(c.messages.at(-2).view, 'artist');
});

test('用户手动清空输入后取消卡片高亮，不会重新添加已清空内容', () => {
    const c = load();
    c.toggle('a', 'red');
    c.prompt.value = '';
    c.listeners['document:input']({target:c.prompt});
    assert.equal(c.api.count(), 0);
    assert.equal(c.messages.at(-1).keys.length, 0);
    c.toggle('b', 'blue');
    assert.equal(c.prompt.value, 'blue');
});

test('卡片与预览同一导入键，选用按钮不触发卡片预览', () => {
    const listeners = {}, posted = [];
    const parent = {postMessage:data => posted.push(data)};
    const document = {addEventListener:(type, fn) => {listeners[type] = fn;}, querySelectorAll:() => []};
    const window = {parent, addEventListener:(type, fn) => {listeners[type] = fn;}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/modules/prompt-library-picker.js'), 'utf8'), {
        window, document, location:{origin:'http://localhost', search:'?picker=prompt'}, URLSearchParams,
    });
    const api = window.PromptLibraryPicker;
    const key = 'prompt:system:one';
    const html = api.button(key, {positive:'red'});
    assert.match(html, /aria-pressed="false"/);
    let stopped = false;
    listeners.click({target:{closest:() => ({dataset:{promptImport:key}})}, preventDefault(){}, stopImmediatePropagation(){stopped=true;}});
    assert.ok(stopped);
    assert.equal(posted[0].key, key);
    listeners.message({origin:'http://localhost', source:parent, data:{type:'prompt-library:state', keys:[key]}});
    assert.match(api.button(key, {positive:'red'}), /aria-pressed="true"/);
});

test('共享尺寸默认 240，保存后所有库读取同一个值，忽略非法值', () => {
    const saved = new Map();
    const storage = {getItem:key => saved.get(key), setItem:(key, value) => saved.set(key, value)};
    function gallery() {
        const context = {window:{}, localStorage:storage};
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/modules/prompt-gallery-ui.js'), 'utf8'), context);
        return context.window.PromptGalleryUI;
    }
    assert.equal(gallery().cardSize(), 240);
    gallery().cardSize(320);
    assert.equal(gallery().cardSize(), 320);
    assert.equal(gallery().cardSize(999), 240);
    assert.equal(gallery().cardSize(), 320);
});
