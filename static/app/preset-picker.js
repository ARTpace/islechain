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
// 上次写入提示词的预设 tokens 快照（用于识别「取消选择」时该删除哪些 token）
let presetPickerLastAppliedTokens = new Set();

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
const VS_BATCH = 48;
let _vsRendered = 0;
let _vsList = [];

// --- 扁平索引（只构建一次）---
let _flatIndex = [];          // [{ id, name, prompt, nameLower, promptLower, category_id, category_name, _subcats: [{id, name}] }]
let _flatById = new Map();    // key = `${catId}:${presetId}` → flat item

// 锁定顺序：打开选择器时计算一次（front-pin + 用户排序），运行期间点击不重排
// 关闭时清空
let presetPickerFrozenOrder = null;


// 按当前 sort 对全部预设排序，再把已选 pin 到前面
function presetPickerBuildFrozenOrder() {
    let list = _flatIndex.filter(p => p._type === _presetMode);
    if (presetPickerSort === 'name') {
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (presetPickerSort === 'category') {
        list = [...list].sort((a, b) => a.category_name.localeCompare(b.category_name) || a.name.localeCompare(b.name));
    }
    if (presetPickerSelected.length > 0) {
        const _selSet = new Set(presetPickerSelected.map(s => s.category_id + ':' + s.id));
        list = list.filter(p => _selSet.has(p.category_id + ':' + p.id)).concat(list.filter(p => !_selSet.has(p.category_id + ':' + p.id)));
    }
    return list;
}

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
                        _type: 'tag',
                        category_id: cat.id,
                        category_name: _presetI18nMap && _presetI18nMap[cat.id] ? _presetI18nMap[cat.id] : cat.name,
                        _subcats: [{ id: sub.id, name: _presetI18nMap && _presetI18nMap[sub.id] ? _presetI18nMap[sub.id] : sub.name }],
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

    // === 风格预设也加入扁平索引 ===
    const sCatI18n = _styleI18n.categories || {};
    const sSubI18n = _styleI18n.subcategories || {};
    const sPreI18n = _styleI18n.presets || {};
    (_stylePickerData.categories || []).forEach(cat => {
        const catName = sCatI18n[cat.id] || cat.name;
        cat.subcategories.forEach(sub => {
            const subName = sSubI18n[sub.id] || sub.name;
            sub.presets.forEach(p => {
                const key = 'style_' + cat.id + ':' + p.id;
                const pName = sPreI18n[p.id] || p.name;
                _flatIndex.push({
                    ...p,
                    _type: 'style',
                    category_id: 'style_' + cat.id,
                    category_name: catName,
                    name: pName,
                    _subcats: [{ id: sub.id, name: subName }],
                    nameLower: pName.toLowerCase(),
                    promptLower: (p.prompt || '').toLowerCase(),
                });
                _flatById.set(key, _flatIndex[_flatIndex.length - 1]);
            });
        });
    });
}

// 加载预设数据
let _stylePickerData = { categories: [] }; // 风格预设原始数据
let _styleI18n = { categories: {}, subcategories: {}, presets: {} }; // 风格中文映射

function presetPickerLoadData() {
    return Promise.all([
        fetch('/api/prompt-presets').then(r => r.json()),
        fetch('/api/style-presets').then(r => r.json()).catch(() => ({ categories: [] })),
        _loadPresetI18n(),
        fetch('/api/style-i18n').then(r => r.json()).catch(() => ({ categories: {}, subcategories: {}, presets: {} }))
    ]).then(([tagData, styleData, i18n, styleI18n]) => {
        presetPickerData = tagData;
        _stylePickerData = styleData;
        _styleI18n = styleI18n;
        _buildFlatIndex();
        window._flatIndex = _flatIndex; // 暴露给同页脚本
        console.log('[PresetPicker] Loaded ' + _flatIndex.length + ' presets');
    }).catch(e => console.error('[PresetPicker] Failed to load preset data', e));
}

/**
 * 获取过滤后的预设列表
 */
function _getFilteredPresets() {
    // 用锁定顺序作为源（点击不会重排），未设置时回退到 _flatIndex
    let list = presetPickerFrozenOrder
        ? presetPickerFrozenOrder.slice()
        : _flatIndex.filter(p => p._type === _presetMode);

    // 分类过滤
    if (presetPickerCategory !== 'all') {
        if (_presetMode === 'style') {
            list = list.filter(p => p.category_id === 'style_' + presetPickerCategory);
        } else {
            list = list.filter(p => p.category_id === presetPickerCategory);
        }
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

    // 排序和已选置顶已由 presetPickerFrozenOrder 提供，filter 中不再重排
    // （避免点击后置顶失效）

    return list;
}

// 渲染分类（标签/风格通用）
function presetPickerRenderCategories() {
    const el = document.getElementById('presetPickerCategories');
    if (!el) return;

    if (_presetMode === 'style') {
        // 风格分类
        const cats = _stylePickerData.categories || [];
        const sCatI18n = _styleI18n.categories || {};
        const styleCounts = {};
        let styleAll = 0;
        cats.forEach(cat => {
            let n = 0;
            cat.subcategories.forEach(sub => { n += sub.presets.length; });
            styleCounts[cat.id] = n;
            styleAll += n;
        });
        el.innerHTML = [
            { id: 'all', name: '全部', count: styleAll },
            ...cats.map(cat => ({ id: cat.id, name: sCatI18n[cat.id] || cat.name, count: styleCounts[cat.id] || 0 }))
        ].map(cat => {
            return '<div class="preset-picker-cat' + (presetPickerCategory === cat.id ? ' active' : '') + '" onclick="presetPickerSetCategory(\'' + cat.id + '\')">' +
                '<span>' + cat.name + '</span>' +
                '<span class="count">' + cat.count + '</span>' +
                '</div>';
        }).join('');
    } else {
        // 标签分类
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
}

// 渲染子分类（标签/风格通用）
function presetPickerRenderSubcategories() {
    const el = document.getElementById('presetPickerSubcategories');
    if (!el) return;

    if (presetPickerCategory === 'all') {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }

    let subcats = [];
    if (_presetMode === 'style') {
        const cat = (_stylePickerData.categories || []).find(c => c.id === presetPickerCategory);
        if (!cat) { el.innerHTML = ''; el.style.display = 'none'; return; }
        const sSubI18n = _styleI18n.subcategories || {};
        subcats = cat.subcategories.map(sub => ({ id: sub.id, name: sSubI18n[sub.id] || sub.name, count: sub.presets.length }));
    } else {
        const cat = presetPickerData.categories.find(c => c.id === presetPickerCategory);
        if (!cat) { el.innerHTML = ''; el.style.display = 'none'; return; }
        subcats = cat.subcategories.map(sub => ({
            id: sub.id,
            name: _presetI18nMap && _presetI18nMap[sub.id] ? _presetI18nMap[sub.id] : sub.name,
            count: _subcategoryCounts[cat.id + ':' + sub.id] || 0,
        }));
    }

    el.style.display = 'flex';
    const totalCount = subcats.reduce((s, c) => s + c.count, 0);

    el.innerHTML = [
        { id: 'all', name: '全部', count: totalCount },
        ...subcats
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
    const gridId = _presetMode === 'style' ? 'presetPickerStyleGrid' : 'presetPickerGrid';
    const grid = document.getElementById(gridId);
    if (!grid) return;

    _vsList = _getFilteredPresets();
    _vsRendered = 0;

    const totalEl = document.getElementById('presetPickerTotalCount');
    if (totalEl) totalEl.textContent = '共 ' + _vsList.length + ' 个预设';

    // 直接清空网格
    grid.innerHTML = '';

    if (_vsList.length === 0) return;

    // 渲染首批
    _vsAppendBatch(grid);

    // 滚动加载后续
    grid.onscroll = () => {
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 100 && _vsRendered < _vsList.length) {
            _vsAppendBatch(grid);
        }
    };
}

function _vsAppendBatch(grid) {
    const start = _vsRendered;
    const end = Math.min(start + VS_BATCH, _vsList.length);
    const batch = _vsList.slice(start, end);
    if (batch.length === 0) return;

    const isStyle = _presetMode === 'style';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px;';
    batch.forEach(p => {
        const sel = presetPickerSelected.some(s => s.id === p.id && s.category_id === p.category_id);
        const catTags = p._subcats.map(s => '<span class="preset-picker-card-tag">' + s.name + '</span>').join('');
        const cnName = _getPresetCnName(p);
        const displayName = cnName 
            ? cnName + '<br><span style="font-size:9px;opacity:0.7;font-weight:400;">' + p.prompt + '</span>'
            : p.prompt;
        const card = document.createElement('div');
        card.className = 'preset-picker-card' + (sel ? ' selected' : '');
        // 使用 addEventListener 替代内联 onclick，避免 ID 含特殊字符时 JS 解析失败
        card.addEventListener('click', () => presetPickerToggle(p.id, p.category_id));

        let inner = '<div class="preset-picker-card-top"><div class="preset-picker-card-cats">' + catTags + '</div><div class="preset-picker-card-check">' + (sel ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div></div>';

        // 风格卡片：显示缩略图
        if (isStyle && p.thumbnail) {
            inner += '<div style="width:100%;aspect-ratio:1;border-radius:6px;overflow:hidden;margin-bottom:6px;background:rgba(255,255,255,0.05);"><img src="' + p.thumbnail + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.parentElement.style.display=\'none\'" /></div>';
        }

        inner += '<div class="preset-picker-card-name" title="' + p.prompt.replace(/"/g, '&quot;') + '">' + displayName + '</div>';
        card.innerHTML = inner;
        wrapper.appendChild(card);
    });
    grid.appendChild(wrapper);
    _vsRendered = end;

    const pageInfoEl = document.getElementById('presetPickerPageInfo');
    if (pageInfoEl) pageInfoEl.textContent = '显示 ' + _vsRendered + ' / ' + _vsList.length + ' 项';
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
    const promptInput = document.getElementById('prompt');
    if (!promptInput) return;

    if (_presetMode === 'style') {
        // 风格模式：用选中的风格预设提示词替换
        const currentPrompt = promptInput.value.trim();
        // {subject} = 用户输入的主题
        let subject = currentPrompt.replace(/\{subject\}/gi, '').trim();
        if (!subject) subject = 'subject';
        // {prompt} = 用户已有的提示词
        let existingPrompt = currentPrompt;

        const stylePrompts = presetPickerSelected.map(p => {
            let text = (p.prompt || '').trim();
            // 如果 prompt 是 JSON，把所有字段转成逗号分隔的提示词
            if (text.startsWith('{') && !text.startsWith('{subject}') && !text.startsWith('{prompt}')) {
                try {
                    const obj = JSON.parse(text);
                    if (typeof obj === 'object' && obj !== null) {
                        const parts = [];
                        for (const [k, v] of Object.entries(obj)) {
                            if (typeof v === 'string' && v.trim()) parts.push(v.trim());
                            else if (typeof v === 'object' && v !== null) {
                                for (const [k2, v2] of Object.entries(v)) {
                                    if (typeof v2 === 'string' && v2.trim()) parts.push(v2.trim());
                                }
                            }
                        }
                        if (parts.length > 0) text = parts.join(', ');
                    }
                } catch(e) {}
            }
            // 替换占位符
            text = text.replace(/\{subject\}/gi, subject);
            text = text.replace(/\{prompt\}/gi, existingPrompt);
            return text;
        }).filter(Boolean);
        if (stylePrompts.length > 0) {
            promptInput.value = stylePrompts.join(', ');
        }
    } else {
        // 标签模式：合并到现有提示词
        const current = promptInput.value.trim();
        const parts = current.split(',').map(p => p.trim()).filter(p => p);
        // 1) 先把"上次应用写入的 token"全部移除（实现取消选择时同步删除）
        const lastSet = presetPickerLastAppliedTokens || new Set();
        const lastSetLower = new Set([...lastSet].map(s => s.toLowerCase()));
        const partsAfterRemove = parts.filter(t => !lastSetLower.has(t.toLowerCase()));
        // 2) 重新分类：非预设 token（角色/普通词 + 画师）保持不动
        const charParts = partsAfterRemove.filter(p => !p.startsWith('@') && !p.startsWith('by ') && !isPresetNameToken(p) && !p.startsWith('['));
        const artistParts = partsAfterRemove.filter(p => p.startsWith('@') || p.startsWith('by '));
        // 3) 收集当前选中的预设 token（用 prompt 优先；name 作为 fallback）
        const newPresetTokens = presetPickerSelected.map(p => {
            return (p.prompt || p.name || p.id || '').trim();
        }).filter(Boolean);
        // 4) 组装最终结果，并按当前选择顺序排列（去重）
        const seen = new Set();
        const orderedPresetParts = [];
        newPresetTokens.forEach(t => {
            const tl = t.toLowerCase();
            if (!seen.has(tl)) { seen.add(tl); orderedPresetParts.push(t); }
        });
        // 5) 写回：把"当前选中的预设 token"快照记到 presetPickerLastAppliedTokens
        //    下次应用时这些就是应该被识别为「预设写入」的 token
        presetPickerLastAppliedTokens = new Set(orderedPresetParts.map(t => t.toLowerCase()));
        const allParts = [...charParts, ...orderedPresetParts, ...artistParts];
        promptInput.value = allParts.filter(p => p).join(', ');
    }

    if (typeof updatePromptTags === 'function') updatePromptTags();
}

// 用户改了排序下拉框：重新计算锁定顺序
function presetPickerSortChanged() {
    presetPickerSort = document.getElementById('presetPickerSort')?.value || 'name';
    presetPickerFrozenOrder = presetPickerBuildFrozenOrder();
    presetPickerRenderGrid();
}

function presetPickerClose() {
    // 关闭即应用（与 LoRA 选择器一致：选择后关闭即直接使用）
    presetPickerApply();

    // 清空锁定顺序，下次打开时重新计算
    presetPickerFrozenOrder = null;
    const modal = document.getElementById('presetPickerModal');
    if (modal) modal.style.display = 'none';

    // 关闭后刷新主界面按钮高亮状态
    if (typeof window.updatePickerButtonsHighlight === 'function') {
        window.updatePickerButtonsHighlight();
    }
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
                const matchedTokenStrings = new Set(); // 记录匹配到的预设所贡献的 token（用于初始化「上次应用」快照）
                _flatById.forEach(p => {
                    if (tokenSet.has(p.name)) {
                        matched.add(p);
                        matchedTokenStrings.add(p.name.toLowerCase());
                    }
                    if (p.prompt) {
                        const pStr = p.prompt.trim();
                        if (tokenSet.has(pStr) || tokenLowerSet.has(pStr.toLowerCase())) {
                            matched.add(p);
                            matchedTokenStrings.add(pStr.toLowerCase());
                        } else {
                            // 预设 prompt 含逗号时被拆成多个 token，检查是否全部存在于当前输入中
                            const pTokens = pStr.split(',').map(s => s.trim()).filter(Boolean);
                            if (pTokens.length > 1 && pTokens.every(t => tokenLowerSet.has(t.toLowerCase()))) {
                                matched.add(p);
                                pTokens.forEach(t => matchedTokenStrings.add(t.toLowerCase()));
                            }
                        }
                    }
                });
                presetPickerSelected = Array.from(matched);
                // 把当前 prompt 中「属于预设」的 token 全部登记为「上次应用写入的」
                // 这样首次进入即取消勾选某个预设，关闭时该预设的 token 也会同步从提示词中删除
                presetPickerLastAppliedTokens = matchedTokenStrings;
            } else {
                presetPickerSelected = [];
                presetPickerLastAppliedTokens = new Set();
            }
        } catch (e) {
            console.warn('[PresetPicker] auto-select existing failed', e);
            presetPickerLastAppliedTokens = new Set();
        }
        // 计算锁定顺序：用户排序 + 已选置顶
        // 之后运行期间点击只切换状态，不重排
        presetPickerFrozenOrder = presetPickerBuildFrozenOrder();
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

    // 切换两个网格的显隐
    const tagGrid = document.getElementById('presetPickerGrid');
    const styleGrid = document.getElementById('presetPickerStyleGrid');
    if (tagGrid) tagGrid.style.display = mode === 'tag' ? '' : 'none';
    if (styleGrid) styleGrid.style.display = mode === 'style' ? '' : 'none';

    // --- 标题 ---
    const titleEl = document.getElementById('presetPickerTitle');
    if (titleEl) titleEl.textContent = mode === 'tag' ? '标签' : '风格';

    // --- 切换模式时重置分类选择 ---
    presetPickerCategory = 'all';
    presetPickerSubcategory = 'all';

    // --- 侧边栏/子分类始终显示，内容由渲染函数按模式切换 ---
    presetPickerRenderCategories();
    presetPickerRenderSubcategories();

    // --- 搜索框 ---
    const searchEl = document.getElementById('presetPickerSearch');
    if (searchEl) {
        searchEl.placeholder = mode === 'tag' ? '搜索标签...' : '搜索风格...';
        searchEl.oninput = () => _presetPickerSearchInput();
        searchEl.value = '';
    }

    // --- 重新渲染网格 ---
    // 切换模式时必须重建冻结顺序，否则旧的 frozenOrder 只含上一模式的预设
    presetPickerFrozenOrder = presetPickerBuildFrozenOrder();
    _vsList = [];
    _vsRendered = 0;
    presetPickerRenderGrid();
}

function presetPickerInit() {
    presetPickerLoadData();

    if (!document.getElementById('presetPickerModal')) {
        const modalHTML = `
        <div id="presetPickerModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 960px; height: 680px; background: linear-gradient(180deg, #0d1b2a 0%, #1b2838 100%); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.6); border: 1px solid rgba(0,180,216,0.15);">
                <!-- 顶部 Tab 切换 -->
                <div style="display: flex; padding: 12px 20px 0; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
                    <div class="preset-mode-tab active" data-mode="tag" onclick="_presetSwitchMode('tag')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🏷️ 标签</div>
                    <div class="preset-mode-tab" data-mode="style" onclick="_presetSwitchMode('style')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🎨 风格</div>
                </div>
                <!-- 顶部工具栏 -->
                <div id="presetPickerToolbar" style="display: flex; align-items: center; padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;">
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <span id="presetPickerTitle" style="font-size: 14px; font-weight: 700; color: #fff;">标签</span>
                        <span id="presetPickerTotalCount" style="font-size: 12px; color: #666;"></span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input id="presetPickerSearch" type="text" placeholder="搜索预设..." oninput="_presetPickerSearchInput()" style="width: 180px; height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 12px; font-size: 12px; color: #fff; outline: none;">
                        <select id="presetPickerSort" onchange="presetPickerSortChanged()" style="height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 8px; font-size: 12px; color: #fff; outline: none;">
                            <option value="name">按名称</option>
                            <option value="category">按分类</option>
                        </select>
                        <button onclick="presetPickerShowSelectedOnly()" id="presetPickerShowSelBtn" style="height: 32px; padding: 0 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fff; cursor: pointer;">已选 (<span id="presetPickerSelectedCount">0</span>)</button>
                        <button onclick="presetPickerCopySelected()" id="presetPickerCopyBtn" style="height: 32px; padding: 0 12px; background: rgba(0,180,216,0.2); border: 1px solid rgba(0,180,216,0.3); border-radius: 8px; font-size: 12px; color: #00b4d8; cursor: pointer;">复制</button>
                        <button onclick="presetPickerClearAll()" id="presetPickerClearBtn" style="height: 32px; padding: 0 12px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; font-size: 12px; color: #ef4444; cursor: pointer;">清空</button>
                        <button onclick="presetPickerClose()" style="height: 32px; width: 32px; padding: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 16px; color: #999; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="关闭并应用">&times;</button>
                    </div>
                </div>
                <!-- 主体 -->
                <div style="display: flex; flex: 1; overflow: hidden;">
                    <!-- 左侧分类（共享） -->
                    <div id="presetPickerCategories" style="width: 200px; padding: 12px 10px; overflow-y: auto; border-right: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;"></div>
                    <!-- 右侧内容 -->
                    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                        <!-- 子分类标签栏（共享） -->
                        <div id="presetPickerSubcategories" style="display: none; padding: 8px 16px; gap: 6px; overflow-x: auto; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; flex-wrap: wrap;"></div>
                        <!-- 标签网格 -->
                        <div id="presetPickerGrid" style="flex: 1; overflow-y: auto; padding: 16px;"></div>
                        <!-- 风格网格 -->
                        <div id="presetPickerStyleGrid" style="display: none; flex: 1; overflow-y: auto; padding: 16px;"></div>
                    </div>
                </div>
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

        // 点击遮罩关闭（与 LoRA 选择器一致）
        const modal = document.getElementById('presetPickerModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) presetPickerClose();
            });
        }
        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
                presetPickerClose();
            }
        });
    }
}

// 页面加载后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', presetPickerInit);
} else {
    presetPickerInit();
}
