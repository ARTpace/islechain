/**
 * LoRA 选择器组件
 * 侧边栏分类 + 卡片网格 + 搜索 + 强度调节
 * 
 * 使用方式：
 *   loraPickerOpen(callback)   — 打开选择器
 *   loraPickerClose()          — 关闭选择器
 * 
 * callback 格式：(selectedLoras) => { ... }
 * selectedLoras: [{ name, displayName, preview, baseModel, tags, strength }]
 */

// ── 状态 ─────────────────────────────────────────────────────────────
let loraPickerAllItems = [];       // 全量 LoRA 数据
let loraPickerSelected = [];       // 已选 LoRA [{name, strength}]
let loraPickerCategory = 'all';    // 当前分类
let loraPickerSearch = '';         // 搜索关键词
let loraPickerCallback = null;     // 确认回调
let loraPickerInitialized = false;
let loraPickerPage = 1;            // 当前页码
const loraPickerPageSize = 50;     // 每页数量

// ── 初始化 ──────────────────────────────────────────────────────────
function loraPickerInit() {
    if (loraPickerInitialized) return;
    loraPickerInitialized = true;

    // 注入 HTML
    const shell = document.createElement('div');
    shell.id = 'loraPickerShell';
    shell.className = 'lora-picker-shell';
    shell.innerHTML = `
        <div class="lora-picker-window">
            <div class="lora-picker-header">
                <span class="lora-picker-title">⚡ LoRA 选择器</span>
                <input type="text" class="lora-picker-search" id="loraPickerSearch" placeholder="搜索 LoRA 名称、标签..." oninput="loraPickerOnSearch(this.value)">
                <button class="lora-picker-close" onclick="loraPickerClose()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
            <div class="lora-picker-body">
                <div class="lora-picker-sidebar" id="loraPickerSidebar"></div>
                <div class="lora-picker-content">
                    <div class="lora-picker-selected-bar" id="loraPickerSelectedBar"></div>
                    <div class="lora-picker-grid" id="loraPickerGrid"></div>
                </div>
            </div>
            <div class="lora-picker-footer">
                <span class="lora-picker-footer-info" id="loraPickerFooterInfo"></span>
                <div class="lora-picker-footer-btns">
                    <button class="lora-picker-btn lora-picker-btn-cancel" onclick="loraPickerClose()">取消</button>
                    <button class="lora-picker-btn lora-picker-btn-confirm" onclick="loraPickerConfirm()">确认选择</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(shell);

    // 点击遮罩关闭
    shell.addEventListener('click', (e) => {
        if (e.target === shell) loraPickerClose();
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shell.classList.contains('is-open')) {
            loraPickerClose();
        }
    });
}

// ── 打开选择器 ─────────────────────────────────────────────────────
async function loraPickerOpen(callback) {
    loraPickerInit();
    loraPickerCallback = callback;
    loraPickerSearch = '';
    loraPickerCategory = 'all';

    // 复制当前已选状态
    if (typeof loraState !== 'undefined') {
        loraPickerSelected = loraState.active.map(l => ({ ...l }));
        loraPickerAllItems = loraState.available.map(name => {
            const meta = loraState.loraMap[name] || {};
            // tags 可能是数组（来自 LoRA Manager），统一转为字符串
            let tags = meta.tags || '';
            if (Array.isArray(tags)) tags = tags.join(', ');
            return {
                name,
                displayName: meta.displayName || name.split('/').pop(),
                preview: meta.preview || '',
                videoUrl: meta.videoUrl || '',
                baseModel: meta.baseModel || '',
                tags: tags,
                folder: meta.folder || '通用'
            };
        });
    } else {
        loraPickerSelected = [];
        loraPickerAllItems = [];
    }

    document.getElementById('loraPickerSearch').value = '';
    document.getElementById('loraPickerShell').classList.add('is-open');
    document.body.style.overflow = 'hidden';

    loraPickerRenderSidebar();
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 关闭选择器 ─────────────────────────────────────────────────────
function loraPickerClose() {
    document.getElementById('loraPickerShell').classList.remove('is-open');
    document.body.style.overflow = '';
    loraPickerCallback = null;
}

// ── 确认选择 ──────────────────────────────────────────────────────
function loraPickerConfirm() {
    if (loraPickerCallback) {
        loraPickerCallback(loraPickerSelected);
    }
    loraPickerClose();
}

// ── 搜索 ─────────────────────────────────────────────────────────
function loraPickerOnSearch(val) {
    loraPickerSearch = val.trim().toLowerCase();
    loraPickerPage = 1;
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 获取分类列表 ──────────────────────────────────────────────────
function loraPickerGetCategories() {
    const cats = {};
    for (const item of loraPickerAllItems) {
        const cat = item.folder || '通用';
        cats[cat] = (cats[cat] || 0) + 1;
    }
    return cats;
}

// ── 获取过滤后的列表 ─────────────────────────────────────────────
function loraPickerGetFiltered() {
    let list = loraPickerAllItems;
    if (loraPickerCategory !== 'all') {
        list = list.filter(item => (item.folder || '通用') === loraPickerCategory);
    }
    if (loraPickerSearch) {
        list = list.filter(item =>
            (item.displayName || '').toLowerCase().includes(loraPickerSearch) ||
            (item.name || '').toLowerCase().includes(loraPickerSearch) ||
            (item.tags || '').toLowerCase().includes(loraPickerSearch) ||
            (item.baseModel || '').toLowerCase().includes(loraPickerSearch)
        );
    }
    return list;
}

// ── 渲染侧边栏 ──────────────────────────────────────────────────
function loraPickerRenderSidebar() {
    const el = document.getElementById('loraPickerSidebar');
    if (!el) return;
    const cats = loraPickerGetCategories();
    const totalCount = loraPickerAllItems.length;

    let html = '<div class="lora-cat-item ' + (loraPickerCategory === 'all' ? 'active' : '') + '" onclick="loraPickerSelectCategory(\'all\')">' +
        '<span>全部</span>' +
        '<span class="lora-cat-count">' + totalCount + '</span>' +
    '</div>';

    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
        const safeCat = cat.replace(/'/g, "\\'");
        html += '<div class="lora-cat-item ' + (loraPickerCategory === cat ? 'active' : '') + '" onclick="loraPickerSelectCategory(\'' + safeCat + '\')">' +
            '<span>' + cat + '</span>' +
            '<span class="lora-cat-count">' + count + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
}

// ── 选择分类 ─────────────────────────────────────────────────────
function loraPickerSelectCategory(cat) {
    loraPickerCategory = cat;
    loraPickerPage = 1;
    loraPickerRenderSidebar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 渲染已选条 ──────────────────────────────────────────────────
function loraPickerRenderSelectedBar() {
    const el = document.getElementById('loraPickerSelectedBar');
    if (!el) return;
    if (loraPickerSelected.length === 0) {
        el.innerHTML = '<span class="lora-picker-selected-empty">未选择任何 LoRA，点击卡片添加</span>';
        return;
    }
    let html = '<span class="lora-picker-selected-label">已选</span>';
    for (let i = 0; i < loraPickerSelected.length; i++) {
        const lora = loraPickerSelected[i];
        const displayName = lora.name.split(/[/\\]/).pop().replace('.safetensors', '');
        html += '<span class="lora-picker-selected-chip" onclick="loraPickerRemoveSelected(' + i + ')">' +
            displayName + ' ×' + lora.strength.toFixed(1) +
            '<span class="chip-x">×</span>' +
        '</span>';
    }
    el.innerHTML = html;
}

// ── 渲染卡片网格 ────────────────────────────────────────────────
function loraPickerRenderGrid() {
    const el = document.getElementById('loraPickerGrid');
    if (!el) return;
    const filtered = loraPickerGetFiltered();

    if (filtered.length === 0) {
        el.innerHTML = '<div class="lora-picker-empty" style="grid-column:1/-1;">' +
            '<div class="lora-picker-empty-icon">📭</div>' +
            '<div class="lora-picker-empty-text">' + (loraPickerSearch ? '没有匹配的 LoRA' : '暂无 LoRA 数据') + '</div>' +
        '</div>';
        return;
    }

    // 分页
    const totalPages = Math.ceil(filtered.length / loraPickerPageSize);
    if (loraPickerPage > totalPages) loraPickerPage = totalPages;
    if (loraPickerPage < 1) loraPickerPage = 1;
    const startIdx = (loraPickerPage - 1) * loraPickerPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + loraPickerPageSize);

    let html = '';
    for (let idx = 0; idx < pageItems.length; idx++) {
        const item = pageItems[idx];
        const selIdx = loraPickerSelected.findIndex(s => s.name === item.name);
        const isSelected = selIdx >= 0;
        const strength = isSelected ? loraPickerSelected[selIdx].strength : 0.8;
        const safeName = item.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        // 优先显示视频，其次图片，最后占位符
        let mediaHtml = '';
        if (item.videoUrl) {
            mediaHtml = '<video class="lora-card-img" src="' + item.videoUrl + '" autoplay loop muted playsinline onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>';
        } else if (item.preview) {
            mediaHtml = '<img class="lora-card-img" src="' + item.preview + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
        }
        const placeholderDisplay = (item.videoUrl || item.preview) ? 'none' : 'flex';

        html += '<div class="lora-card-item ' + (isSelected ? 'selected' : '') + '" onclick="loraPickerToggleItem(\'' + safeName + '\')" title="' + item.displayName + '\n' + (item.baseModel || '') + '\n' + (item.tags || '') + '">' +
            mediaHtml +
            '<div class="lora-card-img-placeholder" style="display:' + placeholderDisplay + '">' +
                '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
            '</div>' +
            '<div class="lora-card-check">✓</div>' +
            '<div class="lora-card-info">' +
                '<div class="lora-card-name">' + item.displayName + '</div>' +
                '<div class="lora-card-meta">' +
                    (item.baseModel ? '<span class="lora-card-base">' + item.baseModel + '</span>' : '') +
                    (item.tags ? '<span class="lora-card-tags">' + item.tags + '</span>' : '') +
                '</div>' +
            '</div>';

        if (isSelected) {
            html += '<div class="lora-card-strength" onclick="event.stopPropagation()">' +
                '<span class="lora-card-strength-label">强度</span>' +
                '<input type="range" min="0.05" max="1.5" step="0.05" value="' + strength + '" oninput="loraPickerUpdateStrength(' + selIdx + ', parseFloat(this.value));this.nextElementSibling.textContent=parseFloat(this.value).toFixed(2)">' +
                '<span class="lora-card-strength-val">' + strength.toFixed(2) + '</span>' +
            '</div>';
        }

        html += '</div>';
    }

    // 分页控件
    if (totalPages > 1) {
        html += '<div class="lora-picker-pagination" style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0;">' +
            '<button class="lora-picker-page-btn" onclick="loraPickerGoPage(' + (loraPickerPage - 1) + ')" ' + (loraPickerPage <= 1 ? 'disabled' : '') + ' style="padding:4px 10px;border-radius:6px;border:1px solid oklch(28% 0.02 280 / 0.5);background:oklch(20% 0.025 280);color:oklch(80% 0.01 280);cursor:pointer;font-size:11px;font-weight:700;">上一页</button>' +
            '<span style="font-size:11px;color:oklch(60% 0.01 280);font-weight:600;">' + loraPickerPage + ' / ' + totalPages + '</span>' +
            '<button class="lora-picker-page-btn" onclick="loraPickerGoPage(' + (loraPickerPage + 1) + ')" ' + (loraPickerPage >= totalPages ? 'disabled' : '') + ' style="padding:4px 10px;border-radius:6px;border:1px solid oklch(28% 0.02 280 / 0.5);background:oklch(20% 0.025 280);color:oklch(80% 0.01 280);cursor:pointer;font-size:11px;font-weight:700;">下一页</button>' +
        '</div>';
    }

    el.innerHTML = html;
}

function loraPickerGoPage(page) {
    loraPickerPage = page;
    loraPickerRenderGrid();
}

// ── 切换选中 ─────────────────────────────────────────────────────
function loraPickerToggleItem(name) {
    const idx = loraPickerSelected.findIndex(s => s.name === name);
    if (idx >= 0) {
        loraPickerSelected.splice(idx, 1);
    } else {
        loraPickerSelected.push({ name, strength: 0.8 });
    }
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 移除已选 ─────────────────────────────────────────────────────
function loraPickerRemoveSelected(index) {
    loraPickerSelected.splice(index, 1);
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 更新强度 ─────────────────────────────────────────────────────
function loraPickerUpdateStrength(index, value) {
    if (loraPickerSelected[index]) {
        loraPickerSelected[index].strength = value;
        loraPickerRenderSelectedBar();
    }
}

// ── 更新 Footer ──────────────────────────────────────────────────
function loraPickerUpdateFooter() {
    const el = document.getElementById('loraPickerFooterInfo');
    if (!el) return;
    const filtered = loraPickerGetFiltered();
    el.textContent = '显示 ' + filtered.length + ' / ' + loraPickerAllItems.length + ' 个 LoRA · 已选 ' + loraPickerSelected.length + ' 个';
}
