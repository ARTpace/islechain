const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const values = new Map();
let captured, uploadCount=0;
const source={naturalWidth:4,naturalHeight:4,color:'original'};
const edited={naturalWidth:4,naturalHeight:4,color:'edited'};
const pixels=Array.from({length:4},()=>Array(4).fill(null));
let clip=null, saved=null;
const drawing={
    clearRect(){pixels.forEach(row=>row.fill(null));},
    save(){saved=clip;},restore(){clip=saved;},beginPath(){},
    rect(x,y,width,height){clip={x,y,width,height};},clip(){},
    drawImage(img){for(let y=0;y<4;y++)for(let x=0;x<4;x++)if(!clip||(x>=clip.x&&y>=clip.y&&x<clip.x+clip.width&&y<clip.y+clip.height))pixels[y][x]=img.color;}
};
const canvas={getContext:()=>drawing,toBlob(callback){captured=structuredClone(pixels);callback({});}};
class FakeImage {
    set src(url){Object.assign(this,url==='source.png'?source:edited);queueMicrotask(()=>this.onload());}
}
class FakeForm { append(){} }
const ctx={window:{},document:{addEventListener(){},getElementById(){return null;},createElement(tag){assert.equal(tag,'canvas');return canvas;}},
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    Image:FakeImage,FormData:FakeForm,DOMException,
    fetch:async()=>{uploadCount++;return{ok:true,json:async()=>({files:[{url:'/output/region.png'}]})};}
};
vm.runInNewContext(fs.readFileSync('static/modules/chat-assistant.js','utf8'),ctx);
const api=ctx.window.ChatAssistant;
(async()=>{
    assert.equal(api.capabilities('local','text2image/anima.json').edit,false);
    assert.equal(api.capabilities('local','text2image/moss-image-sft.json').maxReferences,1);
    assert.equal(api.capabilities('local','text2image/krea2.json').maxReferences,2);
    assert.equal(api.capabilities('local','text2image/flux3-klein.json').edit,true);
    assert.equal(api.capabilities('cloud','custom-model').edit,'unknown');
    assert.equal(api.capabilities('cloud','gpt-image-2','codex').edit,true);
    assert.equal(api.capabilities('cloud','gpt-image-2','openai').edit,'unknown');
    const codexGuide = api.guide({engine:'cloud',model:'gpt-image-2',protocol:'codex'},[{url:'pig.png'}],null,'');
    assert.match(codexGuide,/"edit":true/);
    assert.match(codexGuide,/下游生图工具/);
    assert.match(codexGuide,/抠出主体/);
    for(const box of [null,{x:-.1,y:0,width:.2,height:.2},{x:0,y:0,width:0,height:1},{x:.8,y:0,width:.3,height:1},{x:NaN,y:0,width:.2,height:.2},{image:0,x:0,y:0,width:1,height:1}])assert.throws(()=>api.region(box));
    assert.equal(api.region({image:5,x:0,y:0,width:1,height:1}).image,5);
    assert.equal(api.capabilities('cloud','gpt-image-2','codex').maxReferences,null);
    assert.equal(JSON.stringify(api.pixelBox({x:.25,y:.25,width:.5,height:.5},4,4)),JSON.stringify({x:1,y:1,width:2,height:2}));
    assert.equal(api.pixelBox({x:.999,y:.999,width:.001,height:.001},4,4).width,1);
    api.savePreferences('默认横图'); assert.match(api.guide({engine:'local',model:'anima'},[],null,'连接失败'),/默认横图/);
    values.set('xy_auth_user',JSON.stringify({username:'other'}));
    assert.doesNotMatch(api.guide({engine:'cloud',model:'x'},[],null,''),/默认横图/,'preferences are scoped to the current user');
    api.savePreferences(''); assert.throws(()=>api.savePreferences('x'.repeat(1201)));
    assert.equal(api.isPreferenceRequest('以后默认横图'),true);
    assert.equal(api.isPreferenceRequest('画一张猫'),false);
    const urls=['edited.png'];assert.equal(await api.composite(urls,null),urls);
    const result=await api.composite(urls,{source:'source.png',x:.25,y:.25,width:.5,height:.5});
    assert.equal(result[0],'/output/region.png');
    for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.equal(captured[y][x],x>=1&&x<3&&y>=1&&y<3?'edited':'original','outside pixels must remain unchanged');
    const before=uploadCount;
    const controller=new AbortController();controller.abort();
    await assert.rejects(api.composite(urls,{source:'source.png',x:0,y:0,width:1,height:1},controller.signal),/已取消/);
    assert.equal(uploadCount,before,'cancelled jobs must not upload');
    const page=fs.readFileSync('static/app/zimage.html','utf8');
    assert.doesNotMatch(page,/\.slice\(0, 4\)/,'chat references must not be silently truncated');
    for(const m of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=|application\/(?:ld\+)?json/i.test(m[1]))new vm.Script(m[2]);
    assert.equal((page.match(/await ChatAssistant.composite\(/g)||[]).length,2,'both local and API paths must compose before saving records');
    assert.match(page,/region:ChatTasks.clone\(task.region \|\| null\)/);
    assert.match(page,/ChatAssistant.isPreferenceRequest\(typed\)/);
    assert.match(page,/await ChatAssistant.chooseRegion\(source, area, responseTask.controller.signal\)/);
    assert.match(page,/refs.length > caps.maxReferences/);
    const menu=fs.readFileSync('static/modules/gallery/context-menu.js','utf8');
    assert.ok(fs.readFileSync('static/modules/gallery/bundle.js','utf8').includes(menu.trim()),'bundled menu must match shared implementation');
    console.log('助手能力限制、偏好隔离、区域校验、选区外像素保留、取消和双通道接线通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
