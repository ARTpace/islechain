const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('static/js/appearance.js','utf8');
// 公共适配契约：历史页面的语义容器也必须进入风格层，不能只覆盖设置页。
const appearanceCSS=fs.readFileSync('static/css/appearance.css','utf8');
for(const selector of ['.console-card','.composer','.panel','.gen-card','.sidebar','.asset-panel','.ws-sidebar']) assert(appearanceCSS.includes(selector),selector+' missing from appearance adapter');
assert(!appearanceCSS.includes('[class*='),'Do not infer visual roles using class substrings');
const materialCSS=appearanceCSS.split('/* 预设只改变表面材质')[1];
assert(materialCSS);
assert(!/(?:border(?:-color|-radius)?|outline(?:-offset)?|box-shadow)\s*:/.test(materialCSS),'Material presets must preserve native frame geometry and feedback');
for(const style of ['cartoon','scifi','glass']) {
 const block=appearanceCSS.split('html[data-appearance-style="'+style+'"] body {')[1]?.split('}')[0];
 assert(block?.includes('--studio-panel-opacity'),style+' must respect panel transparency');
}
assert(appearanceCSS.includes('background:transparent !important;'),'Composer inner surface must not obscure transparency');
function setup(saved={}, media=new Map()){
 const ids=new Map(),events={},storage={...saved};let denied=false,revoked=0;
 const element=()=>({isConnected:true,getClientRects:()=>[{}],pause(){this.paused=true;},play(){this.paused=false;return Promise.resolve();},load(){},remove(){this.isConnected=false;},removeAttribute(k){delete this[k];},videoWidth:640,set src(v){this._src=v;if(this.onloadeddata)queueMicrotask(()=>this.onloadeddata?.());},dataset:{},style:{setProperty(k,v){this[k]=v;}},hidden:false,setAttribute(){},classList:{toggle(k,v){this[k]=v;}},prepend(el){el.parentNode=this;ids.set(el.id,el);}});
 const root=element(),body=element();
 const document={addEventListener(k,fn){events[k]=fn;},documentElement:root,body,readyState:'complete',getElementById:k=>ids.get(k),querySelectorAll:()=>[],createElement(tag){if(tag==='canvas')return{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/webp;base64,YWJj'};return element();}};
 const window={StudioLook:{},addEventListener(k,fn){events[k]=fn;},dispatchEvent(){}};
  window.indexedDB={open(){const req={};queueMicrotask(()=>{req.result={transaction(){const tx={objectStore(){return{get(k){return op(media.get(k));},put(v,k){media.set(k,v);return op(k);},delete(k){media.delete(k);return op();}}}};function op(result){queueMicrotask(()=>tx.oncomplete());return{result};}return tx;},close(){}};req.onsuccess();});return req;}};
 const context={crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,window,document,location:{origin:'http://local'},CustomEvent:class{},localStorage:{getItem:k=>storage[k]??null,setItem(k,v){if(denied)throw Error('quota');storage[k]=v;}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){revoked++;}},Image:class{constructor(){this.naturalWidth=3000;this.naturalHeight=2000;}set src(v){this.onload();}}};
 vm.runInNewContext(source,context);
 return{look:window.StudioLook,root,ids,storage,events,media,deny(){denied=true;},revoked:()=>revoked};
}
(async()=>{
 const app=setup();
 assert.equal(app.look.profile().style,'standard');
 for(const style of ['cartoon','scifi','glass','standard']){
  app.look.setProfile('style',style);assert.equal(app.root.dataset.appearanceStyle,style);
  assert.equal(setup(app.storage).look.profile().style,style);
 }
 assert.throws(()=>app.look.setProfile('style','unknown'));
 assert.equal(setup({studio_appearance_profile:JSON.stringify({style:'invalid',density:'compact'})}).look.profile().style,'standard');
 assert.equal(app.look.profile().density,'standard');
 app.look.setProfile('density','compact');assert.equal(app.root.dataset.appearanceDensity,'compact');
 assert.throws(()=>app.look.setProfile('density','tiny'));
 assert.equal(setup(app.storage).look.profile().density,'compact');
 await app.look.setBackground({type:'image/png',size:100});
 assert.equal(app.revoked(),1);assert(app.look.background().image.startsWith('data:image/webp;'));
 assert.equal(app.ids.get('studio-background-layer').style.opacity,'0.25');
 app.look.setBackgroundStrength(70);assert.equal(app.ids.get('studio-background-layer').style.opacity,'0.7');
 assert.equal(app.root.style['--studio-background-strength'],'0.7');
 assert(app.root.style['--studio-background-image'].includes('data:image/webp;'));
 assert.equal(setup(app.storage).look.background().strength,70);
 await assert.rejects(()=>app.look.setBackground({type:'image/svg+xml',size:100}));
 await assert.rejects(()=>app.look.setBackground({type:'image/png',size:16*1024*1024}));
 app.deny();assert.throws(()=>app.look.setBackgroundStrength(20),/未保存/);assert.equal(app.look.background().strength,70);
 const other=setup(app.storage);await other.look.clearBackground();assert.equal(other.look.background().image,'');assert(other.ids.get('studio-background-layer').hidden);
 const invalid=setup({studio_background:JSON.stringify({image:'url(https://bad)',strength:200})});assert.equal(invalid.look.background().image,'');assert.equal(invalid.look.background().strength,100);
 const video=setup();
 await video.look.setBackground({type:'video/mp4',size:1024});
 const key=video.look.background().video;assert(key);assert(video.media.has(key));assert.equal(video.look.background().image,'');
 video.look.setBackgroundStrength(45);assert.equal(video.root.style['--studio-background-strength'],'0.45');
 const restored=setup(video.storage,video.media);assert.equal(restored.look.background().video,key);
 await assert.rejects(()=>video.look.setBackground({type:'video/mp4',size:51*1024*1024}),/50 MB/);
 await video.look.clearBackground();assert.equal(video.look.background().video,'');assert(!video.media.has(key));
 await video.look.setBackground({type:'video/webm',size:1024});const second=video.look.background().video;
 await video.look.setBackground({type:'image/png',size:100});assert(!video.media.has(second));assert.equal(video.look.background().video,'');
 const deniedVideo=setup();deniedVideo.deny();await assert.rejects(()=>deniedVideo.look.setBackground({type:'video/webm',size:100}),/未保存/);assert.equal(deniedVideo.media.size,0);
 console.log('Appearance: video persistence, replacement, cleanup, quota rollback; presets, restore, image normalization, intensity, removal, invalid input and quota failure passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
