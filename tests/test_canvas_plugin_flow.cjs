const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};}append(...items){this.children.push(...items);}setAttribute(k,v){this[k]=v;}}
const definition={typeId:'image.slice',version:'1.0.1',fields:[],execution:{kind:'worker.python',media:true},ports:{inputs:[{id:'image',label:'输入图片',type:'image'}],outputs:[{id:'images',type:'image',multiple:true}]}};
const refs=[0,1,2,3].map(i=>({id:'result-'+i,url:'/output/'+i+'.png',width:50,height:40}));
let request,serial=0;
const c={window:{},document:{createElement:t=>new Element(t),addEventListener(){}},nodes:[],connections:[],render(){},scheduleSave(){},pushUndo(){},crypto:{randomUUID:()=> 'run'},CANVAS_MEDIA_OUTPUT_TYPES:[],
 uid:()=> 'new-'+(++serial),outputUrlValue:r=>r?.url,appendOutputImages:(out,items)=>out.images.push(...items),
 addOutputNode:p=>{const out={id:'out-'+(++serial),type:'output',images:[],...p};c.nodes.push(out);return out;},
 mediaRefsFromNode:n=>n.type==='extension'?c.window.CanvasNodeCatalog.imageRefs(n):[{url:n.url,kind:'image'}],
 fetch:async(url,options)=>{if(url.endsWith('node-catalog'))return {ok:true,json:async()=>({definitions:[definition],hashes:{'image.slice@1.0.1':'hash'}})};request=JSON.parse(options.body);return {ok:true,json:async()=>({outputs:{text:'',images:refs,ports:{images:refs}}})};}};
vm.createContext(c);vm.runInContext(fs.readFileSync('static/js/canvas-node-catalog.js','utf8'),c);
const source=fs.readFileSync('static/js/canvas.js','utf8');
vm.runInContext(source.slice(source.indexOf('function outputNodesForSource('),source.indexOf('function generatedImageRefs(')),c);
(async()=>{
 const api=c.window.CanvasNodeCatalog;await api.load();
 const node={id:'slice',type:'extension',x:100,y:50,w:380};api.initialize(node,definition);
 c.nodes.push({id:'input',type:'image',url:'/source.png'},node);
 c.connections=[{from:'input',to:node.id}];
 assert.equal(api.mappedInputs(node).image.url,'/source.png','plain line automatically maps a compatible port');
 // No fetching is necessary for a resource already imported by the host.
 c.mediaRefsFromNode=n=>n.type==='extension'?api.imageRefs(n):[{id:'input-id',url:n.url,kind:'image'}];
 await api.execute(node);assert.equal(request.portInputs.image,'input-id');
 const out=c.nodes.find(n=>n.type==='output');assert.equal(out.images.length,4,'run creates an output and delivers every slice');
 assert.equal(api.body(node).children.some(e=>e.tag==='img'),false,'generated pictures live in the output node');
 await api.execute(node);assert.equal(c.nodes.filter(n=>n.type==='output').length,1,'reuse connected output');assert.equal(out.images.length,4,'no duplicate images');
 const late={id:'late',type:'output',images:[]};c.nodes.push(late);c.syncLatestGeneratedOutputToConnection(node.id,late.id);assert.equal(late.images.length,4,'late connection receives entire batch');
 c.connections=[{from:node.id,to:'next'}];const next={id:'next',type:'extension',nodeDefinition:JSON.stringify(definition)};c.nodes.push(next);
 assert.equal(api.mappedInputs(next).image.id,refs[0].id,'collection to a single input defaults to its first item');
 c.connections[0].bindings=[{source:'images',target:'image',index:2}];assert.equal(api.mappedInputs(next).image.id,refs[2].id,'explicit index still wins');
 const multi={...node,id:'multi',nodeDefinition:JSON.stringify({...definition,ports:{...definition.ports,outputs:[{id:'left',type:'image'},{id:'right',type:'image'}]}})};c.nodes.push(multi);c.connections=[{from:'multi',to:'next'}];assert.throws(()=>api.mappedInputs(next),/多个可用输出/,'ambiguous ports require explicit choice');
 console.log('CANVAS_PLUGIN_FLOW_OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
