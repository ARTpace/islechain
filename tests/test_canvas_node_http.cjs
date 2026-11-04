const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.value='';}append(...items){this.children.push(...items);}setAttribute(key,value){this[key]=value;}}
const definition={typeId:'api.text',version:'1.0.0',title:'API文本',fields:[{id:'text',label:'文本',component:'text',default:'hello'}],execution:{kind:'host.http',textField:'text',url:'https://api.example.test/text',credentialRef:'service',bodyFields:{text:'text'},responsePath:['text']}};
let requests=[],configured=false;
const context={crypto:{randomUUID:()=> 'a'.repeat(32)},window:{},document:{createElement:tag=>new Element(tag),addEventListener(){}},nodes:[],connections:[],render(){},scheduleSave(){},pushUndo(){},alert:message=>{throw Error(message);},
 fetch:async(url,options)=>{const body=options?.body?JSON.parse(options.body):undefined;requests.push({url,body});if(url.includes('node-http-credential')){if(body)configured=!!body.token;return {ok:true,json:async()=>({configured})};}if(url.endsWith('node-run'))return {ok:true,json:async()=>({outputs:{text:'API result'}})};return {ok:true,json:async()=>({definitions:[definition],hashes:{'api.text@1.0.0':'hash'},groups:[]})};}};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/canvas-node-catalog.js','utf8'),context);
(async()=>{const api=context.window.CanvasNodeCatalog;await api.load();const node={id:'api',type:'extension'};api.initialize(node,definition);context.nodes.push(node);
 const root=api.body(node),password=root.children.find(child=>child.type==='password');assert(password);assert(root.children.some(child=>child.textContent?.includes('https://api.example.test/text')));
 await new Promise(resolve=>setImmediate(resolve));password.value='secret-only-in-request';await root.children.find(child=>child.textContent==='绑定凭据并授权').onclick();assert.equal(password.value,'');assert(configured);
 assert(!JSON.stringify(node).includes('secret-only-in-request'));assert.equal(requests.at(-1).body.definitionHash,'hash');
 await api.execute(node);assert.equal(node.outputText,'API result');assert(!JSON.stringify(requests.at(-1).body).includes('secret-only-in-request'));
 await root.children.find(child=>child.textContent==='解除凭据绑定').onclick();assert(!configured);
 node.running=true;const disabled=api.body(node);assert(disabled.children.find(child=>child.type==='password').disabled);assert(disabled.children.find(child=>child.textContent==='绑定凭据并授权').disabled);
 console.log('CANVAS_NODE_HTTP_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
