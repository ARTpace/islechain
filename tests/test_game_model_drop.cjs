const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('static/js/canvas.js','utf8');
const context=vm.createContext({window:{GameModel3D:{types:['gameModelAsset'],referenceImages:n=>n.reference?[{url:n.reference,name:'模型参考视图.png',kind:'image'}]:[]}},nodes:[],connections:[]});
function load(start,end){const offset=source.indexOf(start);assert.ok(offset>=0);vm.runInContext(source.slice(offset,source.indexOf(end,offset+start.length)),context);}
load('async function modelDropFiles(','window.addEventListener(\'dragend\'');
load('function imageRefsFromNode(','function loopInputImageRefs(');
load('function mediaRefsFromNode(','function generatorSources(');
load('function generatorSources(','function orderedSources(');
load('function llmInputImages(','function llmInputVideos(');
const model={id:'model',type:'gameModelAsset',reference:'/upload/reference.png'},gen={id:'gen',type:'generator'};
context.nodes=[model,gen];context.connections=[{from:'model',to:'gen'}];
assert.equal(context.imageRefsFromNode(model)[0].url,model.reference);
assert.equal(context.mediaRefsFromNode(model)[0].url,model.reference);
assert.equal(context.generatorSources(gen)[0].refs[0].url,model.reference);
assert.equal(context.llmInputImages(gen)[0],model.reference);
const file=(name,size=10)=>({name,size});
const leaf=value=>({isFile:true,name:value.name,file:resolve=>resolve(value)});
const folder=(name,batches)=>({isDirectory:true,name,createReader:()=>({readEntries:resolve=>resolve(batches.shift()||[])})});
(async()=>{
    const ordinary=[file('robot.glb')];assert.equal((await context.modelDropFiles({items:[],files:ordinary}))[0],ordinary[0]);
    const root=folder('character',[[leaf(file('scene.gltf'))],[folder('textures',[[leaf(file('color.png'))]])]]);
    const files=await context.modelDropFiles({items:[{kind:'file',webkitGetAsEntry:()=>root}]});
    assert.deepEqual(Array.from(files,f=>f.webkitRelativePath),['character/scene.gltf','character/textures/color.png']);
    const huge=folder('large',[[leaf(file('large.glb',257*1048576))]]);
    await assert.rejects(context.modelDropFiles({items:[{kind:'file',webkitGetAsEntry:()=>huge}]}),/256 MiB/);
    console.log('GAME_MODEL_DROP_OK: file and folder paths, directory batches, limits, downstream image/video/LLM reference sources');
})().catch(error=>{console.error(error);process.exitCode=1;});
