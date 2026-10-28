const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const store = new Map();
let now = 100, fail = false, downloaded = false;
const response = {status: 403, headers: {get:key=>({'Server-Timing':'app;dur=12, loop;dur=1',
    'X-ArtCanvas-Boot':'new-boot','X-ArtCanvas-Perf':'20261027-2'}[key] || null)}};
const context = {
    URL, Blob, Date, Math,
    location: {href:'http://test/static/app/zimage.html?token=SECRET', origin:'http://test'},
    localStorage: {getItem:key=>store.get(key), setItem:(key,value)=>store.set(key,value)},
    performance: {now:()=>now, getEntriesByType:type=>type === 'resource' ? [{
        name:'http://test/api/conversations/private-id?token=SECRET', duration:70,
        startTime:10, requestStart:12, responseStart:22, transferSize:100, encodedBodySize:80,
        initiatorType:'fetch'
    }] : []},
    document: {addEventListener(){}, createElement:()=>({click(){downloaded=true;}})},
    console: {groupCollapsed(){}, groupEnd(){}, table(){}, log(){}},
    setTimeout(){}, clearTimeout(){}, addEventListener(){},
    fetch:async()=>{now+=25; if(fail) throw new TypeError('SECRET'); return response;}
};
context.window=context;
context.top=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/modules/load-log.js','utf8'),context);
(async()=>{
    const result=await context.fetch('/api/conversations/private-id?token=SECRET');
    assert.equal(result,response,'原始响应必须原样返回');
    context.ArtLoadLog.measure('conversation:render',100,{images:2});
    let report=context.ArtLoadLog.report();
    assert.equal(report.requests[0].status,403);
    assert.equal(report.requests[0].serverTiming,'app;dur=12, loop;dur=1');
    assert.equal(report.requests[0].serverBoot,'new-boot');
    assert.equal(report.requests[0].serverVersion,'20261027-2');
    assert.equal(report.requests[0].durationMs,25);
    assert.equal(report.requests[0].path,'/api/conversations/:id');
    assert.equal(report.stages[0].durationMs,25);
    fail=true;
    await assert.rejects(context.fetch('/api/test'),TypeError);
    report=context.ArtLoadLog.report();
    assert.equal(report.requests[1].error,'TypeError');
    assert(!JSON.stringify(report).includes('SECRET'));
    assert(!JSON.stringify(report).includes('private-id'));
    for(let i=0;i<50;i++) context.ArtLoadLog.measure('test',0);
    assert.equal(context.ArtLoadLog.report().stages.length,40);
    const history=JSON.parse(store.get('art_load_logs_v1'));
    assert.equal(history.length,1,'同次刷新更新日志，不重复追加');
    context.ArtLoadLog.download();
    assert(downloaded);
    context.localStorage.setItem=()=>{throw new Error('storage disabled');};
    assert.doesNotThrow(()=>context.ArtLoadLog.report());
    console.log('加载日志：耗时、403、错误透传、路径脱敏、容量限制和导出检查通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
