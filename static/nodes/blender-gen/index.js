/* AI 建模节点（blenderGen）：让 AI 在 Blender 里现场建模，产物回传画布。
 *
 * 依赖约定见 static/nodes/README.md：
 *   - 画布状态（nodes / connections / canvas）是 let/const 声明，不挂 window，必须走 deps
 *   - 工具函数（addNode / render / scheduleSave / uid / escapeHtml / defaultPoint /
 *     generatorSources / model3dViewerElement / cascadeBtnHtml）是 function 声明，全局可用
 */
(() => {
let deps = null;

function getNodes(){ return deps.nodes(); }
function getConnections(){ return deps.connections(); }
function getCanvas(){ return deps.canvas(); }

// —— AI 建模节点：AI 在 Blender 里现场建模，产物回来变成 3D 模型节点 ——
function addBlenderNode(point, sceneWorkspace=false){
    const p = point || defaultPoint();
    return addNode({
        id: uid('blender'),
        type: 'blenderGen',
        sceneWorkspace,
        x: p.x,
        y: p.y,
        prompt: '',
        provider: '',
        model: '',
        presetId: 'default',
        targetTris: 0,
        status: 'idle',
        statusText: '',
        logs: []
    });
}

function blenderModelSource(node){
    // 上游连了模型资产（或旧版 3D 模型节点）时，把它当成"要改造的基准模型"，
    // 而不是让 AI 从零再建一个相似的。
    try{
        const ups = getConnections().filter(c => c.to === node.id)
            .map(c => getNodes().find(n => n.id === c.from)).filter(Boolean);
        for(const up of ups){
            if(up.type === 'gameModelAsset' && up.modelAssetId && up.projectId && window.GameModel3D?.contentUrl){
                const url = window.GameModel3D.contentUrl(up);
                if(url) return {url, label: '模型资产', nodeId: up.id, assetId: up.modelAssetId, projectId: up.projectId};
            }
            if(up.type === 'model3d' && up.url){
                return {url: up.url, label: up.name || '3D 模型', nodeId: up.id};
            }
        }
    }catch(err){}
    return null;
}

function blenderRefUrls(node){
    return blenderRefPreviews(node).map(ref => ref.url);
}

function blenderRefPreviews(node){
    // 与提交给后端的 blenderRefUrls 同源：连线里真正会被送进 Blender 的图片才显示。
    try{
        const seen = new Set();
        return generatorSources(node)
            .flatMap(src => (src.refs || [])
                .filter(ref => !ref?.kind || ref.kind === 'image')
                .map(ref => ref && typeof ref.url === 'string' ? ref : null))
            .filter(ref => ref && ref.url)
            .filter(ref => {
                if(seen.has(ref.url)) return false;
                seen.add(ref.url);
                return true;
            })
            .map(ref => ({url: ref.url, name: ref.name || '参考图'}));
    }catch(err){
        return [];
    }
}

let blenderProviders = null;

function loadBlenderProviders(){
    if(blenderProviders !== null) return;
    blenderProviders = [];
    fetch('/api/providers').then(res => res.json()).then(data => {
        blenderProviders = (data.providers || [])
            .filter(item => item.enabled !== false && (item.chat_models || []).length)
            .map(item => ({id: item.id, name: item.name || item.id, models: item.chat_models || []}));
        render();
    }).catch(() => {});
}

/* 建模人设：管取舍方向；具体手法与标杆脚本在 packs/blender-skills/<id>/SKILL.md。 */
let blenderPresets = null;

function loadBlenderPresets(){
    if(blenderPresets !== null) return;
    blenderPresets = [];
    fetch('/api/game-projects/presets').then(res => res.json()).then(data => {
        blenderPresets = (data.presets || []).filter(item => (item.kinds || []).includes('model'));
        render();
    }).catch(() => {});
}

function blenderPresetSelectHtml(node){
    loadBlenderPresets();
    const current = node.presetId || 'default';
    const preset = blenderPresets.find(item => item.id === current);
    const options = blenderPresets.map(item =>
        `<option value="${escapeHtml(item.id)}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
    ).join('');
    return `<div class="blender-preset-wrap" style="margin-top:6px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span class="llm-pane-label">建模人设</span>
            <button class="blender-preset-info" type="button" title="查看人设详情与工作手册" style="margin-left:auto;display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:6px;border:1px solid var(--ui-line-strong);background:var(--ui-panel);color:var(--ui-accent);font-size:10px;line-height:16px;cursor:pointer">手册</button>
        </div>
        <select class="blender-preset" style="width:100%;border-radius:8px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);color:var(--ui-text);font-size:11px;padding:5px">
            ${options || '<option value="default">通用助手</option>'}
        </select>
        <div class="blender-preset-desc" style="font-size:10px;line-height:1.4;opacity:.55;margin-top:3px">${escapeHtml(preset ? preset.description : '按当前想法完成任务，不额外引入风格约束。')}</div>
    </div>`;
}

/* 目标面数：填了就是硬约束。改造模式下等于减面目标，新建模式下等于建模预算。 */
function blenderTargetTrisHtml(node){
    const value = Number(node.targetTris) > 0 ? String(node.targetTris) : '';
    const now = Number(node.tris) > 0 ? `<span style="font-size:10px;opacity:.55;margin-left:auto">当前 ${Number(node.tris).toLocaleString()}</span>` : '';
    return `<div class="blender-budget" style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <span style="font-size:11px;color:var(--ui-text);white-space:nowrap">目标面数</span>
        <input class="blender-target-tris" type="number" min="0" max="2000000" step="100" value="${value}" placeholder="不限" ${node.running ? 'disabled' : ''} style="width:92px;height:26px;border-radius:6px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);color:var(--ui-text);font-size:11px;padding:0 6px">
        <span style="font-size:10px;opacity:.5">三角面</span>
        ${now}
    </div>`;
}

function blenderModelSelectHtml(node){
    loadBlenderProviders();
    const options = blenderProviders.flatMap(provider => provider.models.map(model => {
        const value = `${provider.id}|${model}`;
        const selected = node.modelRef === value ? 'selected' : '';
        return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(provider.name + ' · ' + model)}</option>`;
    })).join('');
    return `<select class="blender-model" style="width:100%;margin-top:6px;border-radius:8px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);color:var(--ui-text);font-size:11px;padding:5px">
        <option value="">默认渠道</option>${options}
    </select>`;
}


const _qaHydrated = new Set();

function hydrateBlenderQa(node){
    if(!node.jobId || node.running || _qaHydrated.has(node.id)) return;
    _qaHydrated.add(node.id);
    fetch('/api/dcc/jobs/' + encodeURIComponent(node.jobId))
        .then(res => res.ok ? res.json() : null)
        .then(job => {
            if(!job) return;
            let changed = false;
            if(job.uvReport && !node.uvReport){ node.uvReport = job.uvReport; changed = true; }
            if(typeof job.uvCoverage === 'number' && node.uvCoverage !== job.uvCoverage){
                node.uvCoverage = job.uvCoverage; changed = true;
            }
            if(job.openDifferences){ node.openDifferences = job.openDifferences; changed = true; }
            if(job.checkpoints){ node.checkpoints = job.checkpoints; changed = true; }
            if(changed){ scheduleSave(); render(); }
        })
        .catch(() => {});
}

function renderBlenderBody(node){
    hydrateBlenderQa(node);
    const container = document.createElement('div');
    const logs = (node.logs || []).slice(-6);
    const awaiting = node.status === 'awaiting_approval';
    const tone = node.status === 'failed' ? 'var(--ui-error)'
        : (node.status === 'produced' || node.status === 'imported') ? 'var(--ui-success)'
        : awaiting ? 'var(--ui-warning)' : 'var(--ui-accent)';
    // 灰模待审时产物已在 out/，但尚未导入资产卡片，用作业端点直接预览
    const previewUrl = blenderAssetPreviewUrl(node) || (awaiting && node.jobId
        ? '/api/dcc/jobs/' + encodeURIComponent(node.jobId) + '/products/model.glb?stage=blockout'
        : '');
    const diffs = (node.openDifferences || []).filter(item => !item.resolved);
    const uvReport = node.uvReport || {};
    const uvText = typeof node.uvCoverage === 'number'
        ? `UV 有效去重覆盖 ${(node.uvCoverage * 100).toFixed(2)}%${node.uvCoverage < 0.8 ? ' · 低于 80% 预设（质量失败项）' : ' · 达标'}`
        : (uvReport.hasUv === false ? 'UV 未测：产物不含 TEXCOORD_0'
            : 'UV 未实测（改动前的作业；刷新或重新运行后补算）');
    const stageModels = (node.checkpoints || []).filter(item => item.kind === 'model');
    container.innerHTML = `
        ${previewUrl ? `<div class="blender-stage" style="width:100%;height:150px;position:relative;margin-bottom:6px">
            <button type="button" class="blender-spin" title="${node.spinPaused ? '继续旋转' : '暂停旋转'}" style="position:absolute;right:6px;top:6px;z-index:2;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--ui-line-strong);background:color-mix(in srgb, var(--ui-panel) 82.0%, transparent);color:var(--ui-text);cursor:pointer"><i data-lucide="${node.spinPaused ? 'play' : 'pause'}" style="width:14px;height:14px"></i></button>
        </div>` : ''}
        <div class="llm-pane-label">建模需求</div>
        <textarea class="blender-prompt" placeholder="例如：建一个低多边形木箱，边长 1 米，深棕色木质材质…" style="width:100%;height:92px;flex:0 0 92px;resize:none;border-radius:8px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);color:var(--ui-text);font-size:12px;padding:8px;line-height:1.5">${escapeHtml(node.prompt || '')}</textarea>
        ${blenderPresetSelectHtml(node)}
        ${blenderTargetTrisHtml(node)}
        ${blenderModelSelectHtml(node)}
        ${(() => {
            const src = blenderModelSource(node);
            const refs = blenderRefPreviews(node);
            const base = src
                ? `<div class="blender-base" style="font-size:11px;margin:4px 0 2px;color:var(--ui-success)">改造基准：${escapeHtml(src.label)}（AI 会导入它并在原件上改，不重建）</div>`
                : '';
            const thumbs = refs.length ? `<div class="blender-refs" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px">
                ${refs.map(ref => `<a class="blender-ref" href="${escapeHtml(ref.url)}" target="_blank" rel="noopener" title="${escapeHtml(ref.name)}（点击看原图）" style="display:block;width:62px;height:62px;border-radius:6px;overflow:hidden;border:1px solid var(--ui-line-strong);background:var(--ui-panel);flex:0 0 62px">
                    <img src="${escapeHtml(ref.url)}" alt="${escapeHtml(ref.name)}" draggable="false" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">
                </a>`).join('')}
            </div>` : '';
            const hint = refs.length
                ? `<div class="blender-ref-hint" style="font-size:10px;opacity:.6;margin:4px 0 2px">已接入 ${refs.length} 张参考图；连接模型可局部修改</div>`
                : '<div class="blender-ref-hint" style="font-size:11px;opacity:.55;margin:6px 0 2px">连接图片作参考；连接模型可局部修改</div>';
            return base + thumbs + hint;
        })()}
        <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:var(--ui-text)" title="先确认主要形状与比例；满意后把产物连回本节点继续细化">
            <input class="blender-blockout" type="checkbox" ${node.blockoutOnly ? 'checked' : ''} ${node.running ? 'disabled' : ''}>先做灰模
        </label>
        <div class="gen-run-row mt-2">
            <button class="blender-run" ${node.running ? 'disabled' : ''}><i data-lucide="${node.running ? 'loader' : 'boxes'}" class="w-4 h-4"></i>${node.running ? '建模中…' : awaiting ? '重做灰模' : node.blockoutOnly ? '生成灰模' : '让 AI 建模'}</button>
            ${cascadeBtnHtml(node)}
        </div>
        <div class="blender-status" style="font-size:11px;margin-top:6px;color:${tone};min-height:14px">${escapeHtml(node.statusText || '')}</div>
        ${node.jobId && !awaiting && !node.running ? `<div class="blender-qa" style="margin-top:8px;border:1px solid var(--ui-line-strong);background:var(--ui-panel);border-radius:8px;padding:8px">
            <div style="font-size:11px;color:var(--ui-accent);font-weight:600">验收实测 <span style="font-weight:400;color:var(--ui-muted)">· 后端判定，非 AI 自述</span></div>
            <div style="font-size:10px;color:${typeof node.uvCoverage === 'number' && node.uvCoverage < 0.8 ? 'var(--ui-warning)' : 'var(--ui-muted)'};margin-top:4px;line-height:1.5">${escapeHtml(uvText)} · 检查点 ${stageModels.length} 个</div>
            ${diffs.length ? `<div style="font-size:10px;color:var(--ui-warning);margin-top:4px;line-height:1.5">未解决差异：<br>${diffs.map(item => `• ${escapeHtml(String(item.text || ''))}`).join('<br>')}</div>` : '<div style="font-size:10px;color:var(--ui-muted);margin-top:4px">未解决差异：无机器判定失败项</div>'}
        </div>` : ''}
        ${awaiting ? `<div class="blender-review" style="margin-top:8px;border:1px solid var(--ui-warning);background:var(--ui-panel);border-radius:8px;padding:8px">
            <div style="font-size:11px;color:var(--ui-warning);font-weight:600">灰模待人工审核 · 未自动导入资产</div>
            <div style="font-size:10px;color:var(--ui-muted);margin-top:4px;line-height:1.5">${escapeHtml(uvText)} · 检查点 ${stageModels.length} 个</div>
            ${diffs.length ? `<div style="font-size:10px;color:var(--ui-warning);margin-top:4px;line-height:1.5">${diffs.map(item => `• ${escapeHtml(String(item.text || ''))}`).join('<br>')}</div>` : ''}
            <div style="font-size:10px;color:var(--ui-muted);margin-top:4px;line-height:1.5">把上方需求改成细化要求，再点「通过并继续细化」。模型会在同一作业里接着改，不重建整件、不重传参考。</div>
            <div style="display:flex;gap:6px;margin-top:6px">
                <button class="blender-approve" type="button" style="flex:1;height:28px;border-radius:6px;border:1px solid var(--ui-warning);background:var(--ui-panel);color:var(--ui-warning);font-size:11px;cursor:pointer">通过并继续细化</button>
                <button class="blender-discard" type="button" style="height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--ui-line-strong);background:var(--ui-panel);color:var(--ui-error);font-size:11px;cursor:pointer">否决</button>
            </div>
        </div>` : ''}
        ${node.jobId && node.status === 'failed' ? '<button class="blender-salvage" style="margin-top:6px;width:100%;height:26px;border-radius:6px;border:1px solid var(--ui-line-strong);background:var(--ui-panel);color:var(--ui-accent);font-size:11px;cursor:pointer">回收 Blender 里已建的模型</button>' : ''}
        <details><summary style="font-size:10px;color:var(--ui-muted);cursor:pointer;margin-top:4px">运行记录</summary><div class="blender-logs" style="margin-top:4px;max-height:110px;overflow:auto;font-size:10px;line-height:1.5;color:var(--ui-muted)">${logs.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div></details>
        ${node.reply ? `<div style="margin-top:6px;font-size:11px;line-height:1.5;opacity:.8;border-top:1px solid var(--ui-line-strong);padding-top:6px">${escapeHtml(node.reply)}</div>` : ''}
    `;
    const promptEl = container.querySelector('.blender-prompt');
    if(promptEl){
        promptEl.oninput = e => { node.prompt = e.target.value; };
    }
    container.querySelector('.blender-blockout').onchange = e => {
        node.blockoutOnly = e.target.checked; scheduleSave(); render();
    };
    const presetEl = container.querySelector('.blender-preset');
    if(presetEl){
        presetEl.onchange = e => {
            node.presetId = e.target.value;
            const picked = (blenderPresets || []).find(item => item.id === node.presetId);
            const desc = container.querySelector('.blender-preset-desc');
            if(desc) desc.textContent = picked ? picked.description : '';
            scheduleSave();
            render();
        };
        presetEl.onmousedown = e => e.stopPropagation();
    }
    const presetInfoEl = container.querySelector('.blender-preset-info');
    if(presetInfoEl){
        presetInfoEl.onmousedown = e => e.stopPropagation();
        presetInfoEl.onclick = e => {
            e.stopPropagation();
            window.PresetInfo?.open(presetInfoEl, node.presetId || 'default');
        };
    }
    const trisEl = container.querySelector('.blender-target-tris');
    if(trisEl){
        trisEl.oninput = e => {
            const raw = parseInt(e.target.value, 10);
            node.targetTris = Number.isFinite(raw) && raw > 0 ? Math.min(2000000, raw) : 0;
            scheduleSave();
        };
        trisEl.onmousedown = e => e.stopPropagation();
    }
    const modelEl = container.querySelector('.blender-model');
    if(modelEl){
        modelEl.onchange = e => { node.modelRef = e.target.value; scheduleSave(); };
        modelEl.onmousedown = e => e.stopPropagation();
    }
    const stage = container.querySelector('.blender-stage');
    if(stage && previewUrl){
        stage.appendChild(model3dViewerElement({id: node.id, url: previewUrl, spinPaused: node.spinPaused}));
    }
    const spinBtn = container.querySelector('.blender-spin');
    if(spinBtn){
        spinBtn.onclick = e => { e.stopPropagation(); node.spinPaused = !node.spinPaused; render(); };
    }
    container.querySelector('.blender-run').onclick = e => { e.stopPropagation(); runBlenderGenNode(node.id); };
    const salvage = container.querySelector('.blender-salvage');
    if(salvage){
        salvage.onclick = async e => {
            e.stopPropagation();
            node.statusText = '正在回收 Blender 里的产物…';
            salvage.disabled = true;
            render();
            try{
                await blenderImportJob(node, node.jobId);
                node.status = 'produced';
            }catch(err){
                node.statusText = (err && err.message) || '回收失败';
            }
            node.running = false;
            render();
            scheduleSave();
        };
    }
    const approveBtn = container.querySelector('.blender-approve');
    if(approveBtn){
        approveBtn.onclick = e => { e.stopPropagation(); approveBlenderStage(node.id, 'continue'); };
    }
    const discardBtn = container.querySelector('.blender-discard');
    if(discardBtn){
        discardBtn.onclick = e => { e.stopPropagation(); approveBlenderStage(node.id, 'discard'); };
    }
    bindCascadeButtons(container, node.id);
    return container;
}

/* 建模产物直接落成「模型资产」卡片：不再在画布上留一张只有下载/纳入资产按钮的
   model3d 中间卡片，同时把建模节点和资产节点连起来，后续 AI 改模型可以沿这条线追溯来源。*/
async function blenderModelAsset(fromNode, item){
    const url = [item && item.url, item && item.node && item.node.url].find(value => typeof value === 'string' && value);
    if(!url) throw new Error('产物地址缺失');
    if(!window.GameModel3D || !window.GameModel3D.adoptLocal) throw new Error('模型模块未加载');
    // 后端 collect_into_canvas 已经把产物建成画布上的 model3d 节点，这里直接复用它原地升级成
    // 「模型资产」，不再调 dropModels 新建节点 —— 否则画布上会同时出现「3D 模型」和「模型资产」两个。
    let local = item.node && item.node.id ? getNodes().find(n => n.id === item.node.id) : null;
    if(!local && item.node && item.node.id){
        const fresh = item.node;
        fresh.x = (fromNode.x || 0) + (fromNode.w || 360) + 140;
        fresh.y = fromNode.y || 0;
        local = addNode(fresh);
    }
    if(!local) throw new Error('产物节点缺失');
    // 同一个产物被重复回收时节点已经是资产了，直接补连线返回，不重复升级、也不报错。
    if(local.type !== 'model3d' && local.type !== 'gameModelAsset') throw new Error('产物节点类型异常（' + local.type + '）');
    if(local.type === 'model3d') await window.GameModel3D.adoptLocal(local);
    if(fromNode.sceneWorkspace && !local.modelDisplayName){
        const label=String(fromNode.prompt || 'Blender').trim().split(/\r?\n/)[0].slice(0,24);
        local.modelDisplayName=label+' · 建模结果';
    }
    if(!getConnections().some(c => c.from === fromNode.id && c.to === local.id)){
        getConnections().push({id: uid('c'), from: fromNode.id, to: local.id});
        scheduleSave();
    }
    return local;
}

async function blenderOverwriteAsset(node, target, jobId, product){
    // 改造模式的产物不走「新建节点」，直接覆盖原资产：revision+1，画布布局一个像素都不动
    const url = '/api/dcc/jobs/' + encodeURIComponent(jobId) + '/products/' + encodeURIComponent(product.name);
    const response = await fetch(url);
    if(!response.ok) throw new Error('产物下载失败（' + response.status + '）');
    const blob = await response.blob();
    if(!blob.size) throw new Error('产物文件为空');
    if(!window.GamePipeline || !window.GamePipeline.workflow) throw new Error('项目模块未加载，无法写回资产');
    const raw = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('产物读取失败'));
        reader.readAsDataURL(blob);
    });
    await window.GamePipeline.ensureProject();
    let revision = (node.assetRevision || 0) + 1;
    await window.GamePipeline.workflow(async ctx => {
        const existing = (ctx.project.mediaAssets || []).find(item => item.id === target.assetId);
        if(!existing) throw new Error('原模型资产已被删除，请重新连线后再试');
        const result = await ctx.write('/workspace/media-assets', 'POST', {
            filename: product.name || 'model.glb',
            purpose: existing.purpose || '游戏角色或场景素材',
            contentBase64: raw,
            assetId: target.assetId
        });
        const updated = (result.project.mediaAssets || []).find(item => item.id === target.assetId);
        if(updated) revision = updated.revision;
    });
    return revision;
}

function blenderAssetPreviewUrl(node){
    if(node.sceneWorkspace && node.outputModelUrl) return node.outputModelUrl;
    let assetId = node.targetAssetId, projectId = node.targetProjectId;
    if(!assetId || !projectId){
        // 刚连上线还没跑过：直接用上游的模型当预览，连上就能看见
        const src = blenderModelSource(node);
        if(src && src.assetId && src.projectId){
            assetId = src.assetId;
            projectId = src.projectId;
        }else if(src && src.url){
            return src.url;
        }
    }
    if(!assetId || !projectId) return '';
    const base = `/api/game-projects/${encodeURIComponent(projectId)}/workspace/media-assets/${encodeURIComponent(assetId)}/content`;
    // revision 进 query，覆盖后 model-viewer 才会真的重新拉文件，而不是复用旧实例
    return base + '?r=' + encodeURIComponent(String(node.assetRevision || 0));
}

async function blenderImportJob(node, jobId){
    const target = !node.sceneWorkspace && node.targetAssetId && node.targetProjectId
        ? {assetId: node.targetAssetId, projectId: node.targetProjectId} : null;
    if(target){
        const info = await fetch('/api/dcc/jobs/' + encodeURIComponent(jobId));
        if(!info.ok) throw new Error('作业读取失败（' + info.status + '）');
        const job = await info.json();
        const product = (job.products || []).find(item => item.kind === 'model');
        if(!product) throw new Error('产物里没有模型文件');
        const revision = await blenderOverwriteAsset(node, target, jobId, product);
        node.assetRevision = revision;
        node.statusText = `已更新到原模型（v${revision}）`;
        render();
        scheduleSave();
        return;
    }
    const res = await fetch('/api/dcc/jobs/' + encodeURIComponent(jobId) + '/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({})
    });
    if(!res.ok){
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || ('回收产物失败 ' + res.status));
    }
    const data = await res.json();
    let created = 0;
    for(const item of (data.items || [])){
        const fresh = item && item.node;
        if(item && item.kind === 'model'){
            try{
                const output = await blenderModelAsset(node, item);
                if(node.sceneWorkspace){
                    node.outputNodeId=output.id;
                    node.outputModelUrl=item.url || output.url || '';
                }
                created += 1;
                continue;
            }catch(err){
                // 资产模块不可用时退回普通 model3d 卡片，产物不至于丢
            }
        }
        if(!fresh || !fresh.id) continue;
        if(getNodes().some(n => n.id === fresh.id)) continue;
        // 后端已经把它写进画布文件，这里只补内存副本，坐标跟着生成节点排开
        fresh.x = node.x + 300 + (created % 2) * 280;
        fresh.y = node.y + created * 320;
        addNode(fresh);
        created += 1;
    }
    node.statusText = created ? `已回收 ${created} 个产物` : '没有新产物';
    render();
    scheduleSave();
}

/* 灰模人工放行：沿用同一个 jobId 与 work 目录，从 01-blockout.glb 续跑细化。
   否决只终止作业，不删检查点，方便重做时对照。*/
async function approveBlenderStage(nodeId, action){
    const node = getNodes().find(n => n.id === nodeId);
    if(!node || node.running || !node.jobId) return;
    if(action === 'discard' && !confirm('否决这份灰模？作业会停止，需要重新生成。')) return;
    node.running = true;
    node.statusText = action === 'continue' ? '正在从灰模检查点继续细化…' : '正在否决灰模…';
    render();
    try{
        const res = await fetch('/api/dcc/jobs/' + encodeURIComponent(node.jobId) + '/approve-stage', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                prompt: String(node.prompt || '').trim(),
                provider: (node.modelRef || '').split('|')[0] || '',
                model: (node.modelRef || '').split('|')[1] || '',
                action
            })
        });
        if(!res.ok){
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail.detail || ('放行失败 ' + res.status));
        }
        if(action === 'discard'){
            node.status = 'failed';
            node.statusText = '灰模已否决，未进入细化';
            return;
        }
        node.status = 'building';
        node.openDifferences = [];
        await blenderPollJob(node, node.jobId);
    }catch(err){
        node.status = 'failed';
        node.statusText = err && err.message ? err.message : String(err);
    }finally{
        node.running = false;
        render();
        scheduleSave();
    }
}

async function blenderPollJob(node, jobId){
    const deadline = Date.now() + 16 * 60 * 1000;
    while(Date.now() < deadline){
        await new Promise(resolve => setTimeout(resolve, 2500));
        let job = null;
        try{
            const res = await fetch('/api/dcc/jobs/' + encodeURIComponent(jobId));
            if(!res.ok) continue;
            job = await res.json();
        }catch(err){
            continue;
        }
        node.logs = (job.logs || []).map(item => item.line).filter(Boolean);
        node.statusText = job.stage || job.status || '';
        if(job.tris) node.tris = job.tris;
        if(job.targetTris) node.targetTris = job.targetTris;
        if(job.reply) node.reply = job.reply;
        if(job.uvReport) node.uvReport = job.uvReport;
        if(typeof job.uvCoverage === 'number') node.uvCoverage = job.uvCoverage;
        if(job.openDifferences) node.openDifferences = job.openDifferences;
        if(job.checkpoints) node.checkpoints = job.checkpoints;
        if(job.status !== 'awaiting_approval') node.pipelineStage = job.pipelineStage || '';
        render();
        if(job.status === 'awaiting_approval'){
            node.status = 'awaiting_approval';
            node.statusText = '灰模待审核：确认比例与轮廓后再继续';
            render();
            return;
        }
        if(job.status === 'failed'){
            // 对话可能因为限流/网络断了，但 Blender 已经把 GLB 导出来了。
            // 有产物就先回收，不让用户白跑一次建模。
            const ready = (job.products || []).filter(item => item.kind === 'model' || item.kind === 'image');
            if(ready.length){
                node.status = 'produced';
                node.statusText = '对话中断，正在回收 Blender 里的产物…';
                render();
                try{
                    await blenderImportJob(node, jobId);
                    render();
                    scheduleSave();
                    return;
                }catch(err){}
                node.status = 'failed';
            }
            node.status = 'failed';
            node.statusText = job.error || '建模失败';
            throw new Error(node.statusText);
        }
        if(job.status === 'produced' || job.status === 'imported'){
            node.status = 'produced';
            await blenderImportJob(node, jobId);
            if(job.partial) node.statusText = '已回收阶段模型，尚未完成，请检查后继续修改';
            else if(job.blockoutOnly) node.statusText = '灰模已生成，确认后连接产物继续细化';
            else if(node.tris){
                // 面数是后端读 GLB accessor 数出来的，不是模型自述；接在回收结果后面，不覆盖它
                const count = Number(node.tris).toLocaleString();
                const delta = typeof job.trisDelta === 'number' ? `，${job.trisDelta > 0 ? '+' : ''}${job.trisDelta}%` : '';
                const face = node.targetTris
                    ? `面数 ${count} / 目标 ${Number(node.targetTris).toLocaleString()}${delta}`
                    : `面数 ${count} 三角面`;
                node.statusText = node.statusText ? `${node.statusText} · ${face}` : face;
            }
            return;
        }
    }
    throw new Error('建模超时（16 分钟）');
}

async function runBlenderGenNode(nodeId, opts={}){
    const node = getNodes().find(n => n.id === nodeId);
    if(!node || node.running) return;
    if(node.sceneWorkspace && node.workspaceStep && node.workspaceStep !== 'model'){
        alert('当前工序尚未接通，请切回建模后运行');
        return;
    }
    if(blenderRefUrls(node).length > 8){ alert('当前建模最多支持 8 张参考图，请减少输入后再运行；不会静默截断。'); return; }
    const prompt = String(node.prompt || '').trim();
    if(!prompt){ alert('请先填写建模需求'); return; }
    if(!getCanvas() || !getCanvas().id){ alert('画布还没加载完成'); return; }
    node.running = true;
    node.status = 'submitting';
    node.statusText = '提交建模任务…';
    node.logs = [];
    node.reply = '';
    render();
    try{
        const baseModel = blenderModelSource(node);
        // 目标资产跟着连线走：连线断了就退回新建模式，别偷偷继续改旧模型
        node.targetAssetId = baseModel && baseModel.assetId ? baseModel.assetId : '';
        node.targetProjectId = baseModel && baseModel.projectId ? baseModel.projectId : '';
        node.targetLabel = baseModel ? baseModel.label : '';
        // 改造模式要给节点腾出 3D 预览的高度
        if(node.targetAssetId && (!node.h || node.h < 560)) node.h = 600;
        const res = await fetch('/api/dcc/build-model', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                canvasId: getCanvas().id,
                prompt,
                urls: blenderRefUrls(node),
                modelUrl: baseModel ? baseModel.url : '',
                modelName: baseModel ? baseModel.label : '',
                blockoutOnly: !!node.blockoutOnly,
                presetId: node.presetId || 'default',
                targetTris: Math.max(0, parseInt(node.targetTris, 10) || 0),
                provider: (node.modelRef || '').split('|')[0] || '',
                model: (node.modelRef || '').split('|')[1] || ''
            })
        });
        if(!res.ok){
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail.detail || ('提交失败 ' + res.status));
        }
        const data = await res.json();
        node.jobId = data.jobId;
        node.statusText = node.targetAssetId ? 'AI 正在改造基准模型…' : 'Blender 正在建模…';
        render();
        await blenderPollJob(node, data.jobId);
    }catch(err){
        node.status = 'failed';
        node.statusText = err && err.message ? err.message : String(err);
    }finally{
        node.running = false;
        render();
        scheduleSave();
    }
}

window.BlenderGenNode = {
    type: 'blenderGen',
    title: 'AI 建模',
    defaults: () => ({prompt: '', provider: '', model: '', presetId: 'default',
                      targetTris: 0,
                      status: 'idle', statusText: '', logs: []}),
    init(next){ deps = next; },
    addNode: addBlenderNode,
    body: node => node.sceneWorkspace && window.BlenderWorkspace
        ? window.BlenderWorkspace.body(node, renderBlenderBody) : renderBlenderBody(node),
    run: runBlenderGenNode,
    modelSource: blenderModelSource,
    previewUrl: blenderAssetPreviewUrl,
    poll: blenderPollJob,
    importJob: blenderImportJob,
};
})();
