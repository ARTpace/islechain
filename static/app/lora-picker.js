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
let loraPickerCategory = 'all';    // 当前 folder 分类
let loraPickerTagCategory = 'all'; // 当前 tag 大类分类
let loraPickerSearch = '';         // 搜索关键词
let loraPickerCallback = null;     // 确认回调
let loraPickerOnSelectionChange = null; // 实时选中变化回调（每次 toggle/remove 时触发）
let loraPickerInitialized = false;
let loraPickerPage = 1;            // 当前页码
const loraPickerPageSize = 50;     // 每页数量
let loraPickerSortBy = 'default';  // 排序模式：default/name-asc/name-desc/recent/most-used/folder-name

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
    loraPickerClearCardCache();
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

// ── 卡片 HTML 缓存（按 itemKey） ────────────────────────────────
// 同一张卡在筛选/排序/翻页时复用已渲染的 HTML 字符串，避免重复字符串拼接
// 也减少 DOM 抖动，让浏览器更容易命中已缓存的图片/视频
const loraPickerCardHtmlCache = new Map();
function loraPickerGetItemKey(item) {
    return item.isGroup ? ('g::' + (item.modelRoot || '')) : ('s::' + (item.name || ''));
}
function loraPickerClearCardCache() { loraPickerCardHtmlCache.clear(); }

// ── 预览预热（保守策略） ──────────────────────────────────────
// 只预热当前页可见的卡片，且每批最多 6 个并发，避免同时 200+ 请求压垮浏览器。
// 不再用隐藏 <video>（videos 体积大、metadata 也可能拉很久），视频交给
// 真正渲染到 <video> 元素时按需加载；用过的卡片走 ETag/304 命中缓存。
const loraPickerPrewarmedSet = new Set();
function loraPickerPrewarmPreviews(items, max) {
    if (!Array.isArray(items) || items.length === 0) return;
    const limit = Math.min(items.length, max || 12);
    let i = 0;
    const inFlight = new Set();
    const launch = () => {
        while (inFlight.size < 6 && i < limit) {
            const item = items[i++];
            if (!item || !item.preview) continue;
            if (loraPickerPrewarmedSet.has(item.preview)) continue;
            loraPickerPrewarmedSet.add(item.preview);
            const img = new Image();
            img.decoding = 'async';
            img.src = item.preview;
            inFlight.add(img);
            img.onload = img.onerror = () => inFlight.delete(img);
        }
    };
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 30));
    idle(() => launch());
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
// 与 ComfyUI-LoRA-Manager / civitai 习惯一致：按 tag / 文件名关键字归类到 14 大类
// 注意：baseModel 名称（anima、illustrious、kanzarin 等）不作为分类关键词，
//       否则会把所有"用 Anima 训练的 LoRA"都误归到 BASE MODEL
const LORA_BIG_CATEGORIES = [
    { key: 'all',        label: '全部' },
    { key: 'character',  label: '角色',  match: ['character', 'girl', 'boy', 'woman', 'women', 'man', 'men', '人物', '角色', '女性', '男性', 'female', 'male', 'frieren', 'sousou no frieren', 'huge breasts', 'nsfw', 'nude', 'mature', 'face', 'mangaka', 'cosplay', 'frieren beyond journey', 'empress', 'emperor', 'princess', 'prince', 'royal', 'noble', '颜值', '女帝'] },
    { key: 'style',      label: '风格',      match: ['style', 'styles', 'artstyle', 'artist', 'artists', 'manga', 'anime', 'cartoon', 'chinese', 'guofeng', '国风', 'illustrat', '996beshi', 'ink', 'painting', 'painterly', 'gothic', 'core', 'flat', 'blending', 'shadow', 'lineart', 'realistic', 'realism', 'animecore', '3d', 'cinematic', 'watercolor', 'sketch', 'doodle', 'monochrome', 'neon', '写实', '风格', 'filter'] },
    { key: 'concept',    label: '概念',    match: ['concept', 'theme', 'idea', 'fantasy', 'scifi', 'cyberpunk', 'masterpiece', 'dark', 'dream', 'magic', 'epic', 'vintage', 'retro', 'futuristic'] },
    { key: 'clothing',   label: '服装',   match: ['clothing', 'clothes', 'dress', 'costume', 'uniform', '服装', '衣服', 'outfit', 'armor', 'attire', 'wearing', 'wear', 'skin', 'hair', '衣服', '衣服提取', 'nude'] },
    { key: 'base_model', label: '底模', match: ['base model', 'lycoris', 'lokr', 'loha', 'locon', 'lora', 'model', 'turbo', 'predistill', 'distill', 'lcm', 'detail', 'tweaker', 'slider', 'fix', 'fixer', 'color', '颜色', '强化', 'epoch', 'step', 'adapter', 'adetailer', 'nsfw', 'nudity', 'fluxgym', 'checkpoint'] },
    { key: 'poses',      label: '姿势',      match: ['pose', 'poses', 'body', '动作', 'gesture', '动作学习', 'anypose', '姿势', 'posture', 'cospose', 'angle'] },
    { key: 'background', label: '背景', match: ['background', 'bg', 'scenery', 'landscape', '背景', 'scene', 'environment', 'enchancer', 'enhancer', 'photo-background', 'view'] },
    { key: 'tool',       label: '工具',       match: ['tool', 'utility', 'helper', 'helper-', 'lrzjason', 'flux2klein', 'anime2real', 'anything2real', '2real', '2anime', '转换', '转真人', 'qwen', 'edit', '编辑', 'editplus', 'controlnet', 'control', 'imgedit', 'recolor', 'restore', 'upscale'] },
    { key: 'assets',     label: '素材',     match: ['asset', 'assets', 'resource', 'library', 'pack', 'bundle', 'checkpoint'] },
    { key: 'vehicle',    label: '载具',    match: ['vehicle', 'car', 'mecha', 'ship', 'boat', 'aircraft', '车辆', 'plane', 'tank', '火车'] },
    { key: 'buildings',  label: '建筑',  match: ['building', 'architecture', 'house', '建筑', 'castle', 'city', 'tower', 'palace', 'coruscant'] },
    { key: 'objects',    label: '物品',    match: ['object', 'prop', 'item', '物品', '道具', 'thing', 'stuff', 'gem', 'sword', 'weapon', 'artifact', 'crystal'] },
    { key: 'animal',     label: '动物',     match: ['animal', 'cat', 'dog', 'creature', 'beast', '动物', 'bird', 'dragon', 'monster', 'fish', 'horse', 'wolf', 'fox', 'pet'] },
    { key: 'action',     label: '动作',     match: ['action', 'emotion', 'expression', '表情', '战斗', 'fighting', '动作', '动态', 'dynamic', 'movement', 'dance'] }
];

// 把字符串切成可比较的"词元"，避免 "anima" 误匹配 "man"、"anime" 误匹配 "nim"
// 切分规则：先按非字母数字/中文切，再按大小写转换边界切
// 例：AnimaNSS5anime → [anima, nss5, anime]、frieren_beyond_journey → [frieren, beyond, journey]
function _loraTokenize(s) {
    if (!s) return [];
    let s2 = String(s);
    // 1) 在大写转小写的驼峰边界插入分隔符（AnimaNSS5anime → Anima NSS 5 anime）
    s2 = s2.replace(/([a-z])([A-Z])/g, '$1 $2');
    s2 = s2.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    s2 = s2.replace(/([0-9])([A-Za-z])/g, '$1 $2');
    s2 = s2.replace(/([A-Za-z])([0-9])/g, '$1 $2');
    s2 = s2.toLowerCase();
    // 2) 按非字母数字 / 非中文 切
    return s2.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter(Boolean);
}

// tag 匹配改为 token 匹配：tag 本身作为整体词元参与比较；fileName/folder/baseModel 拆 token 后比较
// 对长 token 做"子串搜索"，能匹配到 "Gentleeeeeeecat" → "cat"、"danimeface" → "anime" / "face"
// 注意：子串匹配要求 匹配词 ≥ 4 字符，避免 "man" 子串误判 "animaNSS8" → "man"
// 例外：超长 token（≥10 字符，明显是多词合并串）才允许 3 字符匹配词做子串
// 例外：中文 token 任何长度都允许子串匹配（中文组合词的子串比较安全）
function _loraMatchTokens(targetTokens, matchList) {
    // 把所有 match 词展平为一个"匹配词集合"
    const flat = [];
    for (const ml of matchList) {
        const t = _loraTokenize(ml);
        if (t.length > 0) flat.push(...t);
    }
    if (flat.length === 0) return false;

    const isChinese = s => /[\u4e00-\u9fa5]/.test(s);
    for (const tk of targetTokens) {
        if (tk.length === 0) continue;
        // 1) 精确匹配（任意长度的匹配词都可命中，避免漏掉短词如 "cat"）
        if (flat.includes(tk)) return true;
        // 2) 中文 token：放宽子串匹配（任意匹配词长度）
        if (isChinese(tk) && tk.length >= 2) {
            for (const m of flat) {
                if (m.length < 2) continue;
                if (tk.includes(m)) return true;
            }
        }
        // 3) 英文 token 做子串匹配
        if (tk.length >= 5) {
            for (const m of flat) {
                if (m.length < 4) continue; // 默认 3 字符匹配词不做子串
                if (tk.includes(m)) return true;
            }
            // 例外：≥10 字符的多词合并串，允许 3 字符匹配词做子串
            // 例：Gentleeeeeeecat(15) → "cat"、starcat_anima → "cat"
            if (tk.length >= 10) {
                for (const m of flat) {
                    if (m.length !== 3) continue;
                    if (tk.includes(m)) return true;
                }
            }
        }
    }
    return false;
}

// 把 LoRA 的 tag 归到第一个匹配的大类；无 tag 或不匹配任何类别时返回 'all'
// item 可选：{ name, folder, baseModel } —— 用于 fallback 分类（无 tags 的本地 LoRA）
function loraPickerMapToBigCategory(tagsArr, item) {
    // ① tags 路径：把每个 tag 当作一个独立"词元集合"（不再拆词，避免误判）
    const norm = Array.isArray(tagsArr)
        ? tagsArr.map(t => _loraTokenize(t)).filter(a => a.length > 0)
        : [];

    for (const cat of LORA_BIG_CATEGORIES) {
        if (cat.key === 'all') continue;
        for (const tTokens of norm) {
            if (_loraMatchTokens(tTokens, cat.match)) return cat.key;
        }
    }

    // ② fallback：把 fileName / folder / baseModel 拆词后比较
    if (item) {
        const fileBase = (item.displayName || item.name || '').toLowerCase();
        const fileFull = String(item.name || '').toLowerCase();
        const folder = String(item.folder || '').toLowerCase();
        const base = String(item.baseModel || '').toLowerCase();
        const pseudo = [fileBase, fileFull, folder, base]
            .filter(Boolean)
            .map(s => _loraTokenize(s))
            .filter(a => a.length > 0);
        for (const cat of LORA_BIG_CATEGORIES) {
            if (cat.key === 'all') continue;
            for (const tTokens of pseudo) {
                if (_loraMatchTokens(tTokens, cat.match)) return cat.key;
            }
        }
    }

    return 'all';
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
                <button class="lora-picker-close" onclick="loraPickerClose()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
            <div class="lora-picker-body">
                <div class="lora-picker-sidebar" id="loraPickerSidebar"></div>
                <div class="lora-picker-content">
                    <div class="lora-picker-toolbar">
                        <div class="lora-picker-tagbar" id="loraPickerTagbar"></div>
                        <div class="lora-picker-sort">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.7"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
                            <select id="loraPickerSortSel" onchange="loraPickerOnSortChange(this.value)" title="排序方式">
                                ${LORA_PICKER_SORTS.map(s => `<option value="${s.key}" ${s.key === loraPickerSortBy ? 'selected' : ''}>${s.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
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
    loraPickerCategory = 'all';
    loraPickerTagCategory = 'all';
    loraPickerRestoreSort();  // 恢复上次选择的排序模式
    // 同步排序下拉的显示
    const sortSel = document.getElementById('loraPickerSortSel');
    if (sortSel) sortSel.value = loraPickerSortBy;

    // 复制当前已选状态
    if (typeof loraState !== 'undefined') {
        loraPickerSelected = loraState.active.map(l => ({ ...l }));
        // 把"已合并到多版本组"的具体文件去掉，组卡片（isGroup）统一从 groups 拿
        const groupedNames = new Set();
        const groups = loraState.groups || {};
        for (const root in groups) {
            for (const v of (groups[root].versions || [])) {
                groupedNames.add(v.name);
            }
        }
        // 单文件卡片
        const singles = loraState.available
            .filter(name => !groupedNames.has(name))
            .map(name => {
                const meta = loraState.loraMap[name] || {};
                let tags = meta.tags || [];
                if (typeof tags === 'string') tags = tags.split(',').map(s => s.trim()).filter(Boolean);
                const item = {
                    name: meta.name || name,
                    displayName: meta.displayName || name.split('/').pop().replace('.safetensors', ''),
                    folder: meta.folder || '通用',
                    baseModel: meta.baseModel || ''
                };
                return {
                    ...item,
                    preview: meta.preview || '',
                    videoUrl: meta.videoUrl || '',
                    tags: tags,
                    tagCategory: loraPickerMapToBigCategory(tags, item),
                    isGroup: false
                };
            });
        // 多版本组合并卡片（每个组一张卡）
        const groupCards = Object.values(groups).map(g => {
            const cur = g.versions[g.currentVersionIdx] || g.versions[0];
            // 收集整个 group 的 tags 并集，给合并卡片归大类
            const allTagsSet = new Set();
            let gFolder = g.folder || '通用';
            let gBase = g.baseModel || '';
            for (const v of g.versions) {
                let t = v.triggerWords || [];
                if (typeof t === 'string') t = t.split(',').map(s => s.trim());
                // 从 loraMap 拉一份更完整的 tags
                const fullMeta = loraState.loraMap[v.name] || {};
                const fullTags = fullMeta.tags || [];
                const list = Array.isArray(fullTags) ? fullTags : (typeof fullTags === 'string' ? fullTags.split(',').map(s => s.trim()) : []);
                for (const x of list) allTagsSet.add(x);
                if (!gFolder && fullMeta.folder) gFolder = fullMeta.folder;
                if (!gBase && fullMeta.baseModel) gBase = fullMeta.baseModel;
            }
            const allTags = Array.from(allTagsSet);
            const gItem = { name: g.modelRoot, displayName: g.displayName, folder: gFolder, baseModel: gBase };
            return {
                name: g.modelRoot,             // 用 modelRoot 作为选中时的 key
                modelRoot: g.modelRoot,
                displayName: g.displayName,
                preview: cur.preview || '',
                videoUrl: cur.videoUrl || '',
                baseModel: gBase,
                tags: allTags,
                folder: gFolder,
                tagCategory: loraPickerMapToBigCategory(allTags, gItem),
                isGroup: true,
                versions: g.versions,
                currentVersionIdx: g.currentVersionIdx,
                // 实际加载时使用的文件路径
                resolvedName: cur ? cur.name : ''
            };
        });
        // 多版本组排前，单文件排后（具体排序规则由 loraPickerSortList 应用）
        loraPickerAllItems = [...groupCards, ...singles];
    } else {
        loraPickerSelected = [];
        loraPickerAllItems = [];
    }

    document.getElementById('loraPickerSearch').value = '';
    document.getElementById('loraPickerShell').classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // 计算锁定顺序：用户排序 + 已选置顶
    // 之后运行期间点击只切换状态，不重排
    loraPickerFrozenOrder = loraPickerBuildFrozenOrder();

    loraPickerRenderTagbar();
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

// ── 获取分类列表 ──────────────────────────────────────────────────
function loraPickerGetCategories() {
    const cats = {};
    for (const item of loraPickerAllItems) {
        const cat = item.folder || '通用';
        cats[cat] = (cats[cat] || 0) + 1;
    }
    return cats;
}

// ── tag 大类列表（按 LORA_BIG_CATEGORIES 顺序输出，count=0 的不展示）──
// 按当前左侧 folder 过滤后再统计，让分类数量反映"当前文件夹下各 tag 分类有多少个"
function loraPickerGetTagCategories() {
    // 1) 先按 folder 过滤（与 GetFiltered 第 1 步保持一致）
    const folderList = loraPickerCategory === 'all'
        ? loraPickerAllItems
        : loraPickerAllItems.filter(item => (item.folder || '通用') === loraPickerCategory);
    const counts = { all: folderList.length };
    for (const item of folderList) {
        const k = item.tagCategory || 'all';
        counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
}

// ── 渲染 tag 大类条（顶部） ─────────────────────────────────────
function loraPickerRenderTagbar() {
    const el = document.getElementById('loraPickerTagbar');
    if (!el) return;
    const counts = loraPickerGetTagCategories();
    let html = '';
    for (const cat of LORA_BIG_CATEGORIES) {
        const count = counts[cat.key] || 0;
        // 0 个的类别不展示（避免太拥挤），但保留"全部"
        if (cat.key !== 'all' && count === 0) continue;
        const isActive = loraPickerTagCategory === cat.key;
        const safeKey = cat.key.replace(/'/g, "\\'");
        html += '<div class="lora-tagbar-item ' + (isActive ? 'active' : '') + '" onclick="loraPickerSelectTagCategory(\'' + safeKey + '\')">' +
            '<span class="lora-tagbar-label">' + cat.label + '</span>' +
            '<span class="lora-tagbar-count">' + count + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
}

// ── 选择 tag 大类 ─────────────────────────────────────────────
function loraPickerSelectTagCategory(key) {
    loraPickerTagCategory = key;
    loraPickerPage = 1;
    loraPickerRenderTagbar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
}

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
    // 1) folder 维度
    if (loraPickerCategory !== 'all') {
        list = list.filter(item => (item.folder || '通用') === loraPickerCategory);
    }
    // 2) tag 大类维度
    if (loraPickerTagCategory !== 'all') {
        list = list.filter(item => (item.tagCategory || 'all') === loraPickerTagCategory);
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
    // 切换 folder 后，把 tag 大类重置为"全部"（上一个 folder 的 tag 在新 folder 里可能没意义）
    loraPickerTagCategory = 'all';
    loraPickerPage = 1;
    loraPickerRenderSidebar();
    loraPickerRenderTagbar();
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
        mediaHtml = '<video class="lora-card-img" src="' + item.videoUrl + '" autoplay loop muted playsinline preload="metadata" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"></video>';
    } else if (item.preview) {
        mediaHtml = '<img class="lora-card-img" src="' + item.preview + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
    }
    const placeholderDisplay = (item.videoUrl || item.preview) ? 'none' : 'flex';

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
    const html = '<div data-key="' + key + '" class="lora-card-item' + (item.isGroup ? ' is-group' : '') + '" onclick="loraPickerToggleItem(\'' + safeName + '\')" title="' + item.displayName + '\n' + (item.baseModel || '') + '\n' + (item.tags || '') + '">' +
        mediaHtml +
        versionBadgeHtml +
        usageBadgeHtml +
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
    } else {
        loraPickerSelected.push({ name: entryName, strength: 0.8 });
    }
    // 不要再 loraPickerPage = 1：选中后强度条就出现在这张卡上，强行跳回首页会让用户失去当前页上下文
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
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
    // 切换版本后预览图/视频变了，清掉这张卡的缓存让新版本生效
    loraPickerCardHtmlCache.delete('g::' + modelRoot);
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
}

// ── 移除已选 ─────────────────────────────────────────────────────
function loraPickerRemoveSelected(index) {
    loraPickerSelected.splice(index, 1);
    loraPickerRenderSelectedBar();
    loraPickerRenderGrid();
    loraPickerUpdateFooter();
    // 实时回调：通知外部选中已变化
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
