/**
 * Anima 画师选择器组件
 * 可在任何页面中调用 artistPickerOpen() 打开选择器
 */

// 状态
let artistPickerSelected = [];
// 上次写入提示词的画师 tokens 快照(用于「取消选择」时同步从提示词中删除)
let artistPickerLastAppliedTokens = new Set();
let artistPickerPage = 1;
const ARTIST_PICKER_PAGE_SIZE = 60;
const ARTIST_PICKER_HISTORY_MAX = 50;
let artistPickerShowSelected = false;


// 锁定顺序:打开选择器时计算一次(front-pin + 用户排序),运行期间点击不重排
// 关闭时清空
let artistPickerFrozenOrder = null;


// 按当前 sort 对全部画师排序,再把已选 pin 到前面
function artistPickerBuildFrozenOrder() {
    let list = ANIMA_ARTIST_DB.slice();
    const sort = document.getElementById('artistPickerSort')?.value || 'post_count';
    if (artistPickerCategory !== 'history' && sort === 'name') {
        list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (artistPickerCategory !== 'history') {
        list.sort((a, b) => b.post_count - a.post_count);
    }
    if (artistPickerSelected.length > 0) {
        const _selSet = new Set(artistPickerSelected);
        list = list.filter(a => _selSet.has(a.name)).concat(list.filter(a => !_selSet.has(a.name)));
    }
    return list;
}
let artistPickerCallback = null;
let artistPickerSort = 'post_count';
let artistPickerCategory = 'all';
let artistPickerFavorites = JSON.parse(localStorage.getItem('anima-artist-favorites') || '[]');
let artistPickerHistory = JSON.parse(localStorage.getItem('anima-artist-history') || '[]');

// 分类定义(按作品数量分级)
const ARTIST_CATEGORIES = [
    { id: 'all', label: '全部画师' },
    { id: 'legend', label: '传奇画师', min: 5000, desc: '5000+作品' },
    { id: 'famous', label: '知名画师', min: 1000, desc: '1000-5000作品' },
    { id: 'active', label: '活跃画师', min: 100, desc: '100-1000作品' },
    { id: 'rising', label: '新锐画师', min: 10, desc: '10-100作品' }
];

// 画师数据
let ANIMA_ARTIST_DB = [];

// 图片URL(使用mooshieblob CDN)
function artistPickerImgUrl(item) {
    return item.image_url || '';
}

// 加载画师数据
function artistPickerLoadData() {
    if (ANIMA_ARTIST_DB.length > 0) return Promise.resolve();
    return fetch('/static/app/artist_data.js')
        .then(r => r.text())
        .then(text => {
            const startIdx = text.indexOf('[');
            const endIdx = text.lastIndexOf(']');
            if (startIdx !== -1 && endIdx !== -1) {
                ANIMA_ARTIST_DB = JSON.parse(text.substring(startIdx, endIdx + 1));
                window.ANIMA_ARTIST_DB = ANIMA_ARTIST_DB; // 暴露给同页脚本
                console.log('[AnimaArtistPicker] Loaded ' + ANIMA_ARTIST_DB.length + ' artists');
            }
        })
        .catch(e => console.error('[AnimaArtistPicker] Failed to load artist data', e));
}

// 渲染分类
function artistPickerRenderCategories() {
    const el = document.getElementById('artistPickerCategories');
    if (!el) return;

    // 计算每个分类的数量
    const counts = {
        all: ANIMA_ARTIST_DB.length,
        legend: ANIMA_ARTIST_DB.filter(a => a.post_count >= 5000).length,
        famous: ANIMA_ARTIST_DB.filter(a => a.post_count >= 1000 && a.post_count < 5000).length,
        active: ANIMA_ARTIST_DB.filter(a => a.post_count >= 100 && a.post_count < 1000).length,
        rising: ANIMA_ARTIST_DB.filter(a => a.post_count >= 10 && a.post_count < 100).length
    };

    el.innerHTML =
        // 我的固定分组(收藏 / 历史)
        '<div class="artist-picker-cat' + (artistPickerCategory === 'favorites' ? ' active' : '') + '" onclick="artistPickerSetCategory(\'favorites\')">' +
            '<span>★ 我的收藏</span><span class="count">' + artistPickerFavorites.length + '</span></div>' +
        '<div class="artist-picker-cat' + (artistPickerCategory === 'history' ? ' active' : '') + '" onclick="artistPickerSetCategory(\'history\')">' +
            '<span>⏱ 最近使用</span><span class="count">' + artistPickerHistory.length + '</span></div>' +
        '<div style="height: 1px; background: rgba(255,255,255,0.08); margin: 8px 4px;"></div>' +
        ARTIST_CATEGORIES.map(cat => {
            const count = counts[cat.id] || 0;
            return '<div class="artist-picker-cat' + (artistPickerCategory === cat.id ? ' active' : '') + '" onclick="artistPickerSetCategory(\'' + cat.id + '\')">' +
                '<span>' + cat.label + '</span>' +
                '<span class="count">' + count + '</span>' +
                '</div>';
        }).join('');
}

function artistPickerSetCategory(cat) {
    artistPickerCategory = cat;
    artistPickerPage = 1;
    artistPickerRenderCategories();
    artistPickerRenderGrid();
}

// 渲染网格
function artistPickerRenderGrid() {
    // 用锁定顺序作为源(点击不会重排),未设置时回退到 ANIMA_ARTIST_DB
    let list = artistPickerFrozenOrder ? artistPickerFrozenOrder.slice() : [...ANIMA_ARTIST_DB];

    // 特殊分类:收藏 / 历史
    if (artistPickerCategory === 'favorites') {
        list = list.filter(a => artistPickerFavorites.includes(a.name));
    } else if (artistPickerCategory === 'history') {
        // 按历史顺序排序(最近在前)
        list = artistPickerHistory
            .map(name => ANIMA_ARTIST_DB.find(a => a.name === name))
            .filter(Boolean);
    } else if (artistPickerCategory !== 'all') {
        const ranges = {
            legend: [5000, Infinity],
            famous: [1000, 5000],
            active: [100, 1000],
            rising: [10, 100]
        };
        const [min, max] = ranges[artistPickerCategory] || [0, Infinity];
        list = list.filter(a => a.post_count >= min && a.post_count < max);
    }

    // 搜索过滤
    const q = (document.getElementById('artistPickerSearch')?.value || '').toLowerCase();
    if (q) {
        list = list.filter(a => a.name.toLowerCase().includes(q));
    }

    // 只看已选
    if (artistPickerShowSelected) {
        list = list.filter(a => artistPickerSelected.includes(a.name));
    }

    // 排序和已选置顶已由 artistPickerFrozenOrder 提供,filter 中不再重排
    // (避免点击后置顶失效)

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / ARTIST_PICKER_PAGE_SIZE));
    if (artistPickerPage > totalPages) artistPickerPage = totalPages;
    const start = (artistPickerPage - 1) * ARTIST_PICKER_PAGE_SIZE;
    const pageItems = list.slice(start, start + ARTIST_PICKER_PAGE_SIZE);

    // 更新统计
    const totalEl = document.getElementById('artistPickerTotalCount');
    const pageInfoEl = document.getElementById('artistPickerPageInfo');
    if (totalEl) totalEl.textContent = '共 ' + total + ' 个画师';
    if (pageInfoEl) pageInfoEl.textContent = '显示 ' + (start + 1) + '-' + Math.min(start + ARTIST_PICKER_PAGE_SIZE, total) + ',共 ' + total + ' 项';

    // 渲染卡片
    const grid = document.getElementById('artistPickerGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="artist-picker-grid">' +
        pageItems.map(a => {
            const sel = artistPickerSelected.includes(a.name);
            const isFav = artistPickerFavorites.includes(a.name);
            const imgUrl = artistPickerImgUrl(a);
            const danbooruUrl = 'https://safebooru.org/index.php?page=post&s=list&tags=' + encodeURIComponent(a.name.replace(/ /g, '_'));
            const safeName = a.name.replace(/"/g, '&quot;').replace(/'/g, "\\'");
            return '<div class="artist-picker-card' + (sel ? ' selected' : '') + '" onclick="artistPickerToggle(\'' + safeName + '\')">' +
                '<img src="' + imgUrl + '" alt="' + safeName + '" title="' + safeName + '" loading="lazy" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\'">' +
                '<div class="artist-picker-avatar" style="display: none;">' + a.name.charAt(0).toUpperCase() + '</div>' +
                '<div class="artist-picker-info">' +
                '<div class="artist-picker-name" title="' + a.name.replace(/"/g, '&quot;') + '">' + a.name + '</div>' +
                '<div class="artist-picker-count" title="' + a.post_count.toLocaleString() + ' 作品投稿">' + a.post_count.toLocaleString() + ' 作品</div>' +
                '</div>' +
                '<div class="artist-picker-link" title="在 Safebooru 查看该画师作品" onclick="event.stopPropagation(); window.open(\'' + danbooruUrl + '\', \'_blank\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></div>' +
                '<div class="artist-picker-fav" title="' + (isFav ? '取消收藏' : '收藏此画师') + '" onclick="artistPickerToggleFav(\'' + safeName + '\', event)"><svg width="16" height="16" viewBox="0 0 24 24" fill="' + (isFav ? '#00b4d8' : 'none') + '" stroke="' + (isFav ? '#00b4d8' : 'rgba(255,255,255,0.6)') + '" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></div>' +
                '<div class="artist-picker-check">' + (sel ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div>' +
                '</div>';
        }).join('') + '</div>';

    // 分页
    const prevBtn = document.getElementById('artistPickerPrevBtn');
    const nextBtn = document.getElementById('artistPickerNextBtn');
    if (prevBtn) prevBtn.disabled = artistPickerPage <= 1;
    if (nextBtn) nextBtn.disabled = artistPickerPage >= totalPages;

    const pagesEl = document.getElementById('artistPickerPages');
    if (pagesEl) {
        pagesEl.innerHTML = Array.from({length: Math.min(totalPages, 7)}, (_, i) => {
            let p;
            if (totalPages <= 7) p = i + 1;
            else if (artistPickerPage <= 4) p = i + 1;
            else if (artistPickerPage >= totalPages - 3) p = totalPages - 6 + i;
            else p = artistPickerPage - 3 + i;
            return '<button onclick="artistPickerGoPage(' + p + ')" style="padding: 6px 10px; border: 1px solid ' + (p === artistPickerPage ? '#00b4d8' : 'rgba(255,255,255,0.1)') + '; border-radius: 6px; font-size: 12px; cursor: pointer; background: ' + (p === artistPickerPage ? 'rgba(0,180,216,0.2)' : 'rgba(255,255,255,0.05)') + '; color: ' + (p === artistPickerPage ? '#00b4d8' : '#ccc') + '; margin: 0 2px;">' + p + '</button>';
        }).join('');
    }
}

// 操作函数
function artistPickerToggle(name) {
    const i = artistPickerSelected.indexOf(name);
    if (i > -1) artistPickerSelected.splice(i, 1);
    else artistPickerSelected.push(name);
    document.getElementById('artistPickerSelectedCount').textContent = artistPickerSelected.length;
    const _sumEl = document.getElementById('artistPickerSelectedSummary');
    if (_sumEl) _sumEl.textContent = '已选 ' + artistPickerSelected.length + ' 个画师';
    artistPickerRenderGrid();
}

function artistPickerToggleFav(name, e) {
    e.stopPropagation();
    const idx = artistPickerFavorites.indexOf(name);
    if (idx > -1) artistPickerFavorites.splice(idx, 1);
    else artistPickerFavorites.push(name);
    try { localStorage.setItem('anima-artist-favorites', JSON.stringify(artistPickerFavorites)); } catch (_) {}
    artistPickerRenderGrid();
    artistPickerRenderCategories();
}

function artistPickerGoPage(p) { artistPickerPage = p; artistPickerRenderGrid(); }
function artistPickerPrevPage() { if (artistPickerPage > 1) { artistPickerPage--; artistPickerRenderGrid(); } }
function artistPickerNextPage() { artistPickerPage++; artistPickerRenderGrid(); }
function artistPickerShowSelectedOnly() { artistPickerShowSelected = !artistPickerShowSelected; artistPickerRenderGrid(); }
function artistPickerCopySelected() { navigator.clipboard.writeText(artistPickerSelected.join(', ')).then(() => alert('已复制')); }
function artistPickerClearAll() { artistPickerSelected = []; document.getElementById('artistPickerSelectedCount').textContent = 0; const _sumElClear = document.getElementById('artistPickerSelectedSummary'); if (_sumElClear) _sumElClear.textContent = '已选 0 个画师'; artistPickerRenderGrid(); }

function artistPickerApply() {
    // 写历史(去重,最近的在前面,限制 ARTIST_PICKER_HISTORY_MAX 条)
    if (artistPickerSelected.length > 0) {
        artistPickerSelected.slice().reverse().forEach(name => {
            const idx = artistPickerHistory.indexOf(name);
            if (idx > -1) artistPickerHistory.splice(idx, 1);
            artistPickerHistory.unshift(name);
        });
        if (artistPickerHistory.length > ARTIST_PICKER_HISTORY_MAX) {
            artistPickerHistory = artistPickerHistory.slice(0, ARTIST_PICKER_HISTORY_MAX);
        }
        try { localStorage.setItem('anima-artist-history', JSON.stringify(artistPickerHistory)); } catch (_) {}
    }

    if (artistPickerCallback) {
        artistPickerCallback(artistPickerSelected.slice());
    } else {
        // 更新 prompt 输入框:保留角色标签,替换画师标签
        const promptInput = document.getElementById('prompt');
        if (promptInput) {
            const current = promptInput.value.trim();
            const parts = current.split(',').map(p => p.trim()).filter(p => p);
            // 1) 先把“上次应用写入的画师 token”全部移除（只移除已知画师，保留 LoRA 触发词）
            const lastSetLower = new Set([...artistPickerLastAppliedTokens].map(s => s.toLowerCase()));
            const knownNames = (typeof ANIMA_ARTIST_DB !== 'undefined' && ANIMA_ARTIST_DB) ?
                new Set(ANIMA_ARTIST_DB.map(a => a.name.toLowerCase())) : new Set();
            const partsAfterRemove = parts.filter(t => {
                if (!lastSetLower.has(t.toLowerCase())) return true;
                // 即使在 lastApplied 中，如果是 LoRA 触发词（不在画师库中）也要保留
                const n = t.replace(/^@/, '').replace(/^by /, '').toLowerCase();
                return !knownNames.has(n);
            });
            // 2) 保留：角色标签 + LoRA 触发词（@/by 开头但不在画师库中的）
            const charAndLoraParts = partsAfterRemove.filter(p => {
                if (!p.startsWith('@') && !p.startsWith('by ')) return true; // 普通标签
                const n = p.replace(/^@/, '').replace(/^by /, '').toLowerCase();
                return !knownNames.has(n); // 不是已知画师 → LoRA 触发词，保留
            });
            // 3) 合并：角色/LoRA 标签 + 新的画师标签
            const artistParts = artistPickerSelected.map(a => '@' + a);
            // 4) 记录本次写入的画师 token
            artistPickerLastAppliedTokens = new Set(artistParts.map(t => t.toLowerCase()));
            const allParts = [...charAndLoraParts, ...artistParts];
            promptInput.value = allParts.filter(p => p).join(', ');
        }
    }
    // 更新标签预览
    if (typeof updatePromptTags === 'function') updatePromptTags();
}

// === 批量选择功能 ===
function artistPickerSelectAll() {
    // 获取当前筛选结果中的所有画师
    const filtered = artistPickerGetFilteredList();
    filtered.forEach(name => {
        if (!artistPickerSelected.includes(name)) {
            artistPickerSelected.push(name);
        }
    });
    artistPickerUpdateUI();
}

function artistPickerInvertSelection() {
    // 获取当前筛选结果
    const filtered = artistPickerGetFilteredList();
    const newSelected = [];
    
    // 遍历筛选结果，选择未选中的
    filtered.forEach(name => {
        if (!artistPickerSelected.includes(name)) {
            newSelected.push(name);
        }
    });
    
    // 保留不在筛选结果中的已选项
    artistPickerSelected.forEach(name => {
        if (!filtered.includes(name)) {
            newSelected.push(name);
        }
    });
    
    artistPickerSelected = newSelected;
    artistPickerUpdateUI();
}

function artistPickerGetFilteredList() {
    // 获取当前筛选结果中的所有画师名称
    const list = [];
    const items = document.querySelectorAll('.artist-picker-card');
    items.forEach(item => {
        // 从 onclick 属性中提取名称
        const onclick = item.getAttribute('onclick');
        if (onclick) {
            const match = onclick.match(/artistPickerToggle\('(.+?)'\)/);
            if (match) {
                list.push(match[1]);
            }
        }
    });
    return list;
}

function artistPickerUpdateUI() {
    // 更新已选数量显示
    const countEl = document.getElementById('artistPickerSelectedCount');
    if (countEl) {
        countEl.textContent = artistPickerSelected.length;
    }
    
    // 更新已选摘要
    const summaryEl = document.getElementById('artistPickerSelectedSummary');
    if (summaryEl) {
        summaryEl.textContent = `已选 ${artistPickerSelected.length} 个画师`;
    }
    
    // 更新卡片选中状态
    document.querySelectorAll('.artist-picker-card').forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick) {
            const match = onclick.match(/artistPickerToggle\('(.+?)'\)/);
            if (match) {
                const name = match[1];
                const isSelected = artistPickerSelected.includes(name);
                item.classList.toggle('selected', isSelected);
            }
        }
    });
}

function artistPickerClose() {
    // 关闭即应用(与 LoRA 选择器一致:选择后关闭即直接使用)
    artistPickerApply();

    // 清空锁定顺序,下次打开时重新计算
    artistPickerFrozenOrder = null;
    const modal = document.getElementById('artistPickerModal');
    if (modal) modal.style.display = 'none';

    // 关闭后刷新主界面按钮高亮状态
    if (typeof window.updatePickerButtonsHighlight === 'function') {
        window.updatePickerButtonsHighlight();
    }
}

function artistPickerOpen(callback) {
    artistPickerCallback = callback || null;
    // 从提示词中读取已有的画师标签(只匹配预定义列表中的)
    const promptInput = document.getElementById('prompt');
    if (promptInput) {
        const parts = promptInput.value.split(',').map(p => p.trim()).filter(p => p);
        const knownNames = new Set(ANIMA_ARTIST_DB.map(a => a.name.toLowerCase()));
        // 画师标签:以@或by开头,且在预定义列表中存在的
        artistPickerSelected = parts
            .filter(p => (p.startsWith('@') || p.startsWith('by ')) && knownNames.has(p.replace(/^@/, '').replace(/^by /, '').toLowerCase()))
            .map(p => p.replace(/^@/, '').replace(/^by /, ''));
        // 只把「已知画师」的 @ token 登记为「上次应用写入的」快照
        // LoRA 触发词(@ 开头但不在 ANIMA_ARTIST_DB 中)不计入,避免关闭时被误删
        const currentArtistTokens = parts.filter(p => {
            if (!p.startsWith('@') && !p.startsWith('by ')) return false;
            const n = p.replace(/^@/, '').replace(/^by /, '').toLowerCase();
            return knownNames.has(n);
        });
        artistPickerLastAppliedTokens = new Set(currentArtistTokens.map(t => t.toLowerCase()));
    }
    document.getElementById('artistPickerSelectedCount').textContent = artistPickerSelected.length;
    const _sumElOpen = document.getElementById('artistPickerSelectedSummary');
    if (_sumElOpen) _sumElOpen.textContent = '已选 ' + artistPickerSelected.length + ' 个画师';
    artistPickerShowSelected = false;
    artistPickerCategory = 'all';
    artistPickerPage = 1;
    // 确保数据已加载
    if (ANIMA_ARTIST_DB.length === 0) {
        artistPickerLoadData().then(() => {
            // 数据加载完后才能计算锁定顺序
            artistPickerFrozenOrder = artistPickerBuildFrozenOrder();
            artistPickerRenderCategories();
            artistPickerRenderGrid();
        });
    } else {
        // 计算锁定顺序:用户排序 + 已选置顶
        // 之后运行期间点击只切换状态,不重排
        artistPickerFrozenOrder = artistPickerBuildFrozenOrder();
        artistPickerRenderCategories();
        artistPickerRenderGrid();
    }
    const modal = document.getElementById('artistPickerModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('artistPickerSearch').value = '';
    setTimeout(() => document.getElementById('artistPickerSearch')?.focus(), 100);
}

// 初始化
function artistPickerInit() {
    artistPickerLoadData();

    if (!document.getElementById('artistPickerModal')) {
        const modalHTML = `
        <div id="artistPickerModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 1240px; height: 720px; background: linear-gradient(180deg, #0d1b2a 0%, #1b2838 100%); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.6); border: 1px solid rgba(0,180,216,0.15);">
                <!-- 顶部工具栏 -->
                <div style="display: flex; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <div style="position: relative; flex: 1; max-width: 280px;">
                            <svg style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #666;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                            <input id="artistPickerSearch" type="text" placeholder="搜索画师..." style="width: 100%; padding: 10px 12px 10px 36px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; font-size: 13px; color: #fff; outline: none; box-sizing: border-box;">
                        </div>
                        <select id="artistPickerSort" style="padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fff; outline: none;">
                            <option value="post_count">按热度 (高→低)</option>
                            <option value="name">按名称 (A→Z)</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button onclick="artistPickerSelectAll()" style="padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">全选</button>
                        <button onclick="artistPickerInvertSelection()" style="padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">反选</button>
                        <button onclick="artistPickerClearAll()" style="padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">清空</button>
                        <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.1);"></div>
                        <button onclick="artistPickerCopySelected()" style="padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">复制已选</button>
                        <button onclick="artistPickerShowSelectedOnly()" style="padding: 8px 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">只看已选</button>
                        <button onclick="artistPickerClose()" style="padding: 6px 10px; background: none; border: none; cursor: pointer; font-size: 20px; color: #666;">&times;</button>
                    </div>
                </div>

                <!-- 主体内容 -->
                <div style="display: flex; flex: 1; overflow: hidden;">
                    <!-- 左侧分类 -->
                    <div style="width: 180px; border-right: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; background: rgba(0,0,0,0.2);">
                        <div style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                            <div style="font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 1px;">分类浏览</div>
                        </div>
                        <div id="artistPickerCategories" style="flex: 1; overflow-y: auto; padding: 8px;"></div>
                        <div style="padding: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
                            <div style="font-size: 10px; color: #666; margin-bottom: 4px;">已选择</div>
                            <div style="font-size: 18px; font-weight: 700; color: #00b4d8;" id="artistPickerSelectedCount">0</div>
                        </div>
                    </div>

                    <!-- 右侧网格 -->
                    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                        <div id="artistPickerGrid" style="flex: 1; overflow-y: auto; padding: 16px 20px;"></div>

                        <!-- 分页 -->
                        <div style="padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
                            <span id="artistPickerPageInfo" style="font-size: 12px; color: #666;"></span>
                            <div style="display: flex; gap: 4px; align-items: center;">
                                <button id="artistPickerPrevBtn" onclick="artistPickerPrevPage()" style="padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; font-size: 12px; cursor: pointer; color: #ccc;">上一页</button>
                                <div id="artistPickerPages"></div>
                                <button id="artistPickerNextBtn" onclick="artistPickerNextPage()" style="padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; font-size: 12px; cursor: pointer; color: #ccc;">下一页</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 底部操作栏 -->
                <div style="padding: 14px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(0,0,0,0.3); flex-shrink: 0;">
                    <div id="artistPickerSelectedSummary" style="font-size: 12px; color: #888;">已选 0 个画师</div>
                    <button onclick="artistPickerClose()" style="padding: 10px 24px; background: linear-gradient(135deg, #00b4d8, #0077b6); border: none; border-radius: 10px; font-size: 13px; font-weight: 600; color: #fff; cursor: pointer;">关闭并应用</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // 绑定事件
    document.getElementById('artistPickerSearch')?.addEventListener('input', () => { artistPickerPage = 1; artistPickerRenderGrid(); });
    document.getElementById('artistPickerSort')?.addEventListener('change', () => { artistPickerPage = 1; artistPickerFrozenOrder = artistPickerBuildFrozenOrder(); artistPickerRenderGrid(); });
}

// DOM Ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', artistPickerInit);
} else {
    artistPickerInit();
}