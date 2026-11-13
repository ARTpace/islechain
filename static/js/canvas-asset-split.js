/* Split algorithm is bundled from PlaneGenerator lib/split-assets/split.ts. */
(()=>{'use strict';
 const busy=new Set();
 const save=()=>scheduleSave();
 const refs=n=>connections.filter(c=>c.to===n.id).flatMap(c=>{const source=nodes.find(s=>s.id===c.from);return source?imageRefsFromNode(source):[];});
 const images=n=>(n.splitPieces||[]).filter(p=>p.selected!==false).map(p=>({url:p.url,name:p.name,kind:'image'}));
 function create(point){const p=point||defaultPoint(0,0);return addNode({id:uid('split'),type:'assetSplit',x:p.x,y:p.y,w:440,splitBackground:'auto',splitThreshold:24,splitMinArea:80});}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 async function upload(files){const form=new FormData();form.append('canvas_id',canvas.id);for(const f of files)form.append('files',f);const r=await fetch('/api/ai/upload',{method:'POST',body:form}),data=await r.json();if(!r.ok||!data.files?.length)throw Error(data.detail||'上传失败');return data.files;}
 async function load(url){const response=await fetch(url);if(!response.ok)throw Error('图片读取失败');const bitmap=await createImageBitmap(await response.blob());try{if(bitmap.width*bitmap.height>20000000)throw Error('请使用 2000 万像素以内的素材图');const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,c.width,c.height);}finally{bitmap.close();}}
 function refresh(n){save();if(nodes.includes(n))refreshNodes([n.id]);}
 async function split(n,status){const source=n.splitSource||refs(n)[0]?.url;if(!source)throw Error('请上传图片或连接图片节点');status.textContent='正在拆分…';await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  const image=await load(source),pieces=SpriteSheetSplit.splitSpriteSheet(image,{background:n.splitBackground||'auto',threshold:Number(n.splitThreshold??24),margin:2,minArea:Number(n.splitMinArea??80),eraseDividers:false,dividerBand:0,openRadius:0,defringe:true});
  if(!pieces.length)throw Error('未找到独立元素，请调整背景或阈值');if(pieces.length>300)throw Error('碎片超过 300 个，请提高最小面积后重试');
  status.textContent=`正在保存 ${pieces.length} 个元素…`;
  const stored=[];for(let i=0;i<pieces.length;i+=12){const batch=pieces.slice(i,i+12);const files=await Promise.all(batch.map(async p=>new File([await (await fetch(p.dataUrl)).blob()],p.id+'.png',{type:'image/png'})));stored.push(...await upload(files));}
  if(stored.length!==pieces.length)throw Error('部分图片未保存，请重试');
  pushUndo();n.splitWidth=image.width;n.splitHeight=image.height;n.splitUsedSource=source;n.splitPieces=pieces.map((p,i)=>({id:p.id,name:p.id,x:p.x,y:p.y,w:p.w,h:p.h,url:stored[i].url,selected:true}));syncConnectedOutputsFromGenerated(n,images(n));refresh(n);
 }
 async function exportPieces(n,kind){const selected=(n.splitPieces||[]).filter(p=>p.selected!==false);if(!selected.length)throw Error('请先拆分并选择元素');
  const files=await Promise.all(selected.map(async(p,i)=>{const r=await fetch(p.url);if(!r.ok)throw Error('元素图片读取失败');return {name:String(i+1).padStart(3,'0')+'-'+p.name.replace(/[\\/:*?"<>|]/g,'_')+'.png',bytes:new Uint8Array(await r.arrayBuffer())};}));
  if(kind==='zip'){files.push({name:'layout.json',bytes:new TextEncoder().encode(JSON.stringify({width:n.splitWidth,height:n.splitHeight,layers:selected},null,2))});download(AssetSplitExport.zip(files),'拆分素材.zip');}
  else{const pieces=await Promise.all(selected.map(async p=>({...p,image:await load(p.url)})));download(AssetSplitExport.psd(n.splitWidth,n.splitHeight,pieces),'拆分素材.psd');}
 }
 async function merge(n){
  const selected=(n.splitPieces||[]).filter(p=>p.selected!==false);if(selected.length<2)throw Error('请至少勾选两个要合并的元素');
  const x=Math.min(...selected.map(p=>p.x)),y=Math.min(...selected.map(p=>p.y)),w=Math.max(...selected.map(p=>p.x+p.w))-x,h=Math.max(...selected.map(p=>p.y+p.h))-y;
  const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
  for(const p of selected){const im=await load(p.url),part=document.createElement('canvas');part.width=p.w;part.height=p.h;part.getContext('2d').putImageData(im,0,0);ctx.drawImage(part,p.x-x,p.y-y);}
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw Error('合并图片失败');const id='merged-'+Date.now(),[f]=await upload([new File([blob],id+'.png',{type:'image/png'})]);
  pushUndo();const first=n.splitPieces.indexOf(selected[0]);n.splitPieces=n.splitPieces.filter(p=>!selected.includes(p));n.splitPieces.splice(first,0,{id,name:'合并素材',x,y,w,h,url:f.url,selected:true});refresh(n);
 }
 function body(n){const box=document.createElement('div');box.className='asset-split-body';box.onmousedown=e=>e.stopPropagation();box.onwheel=e=>e.stopPropagation();
  const add=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;box.append(e);return e;};
  const input=add('input');input.type='file';input.accept='image/*';input.hidden=true;
  const button=(label,action)=>{const b=add('button',label);b.className='imagegen-control';b.type='button';b.disabled=busy.has(n.id);b.onclick=async()=>{if(busy.has(n.id))return;busy.add(n.id);box.querySelectorAll('button').forEach(x=>x.disabled=true);try{await action();}catch(e){status.textContent=e.message;}finally{busy.delete(n.id);box.querySelectorAll('button').forEach(x=>x.disabled=false);if(!box.isConnected&&nodes.includes(n))refreshNodes([n.id]);}};return b;};
  button('上传 / 更换图片',()=>input.click());input.onchange=async()=>{if(!input.files[0]||busy.has(n.id))return;busy.add(n.id);box.querySelectorAll('button').forEach(x=>x.disabled=true);try{const [f]=await upload([input.files[0]]);pushUndo();n.splitSource=f.url;refresh(n);}catch(e){status.textContent=e.message;}finally{busy.delete(n.id);box.querySelectorAll('button').forEach(x=>x.disabled=false);if(!box.isConnected&&nodes.includes(n))refreshNodes([n.id]);}};
  const linked=refs(n),source=n.splitSource||linked[0]?.url;
  if(source){const img=add('img');img.src=source;img.className='asset-split-source';if(n.splitSource&&linked.length)button('使用连线图片',()=>{delete n.splitSource;refresh(n);});}
  else add('p','上传素材图，或从图片节点连线到此处。');
  const label=add('label','背景 '),bg=document.createElement('select');for(const [value,text] of [['auto','自动'],['dark','黑底'],['light','白底']]){const o=new Option(text,value);bg.add(o);}bg.value=n.splitBackground||'auto';bg.onchange=()=>{n.splitBackground=bg.value;save();};label.append(bg);
  for(const [key,title,value,min,max] of [['splitThreshold','背景阈值',24,5,120],['splitMinArea','最小面积',80,1,100000]]){const l=add('label',title+' '),v=document.createElement('input');v.type='number';v.min=min;v.max=max;v.value=n[key]??value;v.onchange=()=>{n[key]=Math.max(min,Math.min(max,Number(v.value)||value));v.value=n[key];save();};l.append(v);}
  button('拆分元素',()=>split(n,status));
  const status=add('p',n.splitPieces?.length?`${n.splitPieces.length} 个元素 · 勾选导出，名称可直接修改`:'适用于透明 / 黑 / 白背景、元素互不相连的素材图。');status.setAttribute('role','status');
  if(n.splitPieces?.length){button('全选 / 取消全选',()=>{const selected=n.splitPieces.some(p=>p.selected===false);n.splitPieces.forEach(p=>p.selected=selected);refresh(n);});button('合并勾选',()=>merge(n));const grid=add('div');grid.className='asset-split-grid';for(const p of n.splitPieces){const item=document.createElement('div'),check=document.createElement('input'),img=document.createElement('img'),name=document.createElement('input');check.type='checkbox';check.checked=p.selected!==false;check.setAttribute('aria-label','选择 '+p.name);check.onchange=()=>{p.selected=check.checked;save();};img.src=p.url;img.loading='lazy';img.alt=p.name;img.onclick=()=>downloadFromUrl(p.url,p.name+'.png');name.value=p.name;name.setAttribute('aria-label','元素名称');name.onchange=()=>{p.name=name.value.trim()||p.id;save();};item.append(check,img,name);grid.append(item);}button('导出 PNG 图包',()=>exportPieces(n,'zip'));button('导出分层 PSD',()=>exportPieces(n,'psd'));}
  return box;
 }
 async function downloadFromUrl(url,name){try{const r=await fetch(url);if(!r.ok)throw Error('下载失败');download(await r.blob(),name);}catch(e){alert(e.message);}}
 function canConnect(from,to){if(to.type==='assetSplit')return from.type!=='assetSplit'&&(imageRefsFromNode(from).length>0||['imageGen','generator','comfy','msgen','rh'].includes(from.type));if(from.type==='assetSplit')return ['output','imageGen','materialPbr'].includes(to.type);}
 window.CanvasAssetSplit={create,body,images,canConnect};
})();
