const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const port=(id,type,multiple=false)=>({id,label:id,type,multiple});
const source={id:'source',type:'extension',nodeDefinition:JSON.stringify({ports:{outputs:[port('original','image'),port('mask','mask'),port('scores','number',true)]}}),extensionPortOutputs:{original:{resourceId:'image-id'},mask:{resourceId:'mask-id'},scores:[0,2]}};
const definition={typeId:'test.ports',version:'1.0.0',fields:[],execution:{kind:'worker.python',media:true},ports:{inputs:[port('photo','image'),port('alpha','mask'),port('score','number')],outputs:[port('result','image')]}};
const target={id:'target',type:'extension',nodeDefinition:JSON.stringify(definition),definitionHash:'hash',extensionParams:{}};
const edge={from:'source',to:'target',bindings:[{source:'original',target:'photo'},{source:'mask',target:'alpha'},{source:'scores',target:'score',index:0}]};
let request,change=false;
const context={window:{},document:{addEventListener(){}},nodes:[source,target],connections:[edge],render(){},scheduleSave(){},crypto:{randomUUID:()=> 'run'},
fetch:async(url,options)=>{if(url.endsWith('node-catalog'))return {ok:true,json:async()=>({definitions:[definition],hashes:{'test.ports@1.0.0':'hash'}})};request=JSON.parse(options.body);if(change)source.extensionPortOutputs.scores[0]=5;return {ok:true,json:async()=>({outputs:{text:'',images:[],ports:{result:{resourceId:'result-id'}}}})};}};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/canvas-node-catalog.js','utf8'),context);const api=context.window.CanvasNodeCatalog;
(async()=>{
 assert.equal(api.mappedInputs(target).score,0);
 assert.equal(api.mappedInputs(target).alpha.resourceId,'mask-id');
 await api.load();await api.execute(target);
 assert.equal(request.portInputs.photo,'image-id');assert.equal(request.portInputs.alpha,'mask-id');assert.equal(request.portInputs.score,0);
 assert.equal(target.extensionPortOutputs.result.resourceId,'result-id');
 edge.bindings.push({source:'scores',target:'score',index:1});assert.throws(()=>api.mappedInputs(target),/重复绑定/);edge.bindings.pop();
 delete edge.bindings[2].index;assert.throws(()=>api.mappedInputs(target),/选择索引/);edge.bindings[2].index=0;
 edge.bindings[2].target='photo';assert.throws(()=>api.mappedInputs(target),/不兼容/);edge.bindings[2].target='score';
 const saved=JSON.parse(JSON.stringify(edge));assert.equal(saved.bindings[2].index,0);
 change=true;await assert.rejects(api.execute(target),/旧结果未发布/);assert.equal(target.extensionPortOutputs,undefined);
 edge.bindings=[];assert.throws(()=>api.mappedInputs(target),/先配置/);
 console.log('named canvas port mappings passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
