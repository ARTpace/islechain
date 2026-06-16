/**
 * 提示词预设管理浮层 — 在当前页面内操作
 */
let spmPresets = [];
let spmEditingId = null;

async function spmLoad() {
    try {
        const res = await fetch('/api/smart-prompt/presets').then(r => r.json());
        spmPresets = res.presets || [];
    } catch (e) { spmPresets = []; }
    spmRenderList();
    // 自动选中第一个或当前编辑的预设
    if (spmEditingId && spmPresets.find(x => x.id === spmEditingId)) {
        spmEdit(spmEditingId);
    } else if (spmPresets.length > 0) {
        spmEdit(spmPresets[0].id);
    } else {
        spmShowEmpty();
    }
}

function spmRenderList() {
    const el = document.getElementById('spmList');
    if (!el) return;
    el.innerHTML = spmPresets.map(p => `
        <div class="spm-item ${p.id === spmEditingId ? 'active' : ''}" onclick="spmEdit('${p.id}')">
            <div class="spm-item-name">${spmEsc(p.name || p.id)}</div>
            ${p.id !== 'default' ? `<button class="spm-item-del" onclick="event.stopPropagation();spmDelete('${p.id}')" title="删除">✕</button>` : ''}
        </div>
    `).join('');
}

function spmShowEmpty() {
    document.getElementById('spmForm').style.display = 'none';
    document.getElementById('spmEmpty').style.display = '';
}

function spmEdit(id) {
    spmEditingId = id;
    const p = spmPresets.find(x => x.id === id);
    if (!p) return;
    document.getElementById('spmEmpty').style.display = 'none';
    document.getElementById('spmForm').style.display = '';
    document.getElementById('spmName').value = p.name || '';
    document.getElementById('spmDesc').value = p.description || '';
    document.getElementById('spmModelMode').value = p.model_mode || 'all';
    document.getElementById('spmTemp').value = p.temperature ?? 0.3;
    document.getElementById('spmTokens').value = p.max_tokens ?? 1024;
    document.getElementById('spmQuality').value = p.quality_tags || '';
    document.getElementById('spmNegative').value = p.negative_default || '';
    document.getElementById('spmSystemPrompt').value = p.system_prompt || '';
    spmLoadProviders(p.provider_id || '');
    spmRenderList();
}

async function spmLoadProviders(selected) {
    const sel = document.getElementById('spmProvider');
    sel.innerHTML = '<option value="">自动（第一个可用）</option>';
    try {
        const data = await fetch('/api/config').then(r => r.json());
        (data.chat_providers || []).forEach(p => {
            (p.chat_models || []).forEach(m => {
                const opt = document.createElement('option');
                opt.value = p.id + '::' + m;
                opt.textContent = p.name + ' (' + m + ')';
                sel.appendChild(opt);
            });
        });
    } catch (e) {}
    if (selected) sel.value = selected;
}

function spmCreate() {
    const id = 'preset-' + Date.now().toString(36);
    const p = { id, name: '新预设', description: '', provider_id: '', model_mode: 'all', temperature: 0.3, max_tokens: 1024, quality_tags: 'masterpiece, best quality, ultra detailed, highres', negative_default: 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry', system_prompt: '', output_format: 'tag_only', is_default: false, created_at: new Date().toISOString().slice(0,10) };
    spmPresets.push(p);
    spmEdit(id);
    spmAutoSave();
}

let spmSaveTimer = null;
function spmAutoSave() {
    clearTimeout(spmSaveTimer);
    spmSaveTimer = setTimeout(() => spmSave(), 500);
}

async function spmSave() {
    if (!spmEditingId) return;
    const p = spmPresets.find(x => x.id === spmEditingId);
    if (!p) return;
    p.name = document.getElementById('spmName').value.trim() || p.name;
    p.description = document.getElementById('spmDesc').value.trim();
    p.provider_id = document.getElementById('spmProvider').value;
    p.model_mode = document.getElementById('spmModelMode').value;
    p.temperature = parseFloat(document.getElementById('spmTemp').value) || 0.3;
    p.max_tokens = parseInt(document.getElementById('spmTokens').value) || 1024;
    p.quality_tags = document.getElementById('spmQuality').value.trim();
    p.negative_default = document.getElementById('spmNegative').value.trim();
    p.system_prompt = document.getElementById('spmSystemPrompt').value;
    try {
        await fetch('/api/smart-prompt/presets/' + p.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(p) });
        spmRenderList();
        // 更新浮动选择器的标签
        spPickerLoadPresets().then(() => {
            const preset = spPickerPresets.find(x => x.id === spPickerSelectedId);
            const label = document.getElementById('spCurrentLabel');
            if (label && preset) label.textContent = preset.name;
        });
    } catch (e) {}
}

async function spmDelete(id) {
    if (!confirm('确认删除此预设？')) return;
    try { await fetch('/api/smart-prompt/presets/' + id, { method: 'DELETE' }); } catch (e) {}
    spmPresets = spmPresets.filter(x => x.id !== id);
    if (spmEditingId === id) { spmEditingId = null; spmShowEmpty(); }
    spmRenderList();
}



function spmOpen() {
    spmLoad().then(() => {
        const shell = document.getElementById('spmShell');
        if (shell) { shell.style.display = 'flex'; requestAnimationFrame(() => shell.classList.add('is-open')); }
    });
}

function spmClose() {
    const shell = document.getElementById('spmShell');
    if (shell) { shell.classList.remove('is-open'); setTimeout(() => shell.style.display = 'none', 300); }
    // 关闭后刷新浮动选择器的预设列表
    spPickerLoadPresets().then(() => {
        const preset = spPickerPresets.find(x => x.id === spPickerSelectedId);
        const label = document.getElementById('spCurrentLabel');
        if (label && preset) label.textContent = preset.name;
    });
}

function spmEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function spmInit() {
    if (document.getElementById('spmShell')) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/static/app/smart-prompt-manager.css';
    document.head.appendChild(css);

    const shell = document.createElement('div');
    shell.id = 'spmShell';
    shell.className = 'spm-shell';
    shell.style.display = 'none';
    shell.onclick = (e) => { if (e.target === shell) spmClose(); };
    shell.innerHTML = `
        <div class="spm-window">
            <div class="spm-head">
                <div class="spm-title">提示词预设管理</div>
                <button class="spm-close" onclick="spmClose()">✕</button>
            </div>
            <div class="spm-body">
                <div class="spm-side">
                    <div class="spm-side-head">
                        <button class="spm-add-btn" onclick="spmCreate()">+ 新建预设</button>
                    </div>
                    <div id="spmList" class="spm-list"></div>
                </div>
                <div class="spm-editor">
                    <div id="spmEmpty" class="spm-empty" style="flex-direction:column;gap:8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/></svg><span>选择左侧预设编辑，或点击上方「新建」</span></div>
                    <div id="spmForm" style="display:none;">
                        <div class="sp-field-row" style="grid-template-columns:1fr 2fr;">
                            <div class="sp-field"><label>预设名称</label><input id="spmName" placeholder="如：萌系动漫" oninput="spmAutoSave()"></div>
                            <div class="sp-field"><label>描述</label><input id="spmDesc" placeholder="简短描述适用场景" oninput="spmAutoSave()"></div>
                        </div>
                        <div class="sp-field-row">
                            <div class="sp-field"><label>AI 模型</label><select id="spmProvider" onchange="spmAutoSave()"></select></div>
                            <div class="sp-field"><label>适用模型</label><select id="spmModelMode" onchange="spmAutoSave()"><option value="all">全部模型</option><option value="Z-Image">Z-Image</option><option value="ANIMA">ANIMA</option><option value="Anima图生图">Anima图生图</option></select></div>
                            <div class="sp-field"><label>Temperature</label><input id="spmTemp" type="number" min="0" max="2" step="0.1" value="0.3" oninput="spmAutoSave()"></div>
                            <div class="sp-field"><label>Max Tokens</label><input id="spmTokens" type="number" min="64" max="4096" step="64" value="1024" oninput="spmAutoSave()"></div>
                        </div>
                        <div class="sp-field"><label>质量词模板</label><input id="spmQuality" placeholder="masterpiece, best quality, ultra detailed, highres" oninput="spmAutoSave()"></div>
                        <div class="sp-field"><label>默认负向提示词</label><input id="spmNegative" placeholder="worst quality, low quality, bad anatomy..." oninput="spmAutoSave()"></div>
                        <div class="sp-field"><label>自定义 System Prompt（留空用默认规则）</label><textarea id="spmSystemPrompt" placeholder="留空使用内置 Anima 规则，填写则完全替换" oninput="spmAutoSave()"></textarea></div>
                    </div>
                </div>
            </div>
            <div class="spm-foot">
                <div style="flex:1;font-size:10px;color:#999;">编辑后自动保存</div>
            </div>
        </div>`;
    document.body.appendChild(shell);
}
