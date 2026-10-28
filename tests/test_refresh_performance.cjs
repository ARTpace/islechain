const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const index = fs.readFileSync('static/index.html', 'utf8');
const page = fs.readFileSync('static/app/zimage.html', 'utf8');
let requests=0, finish;
const ctx={document:{hidden:false}, CID:'client', AbortSignal,
    fetch:()=>{requests++;return new Promise(resolve=>{finish=()=>resolve({json:async()=>({})});});}};
vm.createContext(ctx);
vm.runInContext(index.slice(index.indexOf('        let queueStatusPending'),index.indexOf('        const host = window.location.host;')),ctx);
const nodes={};
const cloud={_cloudProviderId:'web', _cloudModel:'selected', _cloudModels:[],
    _cloudProviders:[{id:'web',image_models:['selected'],model_capabilities:{selected:{generation_params:{status:'ready'}}}}],
    cloudProtocol:()=> 'webai2api', document:{getElementById:id=>nodes[id]||null},
    cloudBuildModelMenu(){},updateUnifiedModelLabel(){},renderUnifiedModelMenu(){},refreshCloudResMenu(){},
    fetch:()=>{throw new Error('已有参数时不应查询网关');}};
vm.createContext(cloud);
vm.runInContext(page.slice(page.indexOf('        async function cloudRefreshModels()'),page.indexOf('        function applyCloudProviders(')),cloud);
(async()=>{
    const first=ctx.syncStatus();
    await ctx.syncStatus();
    assert.equal(requests,1,'慢请求期间不得堆积轮询');
    finish();await first;
    ctx.document.hidden=true;
    await ctx.syncStatus();assert.equal(requests,1,'后台暂停轮询');
    ctx.document.hidden=false;
    const next=ctx.syncStatus();assert.equal(requests,2,'完成后可继续轮询');
    finish();await next;
    await cloud.cloudRefreshModels();
    assert.equal(cloud._cloudModels[0],'selected');
    // 缺失参数时仍查询；生图预检不受显示缓存影响。
    cloud._cloudProviders[0].model_capabilities={};
    let fetched=false;
    cloud.fetch=async()=>{fetched=true;return {ok:false};};
    await cloud.cloudRefreshModels();
    assert(fetched);
    console.log('刷新性能：轮询防重叠、后台暂停、已保存参数即时展示及缺失参数回源通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
