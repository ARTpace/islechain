/**
 * style-preset-panel.js - 风格预设面板（完整提示词）
 * 
 * 与现有 preset-picker.js（标签预设）并行工作
 * 功能：
 *   - 加载 style-presets.json 中的完整提示词预设
 *   - 点击弹出选择菜单：替换全部 / 追加到末尾
 *   - {subject} 占位符自动替换
 *   - 搜索过滤、分类折叠
 */

// === 状态 ===
let stylePresetsData = { categories: [] };
let stylePresetsExpanded = new Set();
let stylePresetsSearchQuery = '';
let stylePresetsCallback = null;

// === 配置 ===
const STYLE_PRESETS_API = '/api/style-presets';

/**
 * 初始化风格预设面板
 * @param {HTMLElement} container - 挂载容器
 * @param {function} onApply - 回调 (preset, action: 'replace'|'append') => void
 */
function stylePresetPanelInit(container, onApply) {
    stylePresetsCallback = onApply;
    // 风格面板只保留内容区域，标题和搜索由顶部工具栏统一提供
    container.innerHTML = `
        <div class="style-preset-panel">
            <div class="style-preset-body" id="stylePresetBody"></div>
        </div>
    `;

    // 搜索由顶部工具栏统一处理，无需绑定本地搜索框

    // 事件委托
    const body = document.getElementById('stylePresetBody');
    if (body) {
        body.addEventListener('click', (e) => {
            const catHeader = e.target.closest('.style-preset-cat-header');
            if (catHeader) {
                const catId = catHeader.dataset.catId;
                if (stylePresetsExpanded.has(catId)) {
                    stylePresetsExpanded.delete(catId);
                } else {
                    stylePresetsExpanded.add(catId);
                }
                _stylePresetRenderBody();
                return;
            }

            const presetItem = e.target.closest('.style-preset-item');
            if (presetItem) {
                const preset = JSON.parse(presetItem.dataset.preset || '{}');
                _stylePresetShowMenu(presetItem, preset);
                return;
            }

            const actionBtn = e.target.closest('.style-preset-action-btn');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const item = actionBtn.closest('.style-preset-item');
                const preset = JSON.parse(item?.dataset.preset || '{}');
                _stylePresetHandleAction(preset, action);
                return;
            }
        });
    }

    // 加载数据
    stylePresetPanelLoad();
}

async function stylePresetPanelLoad() {
    try {
        const res = await fetch(STYLE_PRESETS_API);
        stylePresetsData = await res.json();
        // 默认展开所有分类
        (stylePresetsData.categories || []).forEach(c => stylePresetsExpanded.add(c.id));
        _stylePresetRenderBody();
    } catch (e) {
        console.error('[StylePresets] load error:', e);
    }
}

function _stylePresetRenderBody() {
    const body = document.getElementById('stylePresetBody');
    if (!body) return;

    if (!body._presetThumbnails) body._presetThumbnails = createPresetThumbnailLoader(body);
    body._presetThumbnails.reset();

    const cats = stylePresetsData.categories || [];
    const filtered = _stylePresetFilter(cats);

    // 更新总数（显示在工具栏）
    const total = filtered.reduce((sum, c) =>
        sum + c.subcategories.reduce((s, sub) => s + sub.presets.length, 0), 0
    );
    const toolbarCount = document.getElementById('presetPickerTotalCount');
    if (toolbarCount) toolbarCount.textContent = total + ' 个预设';

    if (filtered.length === 0) {
        body.innerHTML = '<div class="style-preset-empty">暂无风格</div>';
        return;
    }

    body.innerHTML = filtered.map(cat => {
        const expanded = stylePresetsExpanded.has(cat.id);
        const totalPresets = cat.subcategories.reduce((s, sub) => s + sub.presets.length, 0);

        let subHtml = '';
        if (expanded) {
            subHtml = cat.subcategories.map(sub => `
                <div class="style-preset-sub">
                    <div class="style-preset-sub-name">${sub.name}</div>
                    <div class="style-preset-items">
                        ${sub.presets.map(p => _stylePresetRenderItem(p)).join('')}
                    </div>
                </div>
            `).join('');
        }

        return `
            <div class="style-preset-cat" data-cat-id="${cat.id}">
                <div class="style-preset-cat-header" data-cat-id="${cat.id}">
                    <span class="style-preset-arrow">${expanded ? '▼' : '▶'}</span>
                    <span class="style-preset-cat-name">${cat.name}</span>
                    <span class="style-preset-cat-count">${totalPresets}</span>
                </div>
                ${subHtml}
            </div>
        `;
    }).join('');
    body._presetThumbnails.watch();
}

function _stylePresetFilter(cats) {
    if (!stylePresetsSearchQuery) return cats;
    return cats.map(cat => {
        const filteredSubs = cat.subcategories.map(sub => {
            const filteredPresets = sub.presets.filter(p => {
                const name = (p.name || '').toLowerCase();
                const prompt = (p.prompt || '').toLowerCase();
                const desc = (p.description || '').toLowerCase();
                return name.includes(stylePresetsSearchQuery) ||
                       prompt.includes(stylePresetsSearchQuery) ||
                       desc.includes(stylePresetsSearchQuery);
            });
            return filteredPresets.length > 0 ? { ...sub, presets: filteredPresets } : null;
        }).filter(Boolean);
        return filteredSubs.length > 0 ? { ...cat, subcategories: filteredSubs } : null;
    }).filter(Boolean);
}

function _stylePresetRenderItem(preset) {
    const thumbHtml = preset.thumbnail 
        ? `<div class="style-preset-item-thumb"><img data-preset-src="${String(preset.thumbnail).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" alt="${preset.name || ''}" onerror="this.parentElement.style.display='none'" /></div>`
        : '';
    return `
        <div class="style-preset-item" data-preset='${JSON.stringify(preset).replace(/'/g, "&#39;")}'>
            ${thumbHtml}
            <div class="style-preset-item-content">
                <div class="style-preset-item-main">
                    <span class="style-preset-item-name">${preset.name || preset.id}</span>
                    <span class="style-preset-item-badge">完整提示词</span>
                </div>
                ${preset.description ? `<div class="style-preset-item-desc">${preset.description}</div>` : ''}
                <div class="style-preset-item-prompt">${_stylePresetTruncate(preset.prompt, 80)}</div>
            </div>
        </div>
    `;
}

function _stylePresetTruncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

function _stylePresetShowMenu(el, preset) {
    // 移除旧菜单
    document.querySelectorAll('.style-preset-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'style-preset-menu';
    menu.innerHTML = `
        <button class="style-preset-action-btn" data-action="replace">📝 替换全部</button>
        <button class="style-preset-action-btn" data-action="append">➕ 追加到末尾</button>
    `;
    el.appendChild(menu);

    // 3秒自动消失
    setTimeout(() => menu.remove(), 3000);

    // 点击外部关闭
    const close = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', close);
        }
    };
    setTimeout(() => document.addEventListener('click', close), 100);
}

function _stylePresetHandleAction(preset, action) {
    document.querySelectorAll('.style-preset-menu').forEach(m => m.remove());

    let prompt = (preset.prompt || '').replace(/\{subject\}/gi, 'subject');
    let negative = preset.negative_prompt || '';

    if (stylePresetsCallback) {
        stylePresetsCallback({
            ...preset,
            filledPrompt: prompt,
            filledNegative: negative,
        }, action);
    }
}

/**
 * 设置 subject 占位符值（从外部调用）
 */
function stylePresetPanelSetSubject(subject) {
    // 重新渲染以更新预览
    _stylePresetRenderBody();
}

/**
 * 刷新数据（从外部调用）
 */
function stylePresetPanelRefresh() {
    stylePresetPanelLoad();
}

// 导出到全局
window.stylePresetPanelInit = stylePresetPanelInit;
window.stylePresetPanelSetSubject = stylePresetPanelSetSubject;
window.stylePresetPanelRefresh = stylePresetPanelRefresh;

/**
 * 外部搜索接口：由顶部工具栏调用
 */
function stylePresetPanelSetSearch(query) {
    stylePresetsSearchQuery = (query || '').toLowerCase();
    _stylePresetRenderBody();
}
window.stylePresetPanelSetSearch = stylePresetPanelSetSearch;
