/**
 * 提示词预设选择器 — 浮动面板
 * 在文生图页面中调用 spPickerOpen() 打开
 */
let spPickerPresets = [];
let spPickerSelectedId = 'default';

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

function spPickerRender() {
    const body = document.getElementById('spPickerBody');
    if (!body) return;
    // 获取当前模型模式，过滤预设
    const currentMode = (typeof getCurrentModelMode === 'function') ? getCurrentModelMode() : '';
    const filtered = spPickerPresets.filter(p => !p.model_mode || p.model_mode === 'all' || p.model_mode === currentMode);
    if (!filtered.length) {
        body.innerHTML = '<div style="text-align:center;padding:24px;color:#999;font-size:12px;">当前模型没有匹配的预设<br>请到管理器中创建</div>';
        return;
    }
    body.innerHTML = filtered.map(p => {
        const active = p.id === spPickerSelectedId ? 'active' : '';
        return `<div class="sp-picker-item ${active}" onclick="spPickerSelect('${p.id}')">
            <div class="sp-picker-dot"></div>
            <div>
                <div class="sp-picker-name">${escHtml(p.name || p.id)}</div>
                <div class="sp-picker-desc">${escHtml(p.description || '')}</div>
            </div>
        </div>`;
    }).join('');
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
    spPickerRender();
    spPickerClose();
}

function spPickerOpen() {
    spPickerLoadPresets().then(() => {
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
    shell.innerHTML = `
        <div class="sp-picker-window">
            <div class="sp-picker-head">
                <div class="sp-picker-title">提示词预设</div>
                <button class="sp-picker-close" onclick="spPickerClose()">✕</button>
            </div>
            <div id="spPickerBody" class="sp-picker-body"></div>
            <div class="sp-picker-foot">
                <button onclick="spPickerClose()">取消</button>
                <button class="sp-manage-btn" onclick="spPickerClose(); spmOpen()">管理预设</button>
            </div>
        </div>`;
    document.body.appendChild(shell);

    // 加载当前选中的预设名
    spPickerLoadPresets().then(() => {
        const preset = spPickerPresets.find(p => p.id === spPickerSelectedId);
        const label = document.getElementById('spCurrentLabel');
        if (label && preset) label.textContent = preset.name;
    });
}
