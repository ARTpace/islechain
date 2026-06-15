/**
 * Anima 提示词预设选择器组件
 * 参考画师选择器样式，支持三级分类
 *
 * v2 优化：49800+ 预设场景下的渲染性能
 *   - 扁平索引只在数据加载时构建一次
 *   - 搜索/过滤基于预构建的 lowercase 索引，避免重复遍历
 *   - 搜索输入防抖 200ms
 *   - 分类切换不再重建全量数组
 */

// --- 状态 ---
let presetPickerSelected = [];
let presetPickerShowSelected = false;
let presetPickerCallback = null;
let presetPickerSort = 'name';
let presetPickerCategory = 'all';
let presetPickerSubcategory = 'all';
let presetPickerData = { categories: [] };
let _presetI18nMap = null; // i18n 映射缓存

// 加载 i18n 映射
function _loadPresetI18n() {
    if (_presetI18nMap !== null) return Promise.resolve(_presetI18nMap);
    return fetch('/api/preset-i18n')
        .then(r => r.json())
        .then(data => { _presetI18nMap = data || {}; return _presetI18nMap; })
        .catch(() => { _presetI18nMap = {}; return _presetI18nMap; });
}

// 获取预设的中文名
function _getPresetCnName(preset) {
    if (!_presetI18nMap) return preset.name;
    return _presetI18nMap[preset.id] || preset.name;
}

// --- 虚拟滚动 ---
const VS_BATCH = 48;           // 每批渲染条数
let _vsRendered = 0;            // 已渲染数量
let _vsList = [];               // 当前过滤后的完整列表
let _vsObserver = null;         // IntersectionObserver

// --- 扁平索引（只构建一次）---
let _flatIndex = [];          // [{ id, name, prompt, nameLower, promptLower, category_id, category_name, _subcats: [{id, name}] }]
let _flatById = new Map();    // key = `${catId}:${presetId}` → flat item
let _categoryCounts = {};    // catId → total count
let _subcategoryCounts = {}; // `${catId}:${subId}` → count (deduped)

// --- 防抖 ---
let _searchTimer = null;

/**
 * 构建扁平索引 —— 只在数据加载后调用一次
 */
function _buildFlatIndex() {
    _flatIndex = [];
    _flatById.clear();
    _categoryCounts = { all: 0 };
    _subcategoryCounts = {};

    presetPickerData.categories.forEach(cat => {
        // 按 (catId, presetId) 去重，合并子分类
        const merged = new Map();
        cat.subcategories.forEach(sub => {
            sub.presets.forEach(p => {
                const key = cat.id + ':' + p.id;
                if (merged.has(key)) {
                    const existing = merged.get(key);
                    if (!existing._subcats.some(s => s.id === sub.id)) {
                        existing._subcats.push({ id: sub.id, name: sub.name });
                    }
                } else {
                    merged.set(key, {
                        ...p,
                        category_id: cat.id,
                        category_name: _presetI18nMap && _presetI18nMap[cat.id] ? _presetI18nMap[cat.id] : cat.name,
                        _subcats: [{ id: sub.id, name: _presetI18nMap && _presetI18nMap[sub.id] ? _presetI18nMap[sub.id] : sub.name }],
                        // 应用 i18n 映射到 name 字段
                        name: _presetI18nMap && _presetI18nMap[p.id] ? _presetI18nMap[p.id] : p.name,
                        nameLower: (_presetI18nMap && _presetI18nMap[p.id] ? _presetI18nMap[p.id] : p.name).toLowerCase(),
                        promptLower: p.prompt.toLowerCase(),
                    });
                }
            });
        });
        let catCount = 0;
        merged.forEach(item => {
            _flatIndex.push(item);
            _flatById.set(item.category_id + ':' + item.id, item);
            catCount++;
            item._subcats.forEach(s => {
                const skey = cat.id + ':' + s.id;
                _subcategoryCounts[skey] = (_subcategoryCounts[skey] || 0) + 1;
            });
        });
        _categoryCounts[cat.id] = catCount;
        _categoryCounts.all += catCount;
    });
}

// 加载预设数据
function presetPickerLoadData() {
    return Promise.all([
        fetch('/api/prompt-presets').then(r => r.json()),
        _loadPresetI18n()
    ]).then(([data, i18n]) => {
        presetPickerData = data;
        _buildFlatIndex();
        console.log('[PresetPicker] Loaded ' + _flatIndex.length + ' presets across ' + data.categories.length + ' categories');
    }).catch(e => console.error('[PresetPicker] Failed to load preset data', e));
}

/**
 * 获取过滤后的预设列表
 */
function _getFilteredPresets() {
    let list = _flatIndex;

    // 分类过滤
    if (presetPickerCategory !== 'all') {
        list = list.filter(p => p.category_id === presetPickerCategory);
    }
    if (presetPickerSubcategory !== 'all') {
        list = list.filter(p => p._subcats.some(s => s.id === presetPickerSubcategory));
    }

    // 搜索过滤
    const q = (document.getElementById('presetPickerSearch')?.value || '').trim().toLowerCase();
    if (q) {
        list = list.filter(p => p.nameLower.includes(q) || p.promptLower.includes(q));
    }

    // 只看已选
    if (presetPickerShowSelected) {
        const selectedIds = new Set(presetPickerSelected.map(s => s.category_id + ':' + s.id));
        list = list.filter(p => selectedIds.has(p.category_id + ':' + p.id));
    }

    // 排序
    if (presetPickerSort === 'name') {
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (presetPickerSort === 'category') {
        list = [...list].sort((a, b) => a.category_name.localeCompare(b.category_name) || a.name.localeCompare(b.name));
    }

    return list;
}

// 渲染分类
function presetPickerRenderCategories() {
    const el = document.getElementById('presetPickerCategories');
    if (!el) return;

    el.innerHTML = [
        { id: 'all', name: '全部', count: _categoryCounts.all || 0 },
        ...presetPickerData.categories.map(cat => ({
            id: cat.id,
            name: _presetI18nMap && _presetI18nMap[cat.id] ? _presetI18nMap[cat.id] : cat.name,
            count: _categoryCounts[cat.id] || 0,
        }))
    ].map(cat => {
        return '<div class="preset-picker-cat' + (presetPickerCategory === cat.id ? ' active' : '') + '" onclick="presetPickerSetCategory(\'' + cat.id + '\')">' +
            '<span>' + cat.name + '</span>' +
            '<span class="count">' + cat.count + '</span>' +
            '</div>';
    }).join('');
}

// 渲染子分类
function presetPickerRenderSubcategories() {
    const el = document.getElementById('presetPickerSubcategories');
    if (!el) return;

    if (presetPickerCategory === 'all') {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }

    const cat = presetPickerData.categories.find(c => c.id === presetPickerCategory);
    if (!cat) { el.innerHTML = ''; el.style.display = 'none'; return; }

    el.style.display = 'flex';
    const allCount = _categoryCounts[cat.id] || 0;

    el.innerHTML = [
        { id: 'all', name: '全部', count: allCount },
        ...cat.subcategories.map(sub => ({ id: sub.id, name: _presetI18nMap && _presetI18nMap[sub.id] ? _presetI18nMap[sub.id] : sub.name, count: _subcategoryCounts[cat.id + ':' + sub.id] || 0 }))
    ].map(sub => {
        return '<div class="preset-picker-subcat' + (presetPickerSubcategory === sub.id ? ' active' : '') + '" onclick="presetPickerSetSubcategory(\'' + sub.id + '\')">' +
            '<span>' + sub.name + '</span>' +
            '<span class="count">' + sub.count + '</span>' +
            '</div>';
    }).join('');
}

function presetPickerSetCategory(cat) {
    presetPickerCategory = cat;
    presetPickerSubcategory = 'all';
    presetPickerRenderCategories();
    presetPickerRenderSubcategories();
    _vsList = [];
    _vsRendered = 0;
    presetPickerRenderGrid();
}

function presetPickerSetSubcategory(sub) {
    presetPickerSubcategory = sub;
    presetPickerRenderSubcategories();
    _vsList = [];
    _vsRendered = 0;
    presetPickerRenderGrid();
}

// 渲染网格 — 虚拟滚动
function presetPickerRenderGrid() {
    const grid = document.getElementById('presetPickerGrid');
    if (!grid) return;

    // 断开旧 observer
    if (_vsObserver) _vsObserver.disconnect();

    // 获取完整过滤列表
    _vsList = _getFilteredPresets();
    _vsRendered = 0;

    // 更新总数
    const totalEl = document.getElementById('presetPickerTotalCount');
    if (totalEl) totalEl.textContent = '共 ' + _vsList.length + ' 个预设';

    // 清空网格，放入容器
    grid.innerHTML = '<div id="vsContainer"></div>';
    const container = document.getElementById('vsContainer');
    if (!container) return;

    // 渲染首批
    _vsAppendBatch(container);

    // 创建 sentinel
    const sentinel = document.createElement('div');
    sentinel.id = 'vsSentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);

    // 创建 IntersectionObserver
    _vsObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && _vsRendered < _vsList.length) {
            _vsAppendBatch(container);
        }
    }, { root: grid, rootMargin: '200px' });
    _vsObserver.observe(sentinel);
}

function _vsAppendBatch(container) {
    const start = _vsRendered;
    const end = Math.min(start + VS_BATCH, _vsList.length);
    const batch = _vsList.slice(start, end);

    let html = '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">';
    batch.forEach(p => {
        const sel = presetPickerSelected.some(s => s.id === p.id && s.category_id === p.category_id);
        const catTags = p._subcats.map(s => '<span class="preset-picker-card-tag">' + s.name + '</span>').join('');
        const cnName = _getPresetCnName(p);
        // 始终显示：中文名 + 英文 prompt
        const displayName = cnName 
            ? cnName + '<br><span style="font-size:9px;opacity:0.7;font-weight:400;">' + p.prompt + '</span>'
            : p.prompt;
        html += '<div class="preset-picker-card' + (sel ? ' selected' : '') + '" onclick="presetPickerToggle(\'' + p.id.replace(/'/g, "\\'") + '\', \'' + p.category_id.replace(/'/g, "\\'") + '\')">' +
            '<div class="preset-picker-card-top">' +
            '<div class="preset-picker-card-cats">' + catTags + '</div>' +
            '<div class="preset-picker-card-check">' + (sel ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div>' +
            '</div>' +
            '<div class="preset-picker-card-name" title="' + p.prompt.replace(/"/g, '&quot;') + '">' + displayName + '</div>' +
            '</div>';
    });
    html += '</div>';

    // 在 sentinel 前插入
    const sentinel = document.getElementById('vsSentinel');
    if (sentinel) {
        sentinel.insertAdjacentHTML('beforebegin', html);
    } else {
        container.insertAdjacentHTML('beforeend', html);
    }

    _vsRendered = end;

    // 更新统计（可选）
    const pageInfoEl = document.getElementById('presetPickerPageInfo');
    if (pageInfoEl) {
        pageInfoEl.textContent = '显示 ' + _vsRendered + ' / ' + _vsList.length + ' 项';
    }
}

// 操作函数
function presetPickerToggle(id, catId) {
    const key = catId + ':' + id;
    const i = presetPickerSelected.findIndex(s => (s.category_id + ':' + s.id) === key);
    if (i > -1) {
        presetPickerSelected.splice(i, 1);
    } else {
        const preset = _flatById.get(key);
        if (preset) presetPickerSelected.push(preset);
    }
    document.getElementById('presetPickerSelectedCount').textContent = presetPickerSelected.length;
    presetPickerRenderGrid();
}

function presetPickerGoPage(p) { }
function presetPickerPrevPage() { }
function presetPickerNextPage() { }
function presetPickerShowSelectedOnly() { presetPickerShowSelected = !presetPickerShowSelected; presetPickerRenderGrid(); }
function presetPickerCopySelected() { navigator.clipboard.writeText(presetPickerSelected.map(p => p.prompt).join(', ')).then(() => alert('已复制')); }
function presetPickerClearAll() { presetPickerSelected = []; document.getElementById('presetPickerSelectedCount').textContent = 0; presetPickerRenderGrid(); }

// 是否含中文字符
function hasChinese(s) {
    return /[\u4e00-\u9fa5]/.test(s);
}

// 已是中文预设名（避免在下次拆分时被错误识别为角色/普通词）
function isPresetNameToken(s) {
    return hasChinese(s);
}

function presetPickerApply() {
    if (presetPickerCallback) {
        presetPickerCallback(presetPickerSelected.slice());
    } else {
        // 更新 prompt 输入框
        const promptInput = document.getElementById('prompt');
        if (promptInput) {
            const current = promptInput.value.trim();
            const parts = current.split(',').map(p => p.trim()).filter(p => p);
            const charParts = parts.filter(p => !p.startsWith('@') && !p.startsWith('by ') && !isPresetNameToken(p) && !p.startsWith('['));
            const artistParts = parts.filter(p => p.startsWith('@') || p.startsWith('by '));
            // 收集已存在的预设 token（中文名或方括号包裹的），避免被覆盖
            const existingPresetTokens = parts.filter(p => 
                (isPresetNameToken(p) || p.startsWith('[')) && 
                !p.startsWith('@') && 
                !p.startsWith('by ')
            );
            // 新选的预设（始终使用英文prompt）
            const newPresetTokens = presetPickerSelected.map(p => {
                return (p.prompt || p.name || p.id || '').trim();
            }).filter(Boolean);
            // 合并：已存在 + 新选
            const presetTokenSet = new Set([...existingPresetTokens, ...newPresetTokens]);
            const presetParts = Array.from(presetTokenSet);
            const allParts = [...charParts, ...presetParts, ...artistParts];
            promptInput.value = allParts.filter(p => p).join(', ');
        }
    }
    presetPickerClose();
    if (typeof updatePromptTags === 'function') updatePromptTags();
}

function presetPickerClose() {
    const modal = document.getElementById('presetPickerModal');
    if (modal) modal.style.display = 'none';
}

function presetPickerOpen(callback) {
    presetPickerCallback = callback || null;
    presetPickerSelected = [];
    presetPickerShowSelected = false;
    presetPickerCategory = 'all';
    presetPickerSubcategory = 'all';

    const openFn = () => {
        // 读 #prompt 输入框，按已存在的 token 自动勾选对应预设（避免重复添加 & 视觉提示当前已选）
        try {
            const promptInput = document.getElementById('prompt');
            if (promptInput && _flatById) {
                const tokens = promptInput.value.split(',').map(s => s.trim()).filter(Boolean);
                const tokenSet = new Set(tokens);
                const tokenLowerSet = new Set(tokens.map(t => t.toLowerCase()));
                const matched = new Set();
                _flatById.forEach(p => {
                    if (tokenSet.has(p.name)) matched.add(p);
                    if (p.prompt) {
                        const pStr = p.prompt.trim();
                        if (tokenSet.has(pStr)) matched.add(p);
                        if (tokenLowerSet.has(pStr.toLowerCase())) matched.add(p);
                    }
                });
                presetPickerSelected = Array.from(matched);
            }
        } catch (e) {
            console.warn('[PresetPicker] auto-select existing failed', e);
        }
        presetPickerRenderCategories();
        presetPickerRenderSubcategories();
        presetPickerRenderGrid();
    };

    if (presetPickerData.categories.length === 0) {
        presetPickerLoadData().then(openFn);
    } else {
        openFn();
    }
    const modal = document.getElementById('presetPickerModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('presetPickerSearch').value = '';
    setTimeout(() => document.getElementById('presetPickerSearch')?.focus(), 100);
}

/**
 * 搜索防抖 handler
 */
function _presetPickerSearchInput() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
        _vsList = [];
        _vsRendered = 0;
        presetPickerRenderGrid();
    }, 200);
}

// 初始化
// === 预设模式切换 ===
let _presetMode = 'tag'; // 'tag' | 'style'

function _presetSwitchMode(mode) {
    _presetMode = mode;
    const tabs = document.querySelectorAll('#presetPickerModal .preset-mode-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    const tagPanel = document.getElementById('presetPickerTagPanel');
    const stylePanel = document.getElementById('presetPickerStylePanel');
    if (tagPanel) tagPanel.style.display = mode === 'tag' ? 'flex' : 'none';
    if (stylePanel) stylePanel.style.display = mode === 'style' ? 'flex' : 'none';
    // 切换到风格时初始化面板
    if (mode === 'style' && stylePanel && !stylePanel.dataset.inited && typeof stylePresetPanelInit === 'function') {
        stylePanel.dataset.inited = '1';
        stylePresetPanelInit(stylePanel, (preset, action) => {
            const promptInput = document.getElementById('prompt');
            if (!promptInput) return;
            if (action === 'replace') {
                promptInput.value = preset.filledPrompt || preset.prompt || '';
            } else {
                const current = promptInput.value.trim();
                promptInput.value = current ? current + ', ' + (preset.filledPrompt || preset.prompt || '') : (preset.filledPrompt || preset.prompt || '');
            }
            presetPickerClose();
            if (typeof updatePromptTags === 'function') updatePromptTags();
        });
    }
}

function presetPickerInit() {
    presetPickerLoadData();

    if (!document.getElementById('presetPickerModal')) {
        const modalHTML = `
        <div id="presetPickerModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 960px; height: 680px; background: linear-gradient(180deg, #0d1b2a 0%, #1b2838 100%); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.6); border: 1px solid rgba(0,180,216,0.15);">
                <!-- 顶部 Tab 切换 -->
                <div style="display: flex; padding: 12px 20px 0; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
                    <div class="preset-mode-tab active" data-mode="tag" onclick="_presetSwitchMode('tag')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🏷️ 标签预设</div>
                    <div class="preset-mode-tab" data-mode="style" onclick="_presetSwitchMode('style')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🎨 风格预设</div>
                </div>
                <!-- 顶部工具栏 -->
                <div id="presetPickerToolbar" style="display: flex; align-items: center; padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;">
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <span id="presetPickerTitle" style="font-size: 14px; font-weight: 700; color: #fff;">标签预设</span>
                        <span id="presetPickerTotalCount" style="font-size: 12px; color: #666;"></span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input id="presetPickerSearch" type="text" placeholder="搜索预设..." oninput="_presetPickerSearchInput()" style="width: 180px; height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 12px; font-size: 12px; color: #fff; outline: none;">
                        <select id="presetPickerSort" onchange="presetPickerRenderGrid()" style="height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 8px; font-size: 12px; color: #fff; outline: none;">
                            <option value="name">按名称</option>
                            <option value="category">按分类</option>
                        </select>
                        <button onclick="presetPickerShowSelectedOnly()" id="presetPickerShowSelBtn" style="height: 32px; padding: 0 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fff; cursor: pointer;">已选 (<span id="presetPickerSelectedCount">0</span>)</button>
                        <button onclick="presetPickerCopySelected()" id="presetPickerCopyBtn" style="height: 32px; padding: 0 12px; background: rgba(0,180,216,0.2); border: 1px solid rgba(0,180,216,0.3); border-radius: 8px; font-size: 12px; color: #00b4d8; cursor: pointer;">复制</button>
                        <button onclick="presetPickerClearAll()" id="presetPickerClearBtn" style="height: 32px; padding: 0 12px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; font-size: 12px; color: #ef4444; cursor: pointer;">清空</button>
                        <button onclick="presetPickerApply()" id="presetPickerApplyBtn" style="height: 32px; padding: 0 16px; background: #00b4d8; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer;">应用</button>
                        <button onclick="presetPickerClose()" style="height: 32px; width: 32px; padding: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 16px; color: #999; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
                    </div>
                </div>
                <!-- 主体：标签预设面板 -->
                <div id="presetPickerTagPanel" style="display: flex; flex: 1; overflow: hidden;">
                    <!-- 左侧分类 -->
                    <div id="presetPickerCategories" style="width: 140px; padding: 12px 8px; overflow-y: auto; border-right: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;"></div>
                    <!-- 右侧内容 -->
                    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                        <!-- 子分类标签栏 -->
                        <div id="presetPickerSubcategories" style="display: none; padding: 8px 16px; gap: 6px; overflow-x: auto; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; flex-wrap: wrap;"></div>
                        <!-- 网格 -->
                        <div id="presetPickerGrid" style="flex: 1; overflow-y: auto; padding: 16px;"></div>
                    </div>
                </div>
                <!-- 主体：风格预设面板 -->
                <div id="presetPickerStylePanel" style="display: none; flex: 1; overflow: hidden; flex-direction: column;"></div>
                <!-- 底部分页 -->
                <div id="presetPickerFooter" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
                    <span id="presetPickerPageInfo" style="font-size: 12px; color: #666;"></span>
                    <span style="font-size: 12px; color: #666;">↓ 滚动加载更多</span>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Tab 样式
        const style = document.createElement('style');
        style.textContent = ".preset-mode-tab.active { color: #00b4d8 !important; border-bottom-color: #00b4d8 !important; } .preset-mode-tab:hover { color: #fff !important; }";
        document.head.appendChild(style);
    }
}

// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', presetPickerInit);
} else {
    presetPickerInit();
}
