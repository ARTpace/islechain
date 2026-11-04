/* 执行真实节点动作，验证上游约束、固定构建与候选采用保护。 */
const vm = require('node:vm'), fs = require('node:fs'), assert = require('node:assert/strict');
const p = {id:'p',canvasId:'canvas',revision:4,plan:{revision:2},planConfirmed:true,
    assets:[{id:'hero',revision:1,selected:{selectionId:'s1',contentHash:'hash'}}],tables:[]};
const nodes = [{id:'plan',type:'gamePlan',projectId:'p',x:0,y:0},{id:'art',type:'gameAssets',projectId:'p',x:500,y:0}];
const connections = [], calls = []; let saves=0, buildFails=false;
let holdWork=null;
const elements=[];
const document={body:{append(){}},createElement(tag){
    const handlers={};
    const el={tag,style:{},dataset:{},setAttribute(name,value){this[name]=value;},children:[],textContent:'',scrollTop:0,clientHeight:100,scrollHeight:100,
        querySelector(selector){return this.children.find(el=>'.'+el.className===selector) || null;},
        append(...items){this.children.push(...items);},addEventListener(name,fn){handlers[name]=fn;},
        showModal(){this.open=true;},focus(){},close(){this.open=false;handlers.close?.();},remove(){this.removed=true;}};
    elements.push(el);return el;
}};
const workspace = {active:'source',revision:3,workspaceEpoch:'epoch',files:[{path:'game.js'}]};
const build = {buildId:'build1',workspaceRevision:3,workspaceEpoch:'epoch',projectRevision:4,inputManifestHash:'fixed',missingRequiredAssets:[]};
let completedCandidate=null;
const context = vm.createContext({window:{},nodes,connections,canvas:{id:'canvas'},Set,Map,JSON,Object,document,setInterval,clearInterval,
    escapeHtml:String,pushUndo(){},render(){},scheduleSave(){saves++;},confirm:()=>true,
    crypto:{randomUUID:()=> 'request'},uid:(()=>{let i=0;return prefix=>prefix+(++i);})(),
    fetch:async(url, options)=>{
        const data=options.body ? JSON.parse(options.body) : undefined; calls.push({url,data});
        if(url.endsWith('/development-tasks') && options.method==='POST' && holdWork) await holdWork;
        let result;
        if(url.endsWith('/workspace/builds')) { if(buildFails && options.method==='POST') return {ok:false,json:async()=>({detail:'JavaScript 语法检查失败'})}; result=options.method==='POST' ? build : [build]; }
        else if(url.endsWith('/workspace/build-diagnostic')) result={status:'failed',repairable:true};
        else if(url.endsWith('/maintenance')) {completedCandidate=null;result={candidateId:'maint1',kind:'maintenance',mode:data.mode,status:'working',stepCount:0,maxSteps:16,changes:[],diagnostics:[]};}
        else if(url.endsWith('/development-tasks')) {completedCandidate=data.candidateId;result={taskId:'task1',candidateId:data.candidateId,status:'completed',step:4,cursor:4};}
        else if(url.endsWith('/code-candidates/'+completedCandidate)) result={candidateId:completedCandidate,kind:'maintenance',completedFiles:completedCandidate==='code1'?3:0,status:'ready',stepCount:4,maxSteps:16,trace:[{step:4,action:'read',path:'game.js',outcome:'完成'}],changes:[],diagnostics:[]};
        else if(url.endsWith('/work')) result={candidateId:url.includes('/code1/')?'code1':'maint1',kind:'maintenance',completedFiles:url.includes('/code1/')?3:0,status:data.step===3?'ready':'working',stepCount:data.step+1,maxSteps:16,trace:[{step:data.step+1,action:'read',path:'game.js',outcome:'完成'}],changes:[],diagnostics:[]};
        else if(url.endsWith('/code-candidates/maint1')) result={candidateId:'maint1',kind:'maintenance',status:'working',stepCount:0,maxSteps:16,trace:[],diagnostics:[]};
        else if(url.endsWith('/workspace')) { if(options.method==='POST') workspace.active='source'; result=workspace; }
        else if(url.endsWith('/workspace/template')) { workspace.files=[{path:'game.js'}]; result=workspace; }
        else if(url.endsWith('/engineering-plan')) {completedCandidate=null;result={candidateId:'code1',kind:'engineering',status:'planned',completedFiles:0,engineeringPlan:{files:[{path:'style.css'},{path:'src/state.js'},{path:'src/main.js'}]},changes:[],diagnostics:[]};}
        else if(url.endsWith('/code-candidates/code1')) result={candidateId:'code1',kind:'engineering',status:'planned',completedFiles:0,engineeringPlan:{files:[{},{},{}]},changes:[],diagnostics:[]};
        else if(url.endsWith('/next')) result={candidateId:'code1',kind:data.completed===2?'maintenance':'engineering',status:data.completed===2?'working':'planned',stepCount:0,maxSteps:16,completedFiles:data.completed+1,engineeringPlan:{files:[{},{},{}]},changes:[],diagnostics:[]};
        else if(url.endsWith('/apply')) result=workspace;
        else if(url.endsWith('/testing')) result={runs:[{testRunId:'run',state:'completed',attempts:[{caseId:'move',profileId:'desktop',attempt:1,result:'failed',reason:'角色没有移动'}],plan:{buildId:'build1',workspaceEpoch:'epoch',inputManifestHash:'fixed'}}]};
        else throw Error('Unexpected '+url);
        return {ok:true,json:async()=>structuredClone(result)};
    }});
context.window.GamePipeline={get project(){return p;},workflow:fn=>fn()};
p.candidates=[];context.project=()=>p;
const workflowSource=fs.readFileSync('static/js/game-workflow.js','utf8');
vm.runInContext(workflowSource.slice(workflowSource.indexOf('    const candidate ='),workflowSource.indexOf('    const inputSignature =')),context);
context.window.GameWorkflow={planState:context.planState};
vm.runInContext(fs.readFileSync('static/js/game-development.js','utf8'),context);
const api=context.window.GameDevelopment;
const canvasSource = fs.readFileSync('static/js/canvas.js','utf8');
vm.runInContext(canvasSource.slice(canvasSource.indexOf('function isNodeControl('), canvasSource.indexOf('function destroyLTXEditor(')),context);
assert.equal(context.isNodeControl({closest:selector => selector.split(',').map(s=>s.trim()).includes('summary')}),true,'折叠标题必须作为控件，不能启动节点拖拽');
(async()=>{
    await api.execute(nodes[1],'development-chain');
    assert.equal(nodes.length,5); assert.equal(connections.length,4);
    await api.execute(nodes[1],'development-chain');
    assert.equal(nodes.length,5,'恢复链不重复创建节点'); assert.equal(connections.length,4);
    const dev=nodes.find(n=>n.type==='gameDevelop'), play=nodes.find(n=>n.type==='gameTest'), test=nodes.find(n=>n.type==='gameTest');
    const oldPlay={id:'old-play',type:'gamePlay',projectId:'p'};
    nodes.push(oldPlay);
    connections.find(c=>c.from===dev.id && c.to===test.id).to=oldPlay.id;
    connections.push({id:'legacy-link',from:oldPlay.id,to:test.id});
    test.testRun={id:'preserved-record'};
    api.mergeLegacy();
    assert.equal(nodes.includes(oldPlay),false);
    assert.equal(test.testRun.id,'preserved-record','合并保留测试节点身份与记录引用');
    assert.ok(connections.some(c=>c.from===dev.id && c.to===test.id));
    assert.ok(connections.some(c=>c.from===test.id && nodes.find(n=>n.id===c.to)?.type==='gameRelease'));
    const beforeSetup=calls.length;
    await api.execute(dev,'setup');
    assert.equal(calls.length,beforeSetup+1,'已有工程及game.js时初始化只检查，不覆盖文件');
    workspace.active=null; workspace.files=[];
    await api.execute(dev,'setup');
    assert.equal(workspace.active,'source');
    assert.equal(workspace.files[0].path,'game.js','首次初始化建立工程并安装缺失模板');
    assert.equal(calls.at(-2).url.endsWith('/workspace'),true);
    assert.equal(calls.at(-1).url.endsWith('/workspace/template'),true);
    const emptyTarget={classList:{add(){}},append(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
    api.nodeBody(test,emptyTarget);
    assert.ok(emptyTarget.innerHTML.includes('尚未读取测试记录'),'无构建和记录时也能渲染测试节点');
    await api.execute(dev,'build'); assert.equal(dev.build.buildId,'build1');
    assert.equal(api.activePlayer(test).enabled,false,'连接构建即提供预览，不自动开启交互');
    await api.execute(test,'play');
    assert.equal(api.activePlayer(test).buildId,'build1');
    assert.equal(api.activePlayer(test).enabled,true);
    const frameTarget={...emptyTarget,children:[],append(el){this.children.push(el);},querySelector(selector){
        if(selector==='[data-game-controls]' && this.children.length) return {};
        return this.children.find(el=>'.'+el.className===selector) || this.children.flatMap(el=>el.children || []).find(el=>'.'+el.className===selector) || null;
    }};
    api.nodeBody(test,frameTarget);
    const firstFrame=frameTarget.querySelector('.gp-node-game');
    assert.ok(firstFrame.src.includes('/builds/build1/preview?channel='));
    assert.ok(firstFrame.src.includes('embedded=true'));
    assert.equal(firstFrame.sandbox,'allow-scripts','保持试玩隔离');
    api.nodeBody(test,frameTarget);
    assert.equal(frameTarget.querySelector('.gp-node-game'),firstFrame,'刷新控件时保留游戏iframe');
    await api.execute(test,'stop-play');assert.equal(api.activePlayer(test).enabled,false);
    api.nodeBody(test,frameTarget);assert.equal(frameTarget.querySelector('.gp-node-game'),firstFrame,'关闭交互保留预览窗口，不改变节点尺寸');
    assert.equal(api.output(play).buildId,'build1');
    await api.execute(test,'refresh-tests'); assert.equal(test.testRun.id,'run');
    await api.execute(test,'feedback');
    assert.ok(dev.instruction.includes('角色没有移动'));
    assert.ok(dev.instruction.includes('build1 / run'),'反馈保留构建与执行来源');
    p.assets[0].selected.selectionId='s2';
    const before=calls.length; await api.execute(test,'refresh-tests');
    assert.equal(calls.length,before,'上游变化时拒绝读取旧构建测试');
    p.assets[0].selected.selectionId='s1'; workspace.revision=4;
    await api.execute(test,'refresh-tests'); assert.equal(calls.at(-1).url.endsWith('/workspace'),true,'工程变化不读取旧测试');
    workspace.revision=3;
    context.window.GameWorkflow={...context.window.GameWorkflow,controls:()=>'',selectedChatModel:()=>({provider:'configured',model:'chat',label:'展示名',primary:true})};
    delete dev.instruction;
    await api.execute(dev,'generate');
    assert.equal(calls.at(-1).url.endsWith('/engineering-plan'),true,'已确认并连接策划时无需重复填写要求');
    assert.ok(JSON.parse(calls.at(-1).data.instruction).request.includes('首个可玩版本'));
    assert.equal(dev.candidateInstruction,'');
    await api.execute(dev,'continue');
    assert.equal(dev.codeCandidate.completedFiles,3);
    assert.equal(dev.codeCandidate.changes,undefined,'画布不保存源码正文');
    await api.execute(dev,'apply');
    assert.equal(calls.at(-2).url.endsWith('/apply'),true,'留空生成的候选经过运行回归后可以审阅采用');
    assert.equal(calls.at(-1).url.endsWith('/workspace/builds'),true,'采用后重新构建');
    dev.instruction='实现角色移动';
    await api.execute(dev,'generate');
    const generated=calls.at(-1); assert.equal(generated.url.endsWith('/engineering-plan'),true);
    assert.equal(generated.data.provider,'configured'); assert.equal(generated.data.label,undefined);
    assert.equal(JSON.parse(generated.data.instruction).assets[0].id,'hero');
    assert.equal(JSON.parse(generated.data.instruction).request,'实现角色移动','显式修改要求仍优先使用');
    assert.equal(dev.codeCandidate.status,'planned');
    await api.execute(dev,'continue');
    assert.equal(dev.codeCandidate.status,'ready');
    p.plan.revision=3;
    const previous=calls.length; await api.execute(dev,'apply');
    assert.equal(calls.length,previous+1); assert.equal(calls.at(-1).url.endsWith('/workspace'),true,'策划变化不能采用旧候选');
    p.plan.revision=2; await api.execute(dev,'apply');
    assert.equal(dev.codeCandidate,undefined); assert.equal(dev.build.buildId,'build1','采用后保存新构建');
    dev.instruction='只调整生命提示';
    await api.execute(dev,'modify');
    assert.equal(dev.codeCandidate.kind,'maintenance');
    assert.equal(dev.codeCandidate.status,'ready');
    assert.equal(dev.codeCandidate.stepCount,4);
    assert.equal(dev.codeCandidate.changes,undefined);
    await api.execute(dev,'apply');
    assert.ok(calls.at(-1).url.endsWith('/workspace/builds'),'局部修改采用后自动重建');
    assert.equal(dev.build.buildId,'build1');
    buildFails=true; await api.execute(dev,'build');
    assert.equal(dev.buildFailure.repairable,true,'构建失败读取后端权威诊断');
    await api.execute(dev,'repair');
    assert.equal(calls.findLast(c=>c.url.endsWith('/maintenance')).data.mode,'repair');
    buildFails=false; await api.execute(dev,'apply');
    assert.equal(dev.buildFailure,undefined,'修复后重建成功清理提示');
    let releaseWork;
    holdWork=new Promise(resolve=>{releaseWork=resolve;});
    const developing=api.execute(dev,'modify');
    while(!calls.at(-1).url.endsWith('/development-tasks')) await new Promise(resolve=>setImmediate(resolve));
    api.nodeBody(dev,emptyTarget);
    assert.ok(emptyTarget.innerHTML.includes('查看开发日志'));
    assert.ok(emptyTarget.innerHTML.includes('等待模型响应与工具执行'));
    await api.execute(dev,'logs');
    const dialog=elements.findLast(el=>el.tag==='dialog');
    assert.equal(dialog.open,true,'开发请求进行中也能打开日志');
    const pre=dialog.children.find(el=>el.tag==='pre');
    assert.ok(pre.textContent.includes('尚无已完成步骤'));
    holdWork=null;releaseWork();await developing;
    assert.ok(pre.textContent.includes('读取文件 · game.js：完成'),'真实步骤返回后刷新窗口');
    assert.equal(dev.codeCandidate.lastAction.path,'game.js','刷新画布仍保留最后动作摘要');
    assert.equal(dev.codeCandidate.trace,undefined,'画布不保存完整日志或源码');
    dialog.close();assert.equal(dialog.removed,true,'关闭窗口清理定时器及DOM');
    connections.splice(connections.findIndex(c=>c.from==='plan' && c.to===dev.id),1);
    const missing=calls.length; await api.execute(dev,'build'); assert.equal(calls.length,missing,'缺策划连线不构建');
    assert.ok(saves>0); console.log('GAME_DEVELOPMENT_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
