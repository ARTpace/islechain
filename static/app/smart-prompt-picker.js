/**
 * 提示词预设选择器 — 浮动面板
 * 在文生图页面中调用 spPickerOpen() 打开
 */
let spPickerPresets = [];
let spPickerSelectedId = 'default';
let spPickerProviders = [];   // 可用 provider 列表（从 /api/config 加载）

async function spPickerLoadPresets() {
    try {
        const [presetsRes, selectedRes] = await Promise.all([
            fetch('/api/smart-prompt/presets').then(r => r.json()),
            fetch('/api/smart-prompt/selected-preset').then(r => r.json())
        ]);
        spPickerPresets = presetsRes.presets || [];
        spPickerSelectedId = selectedRes.preset_id || 'default';
    } catch (e) {
        spPickerPresets = [{ id: 'default', name: '默认 Anima', description: '标准 Anima 标签生成' }];
        spPickerSelectedId = 'default';
    }
}

async function spPickerLoadProviders() {
    try {
        const data = await fetch('/api/config').then(r => r.json());
        spPickerProviders = [];
        // 内置 comfly
        if (data.has_api_key) {
            spPickerProviders.push({ id: 'comfly', label: 'ComfyUI (' + (data.chat_model || '') + ')' });
        }
        // 内置 modelscope
        if (data.has_ms_key && data.ms_chat_models?.length) {
            spPickerProviders.push({ id: 'modelscope', label: 'ModelScope (' + data.ms_chat_models[0] + ')' });
        }
        // 自定义 providers
        (data.chat_providers || []).forEach(p => {
            (p.chat_models || []).forEach(m => {
                spPickerProviders.push({ id: p.id + '::' + m, label: p.name + ' (' + m + ')' });
            });
        });
    } catch (e) {
        spPickerProviders = [];
    }
}

function spPickerProviderOptionsHtml(selected) {
    let html = '<option value="">自动（全局默认）</option>';
    spPickerProviders.forEach(p => {
        html += `<option value="${escHtml(p.id)}"${p.id === selected ? ' selected' : ''}>${escHtml(p.label)}</option>`;
    });
    return html;
}

function spPickerRender() {
    const body = document.getElementById('spPickerBody');
    if (!body) return;
    // 获取当前模型模式，过滤预设
    const currentMode = (typeof getCurrentModelMode === 'function') ? getCurrentModelMode() : '';
    const filtered = spPickerPresets.filter(p => !p.model_mode || p.model_mode === 'all' || p.model_mode === currentMode);
    if (!filtered.length) {
        body.innerHTML = '<div style="text-align:center;padding:24px;color:#999999;font-size:12px;">当前模型没有匹配的预设<br>请到管理器中创建</div>';
        return;
    }
    body.innerHTML = filtered.map(p => {
        const active = p.id === spPickerSelectedId ? 'active' : '';
        const providerId = p.provider_id || '';
        const providerLabel = spPickerProviders.find(x => x.id === providerId)?.label || '自动';
        return `<div class="sp-picker-item ${active}" onclick="spPickerSelect('${p.id}')">
            <div class="sp-picker-dot"></div>
            <div class="sp-picker-info">
                <div class="sp-picker-name">${escHtml(p.name || p.id)}</div>
                <div class="sp-picker-desc">${escHtml(p.description || '')}</div>
                <div class="sp-picker-model-row">
                    <span class="sp-picker-model-label">模型</span>
                    <select class="sp-picker-model-select" onchange="spPickerChangeProvider('${p.id}', this.value); event.stopPropagation();" onclick="event.stopPropagation();">${spPickerProviderOptionsHtml(providerId)}</select>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function spPickerChangeProvider(presetId, providerId) {
    const p = spPickerPresets.find(x => x.id === presetId);
    if (!p) return;
    p.provider_id = providerId;
    try {
        await fetch('/api/smart-prompt/presets/' + presetId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p)
        });
    } catch (e) {}
}

async function spPickerSelect(id) {
    spPickerSelectedId = id;
    // 保存到后端
    try {
        await fetch('/api/smart-prompt/selected-preset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset_id: id })
        });
    } catch (e) {}
    // 更新按钮标签
    const preset = spPickerPresets.find(p => p.id === id);
    const label = document.getElementById('spCurrentLabel');
    if (label && preset) label.textContent = preset.name;
    spPickerClose();
}

function spPickerOpen() {
    Promise.all([spPickerLoadPresets(), spPickerLoadProviders()]).then(() => {
        spPickerRender();
        const shell = document.getElementById('spPickerShell');
        if (shell) { shell.style.display = 'flex'; requestAnimationFrame(() => shell.classList.add('is-open')); }
    });
}

function spPickerClose() {
    const shell = document.getElementById('spPickerShell');
    if (shell) { shell.classList.remove('is-open'); setTimeout(() => shell.style.display = 'none', 250); }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function spPickerInit() {
    if (document.getElementById('spPickerShell')) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/static/app/smart-prompt-picker.css';
    document.head.appendChild(css);

    const shell = document.createElement('div');
    shell.id = 'spPickerShell';
    shell.className = 'sp-picker-shell';
    shell.style.display = 'none';
    shell.onclick = (e) => { if (e.target === shell) spPickerClose(); };
    // [2026-07-28] head 加 channel 切换器 (API / 本地 ComfyUI)
    shell.innerHTML = `
        <div class="sp-picker-window">
            <div class="sp-picker-head">
                <div class="sp-picker-title">提示词预设</div>
                <div class="sp-picker-channel">
                    <label>通道</label>
                    <select id="spPickerChannel" onchange="spPickerChangeChannel(this.value)">
                        <option value="api">API</option>
                        <option value="comfyui">本地 ComfyUI</option>
                    </select>
                </div>
                <button class="sp-picker-close" onclick="spPickerClose()">✕</button>
            </div>
            <div class="sp-picker-provider-row" id="spPickerProviderRow" style="display:none;">
                <label>模型</label>
                <select id="spPickerProvider" onchange="spPickerChangeProvider(this.value)"></select>
            </div>
            <div id="spPickerBody" class="sp-picker-body"></div>
            <div class="sp-picker-foot">
                <button onclick="spPickerClose()">取消</button>
                <button class="sp-manage-btn" onclick="spPickerClose(); spmOpen()">管理预设</button>
            </div>
        </div>`;
    document.body.appendChild(shell);

    // 加载当前选中的预设名 + channel 状态
    Promise.all([spPickerLoadPresets(), spPickerLoadProviders(), spPickerLoadGlobalConfig()]).then(() => {
        const preset = spPickerPresets.find(p => p.id === spPickerSelectedId);
        const label = document.getElementById('spCurrentLabel');
        if (label && preset) label.textContent = preset.name;
    });
}

// [2026-07-28] 加载全局配置 (channel + provider_id) 到下拉 + window 全局变量
async function spPickerLoadGlobalConfig() {
    try {
        const cfg = await fetch('/api/smart-prompt/config').then(r => r.json());
        const channel = cfg.channel || 'api';
        const providerId = cfg.provider_id || '';
        const chSel = document.getElementById('spPickerChannel');
        const pSel = document.getElementById('spPickerProvider');
        if (chSel) chSel.value = channel;
        if (pSel) {
            pSel.innerHTML = spPickerProviderOptionsHtml(providerId);
            if (channel === 'comfyui') {
                const opt = pSel.querySelector('option[value="comfyui_local"]');
                if (opt) pSel.value = 'comfyui_local';
            }
        }
        window.localPromptChannel = channel;
        window.localPromptProvider = (channel === 'comfyui') ? 'comfyui_local' : providerId;
        const provRow = document.getElementById('spPickerProviderRow');
        if (provRow) provRow.style.display = (channel === 'api') ? '' : 'none';
    } catch (e) {}
}

// [2026-07-28] channel 切换 - 写后端 + 更新全局变量
async function spPickerChangeChannel(channel) {
    window.localPromptChannel = channel;
    if (channel === 'comfyui') {
        window.localPromptProvider = 'comfyui_local';
        const provRow = document.getElementById('spPickerProviderRow');
        if (provRow) provRow.style.display = 'none';
    } else {
        const pSel = document.getElementById('spPickerProvider');
        if (pSel) window.localPromptProvider = pSel.value;
        const provRow = document.getElementById('spPickerProviderRow');
        if (provRow) provRow.style.display = '';
    }
    try {
        await fetch('/api/smart-prompt/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, provider_id: window.localPromptProvider })
        });
    } catch (e) {}
}

// [2026-07-28] provider 切换 - 写后端 + 更新全局变量
async function spPickerChangeProvider(providerId) {
    window.localPromptProvider = providerId;
    try {
        await fetch('/api/smart-prompt/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: window.localPromptChannel || 'api', provider_id: providerId })
        });
    } catch (e) {}
}
