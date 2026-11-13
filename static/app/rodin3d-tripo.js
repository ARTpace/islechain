import {MODEL_VERSIONS, MULTIVIEW_LABELS, MODEL_FORMATS, PARTS, partPrompt, sheetPrompt,
  modelFaceMin, modelFaceMax, decimateFaceRange, normalizeJob, isPSeries} from '/tripo-studio/shared/contracts.js';
import {IMAGE_MODEL_INFO, modelAvailable} from '/tripo-studio/shared/image-models.js';
import {estimateJobCredits} from '/tripo-studio/shared/credit-estimate.js';
import {acceptSiteHandshake} from '/tripo-studio/shared/site.js';
import {capabilities} from './rodin3d-capabilities.js';
import * as imageTools from './rodin3d-image-tools.js';

const $ = id => document.getElementById(id);
const root = $('tripoControls');
const PREFIX = '/dsh-tripo-studio';
const KEY = 'rodin3d_tripo_v1';
const titles = {'image-to-model':'生成','multiview-to-model':'视图',image:'绘图',parts:'拆件','mesh-decimate':'拓扑','model-convert':'导出'};
const paths = {'image-to-model':'m12 3 9 5v8l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v8','multiview-to-model':'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M15 7h1',parts:'m9 3 4 4-4 4-4-4Zm8 8 4 4-4 4-4-4ZM3 15h7v7H3z','mesh-decimate':'m12 3 9 5v8l-9 5-9-5V8Zm0 0v18M3 8l18 8M21 8 3 16','model-convert':'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4'};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||name}"/></svg>`;
const states = {awaiting_approval:'待提交',submitting:'提交中',submission_unknown:'提交待核查',queued:'排队中',running:'生成中',success:'完成',failed:'失败',cancelled:'已取消',discarded:'已丢弃'};
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const state = {platform:saved.platform||'hyper3d',channel:saved.channel||'webai2api',status:null,project:saved.project || '',data:{assets:[],jobs:[]},kind:saved.kind || 'image-to-model',busy:false,timer:0,pending:null,initialized:false,init:null};
const direct = () => state.platform==='tripo'&&state.channel==='api';
let reference = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options = (values, labels = {}) => values.map(value => `<option value="${esc(value)}">${esc(labels[value] || value)}</option>`).join('');
const field = (label, content, id='') => `<div class="field"${id ? ` id="${id}"` : ''}><div class="label">${label}</div>${content.replace(/(<(?:select|textarea|input)\b)/,'$1 aria-label="'+esc(label)+'"')}</div>`;
const select = (id, values, labels) => `<select id="${id}">${options(values,labels)}</select>`;
const toggle = (id, label, on=true) => `<div class="tripo-row"><span>${label}</span><button type="button" id="${id}" class="switch${on?' on':''}" role="switch" aria-label="${label}" aria-checked="${on}"></button></div>`;
const on = id => $(id).getAttribute('aria-checked') === 'true';
const setOn = (id,value) => { $(id).classList.toggle('on',value);$(id).setAttribute('aria-checked',String(value)); };
const imageModels = Object.keys(IMAGE_MODEL_INFO).filter(m=>modelAvailable(m));

root.innerHTML = `
  <div class="platform-row"><span class="platform-mark">◇</span><select id="tpPlatform" aria-label="生成平台"><option value="hyper3d">Rodin</option><option value="hunyuan">混元 3D</option><option value="tripo">Tripo</option></select><span id="tpConnection" class="tripo-note"></span><button id="tpSettings" hidden></button></div>
  <div id="tpProjectRow" class="tripo-row"><select id="tpProject" aria-label="Tripo 项目"></select><button class="icon-btn" id="tpNew" title="新建项目" aria-label="新建项目">＋</button></div>
  <div id="tpNewBox" hidden class="field"><div class="tripo-row"><input id="tpProjectName" aria-label="项目名称" placeholder="项目名称" maxlength="100"><button class="ghost" id="tpCreate">创建</button></div></div>
  <div class="tripo-tabs" id="tpTabs" aria-label="操作">${Object.entries(titles).map(([kind,title])=>`<button type="button" data-kind="${kind}" title="${title}" aria-label="${title}" aria-pressed="false">${icon(kind)}<span>${title}</span></button>`).join('')}</div>
  <div id="tpImageInput">
    <button type="button" class="reference-drop" id="tpUpload" aria-label="上传或更换参考图"><img class="tripo-thumb" id="tpThumb" alt="参考图" hidden><span id="tpUploadEmpty">${icon('M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4')}<b>添加图片</b><small id="tpLimit">点击或拖入</small></span></button>
    <div class="reference-tools"><select id="tpImage" aria-label="选择已有图片"><option value="">已有图片</option></select><button class="icon-btn" id="tpCurrent" title="使用当前参考图" aria-label="使用当前参考图">${icon('M4 4h16v16H4zM8 12h8m-4-4v8')}</button><button class="icon-btn" id="tpCrop" title="裁剪" aria-label="裁剪">${icon('M7 3v14h14M3 7h14v14')}</button></div>
    <input type="file" id="tpFile" accept="image/png,image/jpeg,image/webp" hidden>
    <div id="tpCropBox" hidden><canvas id="tpCropCanvas" class="tripo-crop"></canvas><div class="tripo-actions"><button class="ghost" id="tpCropSave">保存裁剪</button><button class="ghost" id="tpCropCancel">取消</button></div></div>
  </div>
  <div id="tpViews" hidden class="field"><div class="label">视图 <em>正面＋至少一个其他视角</em></div><div class="tripo-images">${Object.entries(MULTIVIEW_LABELS).map(([view,label])=>`<button class="tripo-image" data-view="${view}">${label}<img alt="${label}" hidden></button>`).join('')}</div><div class="tripo-note">点击上传；右键清除当前视图。</div></div>
  <div id="tpSource" hidden>${field('模型',select('tpModelJob',[]))}</div><div id="tpWebModel" hidden></div>
  <div id="tpRodin" hidden>${field('精细度',select('tpEffort',['low','medium','high'],{low:'低',medium:'标准',high:'高'}))}${field('提示词','<textarea id="tpRodinPrompt" rows="2" placeholder="补充细节（可选）"></textarea>')}</div>
  <div id="tpGeneration">
    ${field('模型版本',select('tpVersion',MODEL_VERSIONS,{'v3.1-20260211':'H3.1','v3.0-20250812':'H3.0','v2.5-20250123':'H2.5','P2-20260801':'P2 · 智能网格'}))}
    <div class="tripo-fields">${field('几何质量',select('tpGeometry',['standard','detailed'],{standard:'标准',detailed:'超清'}),'tpGeometryField')}${field('贴图质量',select('tpTextureQuality',['standard','detailed','extreme'],{standard:'标准',detailed:'高清',extreme:'8K'}),'tpTextureField')}</div>
    <div class="tripo-fields">${toggle('tpTexture','生成贴图')}${toggle('tpPbr','PBR 材质')}</div>
    <div class="tripo-fields">
    <div id="tpQuadRow">${toggle('tpQuad','四边面',false)}</div>
    <div id="tpSmartRow">${toggle('tpSmart','智能低模',false)}</div>
    </div>
    <div class="tripo-note" id="tpFbxNote" hidden>H 系列四边面输出 FBX，可下载或转换后预览。</div>
  </div>
  <div id="tpRetopo" hidden>${field('拓扑方式',select('tpRetopoModel',['v2.0','v1.0'],{'v2.0':'智能重拓扑','v1.0':'基础减面'}))}${toggle('tpRetopoQuad','四边面',false)}<div id="tpBakeRow">${toggle('tpBake','保留贴图')}</div><div id="tpAdaptiveRow">${toggle('tpAdaptive','自适应面数',false)}</div></div>
  <div id="tpFacesField" class="field"><div class="tripo-row"><span class="label">面数</span><output id="tpFacesValue"></output></div><input type="range" id="tpFaces" min="500" max="1500000" value="50000" step="1" aria-label="目标面数"></div>
  <div id="tpWebTripo" hidden><span class="tripo-note">H3.1 · 参数由官网设置</span>${field('积分上限','<input id="tpBudget" type="number" min="0" step="1" placeholder="正式提交时必填">')}<a class="tripo-note" href="https://studio.tripo3d.ai/zh/workspace/generate" target="_blank" rel="noopener">官网查看模型 ↗</a></div>
  <div id="tpImageSettings" hidden>
    ${field('生图来源',select('tpImageEngine',['tool','tripo'],{tool:'工具模型',tripo:'Tripo API'}))}
    <div id="tpToolImage">${field('生图模型',select('tpToolModel',[]))}<div id="tpToolParams"></div>${field('尺寸',select('tpToolSize',['1024x1024','1536x1024','1024x1536']))}<button type="button" class="icon-btn" id="tpToolRefresh" title="刷新工具模型" aria-label="刷新工具模型">↻</button></div>
    <div id="tpImageModeField">${field('图像操作',select('tpImageMode',['text-to-image','image-to-image'],{'text-to-image':'文字生图','image-to-image':'图像编辑'}))}</div>
    <div id="tpPartField">${field('拆件方式',select('tpPart',['sheet',...PARTS.map(p=>p.id)],Object.fromEntries([['sheet','整张拆件图'],...PARTS.map(p=>[p.id,p.name])])) )}</div>
    ${field('图像模型',select('tpImageVersion',imageModels,Object.fromEntries(imageModels.map(m=>[m,IMAGE_MODEL_INFO[m].label]))))}
    <div class="tripo-fields">${field('尺寸',select('tpSize',[]))}${field('质量',select('tpQuality',[]),'tpQualityField')}</div>
    ${field('提示词','<textarea id="tpPrompt" rows="4" maxlength="6000" placeholder="描述要生成或修改的内容"></textarea>')}
  </div>
  <div id="tpConvert" hidden>${field('输出格式',select('tpFormat',MODEL_FORMATS))}${toggle('tpConvertQuad','四边面 FBX',false)}</div>
  <details id="tpMore"><summary>其他参数</summary><div id="tpModelMore">${toggle('tpAutoSize','真实尺寸',false)}<div id="tpAutofixRow">${toggle('tpAutofix','优化参考图',false)}</div>${field('贴图对齐',select('tpAlignment',['original_image','geometry'],{original_image:'参考图颜色',geometry:'模型几何'}))}${field('模型朝向',select('tpOrientation',['default','align_image'],{default:'自动',align_image:'对齐参考视角'}))}</div>${field('导出前向轴',select('tpAxis',['default','+x','-x','-y','+y'],{default:'保持默认'}),'tpAxisField')}</details>
  <div class="tripo-message" id="tpMessage" role="status" aria-live="polite"></div>
  <button class="primary" id="tpSubmit">生成模型</button>
  <div id="tpJobHeader" class="tripo-row"><span class="label">任务</span><button class="icon-btn" id="tpRefresh" title="刷新任务" aria-label="刷新任务">${icon('M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12 0l2 5M4 12l2 5a7 7 0 0 0 12 0')}</button><button class="icon-btn" id="tpImport" title="关联云任务" aria-label="关联云任务">${icon('M10 13a5 5 0 0 0 7 0l4-4-6-6-4 4M14 11a5 5 0 0 0-7 0l-4 4 6 6 4-4')}</button></div>
  <div id="tpImportBox" hidden><div class="tripo-row"><input id="tpImportId" aria-label="Tripo 云任务号" placeholder="云任务号"><button class="ghost" id="tpImportSave">关联</button></div></div>
  <div id="tpJobs"></div>
  <div class="modal" id="tpApproval" hidden><div class="modal-card"><h3>确认提交</h3><div id="tpApprovalText" class="tripo-note"></div><div class="row"><button class="ghost" id="tpCancel">取消</button><button class="primary" id="tpApprove">提交并消耗积分</button></div></div></div>
  <div class="modal" id="tpSettingsBox" hidden><div class="modal-card"><h3>Tripo API 连接</h3>${field('站点',select('tpSite',['cn','international'],{cn:'国内站 · tripo3d.com',international:'国际站 · tripo3d.ai'}))}${field('API Key','<input id="tpKey" type="password" autocomplete="new-password" placeholder="留空沿用当前密钥">')}${toggle('tpPaid','允许付费任务',false)}${toggle('tpRemember','本机加密保存')}<div id="tpSettingsMessage" class="tripo-message" role="status"></div><div class="row"><button class="ghost" id="tpSettingsCancel">取消</button><button class="primary" id="tpSettingsSave">保存连接</button></div><button class="ghost" id="tpBalance">查询余额</button></div></div>`;

// Fixed dialogs must escape the panel's backdrop-filter containing block.
const referenceStyles=[
  ['clean','清晰建模参考','轮廓清晰、材质干净','M5 19 19 5M5 5v5M2 8h6M17 16v6M14 19h6','去除杂乱背景与无关物体，补清晰主体结构、轮廓和材质。保持原有造型与颜色。'],
  ['stylized','3D 风格化','卡通体块 · 游戏道具','m12 3 9 5v8l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v8','将主体优化为精致的风格化 3D 游戏资产，体块简洁明确、比例生动、材质干净，保留原有设计特征。'],
  ['lowpoly','低多边形','简化细节 · 突出体块','M12 3 3 18h18Zm0 0v15M3 18l9-7 9 7','将主体转为低多边形游戏资产参考，突出大体块、平面转折和清晰剪影，减少细碎纹理，保留主要结构和配色。'],
  ['tpose','T 姿势','完整角色 · 四肢展开','M12 3v3M3 9h18M12 6v9m0 0-5 6m5-6 5 6','保持角色身份、服装、配饰和原有美术风格，改为正面全身标准 T 姿势：双臂水平展开、双腿自然分开，手脚完整可见。'],
  ['complete','角色补全','补齐遮挡 · 全身构图','M8 4h8v7H8zM6 13h12v8H6z','合理补全画面中被裁切或遮挡的角色身体、服装与配饰，保持设计连续性，展示完整全身，避免夸张透视。'],
  ['figurine','照片转手办','实体质感 · 清晰细节','M9 3h6v6H9zM7 11h10v8H7zM4 22h16','将参考主体转为精致收藏手办的 3D 建模参考，保留可识别特征，统一实体材质和柔和光照，完整展示主体。'],
  ['sculpt','雕塑白模','去除花纹 · 检查形体','M12 3 8 8l1 6-4 6h14l-4-6 1-6Z','将主体转为干净的灰白色雕塑模型，保留形体、层次和轮廓，移除颜色纹理与背景装饰，以柔和光照表现结构。'],
  ['game','游戏资产','统一材质 · 适合建模','M4 8h16v12H4zM8 8V4h8v4M8 14h8','将主体优化为可用于游戏建模的独立资产参考，统一材质语言，明确部件连接关系，简化无关装饰并保留核心设计。']
];
let referenceStyle='clean';
let optimizeOriginal='',optimizeVersions=[],optimizeSelected=0,optimizeBefore=false;
const optimizer=document.createElement('div');optimizer.id='tpOptimizer';optimizer.className='modal';optimizer.hidden=true;
optimizer.innerHTML=`<div class="modal-card"><div class="tripo-row"><h3>优化参考图</h3><button class="icon-btn" id="tpOptimizeClose" aria-label="关闭参考图优化">×</button></div><div class="tripo-optimize-layout"><figure class="tripo-optimize-preview"><figcaption class="tripo-row"><span id="tpOptimizeCaption">原始参考图</span><button class="ghost" id="tpCompareBefore" aria-pressed="false">原图</button><button class="ghost" id="tpCompareAfter" aria-pressed="true">当前版本</button></figcaption><img id="tpOptimizePreview" alt="当前待优化的参考图"><div id="tpOptimizeHistory" aria-label="参考图调整历史"></div></figure><div class="tripo-optimize-options"><div id="tpStyleGrid">${referenceStyles.map(([id,label,hint,path])=>`<button type="button" data-style="${id}" aria-pressed="${id===referenceStyle}">${icon(path)}<strong>${label}</strong><small>${hint}</small></button>`).join('')}</div><div id="tpOptimizeFields"></div>${field('补充要求（可选）','<textarea id="tpOptimizeExtra" rows="2" placeholder="例如：保留盾牌和背包"></textarea>')}<div id="tpOptimizeStatus" class="tripo-message" role="status" aria-live="polite"></div><button class="primary" id="tpOptimizeRun">生成优化效果</button><button class="ghost" id="tpOptimizeAccept">确认采用当前版本</button></div></div></div>`;
const optimizeButton=document.createElement('button');optimizeButton.id='tpOptimize';optimizeButton.type='button';optimizeButton.className='ghost';optimizeButton.textContent='优化参考图';$('tpImageInput').after(optimizeButton);
$('tpImageEngine').value='tool';$('tpImageMode').value='image-to-image';
document.body.append(optimizer);$('tpOptimizeFields').append($('tpToolImage'));
$('tpToolParams').hidden=true;$('tpToolSize').closest('.field').hidden=true;
const dialogs=[$('tpApproval'),$('tpSettingsBox'),optimizer];
const modelField=$('modelField');$('tpWebModel').append(modelField);
const webResults=document.createElement('section');webResults.id='webResults';root.append(webResults);
for(const id of ['progressWrap','resultBox','logBox'])webResults.append($(id));
root.hidden=false;$('webControls').hidden=true;
root.setAttribute('aria-label','生成参数');
const assetProjects=document.createElement('section');assetProjects.className='tripo-assets';
assetProjects.append($('tpProjectRow'),$('tpNewBox'));
$('assetGrid').parentElement.insertBefore(assetProjects,$('assetGrid'));
const assetTasks=document.createElement('section');assetTasks.className='tripo-assets';
assetTasks.append($('tpJobHeader'),$('tpJobs'));$('assetFoot').before(assetTasks);
for(const dialog of dialogs){dialog.classList.add('tripo-dialog');document.body.append(dialog);}
$('tpSettingsBox').addEventListener('click',event=>{
  const button=event.target.closest('button[role="switch"]');
  if(button&&!state.busy)setOn(button.id,!on(button.id));
});
function message(text,error=false) { $('tpMessage').textContent=text;$('tpMessage').dataset.error=String(error); }
function persist() {
  const fields={};root.querySelectorAll('input:not([type=password]):not([type=file]),select,textarea').forEach(el=>{fields[el.id]=el.value;});
  const switches={};root.querySelectorAll('[role=switch]').forEach(el=>{if(!['tpPaid','tpRemember'].includes(el.id))switches[el.id]=on(el.id);});
  try { localStorage.setItem(KEY,JSON.stringify({platform:state.platform,project:state.project,kind:state.kind,channel:state.channel,fields,switches,views})); } catch {}
}
async function api(path, method='GET',body) {
  const response=await fetch(PREFIX+path,{method,credentials:'same-origin',headers:{'x-tripo-studio':'1',...(method==='GET'?{}:{'content-type':'application/json','x-tripo-csrf':state.status?.csrfToken || '', 'x-tripo-site':state.status?.site || ''})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Tripo 后端未返回 JSON，请重启 art-canvas');
  const data=await response.json();if(!response.ok)throw new Error(data.error || `HTTP ${response.status}`);return data;
}
function handshake(data) { acceptSiteHandshake(data);state.status=data; }
function assetUrl(id) { return `${PREFIX}/assets/${encodeURIComponent(id)}?project=${encodeURIComponent(state.project)}`; }
function bindSelect(id,values,empty) { const el=$(id),old=el.value;el.innerHTML=`<option value="">${esc(empty)}</option>`+values.map(v=>`<option value="${esc(v.id)}">${esc(v.label || v.name || v.id)}</option>`).join('');if(values.some(v=>v.id===old))el.value=old; }
async function projects() {
  const list=await api('/projects');bindSelect('tpProject',list,'新项目');
  if(!list.some(p=>p.id===state.project))state.project=list[0]?.id || '';
  $('tpProject').value=state.project;
}
async function ensureProject() {
  if(state.project)return;
  const p=await api('/projects','POST',{name:'3D 生成'});state.project=p.id;await projects();persist();
}
async function snapshot(refresh=false) {
  if(!state.project){state.data={assets:[],jobs:[]};renderAssets();renderJobs();return;}
  if(refresh)await api(`/projects/${state.project}/refresh`,'POST',{});
  state.data=await api(`/projects/${state.project}`);renderAssets();renderJobs();
}
function renderAssets() {
  bindSelect('tpImage',state.data.assets.filter(a=>a.kind==='image'),'选择图片或上传');
  const kinds=state.kind==='mesh-decimate'?['image-to-model','multiview-to-model']:['image-to-model','multiview-to-model','mesh-decimate','model-convert'];
  const modelJobs=state.data.jobs.filter(j=>j.status==='success'&&kinds.includes(j.kind)&&j.site===state.status.site);
  bindSelect('tpModelJob',modelJobs,'选择成功的模型任务');
  imagePreview();renderViews();renderAssetGrid();
}
function renderAssetGrid(){
  if(!direct())return;
  const assets=state.data.assets.filter(a=>a.kind==='model'&&(!a.sourceJobId||state.data.jobs.some(j=>j.id===a.sourceJobId&&j.site===state.status.site)));
  const grid=$('assetGrid');grid.replaceChildren();$('historyCount').textContent=String(assets.length);
  $('assetFoot').textContent='Tripo · '+($('tpProject').selectedOptions[0]?.textContent||'当前项目');
  if(!assets.length){const empty=document.createElement('div');empty.className='asset-empty';empty.textContent='当前项目还没有资产';grid.append(empty);}
  for(const asset of assets){
    const card=document.createElement('button');card.type='button';card.className='asset-card';card.title=asset.label||asset.name||asset.id;
    if(asset.kind==='image'){const img=document.createElement('img');img.src=assetUrl(asset.id);img.alt=card.title;card.append(img);}
    else{const icon=document.createElement('span');icon.className='ph';icon.textContent=(asset.format||'3D').toUpperCase();card.append(icon);}
    const meta=document.createElement('span');meta.className='meta';meta.textContent=card.title;card.append(meta);
    card.onclick=()=>run(async()=>{
      if(asset.kind==='image'){$('tpImage').value=asset.id;state.kind='image-to-model';sync();imagePreview();persist();}
      else if(!asset.format||asset.format==='glb'){const r=await fetch(assetUrl(asset.id));if(!r.ok)throw new Error('模型读取失败');await window.canvas3d.preview(await r.arrayBuffer());}
      else{state.kind='model-convert';renderAssets();$('tpModelJob').value=asset.sourceJobId||'';sync();persist();message('此格式可直接下载，或转换为 GLTF 后预览');}
    });grid.append(card);
  }
}
function imagePreview() { const id=$('tpImage').value,src=id?assetUrl(id):reference;$('tpThumb').hidden=!src;$('tpUploadEmpty').hidden=!!src;if(src)$('tpThumb').src=src; }
const views={...(saved.views || {})};let uploadView='';
function renderViews() { root.querySelectorAll('[data-view]').forEach(button=>{const img=button.querySelector('img'),id=views[button.dataset.view];img.hidden=!id;if(id)img.src=assetUrl(id);}); }
function updateImageSettings() {
  const model=$('tpImageVersion').value,info=IMAGE_MODEL_INFO[model];
  $('tpSize').innerHTML=options(info.sizes);$('tpSize').value=info.defaultSize;
  $('tpQuality').innerHTML=options(info.quality);$('tpQualityField').hidden=!info.quality.length;
}
function imageModelChoices() {
  const edit=state.kind==='parts'||$('tpImageMode').value==='image-to-image',previous=$('tpImageVersion').value;
  const models=imageModels.filter(m=>!edit||IMAGE_MODEL_INFO[m].edit);
  $('tpImageVersion').innerHTML=options(models,Object.fromEntries(models.map(m=>[m,IMAGE_MODEL_INFO[m].label])));
  if(models.includes(previous))$('tpImageVersion').value=previous;
  updateImageSettings();
}
let toolModels=[];
function toolValues() { return Object.fromEntries([...$('tpToolParams').querySelectorAll('select')].map(el=>[el.dataset.param,el.value])); }
function renderToolParams() {
  const model=toolModels.find(m=>m.id===$('tpToolModel').value),declared=imageTools.schema(model,toolValues());
  $('tpToolParams').replaceChildren();
  for(const p of declared?.params||[]){
    const wrap=document.createElement('label');wrap.className='field';const label=document.createElement('span');label.className='label';label.textContent=p.label||p.key;
    const select=document.createElement('select');select.dataset.param=p.key;select.setAttribute('aria-label',p.label||p.key);
    for(const o of p.options||[]){const item=typeof o==='object'?o:{value:o};select.add(new Option(item.label||String(item.value),item.value));}
    if(p.default!==undefined)select.value=String(p.default);wrap.append(label,select);$('tpToolParams').append(wrap);
  }
}
async function loadToolModels() {
  const previous=$('tpToolModel').value||localStorage.getItem('rodin3d_image_model');toolModels=(await imageTools.catalog()).filter(imageTools.supportsEditing);
  $('tpToolModel').replaceChildren(...toolModels.map(m=>new Option(m.label,m.id)));
  if(toolModels.some(m=>m.id===previous))$('tpToolModel').value=previous;
  renderToolParams();if(!toolModels.length)message('请先在工具设置中配置生图模型',true);
}
async function generateToolImage() {
  const model=toolModels.find(m=>m.id===$('tpToolModel').value);if(!model)throw new Error('请选择工具生图模型');
  const source=optimizeVersions[optimizeSelected]?.url;
  if(!source)throw new Error('请先添加参考图');
  localStorage.setItem('rodin3d_image_model',model.id);
  // Website-backed providers expose live schemas through the same refresh API as the canvas.
  if(model.provider?.protocol==='webai2api'){
    const data=await imageTools.json('/api/providers/webai2api/status?'+new URLSearchParams({provider_id:model.provider.id,refresh:'true',model:model.model}));
    const updated=data.provider||data;
    if(!data.online)throw new Error(data.message||'模型参数更新失败，请检查网关连接');
    if(updated.model_capabilities)model.provider={...model.provider,...updated};
  }
  const pending=JSON.parse(localStorage.getItem('rodin3d_image_task')||'null');
  const url=pending?await imageTools.wait(pending,message):await imageTools.generate(model,{prompt:$('tpPrompt').value,reference:source,size:$('tpToolSize').value,values:toolValues()},message);
  const result=await asPng(url);optimizeVersions.push({url:result,label:'版本 '+optimizeVersions.length});optimizeSelected=optimizeVersions.length-1;optimizeBefore=false;renderOptimizeHistory();$('tpOptimizeStatus').textContent='优化完成，可继续调整或确认采用当前版本';
}
function sync() {
  const busy=state.busy||window.canvas3d.busy(),cap=capabilities(state.platform,state.channel),apiMode=direct(),hy=state.platform==='hunyuan';
  if(!cap.kinds.includes(state.kind))state.kind='image-to-model';
  for(const surface of [root,assetProjects,assetTasks,...dialogs])surface.querySelectorAll('button,input,select,textarea').forEach(el=>{if(!el.closest('#webResults,#tpWebModel'))el.disabled=busy;});
  $('tpSettings').disabled=busy||!state.status;
  $('tpPlatform').value=state.platform;
  $('tpProjectRow').hidden=!apiMode;$('tpJobHeader').hidden=!apiMode;$('tpJobs').hidden=!apiMode;$('webResults').hidden=apiMode;
  $('tpConnection').textContent=apiMode?'API': '网页';
  $('channelToggle').disabled=busy||state.platform!=='tripo';$('connectionSettings').disabled=busy;
  const routeLabel=state.platform==='tripo'?(apiMode?'API 通道 · 点击切换网页':'网页通道 · 点击切换 API'):'网页通道（此平台暂未接 API）';
  $('channelToggle').title=routeLabel;$('channelToggle').setAttribute('aria-label',routeLabel);
  $('channelToggle').innerHTML=icon(apiMode?'M8 3v5m8-5v5M5 8h14v4a7 7 0 0 1-14 0Zm7 11v3':'M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-5 5-5 13 0 18 5-5 5-13 0-18');
  $('channelToggle').dataset.channel=apiMode?'api':'webai2api';
  const k=state.kind,gen=['image-to-model','multiview-to-model'].includes(k),image=['image','parts'].includes(k),retopo=k==='mesh-decimate',convert=k==='model-convert';
  $('tpImageEngine').querySelector('option[value=tripo]').disabled=!apiMode;
  $('tpImageEngine').value='tool';$('tpImageMode').value='image-to-image';
  const toolImage=$('tpImageEngine').value==='tool';
  $('tpToolImage').hidden=!toolImage;
  $('tpImageVersion').closest('.field').hidden=toolImage;
  $('tpSize').closest('.tripo-fields').hidden=toolImage;
  const version=$('tpVersion').value,old=version==='v2.5-20250123',p=isPSeries(version),texture=on('tpTexture');
  if(!texture)setOn('tpPbr',false);
  if(old){setOn('tpQuad',false);setOn('tpSmart',false);}
  if(p)setOn('tpSmart',false);
  $('tpGeneration').hidden=!gen||!apiMode&&!hy;$('tpRetopo').hidden=!retopo;$('tpConvert').hidden=!convert;$('tpImageSettings').hidden=true;
  $('tpVersion').closest('.field').hidden=!apiMode;
  $('tpTexture').closest('.tripo-fields').hidden=!apiMode;$('tpSmartRow').hidden=!apiMode||old||p;
  $('tpRodin').hidden=!gen||state.platform!=='hyper3d';$('tpWebTripo').hidden=!gen||state.platform!=='tripo'||apiMode;
  $('tpRetopoModel').closest('.field').hidden=!apiMode;$('tpBakeRow').hidden=!apiMode||$('tpRetopoModel').value==='v1.0';
  $('tpWebModel').hidden=!(hy&&retopo);modelField.hidden=!(hy&&retopo);
  $('tpImageModeField').hidden=k!=='image';$('tpPartField').hidden=k!=='parts';
  $('tpImageInput').hidden=!(k==='image-to-model'||k==='parts'||k==='image'&&$('tpImageMode').value==='image-to-image');
  $('tpOptimize').hidden=k!=='image-to-model';$('tpOptimize').disabled=busy||!($('tpImage').value||reference||window.canvas3d.image());
  $('tpOptimizeRun').disabled=busy||!toolModels.length;
  $('tpOptimizeAccept').disabled=busy||optimizeSelected===0;
  $('tpViews').hidden=k!=='multiview-to-model';$('tpSource').hidden=!apiMode||!(retopo||convert);
  $('tpImage').hidden=!apiMode;$('tpCrop').hidden=!apiMode;
  $('tpLimit').textContent=hy&&!image?'PNG / JPG / WebP · 10 MB':'PNG / JPG / WebP · 20 MB';
  $('tpFacesField').hidden=!(gen||retopo)||!cap.faces;$('tpGeometryField').hidden=!apiMode||old||p;$('tpTextureField').hidden=!apiMode||old||!texture;
  $('tpPbr').disabled=busy||!texture;$('tpQuadRow').hidden=apiMode&&old;
  $('tpFbxNote').hidden=!(apiMode&&gen&&on('tpQuad')&&!p);
  const basic=$('tpRetopoModel').value==='v1.0';
  $('tpAdaptiveRow').hidden=apiMode&&basic;
  $('tpMore').hidden=!apiMode||!(gen||convert);$('tpModelMore').hidden=!gen;$('tpAutofixRow').hidden=k!=='image-to-model';
  $('tpAxisField').hidden=!(gen||convert);$('tpOrientation').disabled=busy||!texture;
  let range=retopo?decimateFaceRange($('tpRetopoModel').value,on('tpRetopoQuad')):[modelFaceMin(version),modelFaceMax(version,{quad:on('tpQuad'),smart:on('tpSmart'),geometry:$('tpGeometry').value})];
  if(hy)range=[100,60000];
  $('tpFaces').min=range[0];$('tpFaces').max=range[1];$('tpFaces').value=Math.min(range[1],Math.max(range[0],Number($('tpFaces').value)));
  const adaptive=retopo&&(!apiMode||!basic)&&on('tpAdaptive');$('tpFaces').disabled=busy||adaptive;
  $('tpFacesValue').textContent=adaptive?'自动':Number($('tpFaces').value).toLocaleString();
  $('tpConvertQuad').disabled=state.busy||$('tpFormat').value!=='FBX';if($('tpFormat').value!=='FBX')setOn('tpConvertQuad',false);
  $('tpSubmit').textContent=gen?'生成模型':retopo?'开始重拓扑':convert?'转换模型':k==='parts'?'生成拆件图':$('tpImageMode').value==='text-to-image'?'生成图片':'编辑图片';
  $('tpSubmit').disabled=busy;$('precheckBtn').hidden=image||apiMode||state.platform==='hyper3d';$('precheckBtn').disabled=busy;
  $('tpTabs').querySelectorAll('[data-kind]').forEach(b=>{b.hidden=!cap.kinds.includes(b.dataset.kind);b.setAttribute('aria-pressed',String(b.dataset.kind===k));});
  $('tpTabs').hidden=cap.kinds.length===1;
}
function params() {
  const k=state.kind,axis=$('tpAxis').value==='default'?{}:{export_orientation:$('tpAxis').value};
  if(k==='model-convert')return {kind:k,params:{input_job:$('tpModelJob').value,format:$('tpFormat').value,quad:on('tpConvertQuad'),...axis}};
  if(k==='mesh-decimate')return {kind:k,params:{input_job:$('tpModelJob').value,model:$('tpRetopoModel').value,quad:on('tpRetopoQuad'),...($('tpRetopoModel').value==='v2.0'?{bake:on('tpBake')}:{}),...(on('tpAdaptive')&&$('tpRetopoModel').value==='v2.0'?{}:{face_limit:Number($('tpFaces').value)})}};
  if(k==='image'||k==='parts') {
    const kind=k==='parts'?'image-to-image':$('tpImageMode').value,model=$('tpImageVersion').value,info=IMAGE_MODEL_INFO[model];
    return {kind,params:{...(kind==='image-to-image'?{input_asset:$('tpImage').value}:{}),model,prompt:$('tpPrompt').value,size:$('tpSize').value,...(info.quality.length?{quality:$('tpQuality').value}:{})}};
  }
  const model=$('tpVersion').value,old=model==='v2.5-20250123',p=isPSeries(model),texture=on('tpTexture');
  return {kind:k,params:{...(k==='multiview-to-model'?{views:{...views}}:{input_asset:$('tpImage').value,enable_image_autofix:on('tpAutofix')}),model,face_limit:Number($('tpFaces').value),texture,pbr:texture&&on('tpPbr'),...(!old?{quad:on('tpQuad'),auto_size:on('tpAutoSize'),...(!p?{geometry_quality:$('tpGeometry').value,smart_low_poly:on('tpSmart')}:{})}:{}),...(texture&&!old?{texture_quality:$('tpTextureQuality').value}:{}),...(texture?{texture_alignment:$('tpAlignment').value,orientation:$('tpOrientation').value}:{}),...axis}};
}

async function initialize() {
  if(state.initialized)return;if(state.init)return state.init;
  state.init=(async()=>{handshake(await api('/status'));await projects();await snapshot();state.initialized=true;
    $('tpConnection').textContent=state.status.keyConfigured?`Tripo · ${state.status.site==='cn'?'国内站':'国际站'}${state.status.paidEnabled?'':' · 只读'}`:'Tripo · 未配置密钥';
    if(saved.fields){for(const [id,value] of Object.entries(saved.fields)){if($(id)&&!['tpProject','tpSite','tpImportId','tpProjectName','tpSize','tpQuality'].includes(id))$(id).value=value;}
      imageModelChoices();for(const id of ['tpSize','tpQuality'])if([...$(id).options].some(o=>o.value===saved.fields[id]))$(id).value=saved.fields[id];saved.fields=null;}
    for(const view of Object.keys(views))if(!state.data.assets.some(a=>a.id===views[view]))delete views[view];
    imagePreview();renderViews();schedule();
  })();try{await state.init;}finally{state.init=null;}
}
async function run(work) { if(state.busy)return;state.busy=true;sync();try{await work();}catch(e){message(e.message,true);}finally{state.busy=false;sync();} }
async function upload(dataUrl,label) {
  reference=dataUrl;
  if(!direct()){$('tpImage').value='';imagePreview();return;}
  await ensureProject();const asset=await api(`/projects/${state.project}/files`,'POST',{dataUrl,label});await snapshot();
  if(uploadView){views[uploadView]=asset.id;uploadView='';renderViews();}else{$('tpImage').value=asset.id;imagePreview();}persist();return asset;
}
async function asPng(source) {
  const img=new Image();img.src=source;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  if(canvas.width*canvas.height>40000000)throw new Error('图片尺寸过大，请先缩小');canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png');
}

function renderJobs() {
  const jobs=[...state.data.jobs].filter(j=>j.site===state.status.site&&!j.hidden&&['image-to-model','multiview-to-model','mesh-decimate','model-convert'].includes(j.kind)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('tpJobs').innerHTML=jobs.map(j=>{
    const assets=state.data.assets.filter(a=>a.sourceJobId===j.id),pct=Math.min(100,Math.max(0,Number(j.progress)||0));
    const buttons=[];
    if(j.status==='awaiting_approval')buttons.push(`<button class="ghost" data-action="review">提交</button><button class="ghost" data-action="discard">丢弃</button>`);
    if(j.status==='submission_unknown')buttons.push(`<button class="ghost" data-action="recover">关联云任务</button>`);
    if(j.taskId)buttons.push(`<button class="ghost" data-action="refresh">查状态</button>`);
    if(j.status==='success'&&j.downloadStatus!=='downloaded')buttons.push(`<button class="ghost" data-action="download">保存产出</button>`);
    for(const a of assets){
      buttons.push(`<a class="ghost" href="${assetUrl(a.id)}&download=1" download>下载 ${(a.format|| (a.kind==='model'?'GLB':'图片')).toUpperCase()}</a>`);
      if(a.kind==='image')buttons.push(`<button class="ghost" data-action="image" data-asset="${a.id}">用作参考图</button>`);
      if(a.kind==='model'&&['image-to-model','multiview-to-model'].includes(j.kind))buttons.push(`<button class="ghost" data-action="source">用作源模型</button>`);
      if(a.kind==='model'&&(!a.format||a.format==='glb'))buttons.push(`<button class="ghost" data-action="preview" data-asset="${a.id}">预览</button>`);
    }
    return `<div class="tripo-job" data-job="${j.id}"><div class="tripo-job-title"><span>${esc(j.label)}</span><span>${esc(states[j.status]||j.status)}${['running','queued'].includes(j.status)?` ${pct}%`:''}</span></div>${['running','queued'].includes(j.status)?`<div class="tripo-meter"><span style="width:${pct}%"></span></div>`:''}${j.error||j.downloadError?`<div class="tripo-note">${esc(j.error||j.downloadError)}</div>`:''}<div class="tripo-actions">${buttons.join('')}</div><div class="tripo-note">${esc(j.taskId || j.id)}</div></div>`;
  }).join('')||'<div class="tripo-note">当前项目还没有任务。</div>';
}
function review(job) {
  state.pending=job;const credits=estimateJobCredits(job);
  $('tpApprovalText').textContent=`${job.label} · ${job.params.model || job.params.format || ''} ${job.params.face_limit?`· ${job.params.face_limit.toLocaleString()} 面`:''}。${credits===null?'费用以当前站点账户结算为准':`参考 ${credits} 积分` }。提交后消耗 Tripo 积分。`;
  $('tpApproval').hidden=false;
}
async function prepare() {
  if(['image','parts'].includes(state.kind)&&$('tpImageEngine').value==='tool')return generateToolImage();
  if(!direct())return website(false);
  if(!$('tpImage').value&&reference&&state.kind==='image-to-model')await upload(reference,'参考图');
  await ensureProject();const input=params();normalizeJob(input.kind,input.params);persist();
  const job=await api(`/projects/${state.project}/prepare`,'POST',{...input,label:titles[state.kind] || input.kind});await snapshot();review(job);
}
function schedule() {
  clearTimeout(state.timer);if(state.channel!=='api')return;
  if(state.data.jobs.some(j=>j.site===state.status.site&&['queued','running'].includes(j.status)&&j.tracking!==false))state.timer=setTimeout(async()=>{try{await snapshot(true);}catch(e){message('状态查询失败：'+e.message,true);}schedule();},4000);
}
function partTemplate() { const id=$('tpPart').value;$('tpPrompt').value=id==='sheet'?sheetPrompt():partPrompt(PARTS.find(p=>p.id===id)?.name || id); }

root.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.getAttribute('role')==='switch'){if(state.busy)return;setOn(button.id,!on(button.id));sync();persist();}
  if(button.dataset.kind&&!state.busy){state.kind=button.dataset.kind;if(state.kind==='parts'&&!$('tpPrompt').value)partTemplate();imageModelChoices();renderAssets();sync();persist();}
});
root.addEventListener('change',event=>{
  if(event.target.id==='tpToolModel')renderToolParams();
  if(event.target.id==='tpImageVersion')updateImageSettings();if(event.target.id==='tpImageMode')imageModelChoices();if(event.target.id==='tpPart')partTemplate();
  if(event.target.id==='tpImage')imagePreview();sync();persist();
});
$('tpFaces').addEventListener('input',()=>{sync();persist();});
$('tpPrompt').addEventListener('input',persist);
$('tpSubmit').onclick=()=>run(prepare);
$('tpOptimize').onclick=()=>run(async()=>{const source=$('tpImage').value?assetUrl($('tpImage').value):reference||window.canvas3d.image();if(!source)throw new Error('请先导入参考图');if(optimizeOriginal!==source){optimizeOriginal=source;optimizeVersions=[{url:source,label:'原图'}];optimizeSelected=0;}optimizeBefore=false;renderOptimizeHistory();$('tpOptimizer').hidden=false;await loadToolModels();$('tpOptimizeStatus').textContent=toolModels.length?'':'没有可用的图像编辑模型，请在工具设置中配置。';$('tpOptimizeRun').disabled=!toolModels.length;});
function renderOptimizeHistory(){
  $('tpOptimizePreview').src=optimizeBefore?optimizeOriginal:optimizeVersions[optimizeSelected]?.url||optimizeOriginal;
  $('tpOptimizeCaption').textContent=optimizeBefore?'原始参考图':optimizeVersions[optimizeSelected]?.label||'原图';
  $('tpCompareBefore').setAttribute('aria-pressed',String(optimizeBefore));$('tpCompareAfter').setAttribute('aria-pressed',String(!optimizeBefore));
  $('tpOptimizeHistory').replaceChildren(...optimizeVersions.map((version,index)=>{
    const button=document.createElement('button');button.type='button';button.title=version.label;button.setAttribute('aria-label',version.label);button.setAttribute('aria-pressed',String(index===optimizeSelected));
    const img=document.createElement('img');img.src=version.url;img.alt=version.label;const label=document.createElement('span');label.textContent=version.label;button.append(img,label);
    button.onclick=()=>{if(state.busy)return;optimizeSelected=index;optimizeBefore=false;renderOptimizeHistory();sync();};return button;
  }));
}
$('tpCompareBefore').onclick=()=>{optimizeBefore=true;renderOptimizeHistory();};
$('tpCompareAfter').onclick=()=>{optimizeBefore=false;renderOptimizeHistory();};
$('tpOptimizeAccept').onclick=()=>run(async()=>{
  if(!optimizeSelected||!optimizeVersions[optimizeSelected])return;
  reference=optimizeVersions[optimizeSelected].url;$('tpImage').value='';imagePreview();state.kind='image-to-model';persist();$('tpOptimizer').hidden=true;message('已采用 '+optimizeVersions[optimizeSelected].label+' 作为 3D 参考图');
  optimizeOriginal=reference;optimizeVersions=[{url:reference,label:'原图'}];optimizeSelected=0;
});
$('tpOptimizeClose').onclick=()=>{$('tpOptimizer').hidden=true;};
$('tpOptimizer').addEventListener('click',event=>{const card=event.target.closest('[data-style]');if(!card||state.busy)return;referenceStyle=card.dataset.style;$('tpStyleGrid').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===card)));});
$('tpToolModel').addEventListener('change',renderToolParams);
$('tpOptimizeRun').onclick=()=>run(async()=>{
  const preset=referenceStyles.find(p=>p[0]===referenceStyle);
  $('tpPrompt').value='基于导入的参考图进行图像编辑，用于后续图片生成 3D 模型。'+preset[4]+' 单个主体居中，完整展示，干净纯色背景，柔和均匀光照，不添加文字、水印、边框或多个视图。'+$('tpOptimizeExtra').value.trim();
  try{$('tpOptimizeStatus').textContent='正在优化参考图…';await generateToolImage();}catch(error){$('tpOptimizeStatus').textContent=error.message;throw error;}
});
$('tpCancel').onclick=()=>run(async()=>{$('tpApproval').hidden=true;if(state.pending)await api(`/projects/${state.project}/jobs/${state.pending.id}/discard`,'POST',{});state.pending=null;await snapshot();});
$('tpApprove').onclick=()=>run(async()=>{
  const job=state.pending;if(!job)return;$('tpApprove').disabled=true;
  try{const result=await api(`/projects/${state.project}/jobs/${job.id}/submit`,'POST',{approvalHash:job.approvalHash});state.pending=null;$('tpApproval').hidden=true;await snapshot();message(result.status==='submission_unknown'?'提交状态不确定，请关联云任务后继续，勿重复生成。':'任务已提交');schedule();}
  finally{$('tpApprove').disabled=false;}
});
$('tpUpload').onclick=()=>{uploadView='';$('tpFile').click();};
$('tpCurrent').onclick=()=>run(async()=>{const image=window.canvas3d.image();if(!image)throw new Error('当前没有参考图');uploadView='';await upload(await asPng(image),'当前参考图');});
$('tpFile').onchange=()=>run(async()=>{const file=$('tpFile').files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MiB');const url=URL.createObjectURL(file);try{await upload(await asPng(url),file.name);}finally{URL.revokeObjectURL(url);$('tpFile').value='';}});
for(const type of ['dragover','drop'])$('tpUpload').addEventListener(type,event=>{event.preventDefault();if(type==='drop'&&!state.busy&&!window.canvas3d.busy())run(async()=>{const file=event.dataTransfer.files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MiB');const url=URL.createObjectURL(file);try{await upload(await asPng(url),file.name);}finally{URL.revokeObjectURL(url);}});});
document.addEventListener('paste',event=>{const file=[...(event.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(!file||event.target.closest('input,textarea')||state.busy||window.canvas3d.busy())return;event.preventDefault();run(async()=>{const url=URL.createObjectURL(file);try{await upload(await asPng(url),'粘贴图片');}finally{URL.revokeObjectURL(url);}});});
root.querySelectorAll('[data-view]').forEach(button=>{button.onclick=()=>{uploadView=button.dataset.view;$('tpFile').click();};button.oncontextmenu=e=>{e.preventDefault();delete views[button.dataset.view];renderViews();persist();};});
$('tpNew').onclick=()=>{$('tpNewBox').hidden=!$('tpNewBox').hidden;$('tpProjectName').focus();};
$('tpCreate').onclick=()=>run(async()=>{const p=await api('/projects','POST',{name:$('tpProjectName').value.trim()||'3D 生成'});state.project=p.id;Object.keys(views).forEach(k=>delete views[k]);await projects();await snapshot();$('tpNewBox').hidden=true;persist();});
$('tpProject').onchange=()=>run(async()=>{state.project=$('tpProject').value;Object.keys(views).forEach(k=>delete views[k]);await snapshot();persist();schedule();});
$('tpRefresh').onclick=()=>run(async()=>{await snapshot(true);message('任务状态已刷新');schedule();});
$('tpImport').onclick=()=>{$('tpImportBox').hidden=!$('tpImportBox').hidden;};
$('tpImportSave').onclick=()=>run(async()=>{await ensureProject();await api(`/projects/${state.project}/jobs/import`,'POST',{taskId:$('tpImportId').value.trim(),confirm:true});await snapshot();schedule();});
$('tpJobs').onclick=event=>run(async()=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const job=state.data.jobs.find(j=>j.id===button.closest('[data-job]').dataset.job),action=button.dataset.action;
  if(action==='review')return review(job);
  if(action==='preview'){const r=await fetch(assetUrl(button.dataset.asset));if(!r.ok)throw new Error('模型读取失败');await window.canvas3d.preview(await r.arrayBuffer());return;}
  if(action==='image'){$('tpImage').value=button.dataset.asset;state.kind='image-to-model';sync();imagePreview();persist();return;}
  if(action==='source'){state.kind='mesh-decimate';renderAssets();$('tpModelJob').value=job.id;sync();persist();return;}
  if(action==='recover'){const taskId=window.prompt('输入 Tripo 控制台中对应的云任务号');if(!taskId)return;await api(`/projects/${state.project}/jobs/${job.id}/recover`,'POST',{taskId:taskId.trim(),confirm:true});}
  else await api(`/projects/${state.project}/jobs/${job.id}/${action}`,'POST',{});
  await snapshot();schedule();
});

$('tpSettings').onclick=()=>{const s=state.status;if(!s){message('尚未连上本机 Tripo 后端，请刷新页面',true);return;}$('tpSite').value=s.site;setOn('tpPaid',s.paidEnabled);setOn('tpRemember',s.credentials?.source==='saved');$('tpSettingsMessage').textContent='';$('tpSettingsBox').hidden=false;};
$('tpSettingsCancel').onclick=()=>{$('tpSettingsBox').hidden=true;$('tpKey').value='';};
$('tpSettingsSave').onclick=()=>run(async()=>{
  try{
    if($('tpSite').value!==state.status.site)handshake(await api('/site','PUT',{site:$('tpSite').value,confirm:true}));
    const key=$('tpKey').value.trim();
    await api('/credentials','PUT',{...(key?{key}:{}),paidEnabled:on('tpPaid'),remember:on('tpRemember'),site:state.status.site});
    $('tpKey').value='';$('tpSettingsBox').hidden=true;state.initialized=false;await initialize();message('连接已保存');
  }catch(e){$('tpSettingsMessage').textContent=e.message;}
});
$('tpBalance').onclick=()=>run(async()=>{try{const data=await api('/balance');$('tpSettingsMessage').textContent=JSON.stringify(data);}catch(e){$('tpSettingsMessage').textContent=e.message;}});

let cropImage=null,cropStart=null,cropRect=null;
$('tpCrop').onclick=()=>run(async()=>{
  if(!$('tpImage').value)throw new Error('请先选择图片');cropImage=new Image();cropImage.src=assetUrl($('tpImage').value);await cropImage.decode();
  const canvas=$('tpCropCanvas'),scale=Math.min(1,300/cropImage.naturalWidth);canvas.width=Math.round(cropImage.naturalWidth*scale);canvas.height=Math.round(cropImage.naturalHeight*scale);canvas.getContext('2d').drawImage(cropImage,0,0,canvas.width,canvas.height);cropRect=null;$('tpCropBox').hidden=false;
});
function cropPoint(event){const c=$('tpCropCanvas'),r=c.getBoundingClientRect();return [Math.max(0,Math.min(c.width,(event.clientX-r.left)*c.width/r.width)),Math.max(0,Math.min(c.height,(event.clientY-r.top)*c.height/r.height))];}
$('tpCropCanvas').onpointerdown=event=>{cropStart=cropPoint(event);$('tpCropCanvas').setPointerCapture(event.pointerId);};
$('tpCropCanvas').onpointermove=event=>{if(!cropStart)return;const end=cropPoint(event),c=$('tpCropCanvas'),ctx=c.getContext('2d');cropRect=[Math.min(cropStart[0],end[0]),Math.min(cropStart[1],end[1]),Math.abs(end[0]-cropStart[0]),Math.abs(end[1]-cropStart[1])];ctx.drawImage(cropImage,0,0,c.width,c.height);ctx.strokeStyle='#00b4d8';ctx.lineWidth=2;ctx.strokeRect(...cropRect);};
$('tpCropCanvas').onpointerup=()=>{cropStart=null;};
$('tpCropCancel').onclick=()=>{$('tpCropBox').hidden=true;cropStart=null;};
$('tpCropSave').onclick=()=>run(async()=>{if(!cropRect||cropRect[2]<2||cropRect[3]<2)throw new Error('请先拖出裁剪区域');const scale=cropImage.naturalWidth/$('tpCropCanvas').width,r=cropRect.map(v=>Math.round(v*scale)),c=document.createElement('canvas');c.width=r[2];c.height=r[3];c.getContext('2d').drawImage(cropImage,...r,0,0,r[2],r[3]);uploadView='';await upload(c.toDataURL('image/png'),'裁剪图片');$('tpCropBox').hidden=true;});

async function website(dryRun){
  let image=reference||window.canvas3d.image();
  if($('tpImage').value)image=await asPng(assetUrl($('tpImage').value));
  if(state.kind==='image-to-model'&&!image)throw new Error('请添加图片');
  const budget=$('tpBudget').value.trim();
  if(state.platform==='tripo'&&!dryRun&&(!budget||!Number.isInteger(Number(budget))||Number(budget)<0))throw new Error('请填写本次积分上限');
  window.canvas3d.website({provider:state.platform,image,topology:state.kind==='mesh-decimate',quad:on(state.kind==='mesh-decimate'?'tpRetopoQuad':'tpQuad'),faces:Number($('tpFaces').value),adaptive:on('tpAdaptive'),effort:$('tpEffort').value,prompt:$('tpRodinPrompt').value,maxCredits:budget?Number(budget):null},dryRun);
}
async function channel(value) {
  if(window.canvas3d.busy()||state.busy){message('请等待当前操作完成',true);return;}
  state.channel=state.platform==='tripo'?value:'webai2api';
  window.canvas3d.assetMode(direct()?'api':'webai2api');
  clearTimeout(state.timer);message('');sync();
  if(direct()){await run(async()=>{await initialize();renderAssetGrid();schedule();});}
  imagePreview();sync();persist();
}
$('tpPlatform').onchange=()=>{if(state.busy||window.canvas3d.busy())return;state.platform=$('tpPlatform').value;channel(state.channel);};
$('channelToggle').onclick=()=>channel(state.channel==='api'?'webai2api':'api');
$('connectionSettings').onclick=()=>{if(direct())$('tpSettings').click();else $('connBtn').click();};
window.canvas3d.precheck=()=>run(()=>website(true));
window.addEventListener('canvas3d-state',sync);
$('historyRefresh').addEventListener('click',()=>{if(direct())run(()=>snapshot(true));});
updateImageSettings();
if(saved.switches)for(const [id,value] of Object.entries(saved.switches))if($(id))setOn(id,Boolean(value));
$('tpEffort').value='medium';
loadToolModels().catch(e=>message(e.message,true));
$('tpToolRefresh').onclick=()=>run(loadToolModels);
channel(state.channel);
