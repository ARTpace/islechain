/**
 * Anima 角色选择器组件
 * 可在任何页面中调用 pickerOpen() 打开选择器
 * 选择完成后会触发 callback 或直接操作 prompt 输入框
 */

// 状态
let pickerSelected = [];
let pickerCategory = 'all';
let pickerPage = 1;
const PICKER_PAGE_SIZE = 60;
const PICKER_MAX_SELECTED = 20;
const PICKER_HISTORY_MAX = 50;
let pickerShowSelected = false;
let pickerFoldState = { gender: false, hair: false, eye: false, copy: false, history: false };
let pickerFavorites = JSON.parse(localStorage.getItem('anima-char-favorites') || '[]');
let pickerHistory = JSON.parse(localStorage.getItem('anima-char-history') || '[]');
let pickerCallback = null;

// 角色数据（延迟加载）
let ANIMA_CHAR_DB = [];

// 图片URL（主源 animadex，失败时由 onerror 切到本地 SVG 占位）
function pickerImgUrl(name, copyright) {
    const raw = copyright ? name + ', ' + copyright : name;
    return 'https://blobs.animadex.net/Outputs/thumbs/' + encodeURIComponent(raw) + '.webp';
}

// 本地占位 SVG（图片 404 时显示，避免空白卡片）
const PICKER_PLACEHOLDER_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">' +
    '<rect width="180" height="180" fill="#1f2235"/>' +
    '<g fill="none" stroke="#3b3f5a" stroke-width="1.5">' +
    '<circle cx="90" cy="75" r="22"/>' +
    '<path d="M55 130 Q90 100 125 130"/>' +
    '</g>' +
    '<text x="90" y="160" fill="#525a78" font-family="sans-serif" font-size="11" text-anchor="middle">无缩略图</text>' +
    '</svg>'
);

// 缩略图加载失败 → 切到占位（避免空白 + 不再触发 onerror）
function pickerImgOnError(img) {
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = PICKER_PLACEHOLDER_SVG;
    img.style.objectFit = 'contain';
    img.style.opacity = '0.55';
}

// Toast 提示（多选上限、复制成功等轻量反馈）
let pickerToastTimer = null;
function pickerShowToast(msg, type) {
    type = type || 'info';
    let el = document.getElementById('pickerToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'pickerToast';
        el.style.cssText = 'position:absolute;top:18px;left:50%;transform:translateX(-50%) translateY(-12px);' +
            'padding:9px 18px;border-radius:22px;font-size:12px;font-weight:600;color:#fff;' +
            'box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:10000;opacity:0;pointer-events:none;' +
            'transition:opacity 0.2s,transform 0.2s;white-space:nowrap;';
        const modal = document.getElementById('characterPickerModal');
        if (modal) modal.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'warn' ? 'rgba(245,158,11,0.95)' :
                        type === 'error' ? 'rgba(239,68,68,0.95)' :
                        'rgba(74,222,128,0.95)';
    el.style.color = type === 'warn' || type === 'error' ? '#fff' : '#0a1628';
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(pickerToastTimer);
    pickerToastTimer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-12px)';
    }, 1800);
}

// 加载角色数据
function pickerLoadData() {
    if (ANIMA_CHAR_DB.length > 0) return Promise.resolve();
    return fetch('/static/app/character_data_full.js')
        .then(r => r.text())
        .then(text => {
            const startIdx = text.indexOf('[');
            const endIdx = text.lastIndexOf(']');
            if (startIdx !== -1 && endIdx !== -1) {
                ANIMA_CHAR_DB = JSON.parse(text.substring(startIdx, endIdx + 1));
                console.log('[AnimaPicker] Loaded ' + ANIMA_CHAR_DB.length + ' characters');
            }
        })
        .catch(e => console.error('[AnimaPicker] Failed to load character data', e));
}

// 分类定义
function pickerBuildCategories() {
    const copyCounts = {};
    const hairCounts = {};
    const eyeCounts = {};
    const genderCounts = {};
    
    ANIMA_CHAR_DB.forEach(c => {
        if (c.copyright) copyCounts[c.copyright] = (copyCounts[c.copyright] || 0) + 1;
        if (c.hair) hairCounts[c.hair] = (hairCounts[c.hair] || 0) + 1;
        if (c.eye) eyeCounts[c.eye] = (eyeCounts[c.eye] || 0) + 1;
        if (c.gender) genderCounts[c.gender] = (genderCounts[c.gender] || 0) + 1;
    });
    
    const topCopies = Object.entries(copyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([name, count]) => ({ id: 'copy:' + name, label: name, count }));
    
    return {
        total: ANIMA_CHAR_DB.length,
        genders: [
            { id: 'gender:1girl', label: 'Female (1girl)', count: genderCounts['1girl'] || 0 },
            { id: 'gender:1boy', label: 'Male (1boy)', count: genderCounts['1boy'] || 0 }
        ],
        hairs: [
            { id: 'hair:black', label: 'Black Hair', count: hairCounts['black'] || 0 },
            { id: 'hair:blonde', label: 'Blonde Hair', count: hairCounts['blonde'] || 0 },
            { id: 'hair:white', label: 'White/Silver', count: hairCounts['white'] || 0 },
            { id: 'hair:brown', label: 'Brown Hair', count: hairCounts['brown'] || 0 },
            { id: 'hair:blue', label: 'Blue/Aqua', count: hairCounts['blue'] || 0 },
            { id: 'hair:pink', label: 'Pink Hair', count: hairCounts['pink'] || 0 },
            { id: 'hair:red', label: 'Red Hair', count: hairCounts['red'] || 0 },
            { id: 'hair:purple', label: 'Purple Hair', count: hairCounts['purple'] || 0 },
            { id: 'hair:green', label: 'Green Hair', count: hairCounts['green'] || 0 }
        ],
        eyes: [
            { id: 'eye:blue', label: 'Blue Eyes', count: eyeCounts['blue'] || 0 },
            { id: 'eye:red', label: 'Red Eyes', count: eyeCounts['red'] || 0 },
            { id: 'eye:brown', label: 'Brown Eyes', count: eyeCounts['brown'] || 0 },
            { id: 'eye:green', label: 'Green Eyes', count: eyeCounts['green'] || 0 },
            { id: 'eye:yellow', label: 'Yellow/Gold', count: eyeCounts['yellow'] || 0 },
            { id: 'eye:purple', label: 'Purple Eyes', count: eyeCounts['purple'] || 0 },
            { id: 'eye:pink', label: 'Pink Eyes', count: eyeCounts['pink'] || 0 }
        ],
        copies: topCopies
    };
}

// 名字首字母缩写（hatsune miku -> "hm"，同时保留原词首字母 "h"）
function pickerNameInitials(name) {
    return (name || '')
        .toLowerCase()
        .split(/[\s()]+/)
        .filter(Boolean)
        .map(w => w[0])
        .join('');
}

// 过滤角色
function pickerFilterChars() {
    const q = (document.getElementById('pickerSearch')?.value || '').toLowerCase().trim();
    let list = ANIMA_CHAR_DB.filter(c => {
        if (pickerCategory === 'history') {
            if (!pickerHistory.includes(c.name)) return false;
        } else if (q) {
            const initials = pickerNameInitials(c.name);
            if (!c.name.toLowerCase().includes(q) &&
                !(c.copyright || '').toLowerCase().includes(q) &&
                !initials.includes(q)) return false;
        }
        if (pickerCategory === 'all' || pickerCategory === 'history') return true;
        if (pickerCategory === 'favorites') return pickerFavorites.includes(c.name);
        if (pickerCategory.startsWith('gender:')) return c.gender === pickerCategory.replace('gender:', '');
        if (pickerCategory.startsWith('hair:')) return c.hair === pickerCategory.replace('hair:', '');
        if (pickerCategory.startsWith('eye:')) return c.eye === pickerCategory.replace('eye:', '');
        if (pickerCategory.startsWith('copy:')) return (c.copyright || '').toLowerCase() === pickerCategory.replace('copy:', '');
        return true;
    });
    const sortBy = document.getElementById('pickerSort')?.value || 'post_count';
    if (sortBy === 'post_count_asc') list.sort((a, b) => a.post_count - b.post_count);
    else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'name_desc') list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sortBy === 'copyright') list.sort((a, b) => (a.copyright || '').localeCompare(b.copyright || '') || b.post_count - a.post_count);
    else list.sort((a, b) => b.post_count - a.post_count);
    return list;
}

// 渲染分类
function pickerRenderCategories() {
    const cats = pickerBuildCategories();
    const el = document.getElementById('pickerCategories');
    if (!el) return;
    
    let html = '';
    html += '<div class="picker-cat-header' + (pickerCategory === 'all' ? ' active' : '') + '" onclick="pickerSetCategory(\'all\')"><span>全部角色</span><span class="count">' + cats.total + '</span></div>';
    html += '<div class="picker-cat-header" style="margin-top: 16px;"><span>我的自定义分组</span><span style="margin-left: auto; font-size: 16px; color: #4ade80; cursor: pointer;">+</span></div>';
    html += '<div class="picker-cat-header' + (pickerCategory === 'favorites' ? ' active' : '') + '" onclick="pickerSetCategory(\'favorites\')"><span>默认收藏</span><span class="count">' + pickerFavorites.length + '</span></div>';
    html += '<div class="picker-cat-header' + (pickerCategory === 'history' ? ' active' : '') + '" onclick="pickerSetCategory(\'history\')"><span>最近使用</span><span class="count">' + pickerHistory.length + '</span></div>';

    const groups = [
        { key: 'gender', title: '角色性别', items: cats.genders },
        { key: 'hair', title: '角色发色', items: cats.hairs },
        { key: 'eye', title: '角色瞳色', items: cats.eyes },
        { key: 'copy', title: '热门作品系列', items: cats.copies }
    ];
    
    groups.forEach(g => {
        html += '<div class="picker-cat-group">';
        html += '<div class="picker-cat-group-title" onclick="pickerToggleFold(\'' + g.key + '\')"><span>' + g.title + '</span><span class="arrow' + (pickerFoldState[g.key] ? ' collapsed' : '') + '">&#9660;</span></div>';
        html += '<div class="picker-cat-group-items' + (pickerFoldState[g.key] ? ' collapsed' : '') + '" style="max-height: ' + (g.key === 'copy' ? '600px' : '400px') + ';">';
        g.items.forEach(item => {
            html += '<div class="picker-cat-item' + (pickerCategory === item.id ? ' active' : '') + '" onclick="pickerSetCategory(\'' + item.id.replace(/'/g, "\\'") + '\')"><span>' + item.label + '</span><span class="count">' + item.count + '</span></div>';
        });
        html += '</div></div>';
    });
    
    el.innerHTML = html;
}

// 渲染网格
function pickerRenderGrid() {
    let list = pickerFilterChars();
    if (pickerShowSelected) list = list.filter(c => pickerSelected.includes(c.name));
    
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / PICKER_PAGE_SIZE));
    if (pickerPage > totalPages) pickerPage = totalPages;
    const start = (pickerPage - 1) * PICKER_PAGE_SIZE;
    const pageItems = list.slice(start, start + PICKER_PAGE_SIZE);
    
    const totalEl = document.getElementById('pickerTotalCount');
    const pageInfoEl = document.getElementById('pickerPageInfo');
    if (totalEl) totalEl.textContent = '共 ' + total + ' 个角色';
    if (pageInfoEl) pageInfoEl.textContent = '显示 ' + (start + 1) + '-' + Math.min(start + PICKER_PAGE_SIZE, total) + '，共 ' + total + ' 项';
    
    const grid = document.getElementById('pickerGrid');
    if (!grid) return;
    
    grid.innerHTML = '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">' +
        pageItems.map(c => {
            const sel = pickerSelected.includes(c.name);
            const isFav = pickerFavorites.includes(c.name);
            const imgUrl = pickerImgUrl(c.name, c.copyright);
            const safeCopyright = (c.copyright || '').replace(/'/g, "\\'");
            const safeCopyrightAttr = (c.copyright || '').replace(/"/g, '&quot;');
            return '<div class="picker-char-card' + (sel ? ' selected' : '') + '" onclick="pickerToggle(\'' + c.name.replace(/'/g, "\\'") + '\')">' +
                '<img src="' + imgUrl + '" alt="' + c.name + '" loading="lazy" onerror="pickerImgOnError(this)">' +
                '<div class="picker-char-select">' + (sel ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div>' +
                '<div class="picker-char-fav" onclick="pickerToggleFav(\'' + c.name.replace(/'/g, "\\'") + '\', event)"><svg width="16" height="16" viewBox="0 0 24 24" fill="' + (isFav ? '#ff6b9d' : 'none') + '" stroke="' + (isFav ? '#ff6b9d' : 'rgba(255,255,255,0.6)') + '" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></div>' +
                '<div class="picker-char-info"><div class="picker-char-name" title="' + c.name.replace(/"/g, '&quot;') + '">' + c.name + '</div><div class="picker-char-meta">' +
                (c.copyright ? '<span class="picker-char-series" title="点击查看「' + safeCopyrightAttr + '」系列所有角色" onclick="pickerJumpToSeries(event, \'' + safeCopyright + '\')">' + c.copyright + '</span>' : '') +
                '<span class="picker-char-count" title="' + c.post_count.toLocaleString() + ' 插画投稿">' + c.post_count.toLocaleString() + ' 插画</span></div></div></div>';
        }).join('') + '</div>';
    
    // 分页
    const prevBtn = document.getElementById('pickerPrevBtn');
    const nextBtn = document.getElementById('pickerNextBtn');
    if (prevBtn) prevBtn.disabled = pickerPage <= 1;
    if (nextBtn) nextBtn.disabled = pickerPage >= totalPages;
    
    const pagesEl = document.getElementById('pickerPages');
    if (pagesEl) {
        pagesEl.innerHTML = Array.from({length: Math.min(totalPages, 7)}, (_, i) => {
            let p;
            if (totalPages <= 7) p = i + 1;
            else if (pickerPage <= 4) p = i + 1;
            else if (pickerPage >= totalPages - 3) p = totalPages - 6 + i;
            else p = pickerPage - 3 + i;
            return '<button onclick="pickerGoPage(' + p + ')" style="padding: 6px 10px; border: 1px solid ' + (p === pickerPage ? '#4ade80' : 'rgba(255,255,255,0.1)') + '; border-radius: 6px; font-size: 12px; cursor: pointer; background: ' + (p === pickerPage ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.05)') + '; color: ' + (p === pickerPage ? '#4ade80' : '#ccc') + '; margin: 0 2px;">' + p + '</button>';
        }).join('');
    }
}

// 操作函数
function pickerSetCategory(cat) { pickerCategory = cat; pickerPage = 1; pickerRenderCategories(); pickerRenderGrid(); }
function pickerToggleFold(section) { pickerFoldState[section] = !pickerFoldState[section]; pickerRenderCategories(); }
function pickerToggle(name) {
    const i = pickerSelected.indexOf(name);
    if (i > -1) {
        pickerSelected.splice(i, 1);
    } else {
        if (pickerSelected.length >= PICKER_MAX_SELECTED) {
            pickerShowToast('最多只能选 ' + PICKER_MAX_SELECTED + ' 个角色', 'warn');
            return;
        }
        pickerSelected.push(name);
    }
    document.getElementById('pickerSelectedCount').textContent = pickerSelected.length;
    pickerRenderGrid();
}

// 点击系列标签 → 跳转到该系列分类(停止冒泡,避免触发卡片选中)
function pickerJumpToSeries(e, copyright) {
    e.stopPropagation();
    e.preventDefault();
    if (!copyright) return;
    const safeId = 'copy:' + String(copyright).toLowerCase();
    pickerSetCategory(safeId);
    pickerShowToast('已切换到: ' + copyright, 'info');
}
function pickerGoPage(p) { pickerPage = p; pickerRenderGrid(); }
function pickerPrevPage() { if (pickerPage > 1) { pickerPage--; pickerRenderGrid(); } }
function pickerNextPage() { pickerPage++; pickerRenderGrid(); }
function pickerShowSelectedOnly() { pickerShowSelected = !pickerShowSelected; pickerRenderGrid(); }
function pickerCopySelected() { navigator.clipboard.writeText(pickerSelected.join(', ')).then(() => pickerShowToast('已复制 ' + pickerSelected.length + ' 个角色', 'info'), () => pickerShowToast('复制失败,请检查浏览器权限', 'error')); }
function pickerClearAll() { pickerSelected = []; document.getElementById('pickerSelectedCount').textContent = 0; pickerRenderGrid(); }

function pickerToggleFav(name, e) {
    e.stopPropagation();
    const idx = pickerFavorites.indexOf(name);
    if (idx > -1) pickerFavorites.splice(idx, 1);
    else pickerFavorites.push(name);
    localStorage.setItem('anima-char-favorites', JSON.stringify(pickerFavorites));
    pickerRenderGrid();
    pickerRenderCategories();
}

function pickerApply() {
    // 写历史（去重，最近的在前面，限制 PICKER_HISTORY_MAX 条）
    if (pickerSelected.length > 0) {
        pickerSelected.slice().reverse().forEach(name => {
            const idx = pickerHistory.indexOf(name);
            if (idx > -1) pickerHistory.splice(idx, 1);
            pickerHistory.unshift(name);
        });
        if (pickerHistory.length > PICKER_HISTORY_MAX) {
            pickerHistory = pickerHistory.slice(0, PICKER_HISTORY_MAX);
        }
        try { localStorage.setItem('anima-char-history', JSON.stringify(pickerHistory)); } catch (_) {}
    }

    if (pickerCallback) {
        pickerCallback(pickerSelected.slice());
    } else {
        // 更新 prompt 输入框：保留画师标签，替换角色标签
        const promptInput = document.getElementById('prompt');
        if (promptInput) {
            const current = promptInput.value.trim();
            const parts = current.split(',').map(p => p.trim()).filter(p => p);
            // 保留画师标签（以@或by开头的部分）
            const artistParts = parts.filter(p => p.startsWith('@') || p.startsWith('by '));
            // 合并：画师标签 + 新的角色标签
            const allParts = [...artistParts, ...pickerSelected];
            promptInput.value = allParts.filter(p => p).join(', ');
        }
    }
    pickerClose();
    // 更新标签预览
    if (typeof updatePromptTags === 'function') updatePromptTags();
}

function pickerClose() {
    const modal = document.getElementById('characterPickerModal');
    if (modal) modal.style.display = 'none';
}

function pickerOpen(callback) {
    pickerCallback = callback || null;
    // 从提示词中读取已有的角色标签
    const promptInput = document.getElementById('prompt');
    if (promptInput) {
        const parts = promptInput.value.split(',').map(p => p.trim()).filter(p => p);
        // 角色标签：不以@或by开头的部分
        pickerSelected = parts.filter(p => !p.startsWith('@') && !p.startsWith('by '));
    }
    document.getElementById('pickerSelectedCount').textContent = pickerSelected.length;
    pickerCategory = 'all';
    pickerShowSelected = false;
    pickerPage = 1;
    pickerRenderCategories();
    pickerRenderGrid();
    const modal = document.getElementById('characterPickerModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('pickerSearch').value = '';
    setTimeout(() => document.getElementById('pickerSearch')?.focus(), 100);
}

// 初始化
function pickerInit() {
    // 加载数据
    pickerLoadData();
    
    // 创建模态框
    if (!document.getElementById('characterPickerModal')) {
        const modalHTML = `
        <div id="characterPickerModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 1240px; height: 720px; background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.08);">
                <div style="display: flex; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                    <div style="flex: 1; display: flex; align-items: center; gap: 16px;">
                        <div style="position: relative; flex: 1; max-width: 300px;">
                            <svg style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #666;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                            <input id="pickerSearch" type="text" placeholder="搜索角色..." style="width: 100%; padding: 10px 12px 10px 36px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; font-size: 13px; color: #fff; outline: none; box-sizing: border-box;">
                        </div>
                        <select id="pickerSort" style="padding: 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fff; outline: none;">
                            <option value="post_count">按热度 (高→低)</option>
                            <option value="post_count_asc">按热度 (低→高)</option>
                            <option value="name">按名称 (A→Z)</option>
                            <option value="name_desc">按名称 (Z→A)</option>
                            <option value="copyright">按作品系列</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button onclick="pickerCopySelected()" style="padding: 8px 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">复制已选</button>
                        <button onclick="pickerShowSelectedOnly()" style="padding: 8px 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">只看已选</button>
                        <button onclick="pickerClearAll()" style="padding: 8px 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #ccc; cursor: pointer;">清除已选</button>
                    </div>
                </div>
                <div style="display: flex; flex: 1; overflow: hidden;">
                    <div style="width: 220px; border-right: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; background: rgba(0,0,0,0.2);">
                        <div style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.08);"><div style="font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 1px;">分类浏览</div></div>
                        <div id="pickerCategories" style="flex: 1; overflow-y: auto; padding: 8px;"></div>
                    </div>
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div style="padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
                            <span id="pickerTotalCount" style="font-size: 13px; color: #888;">共 0 个角色</span>
                        </div>
                        <div id="pickerGrid" style="flex: 1; overflow-y: auto; padding: 16px 20px;"></div>
                        <div style="padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
                            <span id="pickerPageInfo" style="font-size: 12px; color: #666;"></span>
                            <div style="display: flex; gap: 4px;">
                                <button id="pickerPrevBtn" onclick="pickerPrevPage()" style="padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; font-size: 12px; cursor: pointer; color: #ccc;">上一页</button>
                                <div id="pickerPages"></div>
                                <button id="pickerNextBtn" onclick="pickerNextPage()" style="padding: 6px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; font-size: 12px; cursor: pointer; color: #ccc;">下一页</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 13px; color: #888;">已选择:</span>
                        <span id="pickerSelectedCount" style="font-size: 14px; font-weight: 700; color: #4ade80;">0</span>
                        <span style="font-size: 13px; color: #888;">个角色</span>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button onclick="pickerClose()" style="padding: 10px 24px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; font-size: 13px; color: #ccc; cursor: pointer;">取消</button>
                        <button onclick="pickerApply()" style="padding: 10px 24px; background: linear-gradient(135deg, #ff6b9d, #c44dff); border: none; border-radius: 10px; font-size: 13px; font-weight: 600; color: #fff; cursor: pointer;">确认应用到节点</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    
    // 绑定事件
    document.getElementById('pickerSearch')?.addEventListener('input', () => { pickerPage = 1; pickerRenderGrid(); });
    document.getElementById('pickerSort')?.addEventListener('change', () => { pickerPage = 1; pickerRenderGrid(); });
}

// DOM Ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pickerInit);
} else {
    pickerInit();
}