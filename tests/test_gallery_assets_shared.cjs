const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('生成页复用真实资产库，校验回传来源后导入参考图并返回图库', () => {
    const listeners = {};
    const frame = {style:{}, contentWindow:{}, hasAttribute:() => !!frame.src};
    const gallery = {style:{}, after:node => assert.equal(node, frame)};
    const imported = [];
    const AssetLibrary = {};
    const window = {AssetLibrary, addEventListener:(name, fn) => { listeners[name] = fn; }};
    const document = {
        body:{classList:{toggle(){}}},
        addEventListener:(name, fn) => { listeners[name] = fn; },
        querySelector:selector => selector === 'main' ? gallery : null,
        getElementById:() => null,
        createElement:() => frame,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/modules/gallery-assets.js'), 'utf8'), {
        window, document, AssetLibrary, location:{origin:'http://localhost'},
        MutationObserver:class { observe(){} },
        applyAssetToRef:(...args) => imported.push(args),
    });
    listeners.DOMContentLoaded();
    AssetLibrary.open();
    assert.equal(frame.src, '/static/asset-manager.html?picker=image');
    assert.equal(frame.hidden, false);
    assert.equal(gallery.hidden, true);
    const event = {origin:'http://localhost', source:frame.contentWindow,
        data:{type:'asset-library:apply', url:'/assets/reference.png', name:'参考图'}};
    listeners.message({...event, origin:'https://other.example'});
    listeners.message({...event, source:{}});
    assert.equal(imported.length, 0);
    listeners.message(event);
    assert.deepEqual(imported, [['/assets/reference.png', '参考图']]);
    assert.equal(frame.hidden, true);
    assert.equal(gallery.hidden, false);
});
