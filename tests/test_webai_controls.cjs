const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["'](?:module|application\/json)/.test(m[1])) new Function(m[2]);
}
const param = (key, values) => ({ key, label: key, default: values[0], options: values.map(value => ({ value, label: String(value) })) });
let schema = { source: 'website', status: 'ready', params: [param('ratio', ['auto', '1:1', '16:9']), param('count', [1, 2])] };
const ctx = { _cloudProviderId: 'webapi', _cloudModel: 'gpt', cloudModelParams: () => schema,
    escMenuText: value => String(value), ratioIconHtml: () => '<svg></svg>', refreshCloudResMenu: () => {} };
vm.createContext(ctx);
const rendererStart = html.indexOf('        const ICON =');
vm.runInContext(html.slice(rendererStart, html.indexOf('        // 质量下拉', rendererStart)), ctx);
vm.runInContext(html.slice(html.indexOf('        const _cloudWebsiteValues'), html.indexOf('        function cloudParamValues')), ctx);
let ui = ctx.cloudWebsiteControlsHtml();
assert(ui.includes('class="anima-ctrl"'));
assert(ui.includes('anima-ctrl-menu-grid'));
assert(!ui.includes('<select'));
assert(ui.includes('×1') && ui.includes('×2') && !ui.includes('×3'));
assert(!ui.includes('cloudWebsite_sizeBtn'));
ctx.cloudSelectWebsiteOption('count', encodeURIComponent(JSON.stringify(2)));
assert.equal(ctx.cloudWebsiteRequestParams().count, 2);
ctx.cloudSelectWebsiteOption('ratio', encodeURIComponent(JSON.stringify('16:9')));
assert.equal(ctx.cloudWebsiteRequestParams().ratio, '16:9');
schema = { source: 'website', status: 'ready', params: [param('ratio', ['auto']), param('count', [1])] };
ui = ctx.cloudWebsiteControlsHtml();
assert(!ui.includes('16:9') && !ui.includes('×2'));
assert.equal(ctx.cloudWebsiteRequestParams().ratio, 'auto');
assert.equal(ctx.cloudWebsiteRequestParams().count, 1);
ctx._cloudModel = 'nano';
schema = { source: 'website', status: 'ready', params: [param('ratio', ['auto', '4:5']), param('size', ['1K', '2K', '4K']), param('count', [1, 2])] };
ui = ctx.cloudWebsiteControlsHtml();
assert(ui.includes('4K') && !ui.includes('3K'));
assert(ui.includes('cloudWebsite_sizeBtn'));
ctx.cloudSelectWebsiteOption('size', encodeURIComponent(JSON.stringify('4K')));
assert.equal(ctx.cloudWebsiteRequestParams().size, '4K');
assert(html.includes('html.engine-cloud.website-model #batchCountWrap { display:none !important; }'));
for (const key of ['ratio', 'size', 'quality', 'count', 'provider']) assert(html.includes("'cloudWebsite_" + key + "Menu'"));
console.log('原有下拉 UI、模型参数切换与数量透传检查通过');

assert.throws(() => ctx.cloudValidateWebsiteParams(schema, {ratio: 'not-supported'}, 0), /参数已变化/);
assert.throws(() => ctx.cloudValidateWebsiteParams(schema, {count: 4}, 0), /参数已变化/);
assert.throws(() => ctx.cloudValidateWebsiteParams(schema, {count: '2'}, 0), /参数已变化/);
assert.throws(() => ctx.cloudValidateWebsiteParams({...schema, status:'unavailable'}, {}, 0), /未获取/);
const before = ctx.cloudWebsiteRequestParams().size;
ctx.cloudSelectWebsiteOption('size', encodeURIComponent(JSON.stringify('removed-size')));
assert.equal(ctx.cloudWebsiteRequestParams().size, before);
(async () => {
    ctx._cloudCatalog = [{id:'p', model_capabilities:{}}, {id:'other', model_capabilities:{}}];
    ctx._cloudProviders = [];
    let requested;
    const fresh = {source:'website', status:'ready', params:[param('ratio',['auto']),param('count',[1])], max_reference_images:1};
    ctx.fetch = async (url, options) => {
        requested = url;
        assert(url.startsWith('/api/providers/webai2api/status?'));
        assert.equal(options?.method || 'GET', 'GET');
        return {ok:true,json:async()=>({online:true,model_capabilities:{gpt:{generation_params:fresh}}})};
    };
    await assert.rejects(() => ctx.cloudPreflightWebsiteParams({protocol:'webai2api',provider_id:'p',model:'gpt',generation_params:{ratio:'16:9',count:2}}), /参数已变化/);
    assert(requested.includes('refresh=true') && requested.includes('model=gpt'));
    assert(!html.includes("fetch('/api/providers/webai2api/sync?"));
    assert.equal(ctx._cloudCatalog[1].model_capabilities.gpt, undefined);
    await ctx.cloudPreflightWebsiteParams({protocol:'webai2api',provider_id:'p',model:'gpt',generation_params:{ratio:'auto',count:1}});
    ctx.fetch = async () => ({ok:true,json:async()=>({online:false,message:'未登录'})});
    await assert.rejects(() => ctx.cloudPreflightWebsiteParams({protocol:'webai2api',provider_id:'p',model:'gpt'}), /未登录/);
    console.log('缓存失效、历史参数、同步失败及平台归属校验通过');
})().catch(error => {console.error(error);process.exitCode=1;});
