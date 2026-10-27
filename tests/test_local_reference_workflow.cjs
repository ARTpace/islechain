const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'static/app/zimage.html'), 'utf8');
const start = page.indexOf('        async function buildLocalReferenceWorkflow(');
const end = page.indexOf('        // === 主渲染逻辑 ===',start);
const context = vm.createContext({fetch:async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,'workflows',decodeURIComponent(url.split('/').pop())),'utf8'))})});
vm.runInContext(page.slice(start,end),context);
const build = context.buildLocalReferenceWorkflow;
(async()=>{
    const size={width:384,height:512};
    assert.equal(await build('text2image/qwen-image-2.1.json',[],'p',7,size,1),null);
    assert.equal(await build('text2image/krea2.json',['a.png'],'p',7,size,1),null);
    const qwen=await build('text2image/qwen-image-2.1.json',['a.png','b.png'],'编辑',7,size,2);
    assert.equal(qwen.name,'image-edit/qwen-image-2.1.json');
    assert.equal(qwen.workflow['14'].inputs.image,'a.png');
    assert.equal(qwen.workflow['200'].inputs.image,'b.png');
    assert.equal(qwen.workflow['6'].inputs['images.image_2'][0],'200');
    assert.equal(qwen.workflow['2010'].inputs.amount,2);
    assert.equal(qwen.workflow['23'].inputs.text,'编辑');
    assert.equal(qwen.workflow['22'].inputs.seed,7);
    assert.equal(qwen.workflow['11'].inputs.largest_size,512);
    const moss=await build('text2image/moss-image-sft.json',['a.png'],'编辑',8,size,1);
    assert.equal(moss.workflow['22'].inputs.latent_image[0],'15');
    assert.equal(moss.workflow['14'].inputs.image,'a.png');
    await assert.rejects(()=>build('text2image/moss-image-sft.json',['a.png','b.png'],'p',8,size,1),/一张参考图/);
    const flux3=await build('text2image/flux3-klein.json',['a.png','b.png'],'头发改白色，其他不变',9,size,2);
    assert.equal(flux3.name,'image-edit/flux3-klein.json');
    assert.equal(flux3.workflow['4'].inputs.type,'flux3');
    assert.equal(flux3.workflow['6'].class_type,'ReferenceMultiLatent');
    assert.equal(flux3.workflow['6'].inputs['images.image0'][0],'14');
    assert.equal(flux3.workflow['6'].inputs['images.image1'][0],'200');
    assert.equal(flux3.workflow['200'].inputs.image,'b.png');
    assert.equal(flux3.workflow['144'].inputs.width,384);
    assert.equal(flux3.workflow['144'].inputs.height,512);
    assert.equal(flux3.workflow['144'].inputs.batch_size,2);
    assert.equal(flux3.workflow['22'].inputs.seed,9);
    assert.equal(flux3.workflow['23'].inputs.text,'头发改白色，其他不变');
    assert.equal(flux3.workflow['22'].inputs.positive[0],'6');
    assert.equal(flux3.workflow['22'].inputs.negative[1],1);
    assert.equal(flux3.workflow['22'].inputs.latent_image[0],'144');
    assert.equal(flux3.workflow['22'].inputs.cfg,1);
    assert.equal(flux3.workflow['22'].inputs.steps,16);
    for(const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if(!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1]))new vm.Script(match[2]);
    }
    console.log('参考图分支：Qwen 单/多图、MOSS、FLUX.3 多图、尺寸、种子、批量及页面语法检查通过');
    if(!process.argv.includes('--live'))return;
    const base='http://127.0.0.1:8188';
    const sample=fs.readFileSync('H:/AI-Tools/ComfyUI_TE/ComfyUI/input/qwen21-deployment-test.png');
    const form=new FormData();form.append('image',new Blob([sample],{type:'image/png'}),'reference-workflow-test.png');
    const uploaded=await fetch(base+'/upload/image',{method:'POST',body:form});assert.equal(uploaded.ok,true);
    const input=await uploaded.json();
    for(const name of ['qwen-image-2.1','moss-image-sft']) {
        const result=await build('text2image/'+name+'.json',[input.name],'A blue ceramic teapot on a wooden table.',123,size,1);
        result.workflow['22'].inputs.steps=4;
        const submit=await fetch(base+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:result.workflow})});
        const task=await submit.json();assert.equal(submit.ok,true,JSON.stringify(task));
        console.log(name+' 已通过 ComfyUI 校验，正在实际出图：'+task.prompt_id);
        let completed=false;
        for(let i=0;i<150;i++) {
            await new Promise(resolve=>setTimeout(resolve,2000));
            const history=await (await fetch(base+'/history/'+task.prompt_id)).json();
            const entry=history[task.prompt_id];if(!entry)continue;
            assert.notEqual(entry.status?.status_str,'error',JSON.stringify(entry.status));
            const images=Object.values(entry.outputs||{}).flatMap(output=>output.images||[]);
            assert.ok(images.length);console.log(name+' 参考图实际出图成功：'+images[0].filename);completed=true;break;
        }
        assert.ok(completed,'实际出图等待超时，任务仍保留在 ComfyUI');
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
