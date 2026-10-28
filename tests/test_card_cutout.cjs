const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const card = fs.readFileSync('static/modules/gallery/card.js', 'utf8');
const calls = [];
const responses = [
    {id:'task',status:'processing',progress:{stage:'queued',label:'队列第 2 位'}},
    {id:'task',status:'done',url:'/output/cutout.png',model:'BEN2'}
];
const context = vm.createContext({
    Map, Date, Promise, AbortSignal, BTN_INLINE:'',
    setTimeout: resolve => resolve(),
    fetch: async (url, options) => {
        calls.push({url, options});
        return {ok:true,json:async () => responses.shift()};
    }
});
context.window = context;
vm.runInContext(fs.readFileSync('static/js/image-cutout-client.js', 'utf8'), context);
context.global = context;
vm.runInContext(card.slice(card.indexOf('    const cutoutJobs ='), card.indexOf('    function mountDownloadAction(')), context);
(async () => {
    const progressUpdates=[];
    const result = await context.runCutout('/output/original.png', 'portrait', {onProgress:state=>progressUpdates.push(state)});
    assert(progressUpdates.some(state=>state.label==='队列第 2 位' && state.value===undefined));
    assert.equal(progressUpdates.at(-1).value,100);
    assert.equal(result.url, '/output/cutout.png');
    assert.equal(calls[0].url, '/api/image-cutout');
    assert.equal(JSON.parse(calls[0].options.body).url, '/output/original.png');
    assert.equal(calls[1].url, '/api/image-cutout/task');
    responses.push({id:'cached',status:'done',model:'BEN2',url:'/output/cached.png'},
        {id:'replacement',status:'done',model:'RMBG-2.0',attempt:'changed-model',url:'/output/changed.png'});
    const callCount=calls.length;
    const changed=await context.runCutout('/output/original.png','portrait',{model:'RMBG-2.0'});
    assert.equal(changed.url,'/output/changed.png');
    assert.equal(JSON.parse(calls[callCount].options.body).retry,false);
    assert.equal(JSON.parse(calls[callCount+1].options.body).retry,true,'a cached result from another model must trigger exactly one new attempt');
    responses.push({id:'busy',status:'processing',model:'BEN2'});
    const beforeBusy=calls.length;
    await assert.rejects(context.runCutout('/output/original.png','',{model:'RMBG-2.0'}),/正在使用其他模型/);
    assert.equal(calls.length,beforeBusy+1,'do not submit another task while a different model is running');
    responses.push({id:'cached-target',status:'done',model:'SAM3',target:'cat',url:'/cat.png'},
        {id:'new-target',status:'done',model:'SAM3',target:'dog',attempt:'target-change',url:'/dog.png'});
    assert.equal((await context.runCutout('/output/original.png','',{model:'SAM3',target:'dog'})).url,'/dog.png');
    responses.push({id:'manual',status:'done',model:'BEN2',selection:'manual',url:'/manual.png'},
        {id:'automatic',status:'done',model:'RMBG-2.0',selection:'auto',attempt:'auto-change',url:'/auto.png'});
    assert.equal((await context.runCutout('/output/original.png','',{model:'auto'})).url,'/auto.png');
    calls.splice(callCount);
    responses.push({id:'task',status:'done',url:'/output/retry.png',model:'RMBG-2.0',attempt:'retry1',versions:[result]});
    await context.runCutout('/output/original.png', 'portrait', {model:'RMBG-2.0',retry:true});
    const retried = JSON.parse(calls[2].options.body);
    assert.equal(retried.url, '/output/original.png');
    assert.equal(retried.model, 'RMBG-2.0');
    assert.equal(retried.retry, true);
    context.fetch = async () => ({ok:true,json:async () => ({status:'done',model:'BEN2',url:'/output/old.png'})});
    await assert.rejects(context.runCutout('/output/original.png', '', {model:'BEN2',retry:true}), /后端.*重启/);
    context.fetch = async () => ({ok:true,json:async () => ({status:'done',model:'BEN2',attempt:'x',url:'/output/old.png'})});
    await assert.rejects(context.runCutout('/output/original.png', '', {model:'RMBG-2.0',retry:true}), /未使用所选模型/);
    context.fetch = async () => ({ok:false,json:async () => ({detail:'缺少 RMBG 节点'})});
    await assert.rejects(context.runCutout('/output/original.png', ''), /缺少 RMBG/);
    assert.match(card, /mountCutoutAction\(card, \(\) => record/);
    assert.match(card, /mountCutoutAction\(host, getRecord, imageUrl\)/);
    // Exercise version selection, per-version download, retry source and failure preservation.
    let dialog, controls, downloaded, retriedSource;
    const node = () => ({style:{}, value:'', disabled:false, parts:new Map(),
        setAttribute(){}, removeAttribute(key){delete this[key];}, addEventListener(){}, insertBefore(child){this.inserted=child;}, appendChild(child){(this.children ||= []).push(child);}, showModal(){}, focus(){},
        replaceChildren(...children){this.children=children;this.value=children[0]?.value || '';},
        querySelector(selector){if(!this.parts.has(selector))this.parts.set(selector,node());return this.parts.get(selector);}
    });
    context.document = {body:{appendChild(){}},createElement(tag){
        const result=node();
        if(tag==='dialog')dialog=result;
        return result;
    }};
    context.GalleryActions = {downloadImage:url=>{downloaded=url;}};
    context.fetch = async () => ({ok:true,json:async () => ({models:['BEN2','RMBG-2.0']})});
    const old = {url:'/output/old.png',model:'BEN2',kind:'人物'};
    const latest = {url:'/output/latest.png',model:'RMBG-2.0',kind:'通用'};
    context.showCutout({...latest,versions:[old,latest]},'/output/original.png','portrait');
    controls=dialog.inserted;
    await Promise.resolve();
    assert.equal(dialog.querySelector('img').src, latest.url);
    const versions=controls.querySelector('[data-version]');
    versions.value='0'; versions.onchange();
    assert.equal(dialog.querySelector('img').src, old.url);
    dialog.querySelector('[data-download]').onclick({});
    assert.equal(downloaded,old.url);
    const range=dialog.querySelector('[data-compare-range]');
    const original=dialog.querySelector('[data-original]');
    const divider=dialog.querySelector('[data-divider]');
    assert.equal(original.src,'/output/original.png');
    assert.equal(divider.style.left,'50%');
    range.value='25';range.oninput();
    assert.equal(original.style.clipPath,'inset(0 75% 0 0)');
    const surface=dialog.querySelector('[data-compare]');
    let captured=false;
    surface.getBoundingClientRect=()=>({left:10,width:200});
    surface.setPointerCapture=()=>{captured=true;};
    surface.hasPointerCapture=()=>captured;
    surface.releasePointerCapture=()=>{captured=false;};
    surface.onpointerdown({button:0,pointerId:1,clientX:160});
    assert.equal(divider.style.left,'75%');
    surface.onpointermove({pointerId:1,clientX:500});
    assert.equal(divider.style.left,'100%');
    surface.onpointerup({pointerId:1});
    assert.equal(captured,false);
    context.runCutout = async (source,prompt,options) => {
        retriedSource={source,prompt,options};
        return {...latest,url:'/output/manual.png',versions:[old,latest,{...old,url:'/output/manual.png'}]};
    };
    controls.querySelector('[data-model]').value='BEN2';
    await controls.querySelector('[data-retry]').onclick();
    assert.equal(retriedSource.source,'/output/original.png');
    assert.equal(retriedSource.options.model,'BEN2');
    assert.equal(retriedSource.options.retry,true);
    assert.equal(dialog.querySelector('img').src,'/output/manual.png');
    assert.equal(original.src,'/output/original.png');
    context.runCutout = async () => {throw new Error('显存不足');};
    await controls.querySelector('[data-retry]').onclick();
    assert.equal(versions.children.length,3);
    assert.equal(dialog.querySelector('img').src,'/output/manual.png');
    assert.match(controls.querySelector('[data-status]').textContent,/显存不足/);
    const targetLabel=controls.children.find(child=>child.innerHTML?.includes('data-target'));
    const targetInput=targetLabel.querySelector('[data-target]');
    controls.querySelector('[data-model]').value='SAM3';
    controls.querySelector('[data-model]').onchange();
    assert.equal(targetLabel.hidden,false);
    await controls.querySelector('[data-retry]').onclick();
    assert.match(controls.querySelector('[data-status]').textContent,/请填写 SAM3/);
    context.runCutout=async (source,prompt,options)=>{
        assert.equal(options.target,'cat');
        return {...latest,versions:[old,latest]};
    };
    targetInput.value='cat';
    await controls.querySelector('[data-retry]').onclick();
    // Older saved results have no available_models, and the model-list endpoint may be offline.
    context.fetch = async () => ({ok:false,status:404,json:async () => ({detail:'Not Found'})});
    context.showCutout({...latest,versions:undefined},'/output/original.png','portrait');
    controls=dialog.inserted;
    await new Promise(resolve => setImmediate(resolve));
    const fallbackModels=controls.querySelector('[data-model]');
    assert(fallbackModels.children.some(option=>option.value==='BEN2'));
    assert(fallbackModels.children.some(option=>option.value==='RMBG-2.0'));
    assert.equal(fallbackModels.value,'RMBG-2.0');
    assert.match(controls.querySelector('[data-status]').textContent,/重启工具后端/);
    console.log('抠图进度状态、拖动与滑块对比、换模、版本切换及失败保留检查通过');
})().catch(error => {console.error(error);process.exitCode=1;});
