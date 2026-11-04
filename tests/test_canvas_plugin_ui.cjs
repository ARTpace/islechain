const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const listeners={},changes=[],messages=[];let observer;
function element(tag){
    return {tagName:tag,style:{},attributes:{},childNodes:[],content:{childNodes:[]},isConnected:true,
        contentWindow:{postMessage(value){messages.push(value);}},
        append(){},setAttribute(key,value){this.attributes[key]=value;},innerHTML:''};
}
const context={window:{},Set,Map,JSON,Number,crypto:{randomUUID:()=> 'session-1'},
    document:{documentElement:{dataset:{theme:'dark'}},createElement:element,createTextNode:text=>({textContent:text,nodeType:3})},
    addEventListener:(name,handler)=>listeners[name]=handler,
    MutationObserver:class{constructor(handler){observer=handler;}observe(){}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/canvas-plugin-ui.js','utf8'),context);
const definition={title:'隔离组件',fields:[
    {id:'text',component:'text',default:''}, {id:'count',component:'number',minimum:0,maximum:3},
    {id:'mode',component:'dropdown',options:['a','b']},{id:'enabled',component:'boolean'}],
    ui:{kind:'isolated.worker',html:'',css:'</style><script>bad()</script>',height:260,script:'/* plugin-code-only-in-worker */'}};
const frame=context.window.CanvasPluginUI.mount(definition,{},(id,value)=>changes.push([id,value]));
assert.equal(frame.attributes.sandbox,'allow-scripts');
assert(!frame.srcdoc.includes('plugin-code-only-in-worker'),'plugin code is delivered as data, never embedded in the frame DOM');
assert(!frame.srcdoc.includes('</style><script>bad()'),'plugin styles cannot escape the style element');
assert(frame.srcdoc.includes("connect-src 'none'"));assert(frame.srcdoc.includes('worker-src blob:'));
frame.onload();assert.equal(messages[0].script,definition.ui.script);assert.equal(messages[0].dark,true);
function send(field,value,extra={}){listeners.message({origin:'null',source:frame.contentWindow,
    data:{channel:'art-node-form-change',session:'session-1',field,value},...extra});}
send('text','accepted');send('count',2);assert.equal(changes.length,2);
send('text','spoof',{source:{}});send('text','spoof',{origin:'https://example.com'});
send('count',Infinity);send('count',4);send('count','1');send('mode','not-in-options');send('enabled','yes');send('unknown','x');
assert.equal(changes.length,2,'invalid origins, senders, fields and parameter types never reach the host');
frame.isConnected=false;observer();send('text','removed');assert.equal(changes.length,2,'removed views lose bridge sessions');
console.log('CANVAS_PLUGIN_UI_OK');
