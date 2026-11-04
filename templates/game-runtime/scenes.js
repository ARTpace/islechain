/* Scene graph routing, shared state and save slots. No editor privileges. */
(()=>{'use strict';
 const graph=GAME_CONFIG.sceneGraph, frame=document.querySelector('iframe'), status=document.querySelector('#status');
 let state=structuredClone(graph.initialState), current=graph.entryNodeId, enabled=GAME_CONFIG.embedded!==true, generation=0;
 const sounds=new Map(),storageRequests=new Map();let serial=0;
 const key='game-scene-save:'+ (GAME_CONFIG.projectId||'preview');
 const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c');
 function render(id){
  const node=graph.nodes.find(n=>n.id===id);if(!node)throw Error('场景不存在');
  current=id;generation++;status.textContent=node.title;
  const config={...GAME_CONFIG,sceneGraph:undefined,assets:Object.fromEntries(Object.entries(GAME_CONFIG.assets||{}).map(([k,v])=>[k,new URL(v,location.href).href]))};
  const bridge=`window.GameScene={state:${safe(state)},emit(signal,patch){parent.postMessage({type:'scene-exit',generation:${generation},signal,state:{...this.state,...patch}},'*')},audio:{play(id,options){parent.postMessage({type:'scene-audio',generation:${generation},action:'play',id,options},'*')},stop(id){parent.postMessage({type:'scene-audio',generation:${generation},action:'stop',id},'*')}},setState(patch){Object.assign(this.state,patch);parent.postMessage({type:'scene-state',generation:${generation},state:this.state},'*')}};`;
  const diagnostics=`addEventListener('error',e=>parent.postMessage({type:'scene-error',generation:${generation},message:e.message},'*'));addEventListener('unhandledrejection',e=>parent.postMessage({type:'scene-error',generation:${generation},message:String(e.reason)},'*'));`;
  const code=bridge+diagnostics+SCENE_RUNTIME.assetsRuntime+'\n;(()=>{\n'+node.source+'\n})();';
  const close='</'+'script>';
  frame.onload=()=>frame.contentWindow.postMessage({type:'game-node-control',channel:'scene-preview',enabled},'*');
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#10191e;color:white;font:16px system-ui}canvas{width:100%;height:100%;object-fit:contain}button{padding:12px}</style></head><body>'+SCENE_RUNTIME.preview+'<canvas width="800" height="600" tabindex="0"></canvas><div id="hud"></div><p id="message"></p><nav hidden><button id="restart"></button><button id="pause"></button><select id="slot"><option value="1">1</option></select><button id="save"></button><button id="load"></button><button id="clear"></button></nav><script>window.GAME_CONFIG='+safe(config)+';'+close+'<script>'+code.replace(/<\/script/gi,'<\\/script')+close+'</body></html>';
 }
 function accept(value){if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>32768)throw Error('共享状态须为32KiB内的对象');return structuredClone(value);}
 addEventListener('message',e=>{
  if(e.source===parent&&e.data?.type==='scene-storage-result'){const work=storageRequests.get(e.data.requestId);if(work){storageRequests.delete(e.data.requestId);e.data.error?work.reject(Error(e.data.error)):work.resolve(e.data.value);}return;}
  if(e.source===parent&&e.data?.type==='game-node-control'){enabled=e.data.enabled===true;for(const audio of sounds.values()){if(!enabled)audio.pause();else void audio.play().catch(()=>{});}frame.contentWindow.postMessage({type:'game-node-control',channel:'scene-preview',enabled},'*');return;}
  if(e.source!==frame.contentWindow||!['scene-exit','scene-state','scene-audio','scene-error'].includes(e.data?.type)||e.data.generation!==generation||!enabled)return;
  try{
   if(e.data.type==='scene-error'){status.textContent=String(e.data.message).slice(0,1000);parent.postMessage({type:'scene-diagnostic',message:status.textContent},'*');dispatchEvent(new ErrorEvent('error',{message:String(e.data.message)}));return;}
   if(e.data.type==='scene-audio'){
    const id=e.data.id;if(e.data.action==='stop'){sounds.get(id)?.pause();sounds.delete(id);return;}
    if(GAME_CONFIG.assetInfo?.[id]?.kind!=='audio'||!GAME_CONFIG.assets[id])return;
    let audio=sounds.get(id);if(!audio){if(sounds.size>=16)throw Error('同时播放音轨最多16条');audio=new Audio(GAME_CONFIG.assets[id]);sounds.set(id,audio);}
    audio.loop=e.data.options?.loop===true;audio.volume=Math.max(0,Math.min(1,Number(e.data.options?.volume??1)));void audio.play().catch(err=>{status.textContent=err.message;});return;
   }
   state=accept(e.data.state);
   if(e.data.type==='scene-exit'){
    const edge=graph.edges.find(x=>x.source===current&&x.signal===e.data.signal);
    if(!edge){status.textContent='未连接出口：'+String(e.data.signal);return;}
    render(edge.target);
   }
  }catch(err){status.textContent=err.message;}
 });
 document.querySelector('#restart').onclick=()=>{state=structuredClone(graph.initialState);render(graph.entryNodeId);};
 function storage(action,value){
  try{if(action==='save'){localStorage.setItem(key,JSON.stringify(value));return Promise.resolve(null);}return Promise.resolve(JSON.parse(localStorage.getItem(key)));}
  catch(_){return new Promise((resolve,reject)=>{const requestId=++serial;storageRequests.set(requestId,{resolve,reject});parent.postMessage({type:'scene-storage',projectId:GAME_CONFIG.projectId,action,value,requestId},'*');setTimeout(()=>{if(storageRequests.delete(requestId))reject(Error('当前页面不支持存档'));},3000);});}
 }
 document.querySelector('#save').onclick=async()=>{try{await storage('save',{current,state});status.textContent='已保存';}catch(e){status.textContent=e.message;}};
 document.querySelector('#load').onclick=async()=>{try{const value=await storage('load');state=accept(value.state);render(value.current);}catch(_){status.textContent='无可用存档';}};
 render(current);
})();
