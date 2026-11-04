const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const calls=[],nodes=[{id:'n1',type:'image',url:'/assets/hero.png',name:'主角'},{id:'n2',type:'output',images:['/assets/hero.png','/output/music.wav']}];
let revision=3,fail=false;
class Reader{readAsDataURL(file){file.arrayBuffer().then(raw=>{this.result='data:;base64,'+Buffer.from(raw).toString('base64');this.onload();});}}
const context={URL,location:{origin:'http://localhost:8000'},File,FileReader:Reader,document:{getElementById:()=>null},window:{},nodes,selected:new Set(['n1','n2']),canvas:{id:'c1'},
    imageRefsFromNode:n=>n.type==='image'?[{url:n.url,name:n.name}]:[],
    fetch:async(url,options={})=>{
        const body=options.body&&JSON.parse(options.body);calls.push({url,body});
        if(options.method==='POST'){
            if(fail)return {ok:false,json:async()=>({detail:'版本已变化'})};
            assert.equal(body.baseRevision,revision);revision++;
        }
        return {ok:true,json:async()=>({project:{id:'p1',revision}})};
    }};
vm.runInNewContext(fs.readFileSync('static/js/game-asset-intake.js','utf8'),context);
const api=context.window.GameAssetIntake;
(async()=>{
    assert.equal(api.safeURL('https://external.invalid/private.png'),null);
    assert.equal(api.safeURL('/api/settings'),null);
    assert.equal(api.safeURL('/assets/hero.png'),'http://localhost:8000/assets/hero.png');
    const refs=api.selectedRefs();assert.equal(refs.length,2);assert.equal(refs[0].sourceKey,'canvas:c1:n1:0');
    const files=[new File(['png'],'hero.png'),new File(['skip'],'secret.env'),new File(['wav'],'music.wav')];
    const result=await api.upload('p1',files);
    assert.equal(result.added,2);assert.equal(result.skipped.length,1);
    const writes=calls.filter(c=>c.body);assert.equal(writes.length,2);assert.equal(writes[1].body.baseRevision,4);
    const rejected=await api.fromRefs('p1',[{url:'https://external.invalid/image.png',name:'外链'}]);
    assert.equal(rejected.failed.length,1);assert(!calls.some(c=>c.url.includes('external.invalid')));
    fail=true;
    const stopped=await api.upload('p1',[files[0],files[2]]);
    assert.equal(stopped.failed.length,1);assert.equal(stopped.remaining,1);assert.match(api.summary(stopped),/未提交/);
    const entry={name:'root',isDirectory:true,createReader:()=>{let sent=false;return {readEntries:resolve=>{resolve(sent?[]:[{name:'hero.png',isFile:true,file:resolve=>resolve(files[0])}]);sent=true;}};}};
    const dropped=await api.droppedFiles({items:[{webkitGetAsEntry:()=>entry}],files:[]});assert.equal(dropped.length,1);
    console.log('GAME_ASSET_INTAKE_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
