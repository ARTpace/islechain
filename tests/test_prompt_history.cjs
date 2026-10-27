const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const listeners = new Map();
const inputListeners = new Map();
const on = (store, name, handler) => { if (!store.has(name)) store.set(name, []); store.get(name).push(handler); };
const emit = (store, name, event = {}) => { for (const handler of store.get(name) || []) handler({type:name,...event}); };
const input = {value:'原来的文字', contains:()=>false, addEventListener:(name, fn)=>on(inputListeners,name,fn),
    dispatchEvent:event=>emit(inputListeners,event.type,event), focus(){}, appendChild(node){this.lastChild=node;} };
const original = [{id:'image1',file:{name:'image1.png'},url:'blob:old',name:'image1.png'}];
let files = original;
const manager = {getFiles:()=>files, restoreFiles(items){ files=items.map(item=>({...item,url:'blob:restored'})); emit(listeners,'ref-images-changed'); }};
const selection = {rangeCount:0,removeAllRanges(){},addRange(){}};
const ctx = {window:{_refImgMgr:manager,getSelection:()=>selection}, Event:class {constructor(type){this.type=type;}},
    queueMicrotask, MutationObserver:class{observe(){}}, NodeFilter:{SHOW_TEXT:4,FILTER_REJECT:2,FILTER_ACCEPT:1},
    document:{getElementById:()=>input,addEventListener:(name,fn)=>on(listeners,name,fn),
        createTreeWalker:()=>({nextNode:()=>false}),createTextNode:()=>({length:0}), createRange:()=>({setStart(){},setEnd(){}})}};
vm.runInNewContext(fs.readFileSync('static/modules/prompt-history.js','utf8'),ctx);
const api=ctx.window.PromptHistory;
const history=api.createStack('a',value=>value,2);
history.record('b');history.record('c');history.record('d');
assert.equal(history.undo(),'c');assert.equal(history.undo(),'b');assert.equal(history.undo(),null);
assert.equal(history.redo(),'c');history.record('new');assert.equal(history.redo(),null);
const typing=api.createStack('',value=>value);typing.record('a');typing.record('ab',true);assert.equal(typing.undo(),'');
emit(listeners,'DOMContentLoaded');
function key(value,shift=false){let prevented=false;emit(listeners,'keydown',{target:input,key:value,ctrlKey:true,shiftKey:shift,preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,true);}
(async()=>{
    // 同一次清空同时删除文字和图片，只需要一次撤销。
    input.value='';emit(inputListeners,'input');files=[];emit(listeners,'ref-images-changed');await Promise.resolve();
    key('z');assert.equal(input.value,'原来的文字');assert.equal(files[0].file,original[0].file);assert.equal(files[0].url,'blob:restored');
    key('z',true);assert.equal(input.value,'');assert.equal(files.length,0);
    key('z');key('y');assert.equal(input.value,'');assert.equal(files.length,0);
    // 文件恢复必须重新创建 URL，而不是复用已撤销的 blob 地址。
    const source=fs.readFileSync('static/modules/ref-image-manager.js','utf8');
    const start=source.indexOf('  RefImageManager.prototype.restoreFiles =');const end=source.indexOf('  RefImageManager.prototype.getCount',start);
    const revoked=[];const restoredCtx={RefImageManager:function(){},URL:{revokeObjectURL:url=>revoked.push(url),createObjectURL:file=>'new:'+file.name},document:{dispatchEvent(){}},Event:class{}};
    vm.createContext(restoredCtx);vm.runInContext(source.slice(start,end),restoredCtx);
    const realManager=new restoredCtx.RefImageManager();realManager._images=[{url:'old-url'}];realManager.render=()=>{};
    realManager.restoreFiles(original);assert.deepEqual(revoked,['old-url']);assert.equal(realManager._images[0].url,'new:image1.png');
    console.log('输入栏文字/参考图联合撤销、重做快捷键、历史上限与预览 URL 恢复通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
