// Explicit offline fixture: no request can reach a real provider or spend credits.
const fs=require('node:fs');
const fixture=process.env.ART_MODEL3D_FIXTURE_FILE;
if(!fixture)throw new Error('Missing offline model fixture');
const log=event=>{if(process.env.ART_MODEL3D_FIXTURE_LOG)fs.appendFileSync(process.env.ART_MODEL3D_FIXTURE_LOG,JSON.stringify(event)+'\n');};
let counter=0;
global.fetch=async(url,init={})=>{
    const u=new URL(url),path=u.pathname,method=init.method||'GET';
    if(u.hostname!=='3d-fixture.invalid')throw new Error('Offline fixture rejected network host');
    let body={};if(typeof init.body==='string')body=JSON.parse(init.body);
    log({path,method,body,authorized:Boolean(new Headers(init.headers).get('authorization'))});
    const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
    if(path==='/artifact.glb')return new Response(fs.readFileSync(fixture));
    if(path.includes('/meshy/')){
        if(path.endsWith('/balance'))return json({balance:100});
        if(path.endsWith('/animations/library'))return json(Array.from({length:8},(_,i)=>({action_id:i,name:'Action '+i,category:'Body',sub_category:'Move'})));
        if(method==='POST')return json(process.env.ART_MODEL3D_FIXTURE_AMBIGUOUS==='1'?{}:{result:'meshy-task-'+(++counter)});
        return json({id:path.split('/').at(-1),status:process.env.ART_MODEL3D_FIXTURE_WAIT==='1'?'IN_PROGRESS':'SUCCEEDED',progress:50,model_urls:{glb:'https://3d-fixture.invalid/artifact.glb'},result:{animation_glb_url:'https://3d-fixture.invalid/artifact.glb'}});
    }
    if(path.includes('/tripo/')){
        let result;
        if(path.endsWith('/files'))result={file_token:'fixture-file'};
        else if(path.endsWith('/account/balance'))result={balance:100,frozen:2};
        else if(method==='POST')result={task_id:'tripo-task-'+(++counter)};
        else result={status:'success',progress:100,output:{riggable:true,rig_type:'biped',model_url:'https://3d-fixture.invalid/artifact.glb'}};
        return json({code:0,data:result});
    }
    if(path.includes('/hyper3d/')){
        if(path.endsWith('/check_balance'))return json({balance:100});
        if(path.endsWith('/status'))return json({jobs:[{status:'Done'}]});
        if(path.endsWith('/download'))return json({list:[{name:'output.glb',url:'https://3d-fixture.invalid/artifact.glb'}]});
        return json({uuid:'hyper-fixture',jobs:{subscription_key:'fixture-subscription'}});
    }
    throw new Error('Unrecognized offline protocol route: '+path);
};
