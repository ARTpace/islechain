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
let loraPickerModel = 'all';      // 当前一级分类(模型/顶层 folder,key 用 lowercase,display 用原名)
let loraPickerSubcat = 'all';     // 当前二级分类(子目录,key 用 lowercase,'all'=该模型下全部)
let loraPickerSearch = '';         // 搜索关键词
let loraPickerCallback = null;     // 确认回调
let loraPickerOnSelectionChange = null; // 实时选中变化回调（每次 toggle/remove 时触发）
let loraPickerInitialized = false;
let loraPickerPage = 1;            // 当前页码
const loraPickerPageSize = 50;     // 每页数量
let loraPickerSortBy = 'default';  // 排序模式：default/name-asc/name-desc/recent/most-used/folder-name
let loraPickerCardSize = 'md';   // 卡片尺寸：sm/md/lg
let loraPickerModelFilter = null;  // 当前模型过滤（文件夹名），null=不过滤
let loraPickerModelLabel = null;   // 当前模型过滤显示名（如 "Z-Image"）
let loraPickerShowAll = false;     // 用户是否点了"显示全部"

// ── NSFW 状态 ──────────────────────────────────────────────────────────
// loraPickerNsfwRevealed: 本次会话内已被用户点击"显示"的 LoRA key 集合
let loraPickerNsfwRevealed = new Set();
// loraPickerNsfwOverrides: localStorage 持久化的"强制标记/取消标记"字典 { key: true|false }
//   true  = 强制 NSFW(即便 civitai 说不 NSFW)
//   false = 强制非 NSFW(用户已确认)
const LORA_PICKER_NSFW_OVERRIDES_KEY = 'loraPicker.nsfwOverrides';
let loraPickerNsfwOverrides = {};
try { loraPickerNsfwOverrides = JSON.parse(localStorage.getItem(LORA_PICKER_NSFW_OVERRIDES_KEY) || '{}') || {}; } catch (e) { loraPickerNsfwOverrides = {}; }

// NSFW 启发式关键词(大小写不敏感)
const LORA_PICKER_NSFW_KEYWORDS = [
    'nsfw', 'nude', 'naked', 'nudity', 'sex', 'sexy', 'sexual', 'erotic', 'erotica',
    'porn', 'pornography', 'hentai', 'xxx', 'adult', 'explicit', 'fetish',
    'nsfw', 'uncensored', 'lewd', 'kinky',
    '裸', '色情', '情色', '成人', '性爱', '情欲', '裸露'
];
function loraPickerIsNsfwName(name) {
    if (!name) return false;
    const s = String(name).toLowerCase();
    return LORA_PICKER_NSFW_KEYWORDS.some(kw => s.includes(kw));
}
function loraPickerIsNsfwTags(tags) {
    if (!tags) return false;
    const list = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : []);
    return list.some(t => loraPickerIsNsfwName(t));
}
function loraPickerCheckCivitaiNsfw(civitai) {
    if (!civitai) return false;
    if (civitai.nsfw === true) return true;
    if (civitai.nsfwLevel != null && Number(civitai.nsfwLevel) >= 4) return true;
    if (civitai.nsfwLevel != null && Number(civitai.nsfwLevel) >= 1) return false; // 1-3 = 软,不算
    return false;
}
/**
 * 检查 LoraManager 返回的扁平条目中是否含 NSFW 标记。
 * LoraManager 会返回 preview_nsfw_level(预览图的 NSFW 等级) 和 civitai 原始对象。
 */
function loraPickerCheckMetaNsfwFlat(meta) {
    if (!meta) return false;
    // LoraManager 扁平字段:preview_nsfw_level(预览图 NSFW 等级)
    if (meta.preview_nsfw_level != null && Number(meta.preview_nsfw_level) >= 4) return true;
    // 也可能顶层 nsfw
    if (meta.nsfw === true) return true;
    return false;
}
/**
 * 综合判断某 LoRA 是否 NSFW(各路数据 OR,任一为真即 NSFW)
 *  - localStorage 强制标记 / 强制取消标记
 *  - civitai 官方 nsfw 字段
 *  - tags / displayName 启发式
 * @param {string} key - 卡片唯一 key(单 LoRA 用 name,组用 modelRoot)
 * @param {object} meta - loraState.loraMap 对应条目(可空)
 * @param {string} displayName
 * @param {string[]} tags
 */
function loraPickerDetectNsfw(key, meta, displayName, tags) {
    // 1. 强制 override 优先
    if (Object.prototype.hasOwnProperty.call(loraPickerNsfwOverrides, key)) {
        return !!loraPickerNsfwOverrides[key];
    }
    // 2. civitai 官方 / LoraManager 扁平字段
    if (meta) {
        if (loraPickerCheckCivitaiNsfw(meta.civitai)) return true;
        if (loraPickerCheckMetaNsfwFlat(meta)) return true;
    }
    // 3. tags 启发式
    if (loraPickerIsNsfwTags(tags)) return true;
    // 4. displayName 启发式
    if (loraPickerIsNsfwName(displayName)) return true;
    return false;
}
function loraPickerToggleNsfwReveal(key) {
    if (loraPickerNsfwRevealed.has(key)) loraPickerNsfwRevealed.delete(key);
    else loraPickerNsfwRevealed.add(key);
}
function loraPickerSetNsfwOverride(key, val) {
    if (val) loraPickerNsfwOverrides[key] = true;
    else delete loraPickerNsfwOverrides[key];
    try { localStorage.setItem(LORA_PICKER_NSFW_OVERRIDES_KEY, JSON.stringify(loraPickerNsfwOverrides)); } catch (e) {}
}
// 卡片 key 约定:单 LoRA 用 name,组用 modelRoot
function loraPickerCardKey(item) {
    return item.isGroup ? (item.modelRoot || item.name) : (item.name);
}

// 锁定顺序：打开选择器时计算一次（front-pin + 用户排序），运行期间点击不重排
// 关闭时清空
let loraPickerFrozenOrder = null;

// 排序模式 → 显示名
const LORA_PICKER_SORTS = [
    { key: 'default',     label: '默认顺序' },
    { key: 'name-asc',    label: '名称 A→Z' },
    { key: 'name-desc',   label: '名称 Z→A' },
    { key: 'recent',      label: '最近使用' },
    { key: 'most-used',   label: '使用次数' },
    { key: 'folder-name', label: '文件夹 + 名称' }
];

// LoRA 使用统计（持久化到 localStorage）
// 结构：{ [name]: { lastUsed: ms, count: n } }
const LORA_USAGE_STORAGE_KEY = 'loraUsageStats';
function loraPickerGetUsageStats() {
    try {
        const raw = localStorage.getItem(LORA_USAGE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function loraPickerSetUsageStats(stats) {
    try { localStorage.setItem(LORA_USAGE_STORAGE_KEY, JSON.stringify(stats)); } catch (e) {}
}
// 记录本次确认选中的 LoRA（多版本组用 modelRoot 作 key）
function loraPickerRecordUsage(selectedItems) {
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) return;
    const stats = loraPickerGetUsageStats();
    const now = Date.now();
    for (const it of selectedItems) {
        // 同时记录 name 和 modelRoot（多版本组用 modelRoot 作 key 才能匹配卡片）
        const keys = new Set();
        if (it.name) keys.add(it.name);
        // 从 loraState 反查 modelRoot
        if (it.name && loraState && loraState.groups) {
            for (const root of Object.keys(loraState.groups)) {
                const g = loraState.groups[root];
                if (g && g.versions && g.versions.some(v => v.name === it.name)) {
                    keys.add(root);
                }
            }
        }
        for (const key of keys) {
            if (!key) continue;
            if (!stats[key]) stats[key] = { lastUsed: now, count: 0 };
            stats[key].lastUsed = now;
            stats[key].count = (stats[key].count || 0) + 1;
        }
    }
    loraPickerSetUsageStats(stats);
}
// 获取某张卡的使用统计（兼容 group / single）
function loraPickerItemUsage(item) {
    const stats = loraPickerGetUsageStats();
    const key = item.modelRoot || item.name;
    const entry = stats[key] || null;
    // 多版本组：也检查 resolvedName（当前激活版本的文件路径）
    if (!entry && item.isGroup && item.resolvedName) {
        return stats[item.resolvedName] || { lastUsed: 0, count: 0 };
    }
    return entry || { lastUsed: 0, count: 0 };
}

// ── 缩略图 Blob 缓存（前端内存层 + IndexedDB 持久化）────────────
// 内存层：fetch 后存为 blob: URL，DOM 重建/筛选/翻页零网络请求。
// 持久层：IndexedDB 保存 blob 二进制，重启后从 DB 恢复到内存缓存，避免重新 fetch。
// Map<url, {blobUrl, type}>
const loraPickerBlobCache = new Map();

const LORA_DB_NAME = 'loraPreviewCache';
const LORA_DB_VERSION = 1;
const LORA_DB_STORE = 'previews';

/** 打开 IndexedDB */
function loraPickerOpenDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LORA_DB_NAME, LORA_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(LORA_DB_STORE)) {
                db.createObjectStore(LORA_DB_STORE);
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

/** 从 IndexedDB 加载所有缓存的 blob 到内存 */
async function loraPickerLoadBlobDb() {
    try {
        const db = await loraPickerOpenDb();
        const tx = db.transaction(LORA_DB_STORE, 'readonly');
        const store = tx.objectStore(LORA_DB_STORE);
        const keys = await new Promise((res, rej) => {
            const r = store.getAllKeys();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        if (!keys.length) { db.close(); return; }
        const entries = await new Promise((res, rej) => {
            const r = store.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        db.close();
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const blob = entries[i];
            if (blob && !loraPickerBlobCache.has(key)) {
                const blobUrl = URL.createObjectURL(blob);
                const type = blob.type.startsWith('video/') ? 'video' : 'image';
                loraPickerBlobCache.set(key, { blobUrl, type });
            }
        }
    } catch (e) {
        console.warn('[LoRA Picker] IndexedDB load failed:', e);
    }
}

/** 将 blob 异步写入 IndexedDB（不阻塞调用方） */
function loraPickerSaveBlobDb(url, blob) {
    loraPickerOpenDb().then(db => {
        const tx = db.transaction(LORA_DB_STORE, 'readwrite');
        tx.objectStore(LORA_DB_STORE).put(blob, url);
        tx.oncomplete = () => db.close();
    }).catch(() => {});
}

/**
 * 异步获取 blob URL（已缓存则直接返回，否则 fetch + 持久化）
 * @param {string} url - 原始 URL
 * @returns {Promise<string>} blob URL
 */
async function loraPickerGetBlobUrl(url) {
    if (!url) return '';
    const cached = loraPickerBlobCache.get(url);
    if (cached) return cached.blobUrl;
    try {
        const res = await fetch(url);
        if (!res.ok) return url; // 失败回退到原始 URL
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const contentType = res.headers.get('content-type') || '';
        const type = contentType.startsWith('video/') ? 'video' : 'image';
        loraPickerBlobCache.set(url, { blobUrl, type });
        // 异步持久化到 IndexedDB（不阻塞）
        loraPickerSaveBlobDb(url, blob);
        return blobUrl;
    } catch (e) {
        return url; // fetch 失败时回退到原始 URL（让浏览器自己去请求）
    }
}

/**
 * 同步获取 blob URL（仅缓存命中，未命中返回空字符串）
 */
function loraPickerGetBlobUrlSync(url) {
    if (!url) return '';
    const cached = loraPickerBlobCache.get(url);
    return cached ? cached.blobUrl : '';
}

/** 清除所有 blob URL（内存+IndexedDB） */
function loraPickerClearBlobCache() {
    for (const entry of loraPickerBlobCache.values()) {
        try { URL.revokeObjectURL(entry.blobUrl); } catch (e) { /* ignore */ }
    }
    loraPickerBlobCache.clear();
    // 同时清除 IndexedDB
    loraPickerOpenDb().then(db => {
        db.transaction(LORA_DB_STORE, 'readwrite').objectStore(LORA_DB_STORE).clear();
        db.close();
    }).catch(() => {});
}

// ── 卡片 HTML 缓存（按 itemKey） ────────────────────────────────
// 同一张卡在筛选/排序/翻页时复用已渲染的 HTML 字符串，避免重复字符串拼接
// 也减少 DOM 抖动，让浏览器更容易命中已缓存的图片/视频
// 注意：图片 URL 用原始 URL 作为 key，blob 缓存独立于 HTML 缓存。
// 当 HTML 缓存因版本切换等原因被删时，blob 缓存仍然保留。
const loraPickerCardHtmlCache = new Map();
function loraPickerGetItemKey(item) {
    return item.isGroup ? ('g::' + (item.modelRoot || '')) : ('s::' + (item.name || ''));
}
function loraPickerClearCardCache() { loraPickerCardHtmlCache.clear(); }

// ── 预览预热（前端 Blob 缓存） ────────────────────────────────
// fetch 存入 loraPickerBlobCache，关闭时图片已在前端内存中。
// 第二次打开选择器时，<img> 直接使用 blob: URL，零网络请求。
// 策略：
//   - 打开时预热当前页 12 张图的 blob（并发 6）
//   - 滚动/翻页时按需 fetch 新卡片的 blob（lazy）
//   - 版本切换时新预览图也走 blob 缓存
function loraPickerPrewarmPreviews(items, max) {
    if (!Array.isArray(items) || items.length === 0) return;
    const limit = Math.min(items.length, max || 12);
    // 只预热 preview（图片），video 太大，只在渲染到 DOM 时按需 blob
    const urls = [];
    for (let i = 0; i < limit; i++) {
        const item = items[i];
        if (!item) continue;
        if (item.preview && !loraPickerBlobCache.has(item.preview)) {
            urls.push(item.preview);
        }
    }
    if (urls.length === 0) return;
    // 并发 fetch 并存入 blob 缓存
    const concurrency = 6;
    let i = 0;
    const run = () => {
        const batch = urls.slice(i, i + concurrency);
        i += concurrency;
        if (batch.length === 0) return;
        Promise.allSettled(batch.map(url => loraPickerGetBlobUrl(url))).finally(() => {
            if (i < urls.length) {
                // 下一批用 idle 调度，不阻塞 UI
                const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
                idle(() => run());
            }
        });
    };
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 30));
    idle(() => run());
}

// ── 文件夹名 → 中文显示名 ──────────────────────────────────────────
const _PICKER_FOLDER_CN = {
    'anima': '动画角色', 'custom_anima': '自定义动画',
    'flux1': 'FLUX1', 'flux2': 'FLUX2', 'custom_flux2': '自定义FLUX2',
    'qwen': 'Qwen', 'qwen-edit': 'Qwen编辑',
    'custom_qwen': '自定义Qwen', 'custom_qwen_edit': '自定义Qwen编辑',
    'z-image': 'Z-Image', 'zimage': 'ZImage', 'custom_zimage': '自定义ZImage',
    'recipes': '配方', 'character': '角色', 'style': '风格',
    'lighting': '光影', 'concept': '概念', 'poses': '姿势',
    'clothing': '服装', 'background': '背景', 'composition': '构图',
    'detail': '细节', 'emotion': '表情', 'hair': '发型',
    'camera': '镜头', 'texture': '材质', 'effect': '特效',
    'person': '人物', 'scene': '场景', 'animal': '动物',
    'architect': '建筑', 'food': '食物', 'vehicle': '载具',
    'fantasy': '幻想', 'sci-fi': '科幻', 'cyberpunk': '赛博朋克',
    'watercolor': '水彩', 'oil-painting': '油画', 'sketch': '素描',
    'anime': '动漫', 'realistic': '写实', '3d': '3D', '2d': '2D',
    'sd1': 'SD1.5', 'sd2': 'SD2', 'sdxl': 'SDXL', 'sd3': 'SD3',
    'flux': 'FLUX', 'lora': 'LoRA', 'embedding': 'Embedding',
    'controlnet': 'ControlNet', 'upscale': '放大', 'inpaint': '局部绘制'
};
function pickerCnFolder(name) { return _PICKER_FOLDER_CN[name] || name; }

// ── LoRA tag 大类映射 ────────────────────────────────────────────────
// ── 树形分类：按磁盘路径层级 ──────────────────────────────────
// 把 "Anima/style/foo.safetensors" 拆成 { modelKey:"anima", modelDisplay:"Anima", subKey:"style", subDisplay:"style" }
// 平铺在根目录的（无子目录）→ subKey = "__root__"（空字符串容易被误判）
// 内部 key 一律 lowercase，大小写合并去重；display 用首次扫到的原始大小写
function _loraPickerSplitPath(name) {
    const norm = String(name || '').replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    if (parts.length <= 1) {
        return { modelKey: '', modelDisplay: '通用', subKey: '__root__', subDisplay: '根目录' };
    }
    const modelRaw = parts[0];
    const subRaw = parts.length >= 3 ? parts[1] : '__root__';
    return {
        modelKey: modelRaw.toLowerCase(),
        modelDisplay: modelRaw,
        subKey: subRaw.toLowerCase(),
        subDisplay: subRaw === '__root__' ? '根目录' : subRaw
    };
}

// 一级分类（模型）前的 emoji：按 modelKey 匹配，未匹配的用默认
const _LORA_MODEL_EMOJI = {
    'anima': '🎭', 'z-image': '🖼️', 'zimage': '🖼️',
    'qwen': '🐼', 'qwen-edit': '✏️',
    'flux1': '🌊', 'flux2': '🌊', 'flux': '🌊',
    'krea 2': '✨', 'krea2': '✨',
    'ltxv 2.3': '🎬', 'ltxv2': '🎬', 'ltxv': '🎬',
    'recipes': '📜',
    'custom_anima': '🎭', 'custom_flux2': '🌊', 'custom_qwen': '🐼', 'custom_zimage': '🖼️'
};
function _loraPickerModelEmoji(modelKey) {
    return _LORA_MODEL_EMOJI[modelKey] || '📦';
}

// 收集树形分类：{ modelKey: { display, total, subs: { subKey: { display, count } } } }
// 规则：
//   - modelKey / subKey 用 lowercase
//   - display 用首次扫到的原始大小写
//   - 大小写合并：Anime / anime 视为同一个 subKey，display 保留先到那个
//   - 计数为 0 的子目录不展示（渲染层过滤）
function _loraPickerBuildTree(items) {
    const tree = {};
    for (const it of items || []) {
        const p = _loraPickerSplitPath(it.name);
        if (!tree[p.modelKey]) {
            tree[p.modelKey] = { display: p.modelDisplay, total: 0, subs: {} };
        }
        const m = tree[p.modelKey];
        m.total += 1;
        const sub = m.subs[p.subKey] || { display: p.subDisplay, count: 0 };
        sub.count += 1;
        if (!m.subs[p.subKey]) m.subs[p.subKey] = sub;
    }
    return tree;
}

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
                <div class="lora-picker-sort">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.7"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
                    <select id="loraPickerSortSel" onchange="loraPickerOnSortChange(this.value)" title="排序方式">
                        ${LORA_PICKER_SORTS.map(s => `<option value="${s.key}" ${s.key === loraPickerSortBy ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                </div>
                <button type="button" class="lora-picker-size-btn" id="loraPickerSizeBtn" onclick="loraPickerCycleSize()" title="切换卡片尺寸">
                    <svg id="loraSizeIconSm" class="lora-size-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none">
                        <rect x="3"  y="3"  width="5" height="5" rx="1"/>
                        <rect x="9.5" y="3"  width="5" height="5" rx="1"/>
                        <rect x="16" y="3"  width="5" height="5" rx="1"/>
                        <rect x="3"  y="9.5" width="5" height="5" rx="1"/>
                        <rect x="9.5" y="9.5" width="5" height="5" rx="1"/>
                        <rect x="16" y="9.5" width="5" height="5" rx="1"/>
                        <rect x="3"  y="16"  width="5" height="5" rx="1"/>
                        <rect x="9.5" y="16"  width="5" height="5" rx="1"/>
                        <rect x="16" y="16"  width="5" height="5" rx="1"/>
                    </svg>
                    <svg id="loraSizeIconMd" class="lora-size-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3"  y="3"  width="9" height="18" rx="1.5"/>
                        <rect x="13" y="3"  width="9" height="9"  rx="1.5"/>
                        <rect x="13" y="12" width="9" height="9"  rx="1.5"/>
                    </svg>
                    <svg id="loraSizeIconLg" class="lora-size-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none">
                        <rect x="3" y="3" width="18" height="18" rx="1.5"/>
                    </svg>
                </button>
                <button class="lora-picker-close" onclick="loraPickerClose()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
            <div class="lora-picker-body">
                <div class="lora-picker-sidebar" id="loraPickerSidebar"></div>
                    <div class="lora-picker-content">
                    <div class="lora-picker-selected-bar" id="loraPickerSelectedBar"></div>
                    <div class="lora-picker-grid" id="loraPickerGrid"></div>
                    <div class="lora-picker-pager" id="loraPickerPager"></div>
                </div>
            </div>
            <div class="lora-picker-footer">
                <span class="lora-picker-footer-info" id="loraPickerFooterInfo"></span>
                <button class="lora-picker-manager-btn" id="loraPickerManagerBtn" onclick="loraPickerOpenManager()" title="在新窗口打开 ComfyUI 的 LoRA 管理页面（端口 + /loras）">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    <span>打开 LoRA 管理页</span>
                </button>
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
    loraPickerModel = 'all';
    loraPickerSubcat = 'all';
    loraPickerRestoreSort();  // 恢复上次选择的排序模式
    loraPickerRestoreSize();  // 恢复上次卡片尺寸
    // 同步排序下拉的显示
    const sortSel = document.getElementById('loraPickerSortSel');
    if (sortSel) sortSel.value = loraPickerSortBy;

    // 从 IndexedDB 恢复持久化 blob 缓存到内存（重启后加速图片加载）
    await loraPickerLoadBlobDb();

    // 初始化模型过滤状态
    loraPickerShowAll = false;
    if (typeof loraState !== 'undefined') {
        // 优先用新的 folders 列表(支持多 folder);旧字段做兜底
        const _folders = loraState.modelFilterFolders && loraState.modelFilterFolders.length > 0
            ? loraState.modelFilterFolders
            : (loraState.modelFilterFolder ? [loraState.modelFilterFolder] : []);
        loraPickerModelFilter = _folders.length > 0 ? _folders : null;  // 数组或 null
        loraPickerModelLabel = loraState.modelFilterLabel || null;
    }

    // 复制当前已选状态
    if (typeof loraState !== 'undefined') {
        loraPickerSelected = loraState.active.map(l => ({ ...l }));
        // 使用统一刷新函数构建卡片列表（含模型过滤）
        loraPickerRefreshData(false);
    } else {
        loraPickerSelected = [];
        loraPickerAllItems = [];
    }

    document.getElementById('loraPickerSearch').value = '';
    document.getElementById('loraPickerShell').classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // 同步排序/锁定顺序 + 尺寸按钮
    loraPickerFrozenOrder = loraPickerBuildFrozenOrder();
    // 同步尺寸按钮的 SVG icon（只显示当前尺寸对应的那个）
    const curSize = LORA_PICKER_SIZES.find(s => s.key === loraPickerCardSize) || LORA_PICKER_SIZES[1];
    loraPickerRenderSizeIcon(curSize.key);
    const btn2 = document.getElementById('loraPickerSizeBtn');
    if (btn2) btn2.title = curSize.tooltip;
    loraPickerRenderSidebar();
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
    // 预热：只预热当前实际可见的一页（最多 12 张，6 并发），不再灌全部 233 个
    const visibleNow = loraPickerGetFiltered().slice(0, loraPickerPageSize);
    if (visibleNow.length > 0) loraPickerPrewarmPreviews(visibleNow, 12);
    loraPickerUpdateFooter();
}

// ── 关闭选择器 ─────────────────────────────────────────────────────
function loraPickerClose() {
    if (loraPickerCallback) {
        // 记录使用统计（供“最近使用”排序）
        loraPickerRecordUsage(loraPickerSelected);
        loraPickerCallback(loraPickerSelected);
    }
    // 清空锁定顺序，下次打开时重新计算
    loraPickerFrozenOrder = null;
    document.getElementById('loraPickerShell').classList.remove('is-open');
    document.body.style.overflow = '';
    loraPickerCallback = null;
    loraPickerOnSelectionChange = null;
    // 关闭后刷新主界面按钮高亮状态
    if (typeof window.updatePickerButtonsHighlight === 'function') {
        window.updatePickerButtonsHighlight();
    }
}

// ── 搜索 ─────────────────────────────────────────────────────────
function loraPickerOnSearch(val) {
    loraPickerSearch = val.trim().toLowerCase();
    loraPickerPage = 1;
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

// ── 排序 ─────────────────────────────────────────────────────────
const LORA_PICKER_SORT_STORAGE_KEY = 'loraPickerSortBy';
function loraPickerOnSortChange(val) {
    loraPickerSortBy = val || 'default';
    try { localStorage.setItem(LORA_PICKER_SORT_STORAGE_KEY, loraPickerSortBy); } catch (e) {}
    loraPickerPage = 1;
    // 重新计算锁定顺序（用户主动改了排序）
    loraPickerFrozenOrder = loraPickerBuildFrozenOrder();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}
function loraPickerRestoreSort() {
    try {
        const v = localStorage.getItem(LORA_PICKER_SORT_STORAGE_KEY);
        if (v && LORA_PICKER_SORTS.some(s => s.key === v)) loraPickerSortBy = v;
    } catch (e) {}
}

// ── 卡片尺寸切换 ───────────────────────────────────────────────
const LORA_PICKER_SIZE_STORAGE_KEY = 'loraPickerCardSize';
const LORA_PICKER_SIZES = [
    { key: 'sm', label: '小', tooltip: '小卡片' },
    { key: 'md', label: '中', tooltip: '中卡片' },
    { key: 'lg', label: '大', tooltip: '大卡片' }
];
function loraPickerRestoreSize() {
    try {
        const v = localStorage.getItem(LORA_PICKER_SIZE_STORAGE_KEY);
        if (v && LORA_PICKER_SIZES.some(s => s.key === v)) loraPickerCardSize = v;
    } catch (e) {}
}
// 单个图标按钮循环切换 sm → md → lg → sm
function loraPickerCycleSize() {
    const order = LORA_PICKER_SIZES.map(s => s.key);
    const idx = order.indexOf(loraPickerCardSize);
    const next = order[(idx < 0 ? 1 : (idx + 1) % order.length)];
    if (next === loraPickerCardSize) return;
    loraPickerCardSize = next;
    try { localStorage.setItem(LORA_PICKER_SIZE_STORAGE_KEY, loraPickerCardSize); } catch (e) {}
    // 切换显示的 SVG icon
    loraPickerRenderSizeIcon(next);
    const btn = document.getElementById('loraPickerSizeBtn');
    const meta = LORA_PICKER_SIZES.find(s => s.key === next);
    if (btn && meta) btn.title = meta.tooltip;
    // 切换尺寸需要全量重绘（每张卡高度/列宽变了）
    loraPickerClearCardCache();
    loraPickerPage = 1;
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}
// 切尺寸按钮的 SVG icon 可见性（只显示当前尺寸对应那个）
function loraPickerRenderSizeIcon(key) {
    const map = { sm: 'loraSizeIconSm', md: 'loraSizeIconMd', lg: 'loraSizeIconLg' };
    Object.entries(map).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (k === key) ? '' : 'none';
    });
}

// ── 模型过滤条 ────────────────────────────────────────────────
// ── 切换显示全部 ──────────────────────────────────────────────
function loraPickerToggleShowAll() {
    loraPickerShowAll = !loraPickerShowAll;
    // 重新构建所有卡片
    loraPickerRefreshData();
}

// ── 外部刷新数据（工作流切换时调用）─────────────────────────
function loraPickerRefreshData(resetPage) {
    if (typeof loraState === 'undefined') return;
    // 同步模型过滤状态(支持多 folder)
    const _folders = loraState.modelFilterFolders && loraState.modelFilterFolders.length > 0
        ? loraState.modelFilterFolders
        : (loraState.modelFilterFolder ? [loraState.modelFilterFolder] : []);
    loraPickerModelFilter = _folders.length > 0 ? _folders : null;  // 数组或 null
    loraPickerModelLabel = loraState.modelFilterLabel || null;
    // 重新构建全量数据
    const groupedNames = new Set();
    const groups = loraState.groups || {};
    for (const root in groups) {
        for (const v of (groups[root].versions || [])) {
            groupedNames.add(v.name);
        }
    }
    // 防御性兼容:loraPickerModelFilter 可能是 string(老路径)或 array(新路径)
    if (typeof loraPickerModelFilter === 'string') loraPickerModelFilter = [loraPickerModelFilter];
    const availableNames = (loraPickerModelFilter && loraPickerModelFilter.length > 0 && !loraPickerShowAll && typeof LoraManager !== 'undefined')
        ? LoraManager.getFiltered()
        : loraState.available;
    const singles = availableNames
        .filter(name => !groupedNames.has(name))
        .map(name => {
            const meta = loraState.loraMap[name] || {};
            let tags = meta.tags || [];
            if (typeof tags === 'string') tags = tags.split(',').map(s => s.trim()).filter(Boolean);
            const item = {
                name: meta.name || name,
                displayName: meta.displayName || name.split(/[/\\]/).pop().replace('.safetensors', ''),
                folder: meta.folder || '通用',
                baseModel: meta.baseModel || '',
                addedTime: meta.addedTime || 0
            };
            const _displayName = item.displayName;
            const _tags = tags;
            const _key = item.name;
            return {
                ...item,
                preview: meta.preview || '',
                videoUrl: meta.videoUrl || '',
                tags: tags,
                // 分类已改为按路径层级，不再需要 tagCategory 字段
                isGroup: false,
                isNsfw: loraPickerDetectNsfw(_key, meta, _displayName, _tags)
            };
        });
    // 构建可用名称集合用于组过滤
    const availableNameSet = new Set(availableNames);
    const groupCards = Object.values(groups)
        .filter(g => {
            const cur = g.versions[g.currentVersionIdx] || g.versions[0];
            return availableNameSet.has(cur.name);
        })
        .map(g => {
        const cur = g.versions[g.currentVersionIdx] || g.versions[0];
        const allTagsSet = new Set();
        let gFolder = g.folder || '通用';
        let gBase = g.baseModel || '';
        for (const v of g.versions) {
            let t = v.triggerWords || [];
            if (typeof t === 'string') t = t.split(',').map(s => s.trim());
            const fullMeta = loraState.loraMap[v.name] || {};
            const fullTags = fullMeta.tags || [];
            const list = Array.isArray(fullTags) ? fullTags : (typeof fullTags === 'string' ? fullTags.split(',').map(s => s.trim()) : []);
            for (const x of list) allTagsSet.add(x);
            if (!gFolder && fullMeta.folder) gFolder = fullMeta.folder;
            if (!gBase && fullMeta.baseModel) gBase = fullMeta.baseModel;
        }
        const allTags = Array.from(allTagsSet);
        const gItem = { name: g.modelRoot, displayName: g.displayName, folder: gFolder, baseModel: gBase };
        // 组的 NSFW 判断:遍历所有版本,任一版本 NSFW 即整组 NSFW
        const _gKey = g.modelRoot;
        let _gIsNsfw = Object.prototype.hasOwnProperty.call(loraPickerNsfwOverrides, _gKey)
            ? !!loraPickerNsfwOverrides[_gKey]
            : loraPickerDetectNsfw(_gKey, null, g.displayName, allTags);
        if (!_gIsNsfw) {
            for (const v of g.versions) {
                const vMeta = loraState.loraMap[v.name] || {};
                const vDisplay = (vMeta.displayName) || v.name;
                const vTags = vMeta.tags || [];
                if (loraPickerDetectNsfw(v.name, vMeta, vDisplay, vTags)) { _gIsNsfw = true; break; }
            }
        }
        return {
            name: g.modelRoot,
            modelRoot: g.modelRoot,
            displayName: g.displayName,
            preview: cur.preview || '',
            videoUrl: cur.videoUrl || '',
            tags: allTags,
            // 分类已改为按路径层级，不再需要 tagCategory 字段
            isGroup: true,
            isNsfw: _gIsNsfw,
            folder: gFolder,
            baseModel: gBase,
            addedTime: g.addedTime || 0,
            resolvedName: cur ? cur.name : ''
        };
    });
    loraPickerAllItems = singles.concat(groupCards);
    // 重新渲染
    loraPickerFrozenOrder = loraPickerBuildFrozenOrder();
    loraPickerRenderSidebar();
    loraPickerRenderSelectedBar();
    if (resetPage !== false) loraPickerPage = 1;
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}
window.loraPickerRefreshData = loraPickerRefreshData;

// ── NSFW 揭面：本会话内点击“显示” → 取消该卡片的模糊遮罩
function loraPickerRevealNsfw(key) {
    loraPickerToggleNsfwReveal(key);
    // 清掉该卡片的 HTML 缓存(下次 build 会重新生成不带遮罩的版本)
    // 实际 cache key 是 's::name' / 'g::modelRoot',用 s::/g:: 前缀试试
    if (loraPickerCardHtmlCache && loraPickerCardHtmlCache.delete) {
        loraPickerCardHtmlCache.delete('s::' + key);
        loraPickerCardHtmlCache.delete('g::' + key);
    }
    // 重新渲染整页 grid(简单可靠)
    if (typeof loraPickerRenderGrid === 'function') {
        loraPickerRenderGrid();
    }
}
window.loraPickerRevealNsfw = loraPickerRevealNsfw;

// ── 获取分类列表 ──────────────────────────────────────────────────
function loraPickerGetCategories() {
    // 旧接口保留（返回一级 map），内部走树形工具
    const tree = _loraPickerBuildTree(loraPickerAllItems);
    const out = { 'all': loraPickerAllItems.length };
    for (const k of Object.keys(tree)) {
        out[k] = tree[k].total;
    }
    return out;
}

// （旧的 tag 大类相关函数已删除——按用户要求改为按文件夹层级分类）

// ── 锁定顺序：按当前排序对全部 LoRA 排序，并把已选 pin 到前面 ──
function loraPickerBuildFrozenOrder() {
    return loraPickerSortList(loraPickerAllItems);
}

// ── 获取过滤后的列表 ─────────────────────────────────────────────
function loraPickerGetFiltered() {
    // 用锁定顺序作为源（点击不会重排），未设置时回退到全部
    let list = loraPickerFrozenOrder
        ? loraPickerFrozenOrder.slice()
        : loraPickerAllItems;
    // 1) 一级 model 维度（按 modelKey 比对）
    if (loraPickerModel !== 'all') {
        list = list.filter(item => {
            const p = _loraPickerSplitPath(item.name);
            return p.modelKey === loraPickerModel;
        });
    }
    // 2) 二级 sub 维度（在已选 model 内，按 subKey 比对）
    if (loraPickerSubcat !== 'all') {
        list = list.filter(item => {
            const p = _loraPickerSplitPath(item.name);
            return p.subKey === loraPickerSubcat;
        });
    }
    // 3) 搜索
    if (loraPickerSearch) {
        list = list.filter(item =>
            (item.displayName || '').toLowerCase().includes(loraPickerSearch) ||
            (item.name || '').toLowerCase().includes(loraPickerSearch) ||
            (Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : (item.tags || '').toLowerCase()).includes(loraPickerSearch) ||
            (item.baseModel || '').toLowerCase().includes(loraPickerSearch)
        );
    }
    // 排序和已选置顶已由 loraPickerFrozenOrder 提供，filter 中不再重排
    // （避免点击后置顶失效）
    return list;
}

// 应用排序（已选 pin 到前面 + 用户选定的排序规则）
function loraPickerSortList(list) {
    const arr = list.slice();
    const selSet = new Set(loraPickerSelected.map(s => s.name));
    const keyOf = (item) => item.displayName || item.name || '';
    // 先按用户选定的规则排序
    switch (loraPickerSortBy) {
        case 'name-asc':
            arr.sort((a, b) => keyOf(a).localeCompare(keyOf(b), 'zh-Hans-CN'));
            break;
        case 'name-desc':
            arr.sort((a, b) => keyOf(b).localeCompare(keyOf(a), 'zh-Hans-CN'));
            break;
        case 'recent':
            arr.sort((a, b) => loraPickerItemUsage(b).lastUsed - loraPickerItemUsage(a).lastUsed);
            break;
        case 'most-used':
            arr.sort((a, b) => {
                const dc = loraPickerItemUsage(b).count - loraPickerItemUsage(a).count;
                return dc !== 0 ? dc : keyOf(a).localeCompare(keyOf(b), 'zh-Hans-CN');
            });
            break;
        case 'folder-name':
            arr.sort((a, b) => {
                const fc = (a.folder || '通用').localeCompare(b.folder || '通用', 'zh-Hans-CN');
                return fc !== 0 ? fc : keyOf(a).localeCompare(keyOf(b), 'zh-Hans-CN');
            });
            break;
        case 'added-desc':
            // 按文件修改时间(添加时间)降序:新的在前;时间相同时按名称稳定排序
            arr.sort((a, b) => {
                const ta = a.addedTime || 0, tb = b.addedTime || 0;
                if (tb !== ta) return tb - ta;
                return keyOf(a).localeCompare(keyOf(b), 'zh-Hans-CN');
            });
            break;
        case 'default':
        default:
            // 默认顺序：多版本组排前 → 已选排前 → 原序
            arr.sort((a, b) => {
                if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
                return 0;
            });
            break;
    }
    // 已选置顶（所有排序模式通用，确保锁定顺序生效）
    if (selSet.size > 0) {
        const isSel = (it) => selSet.has(it.isGroup ? it.resolvedName : it.name);
        const selected = arr.filter(isSel);
        const unselected = arr.filter(it => !isSel(it));
        return selected.concat(unselected);
    }
    return arr;
}

// ── 渲染侧边栏（树形） ──────────────────────────────────────────
function loraPickerRenderSidebar() {
    const el = document.getElementById('loraPickerSidebar');
    if (!el) return;
    const tree = _loraPickerBuildTree(loraPickerAllItems);
    const totalCount = loraPickerAllItems.length;

    let html = '';

    // ── section: 模型筛选（如果启用了模型过滤） ──
    if (loraPickerModelFilter && !loraPickerShowAll) {
        html += '<div class="lora-sidebar-model-bar">';
        html += '<div class="lora-sidebar-model-label">模型筛选</div>';
        // 兼容 array / string;array 用 ', ' 连接显示
        const _mfDisplay = Array.isArray(loraPickerModelFilter) ? loraPickerModelFilter.join(', ') : loraPickerModelFilter;
        html += '<div class="lora-sidebar-model-chip">' + (loraPickerModelLabel || _mfDisplay) + '</div>';
        html += '<button class="lora-sidebar-model-btn" onclick="loraPickerToggleShowAll()">显示全部</button>';
        html += '</div>';
        html += '<div class="lora-sidebar-divider"></div>';
    }

    // ── 全部 ──
    html += '<div class="lora-sidebar-section">';
    const allActive = (loraPickerModel === 'all' && loraPickerSubcat === 'all');
    html += '<div class="lora-cat-item lora-cat-root ' + (allActive ? 'active' : '') + '" onclick="loraPickerSelectModel(\'all\')">' +
        '<span class="lora-cat-emoji">📚</span>' +
        '<span class="lora-cat-label">全部</span>' +
        '<span class="lora-cat-count">' + totalCount + '</span>' +
    '</div>';
    html += '</div>';

    // ── 一级：按总数降序排 ──
    const entries = Object.entries(tree).sort((a, b) => b[1].total - a[1].total);
    for (const [modelKey, m] of entries) {
        const isModelActive = (loraPickerModel === modelKey);
        const emoji = _loraPickerModelEmoji(modelKey);
        const safeModel = modelKey.replace(/'/g, "\\'");
        html += '<div class="lora-sidebar-section">';
        html += '<div class="lora-cat-item lora-cat-model ' + (isModelActive ? 'active' : '') + '" onclick="loraPickerSelectModel(\'' + safeModel + '\')">' +
            '<span class="lora-cat-emoji">' + emoji + '</span>' +
            '<span class="lora-cat-label">' + m.display + '</span>' +
            '<span class="lora-cat-count">' + m.total + '</span>' +
        '</div>';

        // 二级：只在当前 model 激活时展开；按子目录计数降序
        if (isModelActive) {
            const subEntries = Object.entries(m.subs)
                .filter(([subKey, sub]) => sub.count > 0)
                .sort((a, b) => b[1].count - a[1].count);
            for (const [subKey, sub] of subEntries) {
                const isSubActive = (loraPickerSubcat === subKey);
                const safeSub = subKey.replace(/'/g, "\\'");
                html += '<div class="lora-cat-item lora-cat-sub ' + (isSubActive ? 'active' : '') + '" onclick="loraPickerSelectSub(\'' + safeModel + '\', \'' + safeSub + '\')">' +
                    '<span class="lora-cat-sub-indent">└</span>' +
                    '<span class="lora-cat-label">' + sub.display + '</span>' +
                    '<span class="lora-cat-count">' + sub.count + '</span>' +
                '</div>';
            }
            if (loraPickerSubcat !== 'all') {
                html += '<div class="lora-cat-item lora-cat-sub-reset" onclick="loraPickerSelectSub(\'' + safeModel + '\', \'all\')">' +
                    '<span class="lora-cat-sub-indent">└</span>' +
                    '<span class="lora-cat-label">查看全部</span>' +
                '</div>';
            }
        }
        html += '</div>';
    }

    el.innerHTML = html;
}

// ── 选择一级 model ─────────────────────────────────────────────
function loraPickerSelectModel(modelKey) {
    loraPickerModel = modelKey || 'all';
    loraPickerSubcat = 'all';  // 切一级时重置二级
    loraPickerPage = 1;
    loraPickerRenderSidebar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
    const visibleNow = loraPickerGetFiltered().slice(0, loraPickerPageSize);
    if (visibleNow.length > 0) loraPickerPrewarmPreviews(visibleNow, 12);
}

// ── 选择二级 sub ─────────────────────────────────────────────
function loraPickerSelectSub(modelKey, subKey) {
    if (modelKey) loraPickerModel = modelKey;
    loraPickerSubcat = subKey || 'all';
    loraPickerPage = 1;
    loraPickerRenderSidebar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
    const visibleNow = loraPickerGetFiltered().slice(0, loraPickerPageSize);
    if (visibleNow.length > 0) loraPickerPrewarmPreviews(visibleNow, 12);
}

// 保留旧名以防外部引用（返回一级全部，二级 all）
function loraPickerSelectCategory(cat) {
    loraPickerSelectModel(cat === 'all' ? 'all' : (cat || 'all'));
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
        // 触发词写入开关：始终显示 T 按钮，有/无触发词均可切换
        const meta = loraState && loraState.loraMap && loraState.loraMap[lora.name];
        const hasTrigger = meta && Array.isArray(meta.triggerWords) && meta.triggerWords.length > 0;
        const skipTW = lora.skipTriggerWord;
        const twActive = !skipTW && hasTrigger;
        let twHtml = '<span class="lora-picker-trigger-toggle ' + (twActive ? 'on' : 'off') +
            '" onclick="event.stopPropagation();loraPickerToggleTriggerWord(' + i + ')" title="' +
            (skipTW ? '不写入提示词（点击启用）' : (hasTrigger ? '触发词：' + meta.triggerWords[0] + '（点击禁用）' : '无触发词，点击禁用写入') ) +
            '">T</span>';
        html += '<span class="lora-picker-selected-chip" onclick="loraPickerRemoveSelected(' + i + ')">' +
            twHtml +
            displayName + ' ×' + lora.strength.toFixed(1) +
            '<span class="chip-x">×</span>' +
        '</span>';
    }
    el.innerHTML = html;
}

// ── 构建单张卡片 HTML（带缓存） ─────────────────────────────────
function loraPickerBuildCardHtml(item) {
    const key = loraPickerGetItemKey(item);
    // 缓存命中：直接复用。同一张卡在筛选/排序/翻页时复用同字符串，
    // 浏览器命中已缓存的图片/视频几乎零延迟。
    if (loraPickerCardHtmlCache.has(key)) {
        return loraPickerCardHtmlCache.get(key);
    }
    // 多版本组的 key 用 "g::" 前缀，避免与具体文件路径冲突
    const itemKey = item.isGroup ? ('g::' + item.modelRoot) : item.name;
    const safeName = itemKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // 优先显示视频，其次图片，最后占位符
    // 视频只拉 metadata（不解码首帧），避免多卡时浏览器把首帧都解码一遍
    let mediaHtml = '';
    if (item.videoUrl) {
        const blobSrc = loraPickerGetBlobUrlSync(item.videoUrl) || item.videoUrl;
        // video 懒 blob：如果还没有 blob 缓存，先用原始 URL 挂上，后台异步 fetch blob
        if (!loraPickerGetBlobUrlSync(item.videoUrl)) {
            loraPickerGetBlobUrl(item.videoUrl).then(blobUrl => {
                if (blobUrl && blobUrl !== item.videoUrl) {
                    const cards = document.querySelectorAll('[data-raw-video="' + encodeURIComponent(item.videoUrl) + '"]');
                    cards.forEach(card => { card.src = blobUrl; });
                }
            }).catch(() => {});
        }
        mediaHtml = '<video class="lora-card-img" src="' + blobSrc + '" data-raw-video="' + encodeURIComponent(item.videoUrl) + '" autoplay loop muted playsinline preload="metadata" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>';
    } else if (item.preview) {
        const blobSrc = loraPickerGetBlobUrlSync(item.preview) || item.preview;
        // 图片懒 blob：如果还没有 blob 缓存，先用原始 URL 挂上，后台异步 fetch blob
        if (!loraPickerGetBlobUrlSync(item.preview)) {
            loraPickerGetBlobUrl(item.preview).then(blobUrl => {
                if (blobUrl && blobUrl !== item.preview) {
                    const cards = document.querySelectorAll('[data-raw-img="' + encodeURIComponent(item.preview) + '"]');
                    cards.forEach(card => { card.src = blobUrl; });
                }
            }).catch(() => {});
        }
        mediaHtml = '<img class="lora-card-img" src="' + blobSrc + '" data-raw-img="' + encodeURIComponent(item.preview) + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
    }
    const placeholderDisplay = (item.videoUrl || item.preview) ? 'none' : 'flex';

    // NSFW 覆盖层:封面模糊 + 黑遮罩 + "X 级内容" + "显示"按钮
    let nsfwOverlayHtml = '';
    if (item.isNsfw) {
        const _cardKey = loraPickerCardKey(item);
        const _revealed = loraPickerNsfwRevealed.has(_cardKey);
        if (!_revealed) {
            nsfwOverlayHtml = '<div class="lora-card-nsfw-overlay" data-card-key="' + _cardKey.replace(/"/g, '&quot;') + '">' +
                '<div class="lora-card-nsfw-badge">X 级内容</div>' +
                '<button type="button" class="lora-card-nsfw-reveal" data-card-key="' + _cardKey.replace(/"/g, '&quot;') + '" onclick="event.stopPropagation();loraPickerRevealNsfw(this.dataset.cardKey)">显示</button>' +
            '</div>';
        }
    }

    // 多版本组：当前显示的版本标签（右上角小角标）
    let versionBadgeHtml = '';
    if (item.isGroup && item.versions && item.versions.length > 0) {
        const cur = item.versions[item.currentVersionIdx] || item.versions[0];
        versionBadgeHtml = '<div class="lora-card-version-badge" title="当前显示版本">' + (cur.label || '?') + '</div>';
    }

    let usageBadgeHtml = '';

    // 多版本组：底部悬停版本条
    let versionsBarHtml = '';
    if (item.isGroup && item.versions && item.versions.length > 0) {
        const btnParts = item.versions.map((v, i) => {
            const safeRoot = (item.modelRoot || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const active = (i === item.currentVersionIdx) ? 'active' : '';
            return '<button type="button" class="lora-card-version-btn ' + active + '" onclick="event.stopPropagation();loraPickerSwitchVersion(\'' + safeRoot + '\',' + i + ')" title="' + v.name + '">' + (v.label || 'v' + (i+1)) + '</button>';
        }).join('');
        versionsBarHtml = '<div class="lora-card-versions" onclick="event.stopPropagation()">' +
            btnParts +
        '</div>';
    }

    // 卡片基础结构（不含 selected class、不含强度条）
    // 通过在根 div 上加 data-key 标识，方便后续局部更新选中状态
    const html = '<div data-key="' + key + '" class="lora-card-item' + (item.isGroup ? ' is-group' : '') + (item.isNsfw && !loraPickerNsfwRevealed.has(loraPickerCardKey(item)) ? ' is-nsfw' : '') + '" onclick="loraPickerToggleItem(\'' + safeName + '\')" title="' + item.displayName + '\n' + (item.baseModel || '') + '\n' + (item.tags || '') + '">' +
        mediaHtml +
        versionBadgeHtml +
        usageBadgeHtml +
        nsfwOverlayHtml +
        '<div class="lora-card-img-placeholder" style="display:' + placeholderDisplay + '">' +
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
        '</div>' +
        '<div class="lora-card-check" style="display:none">✓</div>' +
        versionsBarHtml +
        '<div class="lora-card-info">' +
            '<div class="lora-card-name">' + item.displayName + '</div>' +
            '<div class="lora-card-meta">' +
                (item.baseModel ? '<span class="lora-card-base">' + item.baseModel + '</span>' : '') +
                (item.tags ? '<span class="lora-card-tags">' + item.tags + '</span>' : '') +
            '</div>' +
        '</div>' +
        '<div class="lora-card-strength-wrap"></div>' +
    '</div>';

    loraPickerCardHtmlCache.set(key, html);
    return html;
}

// 强度条（仅在选中时插入）
function loraPickerBuildStrengthHtml(selIdx, strength) {
    return '<div class="lora-card-strength" onclick="event.stopPropagation()">' +
        '<div class="lora-card-strength-track"><input type="range" min="0.2" max="1.2" step="0.05" value="' + strength + '" style="--lora-strength-pct:' + ((strength - 0.2) / 1.0 * 100).toFixed(1) + '%" oninput="loraPickerUpdateStrength(' + selIdx + ', parseFloat(this.value));var p=((parseFloat(this.value)-0.2)/1.0*100).toFixed(1);this.style.setProperty(\'--lora-strength-pct\',p+\'%\');this.closest(\'.lora-card-strength\').querySelector(\'.lora-card-strength-val\').textContent=parseFloat(this.value).toFixed(2)"></div>' +
        '<span class="lora-card-strength-val">' + strength.toFixed(2) + '</span>' +
    '</div>';
}

// ── 渲染卡片网格（只渲染卡片，分页条交给 renderPager） ──────────────
function loraPickerRenderGrid() {
    const el = document.getElementById('loraPickerGrid');
    if (!el) return;
    // 卡片尺寸 class（sm/md/lg），驱动 CSS 网格列宽和卡片高度
    el.className = 'lora-picker-grid lora-picker-grid--' + loraPickerCardSize;
    const filtered = loraPickerGetFiltered();

    if (filtered.length === 0) {
        el.innerHTML = '<div class="lora-picker-empty" style="grid-column:1/-1;">' +
            '<div class="lora-picker-empty-icon">📭</div>' +
            '<div class="lora-picker-empty-text">' + (loraPickerSearch ? '没有匹配的 LoRA' : '暂无 LoRA 数据') + '</div>' +
        '</div>';
        loraPickerRenderPager();
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
        const selIdx = loraPickerSelected.findIndex(s => s.name === (item.isGroup ? item.resolvedName : item.name));
        const isSelected = selIdx >= 0;
        const strength = isSelected ? loraPickerSelected[selIdx].strength : 0.8;

        let cardHtml = loraPickerBuildCardHtml(item);
        // 选中态：补丁到根 div class
        if (isSelected) {
            cardHtml = cardHtml.replace('class="lora-card-item', 'class="lora-card-item selected');
            // 在强度条槽位插入 slider
            cardHtml = cardHtml.replace(
                '<div class="lora-card-strength-wrap"></div>',
                '<div class="lora-card-strength-wrap">' + loraPickerBuildStrengthHtml(selIdx, strength) + '</div>'
            );
        }
        html += cardHtml;
    }

    el.innerHTML = html;
    // 独立渲染分页条（在网格下方固定可见，不随滚动消失）
    loraPickerRenderPager();
}

// ── 渲染固定分页条 ──────────────────────────────────────────────
// 始终贴在网格下方，不随网格滚动；总页数 ≤ 1 时不显示
function loraPickerRenderPager() {
    const el = document.getElementById('loraPickerPager');
    if (!el) return;
    const filtered = loraPickerGetFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / loraPickerPageSize));
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    if (loraPickerPage > totalPages) loraPickerPage = totalPages;
    if (loraPickerPage < 1) loraPickerPage = 1;

    // 数字页码：总页数 ≤ 7 全显示；> 7 时窗口化
    let pageBtns = '';
    const winSize = 7;
    let startP, endP;
    if (totalPages <= winSize) {
        startP = 1; endP = totalPages;
    } else if (loraPickerPage <= 4) {
        startP = 1; endP = 7;
    } else if (loraPickerPage >= totalPages - 3) {
        startP = totalPages - 6; endP = totalPages;
    } else {
        startP = loraPickerPage - 3; endP = loraPickerPage + 3;
    }
    if (startP > 1) {
        pageBtns += '<button class="lora-picker-page-num" onclick="loraPickerGoPage(1)">1</button>';
        if (startP > 2) pageBtns += '<span class="lora-picker-page-ellipsis">…</span>';
    }
    for (let p = startP; p <= endP; p++) {
        const active = p === loraPickerPage ? ' active' : '';
        pageBtns += '<button class="lora-picker-page-num' + active + '" onclick="loraPickerGoPage(' + p + ')">' + p + '</button>';
    }
    if (endP < totalPages) {
        if (endP < totalPages - 1) pageBtns += '<span class="lora-picker-page-ellipsis">…</span>';
        pageBtns += '<button class="lora-picker-page-num" onclick="loraPickerGoPage(' + totalPages + ')">' + totalPages + '</button>';
    }

    el.innerHTML =
        '<button class="lora-picker-page-btn" onclick="loraPickerGoPage(' + (loraPickerPage - 1) + ')" ' + (loraPickerPage <= 1 ? 'disabled' : '') + '>‹ 上一页</button>' +
        '<div class="lora-picker-pages">' + pageBtns + '</div>' +
        '<button class="lora-picker-page-btn" onclick="loraPickerGoPage(' + (loraPickerPage + 1) + ')" ' + (loraPickerPage >= totalPages ? 'disabled' : '') + '>下一页 ›</button>' +
        '<span class="lora-picker-page-info">' + loraPickerPage + ' / ' + totalPages + ' · 共 ' + filtered.length + ' 个</span>';
}

function loraPickerGoPage(page) {
    loraPickerPage = page;
    loraPickerRenderGrid();
}

// ── DOM 修补：对单张卡片局部更新选中态 + 强度条 ──────────────
// 取代全量重绘 loraPickerRenderGrid()，避免所有 <img> 重新请求
function loraPickerPatchCard(cardKey, isSelected, strength, selIdx) {
    const el = document.getElementById('loraPickerGrid');
    if (!el) return;
    // querySelector 无法处理含反斜杠的路径，改用遍历 dataset.key
    const cards = el.querySelectorAll('.lora-card-item');
    let card = null;
    for (const c of cards) {
        if (c.dataset.key === cardKey) { card = c; break; }
    }
    if (!card) return;
    if (isSelected) {
        card.classList.add('selected');
        // 选中勾
        const check = card.querySelector('.lora-card-check');
        if (check) check.style.display = '';
        // 强度滑块
        const wrap = card.querySelector('.lora-card-strength-wrap');
        if (wrap && !wrap.querySelector('.lora-card-strength')) {
            wrap.innerHTML = loraPickerBuildStrengthHtml(selIdx, strength);
        }
    } else {
        card.classList.remove('selected');
        const check = card.querySelector('.lora-card-check');
        if (check) check.style.display = 'none';
        const wrap = card.querySelector('.lora-card-strength-wrap');
        if (wrap) wrap.innerHTML = '';
    }
}

// ── 切换选中 ─────────────────────────────────────────────────────
function loraPickerToggleItem(itemKey) {
    // itemKey: 单文件=文件路径；多版本组="g::" + modelRoot
    const isGroup = itemKey.indexOf('g::') === 0;
    let entryName = itemKey;
    if (isGroup) {
        const root = itemKey.slice(3);
        const group = loraState.groups && loraState.groups[root];
        if (!group) return;
        // 组：用"实际加载的文件路径"作为已选项的 key（这样 ComfyUI 加载时能直接用）
        const cur = group.versions[group.currentVersionIdx] || group.versions[0];
        entryName = cur ? cur.name : root;
    }
    const idx = loraPickerSelected.findIndex(s => s.name === entryName);
    if (idx >= 0) {
        loraPickerSelected.splice(idx, 1);
        // DOM 局部修补：仅取消这张卡的选中态
        // 组卡片 data-key 是 itemKey（已有 g:: 前缀），单卡片是 s::entryName
        loraPickerPatchCard(isGroup ? itemKey : ('s::' + entryName), false, 0, -1);
    } else {
        loraPickerSelected.push({ name: entryName, strength: 0.8 });
        const newSelIdx = loraPickerSelected.length - 1;
        loraPickerPatchCard(isGroup ? itemKey : ('s::' + entryName), true, 0.8, newSelIdx);
    }
    loraPickerRenderSelectedBar();
    loraPickerUpdateFooter();
    // 实时回调：通知外部选中已变化
    if (typeof loraPickerOnSelectionChange === 'function') {
        try { loraPickerOnSelectionChange([...loraPickerSelected]); } catch(e) { console.error('[LoRA Picker] onSelectionChange error:', e); }
    }
}

// ── 多版本组：切换显示版本（不动选中，只换卡片预览） ──────────────
function loraPickerSwitchVersion(modelRoot, idx) {
    const group = loraState.groups && loraState.groups[modelRoot];
    if (!group) return;
    if (idx < 0 || idx >= group.versions.length) return;
    group.currentVersionIdx = idx;
    // 同步 loraState.loraMap 上的合并条目
    if (loraState.loraMap && loraState.loraMap[modelRoot]) {
        const v = group.versions[idx];
        loraState.loraMap[modelRoot].currentVersionIdx = idx;
        loraState.loraMap[modelRoot].name = v.name;
        loraState.loraMap[modelRoot].preview = v.preview;
        loraState.loraMap[modelRoot].videoUrl = v.videoUrl;
        loraState.loraMap[modelRoot].baseModel = v.baseModel;
    }
    // 同步 loraPickerAllItems 里那张卡片的数据
    for (let i = 0; i < loraPickerAllItems.length; i++) {
        const it = loraPickerAllItems[i];
        if (it.isGroup && it.modelRoot === modelRoot) {
            it.currentVersionIdx = idx;
            it.preview = group.versions[idx].preview;
            it.videoUrl = group.versions[idx].videoUrl;
            it.baseModel = group.versions[idx].baseModel;
            it.resolvedName = group.versions[idx].name;
            break;
        }
    }
    // 同步已选：若组当前已选，需要把已选里那条同步到新版本对应的具体文件路径
    if (loraState.active && Array.isArray(loraState.active)) {
        for (const sel of loraState.active) {
            // 若已选里存的是同 modelRoot 任一旧版本，替换为新版本
            const oldV = group.versions.find(v => v.name === sel.name);
            if (oldV) {
                sel.name = group.versions[idx].name;
            }
        }
    }
    loraPickerSelected = loraPickerSelected.map(s => {
        // 检查 loraPickerSelected 里是否有同 modelRoot 的旧版本名
        const oldV = group.versions.find(v => v.name === s.name);
        if (oldV) {
            return { ...s, name: group.versions[idx].name };
        }
        return s;
    });
    // 切换版本后只刷新这一张卡的 DOM（替换预览图/视频 src），不重绘整页
    loraPickerCardHtmlCache.delete('g::' + modelRoot);
    loraPickerRenderSelectedBar();
    // 局部替换这张卡
    const grid = document.getElementById('loraPickerGrid');
    if (grid) {
        const oldCards = grid.querySelectorAll('.lora-card-item');
        let oldCard = null;
        for (const c of oldCards) {
            if (c.dataset.key === 'g::' + modelRoot) { oldCard = c; break; }
        }
        if (oldCard) {
            // 找到对应的 item 数据
            const item = loraPickerAllItems.find(it => it.isGroup && it.modelRoot === modelRoot);
            if (item) {
                const selIdx = loraPickerSelected.findIndex(s => s.name === item.resolvedName);
                const isSelected = selIdx >= 0;
                const strength = isSelected ? loraPickerSelected[selIdx].strength : 0.8;
                let newHtml = loraPickerBuildCardHtml(item);
                if (isSelected) {
                    newHtml = newHtml.replace('class="lora-card-item', 'class="lora-card-item selected');
                    newHtml = newHtml.replace(
                        '<div class="lora-card-strength-wrap"></div>',
                        '<div class="lora-card-strength-wrap">' + loraPickerBuildStrengthHtml(selIdx, strength) + '</div>'
                    );
                }
                const temp = document.createElement('div');
                temp.innerHTML = newHtml;
                const newCard = temp.firstElementChild;
                if (newCard) oldCard.replaceWith(newCard);
            }
        }
    }
}

// ── 移除已选 ─────────────────────────────────────────────────────
function loraPickerRemoveSelected(index) {
    const removed = loraPickerSelected.splice(index, 1)[0];
    // DOM 局部修补：仅取消这张卡的选中态
    if (removed) loraPickerPatchCard('s::' + removed.name, false, 0, -1);
    loraPickerRenderSelectedBar();
    loraPickerUpdateFooter();
    // 实时回调：通知外部选中已变化
    if (typeof loraPickerOnSelectionChange === 'function') {
        try { loraPickerOnSelectionChange([...loraPickerSelected]); } catch(e) { console.error('[LoRA Picker] onSelectionChange error:', e); }
    }
}

// ── 切换触发词写入 ──────────────────────────────────────────────
function loraPickerToggleTriggerWord(index) {
    if (!loraPickerSelected[index]) return;
    loraPickerSelected[index].skipTriggerWord = !loraPickerSelected[index].skipTriggerWord;
    loraPickerRenderSelectedBar();
    // 实时回调：通知外部触发词状态已变化
    if (typeof loraPickerOnSelectionChange === 'function') {
        try { loraPickerOnSelectionChange([...loraPickerSelected]); } catch(e) { console.error('[LoRA Picker] onSelectionChange error:', e); }
    }
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

// ── 打开 ComfyUI LoRA 管理页（端口 /loras）────────────────────────
// 从 /api/comfyui/instances 读取当前配置的 ComfyUI 实例列表（host:port），
// 取第一个实例的 host:port，拼成 http://host:port/loras 并在新窗口打开
async function loraPickerOpenManager() {
    const btn = document.getElementById('loraPickerManagerBtn');
    const setBusy = (busy) => {
        if (!btn) return;
        btn.disabled = busy;
        btn.classList.toggle('is-loading', busy);
    };
    setBusy(true);
    try {
        const res = await fetch('/api/comfyui/instances');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const instances = (data && Array.isArray(data.instances)) ? data.instances : [];
        if (instances.length === 0) {
            alert('未配置 ComfyUI 后端地址，请先在 ComfyUI 设置中填写 host:port');
            return;
        }
        // host:port 可能带协议前缀，做一次清洗
        const first = String(instances[0]).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        if (!first) {
            alert('ComfyUI 后端地址为空，请先在 ComfyUI 设置中填写');
            return;
        }
        const url = 'http://' + first + '/loras';
        window.open(url, '_blank', 'noopener');
    } catch (e) {
        console.error('[LoRA Picker] 打开 LoRA 管理页失败:', e);
        alert('打开 LoRA 管理页失败：' + (e && e.message ? e.message : e));
    } finally {
        setBusy(false);
    }
}
