const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const flush = () => new Promise(resolve => setImmediate(resolve));
test('统一包管理分类展示，使用仓库安装更新且没有本地ZIP入口', async () => {
    const calls = []; let click;
    const packs = ['styles','artists','characters','tags'].map(kind => ({kind, packId:kind, name:kind + '<x>',version:'1.0.1',entryCount:1,installed:kind==='artists',updateAvailable:kind==='artists'}));
    const host = {innerHTML:'',addEventListener:(_,fn) => click=fn};
    const ctx = {Event:class {},window:{prompt:()=>'https://github.com/ARTpace/Art-prompt-library',confirm:()=>true,dispatchEvent:()=>{}},fetch:async (url,options={}) => {
        calls.push({url,...options});
        return {ok:true,json:async () => url.includes('repository') ? {url:'https://github.com/ARTpace/Art-prompt-library',packs} : {installed:url.includes('artists') ? [{packId:'artists',version:'1.0.0'}] : [],packs:[]}};
    }};
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../static/modules/content-pack-manager.js'),'utf8'),ctx);
    ctx.window.ContentPackManager.render(host); await flush();
    assert.match(host.innerHTML,/风格包/); assert.match(host.innerHTML,/画师包/); assert.match(host.innerHTML,/角色包/); assert.match(host.innerHTML,/标签包/);
    assert.match(host.innerHTML,/更新此包/); assert.doesNotMatch(host.innerHTML,/导入 zip|install-official|type="file"|<x>/);
    assert.match(host.innerHTML,/&lt;x&gt;/);
    click({target:{closest:selector=>selector==='[data-cp-category]' ? {dataset:{cpCategory:'characters'}} : null}});
    assert.doesNotMatch(host.innerHTML,/styles&lt;x&gt;/); assert.match(host.innerHTML,/characters&lt;x&gt;/);
    click({target:{closest:selector=>selector==='[data-cp-action]' ? {dataset:{cpAction:'install',id:'characters',kind:'characters'}} : null}});
    await flush();
    const install=calls.find(c=>c.url.endsWith('/repository/install'));
    assert.deepEqual(JSON.parse(install.body),{packId:'characters',replace:false});
});
