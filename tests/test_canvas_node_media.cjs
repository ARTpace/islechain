const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.value='';}
    append(...items){this.children.push(...items);}
    setAttribute(key,value){this[key]=value;}
}
const definition={typeId:'image.worker',version:'1.0.0',title:'图片处理',fields:[{id:'text',label:'文字',component:'text',default:''}],execution:{kind:'worker.python',media:true}};
let requests=[],mutate=null;
const image={id:'c'.repeat(32),url:'/output/result.png',kind:'image',width:6,height:4};
const context={window:{},document:{createElement:tag=>new Element(tag),addEventListener(){}},console,
    nodes:[],connections:[],render(){},scheduleSave(){},pushUndo(){},wouldCreateGeneratorCycle:()=>false,
    crypto:{randomUUID:()=> 'a'.repeat(32)},CANVAS_MEDIA_OUTPUT_TYPES:['comfy'],CANVAS_GENERATOR_TYPES:['comfy'],
    outputUrlValue:item=>item?.url||item,mediaKindForOutputItem:()=> 'image',mediaKindForNode:()=> 'image',
    outputImageName:()=> 'image',isVideoUrl:()=>false,isAudioUrl:()=>false,
    fetch:async(url,options)=>{
        const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});
        if(url.endsWith('node-catalog'))return {ok:true,json:async()=>({definitions:[definition],hashes:{'image.worker@1.0.0':'pinned'},groups:[]})};
        if(mutate)mutate();
        return {ok:true,json:async()=>({outputs:{text:'done',images:[image]}})};
    }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/canvas-node-catalog.js','utf8'),context);
const source=fs.readFileSync('static/js/canvas.js','utf8');
function load(start,end){const offset=source.indexOf(start);assert(offset>=0);vm.runInContext(source.slice(offset,source.indexOf(end,offset+start.length)),context);}
load('function outputNodesForSource(', 'function orderedSources(');
load('function llmInputImages(', 'function llmInputVideos(');
context.appendOutputImages=(node,images)=>node.images.push(...images);
const api=context.window.CanvasNodeCatalog;
(async()=>{
    await api.load();const node={id:'worker',type:'extension'};api.initialize(node,definition);
    const upstream={id:'source',type:'extension',extensionImages:[{...image,id:'b'.repeat(32),url:'/output/source.png'}],outputText:'upstream'};
    const output={id:'out',type:'output',images:[]},target={id:'llm',type:'llm'};
    context.nodes=[upstream,node,output,target];context.connections=[{from:'source',to:'worker'},{from:'worker',to:'out'},{from:'worker',to:'llm'}];
    assert(api.canConnect({id:'img',type:'image'},node),'image worker accepts images');
    assert(api.canConnect(node,output),'image worker can connect to the native output node');
    await api.execute(node);
    const request=requests.find(item=>item.url.endsWith('node-run')).body;
    assert.deepEqual(request.imageInputs,['b'.repeat(32)],'upstream resource handles are reused without downloading');
    assert.deepEqual(request.inputs,['upstream']);assert.equal(request.definitionHash,'pinned');
    assert.equal(node.extensionImages[0].url,image.url);assert.equal(output.images[0].url,image.url);
    assert.equal(api.body(node).children.filter(child=>child.tag==='img').length,1,'image output is visible in the node');
    assert.deepEqual(Array.from(context.llmInputImages(target)),[image.url],'LLM receives the new image output');
    const sources=context.generatorSources(target);assert.equal(sources[0].refs[0].url,image.url);
    assert.equal(sources[0].prompt,'done','image output retains its companion text');
    node.extensionParams.text='changed';mutate=()=>{node.extensionParams.text='changed-during-execution';};
    await assert.rejects(api.execute(node),/旧结果未发布/);assert.equal(node.extensionImages,undefined);
    assert.equal(node.outputText,undefined,'a failed/stale run must not leave a previous result as current');
    mutate=null;upstream.extensionImages=Array.from({length:9},()=>image);
    const before=requests.length;await assert.rejects(api.execute(node),/不能超过8张/);assert.equal(requests.length,before);
    console.log('CANVAS_NODE_MEDIA_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
