const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const requests=[];
let reject=false,workflowLoaded='';
const context={window:{},document:{},URLSearchParams,JSON,Map,
    comfyWorkflows:[{name:'custom/old.json'}],comfyWorkflowCache:{},
    fetch:async(url,options)=>{
        requests.push({url,body:options?.body?JSON.parse(options.body):null});
        if(url.startsWith('/api/mcp/'))return {ok:!reject,json:async()=>reject?{detail:'未通过测试'}:{workflowName:'custom/ai-test.json',params:{steps:12,prompt:'商品图'},title:'商品处理'}};
        return {ok:true,json:async()=>({workflows:[{name:'custom/ai-test.json',title:'商品处理'}]})};
    },
    ensureComfyWorkflow:async name=>(workflowLoaded=name,{config:{fields:[{id:'steps',default:12}]}})
};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/canvas-comfy-builds.js','utf8'),context);
(async()=>{
    const api=context.window.CanvasComfyBuilds,fields={comfyBuildId:'build-1',comfyRevision:'revision-1'};
    const artifact=await api.prepare(fields,'canvas-1');
    assert.equal(requests[0].body.canvasId,'canvas-1','publication is scoped to the original canvas');
    assert.equal(requests[0].body.revision,'revision-1');assert.equal(workflowLoaded,'custom/ai-test.json');
    const node={type:'comfy',mode:'text',comfyParams:{old:5}};api.configure(node,artifact,fields);
    assert.equal(node.mode,'custom','reuse native custom workflow mode');
    assert.equal(node.comfyWorkflow,'custom/ai-test.json');assert.equal(node.comfyParams.steps,12);
    assert.equal(node.comfyParams.old,undefined,'parameters come from the tested revision');
    assert.equal(node.comfyBuildId,'build-1');
    const saved=JSON.parse(JSON.stringify(node));assert.equal(saved.comfyRevision,'revision-1');
    reject=true;const count=requests.length;
    await assert.rejects(api.prepare(fields,'canvas-1'),/未通过测试/);
    assert.equal(requests.length,count+1,'failed publication never refreshes or silently adopts another workflow');
    console.log('CANVAS_COMFY_BUILDS_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
