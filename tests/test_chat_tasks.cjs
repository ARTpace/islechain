const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const created=[];
const makeNode = () => { const node={ children:[], dataset:{}, setAttribute(){}, hidden:false, append(...nodes){ this.children.push(...nodes); }, appendChild(node){ this.children.push(node); } }; created.push(node); return node; };
const calls = [];
const ctx = { window:{}, document:{createElement:makeNode}, AbortController, DOMException,
    fetch:async (url, options) => { calls.push([url, JSON.parse(options.body)]); return {ok:true}; } };
vm.runInNewContext(fs.readFileSync('static/modules/chat-tasks.js','utf8'), ctx);
const tasks = ctx.window.ChatTasks;
(async () => {
    for (const text of ['头发改白色，其他不变','用图 1 的角色、图 2 的构图','修改这张','去掉左侧路人','头发再白一点']) assert.equal(tasks.isEdit(text),true);
    assert.equal(tasks.isEdit('你好'),false);
    assert.match(tasks.referenceGuide([{},{}]), /图 1、图 2/);
    const references = [{url:'character.png'}, {url:'composition.png'}];
    assert.equal(tasks.numberedReferences('用图1的角色和图二的构图', references), references);
    assert.equal(tasks.numberedReferences('用图 3 的构图', references), null);
    assert.equal(tasks.numberedReferences('其他不变', references), null);
    const fiveRefs = Array.from({length:5},(_,i)=>({url:i+'.png'}));
    assert.equal(tasks.numberedReferences('用图5和图五', fiveRefs),fiveRefs);
    assert.equal(tasks.isEdit('用图5'),true);
    const host = makeNode(); const task = tasks.create(host);
    const [label, stop] = task.bar.children; const retry=created.at(-2);
    assert.equal(label.textContent,'正在理解');
    task.promptId = 'my-task'; task.clientId = 'my-client';
    await stop.onclick();
    assert.equal(task.controller.signal.aborted,true);
    assert.throws(task.check, /任务已停止/);
    assert.deepEqual(calls, [['/api/comfyui/cancel-task',{prompt_id:'my-task',client_id:'my-client'}]]);
    task.finish(); assert.equal(retry.hidden,false);
    const success = tasks.create(makeNode()); success.snapshot = {workflow:{seed:42}};
    const successRetry=created.at(-2); success.finish(); assert.equal(successRetry.dataset.tip,'相同参数再出一张');
    const failed = tasks.create(makeNode()); failed.snapshot = {workflow:{seed:42}};
    const failedRetry=created.at(-2); failed.finish(new Error('断网')); assert.match(failed.bar.children[0].textContent,/断网/);
    assert.equal(failedRetry.dataset.tip,'原参数重试');
    const html = fs.readFileSync('static/app/zimage.html','utf8');
    const start = html.indexOf('        async function handleRender() {');
    const end = html.indexOf('        /* ==================== 在线API',start);
    let submitted, generated;
    const renderTask = {snapshot:{engine:'local',lockedWorkflow:'text2image/qwen-image-2.1.json', actualWorkflowName:'image-edit/qwen-image-2.1.json',
        controls:{seedMode:'fixed',fixedSeed:42},seed:42,size:{width:512,height:768},workflow:{'1':{inputs:{seed:42,image:'original.png'}}}},
        check(){},setStage(){},controller:new AbortController()};
    const renderCtx = { ChatTasks:tasks, window:{__chatGenerationTask:renderTask,__chatRenderPrompt:'原提示词',__chatRenderRefs:[{url:'original.png'}]},
        currentEngine:'cloud',currentWorkflow:'different.json', selectedUnetModel:'different.safetensors',
        document:{getElementById(){return {prepend(){}}}}, loraState:{active:[]},
        startProgress(){},hideProgress(){}, createStudioPlaceholder(){return {parentNode:null};},
        GenerationControls:{getState(){throw new Error('不应读取新界面参数');}},getAnimaSize(){throw new Error('不应读取新尺寸');},
        generateUUID:()=> 'test',resolveWorkflowModels:async()=>[],_registerTask(){},CardProgress:{update(){}},
        CLIENT_ID:'client',setInterval:()=>1,clearInterval(){},setTimeout(){},
        fetch:async(url, options)=>{
            if(url==='/api/comfyui/prompt'){submitted=JSON.parse(options.body);return {ok:true,json:async()=>({prompt_id:'pid'})};}
            if(url==='/api/generate'){generated=JSON.parse(options.body);throw new Error('模拟生成失败');}
            throw new Error('不应重建工作流：'+url);
        }, console:{log(){}} };
    vm.createContext(renderCtx); vm.runInContext(html.slice(start,end),renderCtx);
    await assert.rejects(renderCtx.handleRender(), /模拟生成失败/);
    assert.equal(submitted.prompt['1'].inputs.seed,42);
    assert.equal(submitted.prompt['1'].inputs.image,'original.png');
    assert.equal(generated.width,512); assert.equal(generated.height,768);
    assert.equal(generated.prompt,'原提示词');
    const lora = fs.readFileSync('static/modules/lora-manager.js','utf8');
    const loraStart = lora.indexOf('    function injectNodes(');
    const loraEnd = lora.indexOf('    // ─',loraStart);
    const loraCtx = {state:{active:[{name:'current.safetensors',strength:0.6}]}, LORA_NODE_BASE:10000};
    vm.createContext(loraCtx); vm.runInContext(lora.slice(loraStart,loraEnd),loraCtx);
    const graph = () => ({'1':{class_type:'KSampler',inputs:{model:['2',0]}}});
    const frozen = graph(); loraCtx.injectNodes(frozen,[{name:'original.safetensors',strength:0.4}]);
    assert.equal(frozen['10000'].inputs.lora_name,'original.safetensors');
    assert.equal(frozen['10000'].inputs.strength_model,0.4);
    const normal = graph(); loraCtx.injectNodes(normal);
    assert.equal(normal['10000'].inputs.lora_name,'current.safetensors');
    console.log('连续修改识别、多图顺序、定向取消、状态与重试、跨界面参数快照通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
