const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = Object.fromEntries(['.card-progress-label','.card-progress-pct','.pg-ring-outer','.pg-ring-inner'].map(k=>[k,{style:{},textContent:''}]));
const placeholder = {querySelector:k=>elements[k]};
const context = {window:{},document:{getElementById:()=>({})},setInterval:()=>1,clearInterval:()=>{},URL,location:{href:'http://localhost/'}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/modules/card-progress.js','utf8'),context);
function image() {
    const listeners = new Map();
    return {complete:false,naturalWidth:0,src:'http://localhost/preview',
        getAttribute:()=>'/original.png',
        addEventListener:(event,fn)=>listeners.set(event,fn),
        removeEventListener:event=>listeners.delete(event),
        fire(event){listeners.get(event)?.();},
        decode:async()=>{}, listeners};
}
(async()=>{
    const img=image();let ready=false,decoded=false;
    img.decode=async()=>{decoded=true;};
    const wait=context.window.CardProgress.imageReady(img,placeholder).then(()=>{ready=true;});
    await Promise.resolve();
    assert.equal(ready,false);
    assert.equal(img.loading,'eager');
    assert.equal(img.fetchPriority,'high');
    img.naturalWidth=768;img.fire('load');await wait;
    assert(ready && decoded);
    assert.equal(img.listeners.size,0);
    const cached=image();cached.complete=true;cached.naturalWidth=768;
    await context.window.CardProgress.imageReady(cached,placeholder);
    const fallback=image();const retry=context.window.CardProgress.imageReady(fallback,placeholder);
    fallback.fire('error');await Promise.resolve();
    assert.equal(fallback.src,'/original.png');
    fallback.naturalWidth=2048;fallback.fire('load');await retry;
    console.log('图片加载和解码完成后才就绪；缓存命中与原图回退检查通过');
})().catch(e=>{console.error(e);process.exitCode=1;});
