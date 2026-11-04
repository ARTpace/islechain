/* Audio, project files and playable scenes reuse the project workflow and media library. */
(()=>{'use strict';
 const audioTypes=['gameSpeech','gameSoundEffect','gameMusic','gameAudioScene'];
 const types=[...audioTypes,'gameFile','gameFolder','gameScene'];
 const menuTitles={gameSpeech:'音频生成',gameFile:'文件资料'};
 const titles={...menuTitles,gameScene:'试玩与场景',gameSoundEffect:'音频生成',gameMusic:'音频生成',gameAudioScene:'音频生成',gameFolder:'文件资料'};
 const operationLabels={speech:'配音','sound-effect':'音效',music:'音乐','audio-scene':'声音场景'};
 const operations={gameSpeech:'speech',gameSoundEffect:'sound-effect',gameMusic:'music',gameAudioScene:'audio-scene'};
 // ponytail: keep legacy node types/IDs; one mode field unifies their existing generation path.
 const operation=n=>n.audioOperation||operations[n.type]||'speech';
 const esc=v=>escapeHtml(String(v??'')), project=()=>window.GamePipeline?.project;
 const cache=new Map(),loadFailed=new Set(),loading=new Set(),busy=new Set(),polling=new Set();let graphSaving=false,graphError='',savedGraph='',graphProject='';
 const inputs=n=>connections.filter(c=>c.to===n.id).map(c=>nodes.find(n=>n.id===c.from)).filter(Boolean);
 const files=n=>(project()?.projectFiles||[]).filter(f=>(n.fileIds||[]).includes(f.id));
 const text=n=>files(n).map(f=>project()?.documents.find(d=>d.id===f.documentId)?.lastSavedContent||'').filter(Boolean).join('\n\n').slice(0,32768);
 const sourceText=n=>n.type==='document'?(project()?.documents.find(d=>d.id===n.docId)?.lastSavedContent||''):n.type==='gamePlan'?JSON.stringify(project()?.plan||{}):['gameFile','gameFolder'].includes(n.type)?text(n):n.idea||n.text||n.prompt||'';
 const refresh=n=>{scheduleSave();if(nodes.includes(n))refreshNodes([n.id]);};
 const btn=(action,label,attrs='')=>`<button class="tool-btn" type="button" data-extra="${action}" ${attrs}>${label}</button>`;
 async function request(n,path,method='GET',data){
  const p=project();if(p?.id!==n.projectId||p?.canvasId!==canvas?.id||p.archived)throw Error('请回到节点所属的可编辑游戏项目');
  const response=await fetch(`/api/game-projects/${encodeURIComponent(p.id)}${path}`,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json().catch(()=>({}));if(!response.ok){const error=Error(typeof result.detail==='string'?result.detail:Array.isArray(result.detail)?result.detail.map(x=>x.msg).join('；'):'输入或服务配置无效，请检查后重试');error.status=response.status;throw error;}
  if(project()?.id!==p.id||canvas?.id!==p.canvasId)throw Error('已切换项目，结果保存在原项目');return result;
 }
 function dialog(title,body){const d=document.createElement('dialog');d.className='gx-dialog';d.innerHTML=`<header><h2>${esc(title)}</h2><button data-close aria-label="关闭">×</button></header><section>${body}</section><p role="status"></p>`;document.body.append(d);d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();d.showModal();return d;}
 const field=(name,label,value='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}"></label>`;
 const fail=(n,e)=>{n.extraNotice=e.message;refresh(n);};
 async function load(n){if(cache.has(n.projectId)||loading.has(n.projectId))return;loading.add(n.projectId);try{cache.set(n.projectId,await request(n,'/audio/connections'));loadFailed.delete(n.projectId);for(const node of nodes.filter(x=>audioTypes.includes(x.type)&&x.projectId===n.projectId))delete node.extraNotice;refreshNodes(nodes.filter(x=>audioTypes.includes(x.type)&&x.projectId===n.projectId).map(x=>x.id));}catch(e){loadFailed.add(n.projectId);fail(n,e);}finally{loading.delete(n.projectId);}}
 function audioURL(n){if(n.audioJob&&['succeeded','adopted'].includes(n.audioJob.status))return `/api/game-projects/${n.projectId}/audio/jobs/${n.audioJob.jobId}/content`;const a=project()?.mediaAssets?.find(a=>a.id===n.audioAssetId);return a?`/api/game-projects/${n.projectId}/workspace/media-assets/${a.id}/content`:'';}
 function nodeBody(n,target){
  target.className='node-body gx-node';target.onwheel=e=>e.stopPropagation();const locked=project()?.archived||project()?.id!==n.projectId;
  if(audioTypes.includes(n.type)){
   if(project()?.id===n.projectId&&!cache.has(n.projectId)&&!loadFailed.has(n.projectId))void load(n);
   const data=cache.get(n.projectId), choices=(data?.connections||[]).filter(c=>c.enabled&&c.hasKey&&(operation(n)==='speech'||c.protocol==='volcengine-seed-audio'));
   if(!choices.some(c=>c.id===n.audioConnection)&&choices.length)n.audioConnection=choices[0].id;
   const url=audioURL(n),job=n.audioJob,running=busy.has(n.id)||['queued','running'].includes(job?.status);
   target.innerHTML=`<div class="gx-media">${url?`<audio controls preload="metadata" src="${esc(url)}"></audio>`:`<span class="gx-symbol">♫</span><span>生成后在此试听</span>`}</div><select data-audio-mode aria-label="音频类型" ${running||n.audioPending?'disabled':''}>${Object.entries(operationLabels).map(([value,label])=>`<option value="${value}" ${operation(n)===value?'selected':''}>${label}</option>`).join('')}</select><textarea data-prompt rows="2" aria-label="音频描述" placeholder="${operation(n)==='speech'?'输入配音台词，或连接文本资料':'描述需要的声音，也可连接策划资料'}">${esc(n.audioPrompt)}</textarea><div class="gx-actions">${btn(job?.status==='succeeded'?'adopt':'generate',job?.status==='succeeded'?'采用到游戏资产':running?'正在生成…':'生成音频',running?'disabled':'')}${btn('audio-settings','设置','aria-label="音频设置"')}${btn(n.audioAssetId?'asset-details':'audio-history',n.audioAssetId?'已采用资产':'记录')}</div><p class="gx-status" role="status">${esc(n.extraNotice||job?.message||(choices.length?'已连接 '+choices.find(c=>c.id===n.audioConnection)?.name:'先在设置中连接音频服务'))}</p>${running?btn('cancel','停止等待'):''}`;
   target.querySelector('[data-audio-mode]').onchange=e=>{n.audioOperation=e.target.value;delete n.audioJob;delete n.audioAssetId;delete n.audioPending;delete n.extraNotice;refresh(n);};
   target.querySelector('[data-prompt]').oninput=e=>{n.audioPrompt=e.target.value;delete n.audioPending;scheduleSave();};
  }else if(['gameFile','gameFolder'].includes(n.type)){
   const items=files(n);
   target.innerHTML=`<div class="gx-file-list">${items.length?items.map(f=>`<div><span title="${esc(f.path)}">${esc(f.path)}</span><small>${(f.sizeBytes/1024).toFixed(1)} KB${f.documentId?' · 可作文本参考':''}</small></div>`).join(''):`<div class="gx-empty">导入文件或文件夹，保留目录结构</div>`}</div><div class="gx-actions">${btn('import',items.length?'添加文件':'导入文件')}${btn('import-folder','导入文件夹')}${items.length?btn('browse','查看 / 下载'):''}</div><p class="gx-status">${esc(n.extraNotice||(items.length?`${items.length} 个文件 · 连接策划或开发节点作为资料`:'文本可供 AI 参考，其他文件保留下载'))}</p>`;
  }else{
   n.sceneSource??=defaultSource(n.title||'新场景');n.sceneSignals??=['next'];
   const has=project()?.playableGraph?.nodes.some(s=>s.id===n.id),url=has?`/api/game-projects/${n.projectId}/node-assets/graph/preview?entry=${n.id}&v=${hash(previewKey())}&embedded=true`:'';
   const existing=target.querySelector('iframe');
   if(existing&&existing.dataset.url===url){updateSceneTools(n,target);return;}
   target.innerHTML=`<div class="gx-scene-window">${url?`<iframe title="${esc(n.title||'可玩场景')}" sandbox="allow-scripts" src="${esc(url)}" data-url="${esc(url)}"></iframe>`:'<div class="gx-empty">正在准备场景预览…</div>'}<button class="gx-play" data-extra="toggle" aria-label="开始试玩" title="开始 / 停止试玩">▶</button></div>${window.GameExtraNodes.modeControl(n)}<div class="gx-actions">${btn('scene-settings','场景与出口')}${btn('entry','设为入口')}${btn('graph-save','保存场景')}</div><details><summary>测试与问题反馈</summary><p data-scene-diagnostic>${esc(n.extraNotice||'场景运行错误会显示在这里；工程自动化测试请切换到工程试玩。')}</p></details><p class="gx-status" role="status"></p>`;
   const frame=target.querySelector('iframe');if(frame){frame.style.pointerEvents='none';frame.tabIndex=-1;}if(frame)frame.onload=()=>{n.scenePlaying=false;frame.contentWindow.postMessage({type:'game-node-control',enabled:false},'*');};updateSceneTools(n,target);
  }
  window.GameExtraNodes.bindMode(n,target);
  target.querySelectorAll('[data-extra]').forEach(b=>b.onclick=e=>{e.stopPropagation();void action(n,b.dataset.extra,target).catch(e=>fail(n,e));});
  target.querySelectorAll('button,input,textarea,select').forEach(el=>{if(locked)el.disabled=true;});
 }
 function defaultSource(title){return `const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');\nctx.fillStyle='#152b3d';ctx.fillRect(0,0,800,600);\nctx.fillStyle='#e3f6ff';ctx.font='32px sans-serif';ctx.fillText(${JSON.stringify(title)},50,100);\nctx.font='20px sans-serif';ctx.fillText('点击进入下一场景',50,160);\ncanvas.addEventListener('click',()=>GameScene.emit('next',{visits:(GameScene.state.visits||0)+1}));`;}
 function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(31,h)+s.charCodeAt(i))|0;return (h>>>0).toString(36);}
 function sceneNodes(){return nodes.filter(n=>(n.type==='gameScene'||(n.type==='gameTest'&&n.sceneSource!==undefined))&&n.projectId===project()?.id);}
 function graph(){
  const list=sceneNodes();if(!list.length)return null;
  const initialState=project()?.playableGraph?.initialState||{};
  const entry=project()?.playableGraph?.entryNodeId;
  return {version:1,entryNodeId:list.some(n=>n.id===entry)?entry:list[0].id,initialState,nodes:list.map(n=>({id:n.id,title:n.title||'可玩场景',source:n.sceneSource??defaultSource('新场景'),signals:n.sceneSignals||['next']})),edges:connections.filter(c=>list.some(n=>n.id===c.from)&&list.some(n=>n.id===c.to)).map(c=>({source:c.from,target:c.to,signal:c.sceneSignal||(list.find(n=>n.id===c.from)?.sceneSignals||['next'])[0]}))};
 }
 const graphKey=()=>JSON.stringify(graph());
 const previewKey=()=>JSON.stringify([graph(),(project()?.mediaAssets||[]).map(a=>[a.id,a.contentHash,a.enabled]),(project()?.assets||[]).map(a=>[a.id,a.selected?.contentHash])]);
 async function saveGraph(force=false){
  const g=graph();if(graphSaving||project()?.archived)return;if(graphProject!==project()?.id){graphProject=project()?.id;savedGraph='';graphError='';}if(!g&&(!savedGraph||!project()?.playableGraph))return;
  const key=JSON.stringify(g);if(!force&&key===savedGraph)return;
  graphSaving=true;try{await GamePipeline.workflow(async ctx=>{await ctx.write('/node-assets/graph','PUT',{graph:g});});savedGraph=key;graphError='';scheduleSave();refreshNodes(sceneNodes().map(n=>n.id));}catch(e){graphError=e.message;if(force)throw e;}finally{graphSaving=false;}
 }
 function updateSceneTools(n,target){const diagnostic=target.querySelector('[data-scene-diagnostic]');if(diagnostic)diagnostic.textContent=n.extraNotice||'场景运行错误会显示在这里；工程自动化测试请切换到工程试玩。';const status=target.querySelector('[role=status]');if(status)status.textContent=n.extraNotice||graphError||`${project()?.playableGraph?.entryNodeId===n.id?'入口场景 · ':''}${(n.sceneSignals||['next']).join(' / ')} 出口 · 连线后自动保存`;}
 async function action(n,name,target){
  n.extraNotice='';
  if(name==='toggle'){n.scenePlaying=!n.scenePlaying;const frame=target.querySelector('iframe');frame?.contentWindow.postMessage({type:'game-node-control',enabled:n.scenePlaying},'*');if(frame){frame.style.pointerEvents=n.scenePlaying?'auto':'none';frame.tabIndex=n.scenePlaying?0:-1;}const b=target.querySelector('[data-extra=toggle]');b.textContent=n.scenePlaying?'■':'▶';b.setAttribute('aria-label',n.scenePlaying?'停止试玩':'开始试玩');return;}
  if(name==='import'||name==='import-folder'){
   const input=document.createElement('input');input.type='file';input.multiple=true;if(name==='import-folder')input.webkitdirectory=true;
   input.onchange=()=>void importFiles(n,[...input.files]).catch(e=>fail(n,e));input.click();return;
  }
  if(name==='browse'){
   const items=files(n),d=dialog('项目文件',items.map(f=>`<article><strong>${esc(f.path)}</strong><a download="${esc(f.path.split('/').at(-1))}" href="/api/game-projects/${n.projectId}/node-assets/files/${f.id}">下载</a>${f.documentId?`<pre>${esc(project()?.documents.find(x=>x.id===f.documentId)?.lastSavedContent)}</pre>`:'<p>此格式保留原文件，不作为文本发送给 AI。</p>'}</article>`).join('')+`<a download href="/api/game-projects/${n.projectId}/node-assets/folder?ids=${items.map(f=>f.id).join(',')}">下载整个文件夹 ZIP</a>`);return;
  }
  if(name==='graph-save')return saveGraph(true);
  if(name==='entry'){const g=graph();g.entryNodeId=n.id;await GamePipeline.workflow(ctx=>ctx.write('/node-assets/graph','PUT',{graph:g}));savedGraph=JSON.stringify(g);refreshNodes(sceneNodes().map(n=>n.id));return;}
  if(name==='scene-settings')return sceneSettings(n);
  if(name==='audio-settings')return audioSettings(n);
  if(name==='asset-details'){
   const asset=project()?.mediaAssets.find(a=>a.id===n.audioAssetId);if(!asset)throw Error('所选音频资产不存在，请刷新项目');
   const d=dialog('已采用音频资产',`<strong>${esc(asset.name)}</strong><audio controls src="/api/game-projects/${n.projectId}/workspace/media-assets/${asset.id}/content"></audio><p>所属项目：${esc(project().title)}</p><p>用途：${esc(asset.purpose)}</p><label>开发时使用的资产 ID<input readonly value="${esc(asset.id)}"></label><p>将节点右侧连到游戏开发或可玩场景节点。AI 可通过 GameAssets.createAudio(资产ID) 使用这段音频。</p><div class="gx-actions">${btn('add-scene','新建并连接场景')}${btn('history','任务记录')}</div><a download="${esc(asset.name)}" href="/api/game-projects/${n.projectId}/workspace/media-assets/${asset.id}/content">下载音频</a>`);
   d.querySelector('[data-extra=history]').onclick=()=>{d.close();void action(n,'audio-history',target).catch(e=>fail(n,e));};
   d.querySelector('[data-extra=add-scene]').onclick=async()=>{const scene=await GameWorkflow.addNode('gameScene',{x:n.x+500,y:n.y});if(scene){connections.push({id:uid('c'),from:n.id,to:scene.id});scene.sceneSource=`const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle='#16364a';ctx.fillRect(0,0,800,600);ctx.fillStyle='white';ctx.font='28px sans-serif';ctx.fillText('点击播放音频',50,140);canvas.onclick=()=>GameScene.audio.play(${JSON.stringify(asset.id)},{loop:true});`;scheduleSave();render();d.close();}};return;
  }
  if(name==='audio-history'){
   const jobs=(await request(n,'/audio/jobs')).filter(j=>j.nodeId===n.id),d=dialog('音频任务记录',jobs.map(j=>`<article><strong>${esc(new Date(j.createdAt*1000).toLocaleString())}</strong><p>${esc(j.message)}</p><button data-job="${j.jobId}">查看</button></article>`).join('')||'<p>尚无任务</p>');d.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>{n.audioJob=jobs.find(j=>j.jobId===b.dataset.job);refresh(n);d.close();});return;
  }
  if(name==='cancel'){n.audioJob=await request(n,`/audio/jobs/${n.audioJob.jobId}/cancel`,'POST');refresh(n);return;}
  if(name==='adopt'){await GamePipeline.workflow(async ctx=>{const result=await ctx.write(`/audio/jobs/${n.audioJob.jobId}/adopt`,'POST',{name:operationLabels[operation(n)],purpose:n.audioPurpose||n.audioPrompt||operationLabels[operation(n)]});n.audioAssetId=result.assetId;n.audioJob={...n.audioJob,status:'adopted',message:'已接入游戏资产，可连接开发或场景节点'};});refresh(n);return;}
  if(name==='generate'){
   const prompt=[n.audioPrompt,...inputs(n).map(sourceText)].filter(Boolean).join('\n\n').trim();if(!prompt)throw Error('请输入声音描述或连接文本资料');if(prompt.length>2744)throw Error('合并描述超过2744字，请精简连接资料');
   const settings={...(n.audioSettings||{})};if(operation(n)==='speech'&&!settings.voiceId)settings.voiceId=cache.get(n.projectId)?.catalog.voices[0]?.id||'';if(operation(n)==='speech')delete settings.durationSeconds;const pending=n.audioPending;
   const body=pending||{baseRevision:project().revision,requestId:crypto.randomUUID(),nodeId:n.id,connectionId:n.audioConnection||'',operation:operation(n),prompt,...settings};
   n.audioPending=body;scheduleSave();busy.add(n.id);refresh(n);
   try{n.audioJob=await request(n,'/audio/jobs','POST',body);delete n.audioPending;}catch(e){if(e.status===409){delete n.audioPending;await GamePipeline.canvasLoaded();}throw e;}finally{busy.delete(n.id);refresh(n);}return;
  }
 }
 async function audioSettings(n){
  await load(n);const data=cache.get(n.projectId)||{connections:[],catalog:{voices:[],models:[]}},s=n.audioSettings||{};
  const d=dialog('音频设置',`<label>音频服务<select name="connection"><option value="">选择服务</option>${data.connections.filter(c=>operation(n)==='speech'||c.protocol==='volcengine-seed-audio').map(c=>`<option value="${esc(c.id)}" ${c.id===n.audioConnection?'selected':''}>${esc(c.name)}${c.hasKey?'':'（未配置密钥）'}</option>`).join('')}</select></label><label>音色<select name="voiceId"><option value="">默认 / 不指定</option>${data.catalog.voices.map(v=>`<option value="${esc(v.id)}" ${v.id===s.voiceId?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label>${operation(n)==='speech'?'':field('durationSeconds','目标时长（秒，1–120）',s.durationSeconds||10,'number')}${field('style','声音风格',s.style)}${field('speed','语速（-50–100）',s.speed||0,'number')}${field('pitch','音高（-12–12）',s.pitch||0,'number')}${field('volume','音量（-50–100）',s.volume||0,'number')}<label>输出格式<select name="format">${['mp3','wav','ogg_opus'].map(f=>`<option ${s.format===f?'selected':''}>${f}</option>`).join('')}</select></label>${field('purpose','游戏中的用途',n.audioPurpose)}<div class="gx-actions">${btn('save-settings','保存设置')}${btn('connection','管理音频连接')}</div><small>音乐生成仅支持纯音乐；当前模型不保证无缝循环。音频接口与聊天模型接口独立。</small>`);
  const updateFormats=()=>{const c=data.connections.find(c=>c.id===d.querySelector('[name=connection]').value);const option=d.querySelector('[name=format] option[value=wav]');if(option){option.disabled=c?.protocol==='volcengine-tts';if(option.disabled&&option.selected)d.querySelector('[name=format]').value='mp3';}};d.querySelector('[name=connection]').onchange=updateFormats;updateFormats();
  d.querySelector('[data-extra=connection]').onclick=()=>configureAudio(n,d);
  d.querySelector('[data-extra=save-settings]').onclick=()=>{n.audioConnection=d.querySelector('[name=connection]').value;n.audioSettings={voiceId:d.querySelector('[name=voiceId]').value,format:d.querySelector('[name=format]').value,style:d.querySelector('[name=style]').value,...Object.fromEntries(['speed','pitch','volume'].map(k=>[k,Number(d.querySelector(`[name=${k}]`).value)]))};if(operation(n)!=='speech')n.audioSettings.durationSeconds=Number(d.querySelector('[name=durationSeconds]').value);n.audioPurpose=d.querySelector('[name=purpose]').value;delete n.audioPending;refresh(n);d.close();};
 }
 function configureAudio(n,parentDialog){
  const entries=cache.get(n.projectId)?.connections||[],old=entries.find(c=>c.id===n.audioConnection);
  const d=dialog('音频服务连接',`<label>已有连接<select name="existing"><option value="">新建连接</option>${entries.map(c=>`<option value="${esc(c.id)}" ${c.id===old?.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>${field('name','名称',old?.name||'豆包音频')}<label>服务协议<select name="protocol"><option value="volcengine-seed-audio">Seed Audio · 音效 / 音乐 / 声音场景</option><option value="volcengine-tts">Seed TTS 2.0 · 配音</option></select></label>${field('baseUrl','接口完整地址（留空使用官方地址）',old?.baseUrl)}${field('apiKey',old?.hasKey?'API Key（留空保留）':'API Key','','password')}${btn('save','保存连接')}`);
  d.querySelector('[name=protocol]').value=old?.protocol||'volcengine-seed-audio';
  d.querySelector('[name=existing]').onchange=e=>{const c=entries.find(c=>c.id===e.target.value);for(const k of ['name','protocol','baseUrl'])d.querySelector(`[name=${k}]`).value=c?.[k]||(k==='protocol'?'volcengine-seed-audio':'');d.querySelector('[name=apiKey]').value='';};
  d.querySelector('[data-extra=save]').onclick=async()=>{try{const get=k=>d.querySelector(`[name=${k}]`).value;const result=await request(n,'/audio/connections','PUT',{id:get('existing')||uid('audio'),name:get('name'),protocol:get('protocol'),baseUrl:get('baseUrl'),apiKey:get('apiKey')||null,enabled:true});n.audioConnection=result.id;cache.delete(n.projectId);await load(n);d.close();parentDialog.close();await audioSettings(n);}catch(e){d.querySelector('[role=status]').textContent=e.message;}};
 }
 function sceneSettings(n){
  const outgoing=connections.filter(c=>c.from===n.id&&nodes.some(x=>x.id===c.to&&x.type==='gameScene'));
  const d=dialog('场景与出口',`${field('title','场景名称',n.title||'新场景')}${field('signals','出口信号（逗号分隔）',(n.sceneSignals||['next']).join(','))}<label>场景 JavaScript<textarea name="source" class="gx-code" spellcheck="false">${esc(n.sceneSource)}</textarea></label><small>GameScene.state 读取共享状态；GameScene.setState({score:1}) 更新；GameScene.emit('next', {score:2}) 从出口跳转。使用 GAME_CONFIG.assets 或 GameAssets 读取已采用素材。</small><label>初始共享状态 JSON<textarea name="state">${esc(JSON.stringify(project()?.playableGraph?.initialState||{},null,2))}</textarea></label>${outgoing.map(c=>field('edge-'+c.id,'→ '+(nodes.find(x=>x.id===c.to)?.title||'场景')+' 的出口信号',c.sceneSignal||'next')).join('')}<div class="gx-actions">${btn('save','保存场景')}${btn('workspace','从已连接开发节点导入代码')}</div>`);
  d.querySelector('[data-extra=workspace]').onclick=async()=>{try{if(!inputs(n).some(x=>x.type==='gameDevelop'))throw Error('请先将游戏开发节点连接到此场景');const overview=await request(n,'/workspace');const candidates=overview.files.filter(f=>f.path.endsWith('.js'));let paths=candidates.map(f=>f.path);const manifestFile=overview.files.find(f=>f.path==='game-project.json');if(manifestFile){const manifest=await request(n,'/workspace/file?path=game-project.json');const value=JSON.parse(manifest.content);paths=value.scripts||paths;}const content=[];for(const path of paths){const item=await request(n,'/workspace/file?path='+encodeURIComponent(path));content.push(item.content);}d.querySelector('[name=source]').value=content.join('\n;\n');d.querySelector('[role=status]').textContent='已导入源码，请添加出口 GameScene.emit 后保存';}catch(e){d.querySelector('[role=status]').textContent=e.message;}};
  d.querySelector('[data-extra=save]').onclick=async()=>{try{const signals=d.querySelector('[name=signals]').value.split(',').map(x=>x.trim()).filter(Boolean);if(!signals.length||signals.some(x=>!/^[-\w]{1,80}$/.test(x))||new Set(signals).size!==signals.length)throw Error('出口须为不重复的英文、数字、下划线或短横线');const state=JSON.parse(d.querySelector('[name=state]').value);const g=graph();Object.assign(g.nodes.find(x=>x.id===n.id),{title:d.querySelector('[name=title]').value,source:d.querySelector('[name=source]').value,signals});g.initialState=state;for(const c of outgoing){const edge=g.edges.find(e=>e.source===c.from&&e.target===c.to);edge.signal=d.querySelector(`[name="edge-${c.id}"]`).value.trim();}await GamePipeline.workflow(ctx=>ctx.write('/node-assets/graph','PUT',{graph:g}));const value=g.nodes.find(x=>x.id===n.id);n.title=value.title;n.sceneSource=value.source;n.sceneSignals=signals;for(const c of outgoing)c.sceneSignal=g.edges.find(e=>e.source===c.from&&e.target===c.to).signal;savedGraph=JSON.stringify(g);scheduleSave();refreshNodes(sceneNodes().map(x=>x.id));d.close();}catch(e){d.querySelector('[role=status]').textContent=e.message;}};
 }
 async function importFiles(n,list){
  list=list.filter(f=>!(f.webkitRelativePath||f.name).split('/').some(x=>['.git','node_modules','__pycache__'].includes(x)||x==='.env'||x.startsWith('.env.')));if(!list.length)return;if(list.reduce((sum,f)=>sum+f.size,0)>256*1048576)throw Error('一次导入总量最大256MiB');if(list.length>200)throw Error('一次最多200个文件');
  const encoded=[];for(const file of list){if(file.size>32*1048576)throw Error('单文件最大32MiB');const raw=await file.arrayBuffer();let binary='';const bytes=new Uint8Array(raw);for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));encoded.push({path:file.webkitRelativePath||file.name,contentBase64:btoa(binary)});}
  await GamePipeline.workflow(async ctx=>{const result=await ctx.write('/node-assets/files','POST',{files:encoded});n.fileIds=[...(n.fileIds||[]),...result.fileIds];});refresh(n);
 }
 function canConnect(from,to){
  if(!types.includes(from?.type)&&!types.includes(to?.type))return null;
  if(from.projectId&&to.projectId&&from.projectId!==to.projectId)return false;
  if(from.type==='gameScene'&&to.type==='gameRelease')return from.projectId===to.projectId;
  if(from.type==='gameScene'&&to.type==='gameScene')return from.projectId===to.projectId;
  if(['gameFile','gameFolder'].includes(from.type))return ['gamePlan','gameDevelop',...audioTypes].includes(to.type)&&from.projectId===to.projectId;
  if(audioTypes.includes(from.type))return ['gameDevelop','gameScene'].includes(to.type)&&from.projectId===to.projectId;
  if(audioTypes.includes(to.type))return ['prompt','document','gamePlan','gameIdea','gameFile','gameFolder'].includes(from.type);
  if(to.type==='gameScene')return ['gameDevelop','gameModelAsset','gameModel3d','gameAnimate3d',...audioTypes].includes(from.type)&&from.projectId===to.projectId;
  return false;
 }
 async function tick(){
  if(!project()||project().archived)return;
  for(const n of nodes.filter(n=>audioTypes.includes(n.type)&&n.projectId===project().id&&['queued','running'].includes(n.audioJob?.status))){if(polling.has(n.id))continue;polling.add(n.id);try{const j=await request(n,'/audio/jobs/'+n.audioJob.jobId);if(nodes.includes(n)&&n.audioJob.jobId===j.jobId){n.audioJob=j;refresh(n);}}catch(e){fail(n,e);}finally{polling.delete(n.id);}}
  if(sceneNodes().length||(graphProject===project().id&&savedGraph&&project().playableGraph))await saveGraph();
 }
 addEventListener('message',e=>{
  if(e.data?.type==='scene-diagnostic'){const node=sceneNodes().find(n=>document.querySelector(`[data-id="${n.id}"] .gx-scene-window iframe`)?.contentWindow===e.source);if(node){node.extraNotice=String(e.data.message).slice(0,1000);updateSceneTools(node,document.querySelector(`[data-id="${node.id}"]`));}return;}
  if(e.data?.type!=='scene-storage'||!['save','load'].includes(e.data.action))return;
  const n=sceneNodes().find(n=>document.querySelector(`[data-id="${n.id}"] .gx-scene-window iframe`)?.contentWindow===e.source);
  if(!n||e.data.projectId!==project()?.id)return;
  try{const key='scene-save:'+n.projectId;let value=null;if(e.data.action==='save'){if(JSON.stringify(e.data.value).length>40000)throw Error('存档过大');localStorage.setItem(key,JSON.stringify(e.data.value));}else value=JSON.parse(localStorage.getItem(key));e.source.postMessage({type:'scene-storage-result',requestId:e.data.requestId,value},'*');}catch(err){e.source.postMessage({type:'scene-storage-result',requestId:e.data.requestId,error:err.message},'*');}
 });
 setInterval(()=>void tick(),2500);
 function preserve(n,el){if(!el||n.type!=='gameScene')return false;const frame=el.querySelector('.gx-scene-window iframe');if(!frame)return false;const has=project()?.playableGraph?.nodes.some(s=>s.id===n.id),url=has?`/api/game-projects/${n.projectId}/node-assets/graph/preview?entry=${n.id}&v=${hash(previewKey())}&embedded=true`:'';if(frame.dataset.url!==url)return false;updateSceneTools(n,el);return true;}
 function linkOptions(n,kind){
  if(kind!=='out'||!types.includes(n.type))return null;
  const targets=n.type==='gameScene'?['gameScene']:audioTypes.includes(n.type)?['gameScene','gameDevelop']:['gamePlan','gameDevelop','gameSpeech'];
  return targets.map(type=>({type,label:titles[type]||({gamePlan:'AI 游戏策划',gameDevelop:'游戏开发'})[type],icon:type==='gameDevelop'?'code':type==='gamePlan'?'clipboard-list':type==='gameScene'?'gamepad-2':'music'}));
 }
 function modeControl(n){return `<label class="gx-preview-mode">试玩来源<select data-preview-mode aria-label="试玩来源"><option value="gameTest" ${n.type==='gameTest'?'selected':''}>开发工程</option><option value="gameScene" ${n.type==='gameScene'?'selected':''}>场景与出口</option></select></label>`;}
 function bindMode(n,target){const select=target.querySelector('[data-preview-mode]');if(!select)return;select.disabled=!!project()?.archived;select.onchange=()=>{pushUndo();window.GameDevelopment?.resetPlayer(n);n.type=select.value;n.scenePlaying=false;delete n.h;scheduleSave();render();};}
 window.GameExtraNodes={modeControl,bindMode,linkOptions,types,titles,menuTitles,operation,audioTypes,nodeBody,canConnect,files,text,sourceText,graph,saveGraph,defaultSource,preserve,active:n=>n?.type==='gameScene',importFiles};
})();
