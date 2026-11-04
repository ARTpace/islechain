const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const elements=[],handlers={};
function element(tag){
 const e={tag,value:'',style:{},dataset:{},children:[],classList:{toggle(){},add(){},remove(){}},prepend(...xs){this.children.unshift(...xs);},append(...xs){this.children.push(...xs);},replaceChildren(...xs){this.children=xs;},setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k];},querySelector(){return null;},querySelectorAll(){return this.children.filter(e=>e.tag==='button');},focus(){},getBoundingClientRect(){return {left:20,bottom:100};},remove(){},addEventListener(){},contains(x){return this===x||this.children.some(c=>c.contains?.(x));}};e.classList.add=name=>{e.className=((e.className||'')+' '+name).trim();};e.classList.contains=name=>(e.className||'').split(' ').includes(name);if(tag==='iframe')e.contentWindow={postMessage(){}};elements.push(e);return e;
}
const a={id:'a',type:'imageGen',x:10,y:20,w:840,h:600,prompt:'角色A',generationSettings:{engine:'cloud',cloud:{provider:'mock',model:'mock-image'},controls:{ratioW:3,ratioH:4,res:2,batchCount:1}}},b={id:'b',type:'imageGen',x:30,y:40,prompt:'角色B'};
let creates=0,failNext=false,release,remoteFailure=null,localCreates=0,linkedText='连接的提示词',linkedRefs=[{url:'/output/ref.png'}];
const context={window:{innerWidth:1200,innerHeight:900,addEventListener(type,fn){handlers['window:'+type]=fn;}},document:{readyState:'loading',body:element('body'),createElement:element,querySelector(){return null;},addEventListener(type,fn){handlers['document:'+type]=fn;}},LoraManager:{state:{}},canvas:{id:'canvas'},nodes:[a,b],location:{origin:'http://local'},selected:new Set(),URL,URLSearchParams,setTimeout,crypto:{randomUUID:()=> 'client'},
 orderedSources:(n,s)=>s,generatorSources:n=>n.id==='a'?[{prompt:linkedText,refs:linkedRefs}]:[],imageRefsOnly:r=>r,
 scheduleSave(){},saveCanvas:async()=>{},pushUndo(){},render(){},outputForNode(n){return n.out||(n.out={images:[]});},appendOutputImagesWithoutDuplicates(out,items){out.images.push(...items);},syncConnectedOutputsFromGenerated(){},
 fetch:async url=>({ok:true,json:async()=>url==='/api/providers'?{providers:[{id:'mock',protocol:'openai',image_models:['mock-image','declared-image'],model_capabilities:{'declared-image':{generation_params:{source:'website',status:'ready',params:[{key:'size',label:'尺寸',default:'4K',options:[{value:'2K'},{value:'4K'}]},{key:'quality',label:'质量',default:'high',options:[{value:'high',label:'高'}]}]}}}}]}:{workflows:['moss-image-sft-4step','moss-image-sft-fast','moss-image-sft'].map(name=>({name:'text2image/'+name+'.json',title:'MOSS-Image SFT'}))}}),
 createCanvasImageTask:async payload=>{creates++;context.payload=structuredClone(payload);if(release)await release;return {task_id:'task'+creates};},
 ImageGenerationWorkflow:{build:async options=>{context.localOptions=options;return {workflow:{built:true},name:options.workflowName};}},createCanvasComfyTask:async payload=>{localCreates++;context.localPayload=payload;return {task_id:'local1'};},
 cascadeFetch:async url=>{if(url.endsWith(remoteFailure||'never'))return {ok:true,json:async()=>({status:'failed',error:'remote failed'})};if(failNext){failNext=false;throw new Error('network');}return {ok:true,json:async()=>({status:'succeeded',result:{images:['/output/'+url.split('/').pop()+'.png']}})};}
};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/modules/generation-options-panel.js','utf8'),context);vm.runInContext(fs.readFileSync('static/modules/generation-prompt-library.js','utf8'),context);context.GenerationPromptLibrary=context.window.GenerationPromptLibrary;vm.runInContext(fs.readFileSync('static/js/canvas-generation-node.js','utf8'),context);
const api=context.window.CanvasImageGeneration,bodyA=api.body(a),bodyB=api.body(b);
const inputA=bodyA.children[0],refsA=inputA.children[0],contextA=inputA.children[1],promptA=inputA.children[2],promptB=bodyB.children[0].children[2];
assert.equal(inputA.className,'imagegen-input');assert.equal(bodyA.children[2].children[0].className,'imagegen-control imagegen-model');
assert.equal(a.w,440);assert.equal(a.h,undefined);assert(!elements.some(e=>e.tag==='iframe'),'node must use native controls');
assert.equal(promptA.value,'角色A');
assert.equal(contextA.textContent,'连接的提示词');assert.equal(contextA.hidden,false);assert.equal(promptA.placeholder,'补充描述或修改要求（可选）');assert.equal(bodyA.children[3].textContent,'已接入 上游文本 · 1 张参考图');
linkedText='修改后的上游文本';linkedRefs=[{url:'/output/updated.png'}];api.sync();assert.equal(contextA.textContent,'修改后的上游文本');assert.equal(refsA.children[0].children[0].src,'/output/updated.png');assert.equal(a.prompt,'角色A','upstream text must not be copied into the editable prompt');
linkedText='';linkedRefs=[];api.sync();assert.equal(contextA.hidden,true);assert.equal(refsA.hidden,true);assert.equal(promptA.placeholder,'描述你想生成的画面…');
linkedText='连接的提示词';linkedRefs=[{url:'/output/ref.png'}];api.sync();assert.equal(promptB.value,'角色B');
promptB.value='独立角色B';promptB.oninput();assert.equal(a.prompt,'角色A');assert.equal(b.prompt,'独立角色B');
const card={style:{},classList:{toggle(){}},contains:x=>x===bodyA};assert(api.preserve(a,card));assert.equal(card.style.width,'440px');
(async()=>{
 await bodyB.children[2].children[0].onclick();
 const dropdown=elements.find(e=>e.className?.includes('imagegen-model-dropdown'));
 assert(dropdown);assert.equal(dropdown.children.length,1,'model dropdown has no title or prompt header');
 const menu=dropdown.children[0],searchRow=menu.children[0],list=menu.children[1];
 assert.equal(searchRow.children[1]['aria-label'],'刷新模型');
 assert.equal(list.children[0].children[1].children[0].textContent,'2K','model displays max resolution badge');
 assert.equal(list.children[0].children.length,2,'MOSS appears once, after its group label');
 list.children[0].children[1].onclick();assert.equal(b.generationSettings.workflow,'text2image/moss-image-sft.json');
 await bodyB.children[2].children[1].onclick();
 const quality=elements.find(e=>e.className?.startsWith('generation-options-segments')&&e.children.some(c=>c.textContent==='极速'));
 const resolutions=elements.filter(e=>e.className?.startsWith('generation-options-segments')).find(e=>e.children.some(c=>c.textContent==='1K'));assert.deepEqual(resolutions.children.map(c=>c.textContent),['1K','2K']);
 assert(elements.some(e=>e.className==='generation-options-ratio-icon'),'shared panel renders ratio icons');
 assert(quality,'MOSS quality is available in parameters');quality.children[2].onclick();
 assert.equal(b.generationSettings.workflow,'text2image/moss-image-sft-4step.json');
 assert.equal(bodyB.children[2].children[0].textContent,'MOSS-Image SFT ▾');

 await bodyA.children[1].children[0].onclick();const frame=elements.find(e=>e.tag==='iframe');assert(frame,'shared prompt library opens outside the card');assert(!bodyA.contains(frame));
 const toggle={type:'prompt-library:toggle',key:'style',item:{positive:'new style',negative:'bad texture'}};
 const send=(data,source=frame.contentWindow,origin='http://local')=>handlers['window:message']({data,source,origin});
 send(toggle,frame.contentWindow,'http://evil');assert.equal(a.prompt,'角色A');send(toggle,{});assert.equal(a.prompt,'角色A');
 send(toggle);assert.equal(a.prompt,'角色A, new style');assert.equal(a.generationSettings.negative,'bad texture');assert.equal(b.prompt,'独立角色B');send(toggle);assert.equal(a.prompt,'角色A');assert.equal(a.generationSettings.negative,'');
 handlers['document:keydown']({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});send(toggle);assert.equal(a.prompt,'角色A','closed picker messages must be ignored');
 a.generationSettings.cloud.model='declared-image';
 await bodyA.children[2].children[1].onclick();
 const selects=elements.filter(e=>e.className==='generation-options-segments');assert(selects.some(e=>e.children.some(o=>o.textContent==='4K')),'declared model sizes are rendered');
 assert.equal(a.generationSettings.cloud.website['mock/declared-image'].size,'4K');
 a.generationSettings.cloud.model='mock-image';
 let unblock;release=new Promise(resolve=>{unblock=resolve;});const first=api.run('a');assert.equal(api.run('a'),first,'duplicate clicks share the same task');
 await new Promise(resolve=>setImmediate(resolve));a.prompt='下一轮提示词';unblock();await first;release=null;
 assert.equal(creates,1);assert.equal(context.payload.prompt,'角色A\n\n连接的提示词');assert.equal(context.payload.size,'1536x2048');assert.equal(context.payload.reference_images.length,1);assert.equal(a.out.images.length,1);assert.equal(a.runStatus,'done');assert.equal(a.imageGenerationTask,undefined);
 failNext=true;await assert.rejects(api.run('a'),/network/);assert.equal(a.imageGenerationTask.paused,true);assert.equal(creates,2);
 await api.run('a');assert.equal(creates,2,'network recovery must not resubmit');assert.equal(a.out.images.length,2);
 await api.run('b');assert.equal(localCreates,1);assert.equal(creates,2,'local selection must never fall back online');assert.equal(context.localPayload.workflow_data.built,true);assert.equal(b.runStatus,'done');
 a.generationSettings.controls.batchCount=2;remoteFailure='task3';await assert.rejects(api.run('a'),/remote failed/);assert.equal(creates,4);assert.equal(a.out.images.length,3,'other accepted batch tasks must still be collected after one fails');assert.equal(a.imageGenerationTask,undefined);
 context.nodes.splice(0,1);api.sync();await assert.rejects(api.run('a'),/不存在/);
 console.log('CANVAS_GENERATION_NATIVE_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
