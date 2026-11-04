/* 离线验证简化工作流的调用顺序、失败停止与审阅门槛，不调用模型。 */
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync('static/js/game-native-runtime.js','utf8');
function setup({sessions=[],enabled=true,installFailure=false,stale=false,decline=false}={}) {
    const elements=new Map(), calls=[], prompts=[], runs=[], stored=new Map(), tasks=[];
    const element=id=>{
        if(elements.has(id))return elements.get(id);
        const e={id,value:'',hidden:false,disabled:false,textContent:'',children:[],attrs:{},handlers:{},dataset:{},
            classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.handlers[k]=fn;},
            focus(){this.focused=true;},closest(){return this.advanced?{}:null;},replaceChildren(){this.children=[];this.value='';},
            append(child){this.children.push(child);if(!this.value)this.value=child.value;},get options(){return this.children;}};
        elements.set(id,e);return e;
    };
    const buttons=['develop','play','stop','refresh','enable','disable','template','import','session','agent','resume','install','build','dev','preview','changes','adopt'].map(action=>{const e=element('button-'+action);e.dataset.native=action;return e;});
    const state={active:'game',revision:3,workspaceEpoch:0,files:[{path:'package.json'}]};
    element('nativeAgent').value='codex';
    const overview=()=>({enabled,tools:{npm:true,codex:true,claude:true,opencode:true},sessions,runs});
    const context={URLSearchParams,location:{search:'?projectId=p1'},Event,FormData,crypto:{randomUUID:()=>String(calls.length)},
        sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},
        confirm:message=>{prompts.push(message);return !decline;},window:{addEventListener(){}},
        setTimeout:(fn,ms)=>{if(ms===800){queueMicrotask(fn);return 0;}tasks.push(fn);return tasks.length;},clearTimeout(){},
        document:{getElementById:element,createElement:()=>({style:{}}),querySelectorAll:selector=>selector==='[data-round]'?[]:buttons,dispatchEvent:()=>true},
        fetch:async(url,options={})=>{
            const body=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method||'GET',body});let result;
            if(url.endsWith('/native-runtime')){if(options.method==='PUT')enabled=body.enabled;result=overview();}
            else if(url.endsWith('/workspace'))result=state;
            else if(url.endsWith('/conversation'))result={rounds:[],hostHistory:[]};
            else if(url==='/api/game-projects/p1')result={project:{revision:4}};
            else if(url.endsWith('/sessions')&&options.method==='POST'){
                const s={sessionId:'new-session',workspaceRevision:3,workspaceEpoch:0,projectRevision:4};sessions.unshift(s);result=s;
            }else if(url.endsWith('/runs')&&options.method==='POST'){
                result={runId:'run-'+runs.length,sessionId:body.sessionId,operation:body.operation,status:body.operation==='agent'?'running':body.operation==='install'&&installFailure?'failed':'succeeded',serverReady:body.operation==='dev',port:19000,log:'',exitCode:0};
                if(body.operation==='dev')result.status='running';runs.unshift(result);
            }else if(url.includes('/runs/'))result=runs.find(r=>url.endsWith(r.runId));
            else if(url.endsWith('/changes'))result={changes:[{path:'src/game.ts',diff:'+move()'}]};
            else if(url.endsWith('/stop')){runs.forEach(r=>r.status='cancelled');result={stopped:true};}
            else throw new Error('Unexpected API '+url);
            return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
        }};
    if(stale)state.revision=5;
    vm.runInNewContext(source,context);
    const flush=async()=>{for(let i=0;i<60;i++)await new Promise(resolve=>setImmediate(resolve));};
    return {element,calls,prompts,runs,stored,flush,click:async action=>{element('button-'+action).onclick();await flush();},tasks};
}
(async()=>{
    let h=setup();await h.flush();await h.click('develop');
    assert.equal(h.calls.filter(c=>c.method==='POST').length,0,'空需求不得开始付费任务');
    assert.equal(h.element('nativePrompt').focused,true);
    h.element('nativePrompt').value='增加冲刺';h.element('nativePrompt').handlers.input();
    await h.click('develop');
    assert.equal(h.calls.filter(c=>c.url.endsWith('/sessions')&&c.method==='POST').length,1);
    assert.equal(h.calls.find(c=>c.url.endsWith('/runs')&&c.method==='POST').body.resume,false);
    assert.equal(h.stored.get('game-development-draft:p1'),'增加冲刺');
    assert.equal(h.element('nativePrompt').value,'增加冲刺','提交后保留需求，便于失败修正');
    await h.click('stop');assert.equal(h.runs[0].status,'cancelled');
    h=setup({sessions:[{sessionId:'owned',workspaceRevision:3,workspaceEpoch:0,projectRevision:4,agentSessionId:'codex-owned'}]});await h.flush();
    h.element('nativePrompt').value='继续修改';await h.click('develop');
    assert.equal(h.calls.filter(c=>c.url.endsWith('/sessions')&&c.method==='POST').length,0,'匹配版本应复用副本');
    assert.equal(h.calls.find(c=>c.url.endsWith('/runs')&&c.method==='POST').body.resume,true,'续接所属对话');
    h.runs[0].status='succeeded';
    await h.click('adopt');assert.equal(h.calls.filter(c=>c.url.endsWith('/changes')).length,0,'未审阅不能采用');
    await h.click('changes');assert.equal(h.element('nativeDiff').textContent,'+move()');
    await h.click('adopt');assert.equal(h.calls.filter(c=>c.url.endsWith('/changes')).at(-1).body.apply,true);
    h=setup();await h.flush();await h.click('play');
    assert.deepEqual(h.calls.filter(c=>c.url.endsWith('/runs')&&c.method==='POST').map(c=>c.body.operation),['install','dev']);
    assert.equal(h.element('nativePreview').href,'http://127.0.0.1:19000/');
    assert.equal(h.element('nativeReady').hidden,false);
    await h.click('play');
    assert.equal(h.calls.filter(c=>c.url.endsWith('/runs')&&c.method==='POST').length,2,'服务已就绪不重复安装启动');
    h=setup({installFailure:true});await h.flush();await h.click('play');
    assert.deepEqual(h.calls.filter(c=>c.url.endsWith('/runs')&&c.method==='POST').map(c=>c.body.operation),['install']);
    assert.match(h.element('nativeStatus').textContent,/失败/);
    h=setup({enabled:false,decline:true});await h.flush();h.element('nativePrompt').value='做一个游戏';await h.click('develop');
    assert.equal(h.calls.filter(c=>c.method==='POST'||c.method==='PUT').length,0,'取消确认不得授权或执行');
    h=setup({sessions:[{sessionId:'old',workspaceRevision:1,workspaceEpoch:0,projectRevision:4}]});await h.flush();h.element('nativePrompt').value='改进玩法';await h.click('develop');
    assert.equal(h.calls.find(c=>c.url.endsWith('/runs')&&c.method==='POST').body.sessionId,'new-session','陈旧副本不可作为当前版本继续');
    assert.equal(h.calls.find(c=>c.url.endsWith('/sessions')&&c.method==='POST').body.parentSessionId,'old','工程变化后仍应交接所选分支历史');
    h=setup({sessions:[{sessionId:'owned',workspaceRevision:3,workspaceEpoch:0,projectRevision:4,agentSessionId:'codex-owned'}]});await h.flush();
    h.element('nativeAgent').value='claude';h.element('nativeAgent').onchange();h.element('nativePrompt').value='接着增加音效';await h.click('develop');
    assert.equal(h.calls.find(c=>c.url.endsWith('/runs')&&c.method==='POST').body.agent,'claude','切换Agent仍沿用当前工程和对话分支');
    console.log('GAME_NATIVE_WORKFLOW_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
