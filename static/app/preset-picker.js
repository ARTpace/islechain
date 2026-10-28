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
let presetStyleSubject = '';
let presetStyleExpanded = '';

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
    const asc = document.getElementById('presetPickerSort')?.dataset.asc === '1';
    if (presetPickerSort === 'name') {
        list = [...list].sort((a, b) => asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
    } else if (presetPickerSort === 'category') {
        list = [...list].sort((a, b) => {
            const cmp = a.category_name.localeCompare(b.category_name) || a.name.localeCompare(b.name);
            return asc ? cmp : -cmp;
        });
    } else {
        list = [...list];
        if (asc) list.reverse();
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
                        name_key: (cat.id ? cat.id + '::' : '') + p.id,
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
                    _collection: _styleCollection(p, cat.id, sub.name),
                    category_id: 'style_' + cat.id,
                    category_name: catName,
                    name: pName,
                    _subcats: [{ id: sub.id, name: subName }],
                    nameLower: pName.toLowerCase(),
                    promptLower: (p.prompt || '').toLowerCase(),
                    name_key: 'style_' + cat.id + '::' + p.id,
                });
                _flatById.set(key, _flatIndex[_flatIndex.length - 1]);
            });
        });
    });
}

// 加载预设数据
// ponytail: 只整理展示索引，不改来源数据与选择键；后续导入自动沿用这些规则。
const _styleCollections = [
    ['edit', '图片编辑', /修复|换装|换脸|抠图|去除|老照片|照片转|人物转|人像转|线稿上色|背景替换|去水印/i],
    ['stickers', '贴纸表情', /表情包|贴纸|表情贴|sticker/i],
    ['ui', '图标 UI', /图标|界面|UI设计|\bicons?\b|interface/i],
    ['poster', '海报排版', /海报|招贴|信息图|日历|月历|手账|排版|流程图|图解|画报|日签|拼贴|poster|infographic/i],
    ['product', '产品商业', /产品|商品|电商|广告|品牌|包装|标志|商标|\blogo\b|product|branding/i],
    ['character', '角色设计', /角色|设定图|三视图|吉祥物|手办|character/i],
    ['portrait', '人像写真', /人像|写真|肖像|自拍|portrait|headshot/i],
    ['scene', '场景建筑', /场景|风景|景观|建筑|室内设计|宫殿群|landscape|architecture|interior design/i],
    ['anime', '动漫插画', /动漫|动画|二次元|卡通|漫画|Q版|anime|manga|cartoon|chibi/i],
    ['3d', '3D 与材质', /3D|三维|黏土|粘土|剪纸|折纸|刺绣|毛毡|浮雕|雕塑|像素|voxel/i],
    ['painting', '绘画艺术', /水彩|油画|水墨|素描|版画|绘画|插画|手绘|涂鸦|watercolor|painting|sketch|illustration/i],
    ['photo', '摄影与光影', /摄影|街拍|抓拍|胶片|镜头|CCD|生活照|电影剧照|photography|cinematic/i],
    ['food', '美食静物', /美食|菜肴|食物|甜点|静物|food|still life/i],
    ['pets', '动物萌宠', /萌宠|宠物|猫咪|小猫|小狗|狗狗|动物|pet portrait/i],
    ['wallpaper', '壁纸背景', /壁纸|背景纹理|wallpaper/i],
    ['storyboard', '分镜叙事', /分镜|故事板|连环画|四格漫|storyboard/i],
    ['vehicle', '机械载具', /汽车|跑车|赛车|机车|载具|机甲|机械|法拉利|兰博基尼|劳斯莱斯/i],
    ['fantasy', '奇幻科幻', /奇幻|科幻|怪物|巨兽|巨龙|天使军团|赛博朋克|神话|史诗对决/i],
    ['effects', '材质特效', /肌理|材质|液态|全息|光晕|玻璃微距|金属质感|texture/i],
    ['layout', '构图与版式', /构图|版式|宫格|网格图|平铺图|三联画|双联画|对比图|分屏|立体字|视觉设计指南/i],
    ['concept', '概念创意', /概念|超现实|梦核|悖论|反模因|抽象|视错觉|脑洞|极简主义|几何|美学/i],
    ['assistant', '提示词与文案', /提示词|报告要求|管理计划|对作品进行评价|图片反推|图像反推/i],
    ['style', '通用画风', null],
    ['review', '其他待整理', null]
];
function _styleCollection(p, category, subcategory = '') {
    if (!p.id.startsWith('opennana_') && !p.id.startsWith('yuanbao_')) return 'style';
    const title = p.name || '';
    const matched = _styleCollections.find(([, , pattern]) => pattern?.test(title));
    if (matched) return matched[0];
    if (category === 'yuanbao') {
        const sourceCategory = { '智能P图': 'edit', '海报设计': 'poster', '电脑壁纸': 'wallpaper', '品牌设计': 'product', '电商营销': 'product', 'UI设计': 'ui', '产品设计': 'product', 'IP角色': 'character', '写实人像': 'portrait' }[subcategory];
        if (sourceCategory) return sourceCategory;
    }
    if (/少女|女性|女子|女郎|男士|男性|女孩|男孩|情侣|佳人|美妆|发型|穿搭|人物|美女|美男/.test(title)) return 'portrait';
    const originalCollection = ({ anime_manga: 'anime', painting: 'painting', art_movements: 'painting', digital_3d: '3d', crafts: '3d', photography: 'photo', film_cinema: 'photo', retro: 'photo' })[category];
    if (originalCollection) return originalCollection;
    // 标题没有命中时才读取正文的明确用途，避免示例、背景和负向词抢占分类。
    const extraTitleRules = [
        ['poster', /封面|画册|图谱|科普图|数据可视化|图表|宣传图|长图|金句卡|许可证|邮票|剪贴簿|PPT|墙报|食谱|运势图/],
        ['portrait', /模特|超模|名模|时尚大片|时尚社论|丽人|名媛|女神|辣妹|美人|少年|男孩|男子|女生|男生|全身像|偶像|女球迷|时尚缪斯|名伶|青年|女友|运动员|人像|女主角/],
        ['painting', /工笔|蜡笔|厚涂|浮世绘|速写|草图|线稿|行书|书法|莫奈|毕加索|马蒂斯|克里姆特|维米尔|夏加尔|吉卜力|绘卷|平涂|线绘|蓝晒/],
        ['3d', /布偶|玩偶|微缩|立体模型|等距|树脂|搪胶|纸艺|公仔|娃娃/],
        ['product', /工业设计|人体工程学|物品拆解|爆炸图|护肤品|面霜|香水瓶|球鞋|腕表|咖啡机|徽章/],
        ['photo', /照片|拍照|随拍|快照|全身照|纪实|影棚|光影|微距|实景|随手拍|闪光灯|特写|电影静帧/],
        ['food', /蛋糕|披萨|糕点|三明治|芝士|咖啡|饮料|可乐|美食/],
        ['scene', /天际线|城市|海岸|山河|花园|森林|教堂|楼梯|天空|云海|宫殿|庭院|主城|夜景|地形图|街道|地标/],
        ['effects', /视错觉|几何波普|色彩质感|流体|渐变|背景色彩/]
    ];
    const extraTitle = extraTitleRules.find(([, pattern]) => pattern.test(title));
    if (extraTitle) return extraTitle[0];
    const prompt = (p.prompt || '').replace(/<[^>]*>/g, ' ').split(/负面|负向|反向提示|negative\s*(?:prompt)?\s*[:：]/i)[0];
    const contentRules = [
        ['storyboard', /分镜图|故事板|连环画|三格竖向漫画|四格漫画/],
        ['ui', /音乐播放器|系统原生.*界面|应用.*界面设计/],
        ['poster', /生成.{0,15}(?:封面图|海报|信息图)|创作.{0,15}海报|收藏卡片|艺术邮票/],
        ['product', /产品照片|产品摄影|电商主图|包装设计|工业设计/],
        ['3d', /复古手工布偶|搪胶|微缩模型|黏土材质|毛毡材质/],
        ['painting', /水墨画风|工笔画|油画风格|水彩画|丙烯笔刷|儿童绘本画风|速写草图/],
        ['anime', /动漫风格|卡通风格|日式动画风格|吉卜力风格/],
        ['portrait', /年轻女性|年轻男性|一位.{0,10}(?:女孩|男子|女人|男人)|时尚编辑肖像|全身肖像|主体.{0,8}(?:女性|男性)|人物.{0,8}(?:面部|五官)|模特.{0,8}(?:身穿|穿着)/],
        ['pets', /一只.{0,12}(?:猫|狗|熊|狐狸|鹦鹉|兔|鸟)|动物肖像/],
        ['food', /美食摄影|食物摄影|静物摄影/],
        ['wallpaper', /手机壁纸|电脑壁纸/]
    ];
    const contentMatch = contentRules.find(([, pattern]) => pattern.test(prompt));
    if (contentMatch) return contentMatch[0];
    return 'review';
}
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
            list = presetPickerCategory.startsWith('collection_')
                ? list.filter(p => p._collection === presetPickerCategory.slice(11))
                : presetPickerCategory === 'opennana'
                ? list.filter(p => p.id.startsWith('opennana_'))
                : list.filter(p => p.category_id === 'style_' + presetPickerCategory && !p.id.startsWith('opennana_'));
        } else {
            list = list.filter(p => p.category_id === presetPickerCategory);
        }
    }
    if (presetPickerSubcategory !== 'all') {
        list = _presetMode === 'style' && presetPickerCategory === 'opennana'
            ? list.filter(p => p._collection === presetPickerSubcategory)
            : list.filter(p => p._subcats.some(s => s.id === presetPickerSubcategory));
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
            cat.subcategories.forEach(sub => { n += sub.presets.filter(p => !p.id.startsWith('opennana_')).length; });
            styleCounts[cat.id] = n;
            styleAll += cat.subcategories.reduce((sum, sub) => sum + sub.presets.length, 0);
        });
        el.innerHTML = [
            { id: 'all', name: '全部', count: styleAll },
            { id: 'opennana', name: 'OpenNana', count: _flatIndex.filter(p => p._type === 'style' && p.id.startsWith('opennana_')).length },
            ...cats.map(cat => ({ id: cat.id, name: sCatI18n[cat.id] || cat.name, count: styleCounts[cat.id] || 0 })).filter(cat => cat.count)
        ].map((cat, index, items) => {
            const collection = cat.id.startsWith('collection_');
            const heading = collection && !items[index - 1]?.id.startsWith('collection_') ? '按用途 / 画风' :
                !collection && cat.id !== 'all' && items[index - 1]?.id.startsWith('collection_') ? '原分类 / 来源（保留）' : '';
            return (heading ? '<div style="padding:12px 10px 4px;opacity:.6;font-size:11px">' + heading + '</div>' : '') +
                '<div class="preset-picker-cat' + (presetPickerCategory === cat.id ? ' active' : '') + '" onclick="presetPickerSetCategory(\'' + cat.id + '\')">' +
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
    if (_presetMode === 'style' && presetPickerCategory === 'opennana') {
        const counts = {};
        _flatIndex.forEach(p => {
            if (p._type === 'style' && p.id.startsWith('opennana_')) counts[p._collection] = (counts[p._collection] || 0) + 1;
        });
        subcats = _styleCollections.map(([id, name]) => ({ id, name, count: counts[id] || 0 })).filter(sub => sub.count);
    } else if (_presetMode === 'style') {
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

    if (!grid._presetThumbnails) grid._presetThumbnails = createPresetThumbnailLoader(grid);
    grid._presetThumbnails.reset();
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
        const cardCategories = isStyle && p._collection
            ? [{ name: _styleCollections.find(([id]) => id === p._collection)[1] }]
            : p._subcats;
        const catTags = cardCategories.map(s => '<span class="preset-picker-card-tag">' + s.name + '</span>').join('');
        const cnName = _getPresetCnName(p);
        const displayName = cnName 
            ? cnName + '<br><span style="font-size:9px;opacity:0.7;font-weight:400;">' + p.prompt + '</span>'
            : p.prompt;
        const card = document.createElement('div');
        card.className = 'preset-picker-card' + (isStyle ? ' preset-picker-card-style' : '') + (sel ? ' selected' : '');
        if (isStyle && p.description) card.title = p.description;
        // 使用 addEventListener 替代内联 onclick，避免 ID 含特殊字符时 JS 解析失败
        card.addEventListener('click', () => presetPickerToggle(p.id, p.category_id));

        const cardTop = '<div class="preset-picker-card-top"><div class="preset-picker-card-cats">' + catTags + '</div><div class="preset-picker-card-check">' + (sel ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div></div>';
        let inner;
        if (isStyle) {
            const styleName = cnName || p.name || '';
            const thumb = p.thumbnail
                ? '<img class="preset-style-img" data-preset-src="' + String(p.thumbnail).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" alt="" onerror="this.remove()">'
                : '';
            inner = '<div class="preset-style-thumb">' + thumb + cardTop
                + '<div class="preset-style-caption"><div class="preset-picker-card-name">' + styleName + '</div>'
                + '<div class="preset-style-prompt" title="' + String(p.prompt || '').replace(/"/g, '&quot;') + '">' + (p.prompt || '') + '</div></div></div>';
        } else {
            inner = cardTop + '<div class="preset-picker-card-name" title="' + String(p.prompt || '').replace(/"/g, '&quot;') + '">' + displayName + '</div>';
        }
        card.innerHTML = inner;
        wrapper.appendChild(card);
    });
    grid.appendChild(wrapper);
    grid._presetThumbnails.watch();
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
function presetPickerCopySelected() {
    const text = presetPickerSelected.map(p => p.prompt).join(', ');
    const done = () => { if (typeof pickerShowToast === 'function') pickerShowToast('已复制 ' + presetPickerSelected.length + ' 个预设', 'info'); };
    navigator.clipboard.writeText(text).then(done, done);
}
// === 批量选择功能 ===
function presetPickerSelectAll() {
    // 获取当前筛选结果中的所有预设
    const filtered = presetPickerGetFilteredList();
    filtered.forEach(item => {
        if (!presetPickerSelected.some(s => s.id === item.id)) {
            presetPickerSelected.push(item);
        }
    });
    document.getElementById('presetPickerSelectedCount').textContent = presetPickerSelected.length;
    presetPickerRenderGrid();
}

function presetPickerInvertSelection() {
    // 获取当前筛选结果
    const filtered = presetPickerGetFilteredList();
    const newSelected = [];
    
    // 遍历筛选结果，选择未选中的
    filtered.forEach(item => {
        if (!presetPickerSelected.some(s => s.id === item.id)) {
            newSelected.push(item);
        }
    });
    
    // 保留不在筛选结果中的已选项
    presetPickerSelected.forEach(item => {
        if (!filtered.some(f => f.id === item.id)) {
            newSelected.push(item);
        }
    });
    
    presetPickerSelected = newSelected;
    document.getElementById('presetPickerSelectedCount').textContent = presetPickerSelected.length;
    presetPickerRenderGrid();
}

function presetPickerGetFilteredList() {
    // 获取当前筛选结果中的所有预设
    // 直接从 _vsList 中获取，这是当前渲染的列表
    return _vsList.map(p => ({
        id: p.id,
        name: p.name,
        prompt: p.prompt,
        category_id: p.category_id,
        category_name: p.category_name
    }));
}

function presetPickerClearAll() { presetPickerSelected = []; document.getElementById('presetPickerSelectedCount').textContent = 0; presetPickerRenderGrid(); }

function presetPickerApply() {
    // 方案编辑器模式：有 callback 时不直接改 prompt，交给 callback 处理
    // （保持与 character / artist picker 一致的行为）
    if (presetPickerCallback) {
        presetPickerCallback(presetPickerSelected.slice());
        return;
    }

    const promptInput = document.getElementById('prompt');
    if (!promptInput) return;

    if (_presetMode === 'style') {
        const currentPrompt = promptInput.value.trim();
        const subject = (presetStyleExpanded && currentPrompt === presetStyleExpanded)
            ? presetStyleSubject
            : currentPrompt.replace(/\{subject\}/gi, '').trim();
        const fillSubject = (text) => {
            if (subject) return text.replace(/\{(?:subject|prompt)\}/gi, subject);
            return text
                .replace(/\{(?:subject|prompt)\}\s*,\s*/gi, '')
                .replace(/\s*\{(?:subject|prompt)\}/gi, '')
                .replace(/\s{2,}/g, ' ')
                .replace(/^\s*,\s*/, '')
                .trim();
        };

        const stylePrompts = presetPickerSelected.map(p => {
            let text = (p.prompt || '').trim();
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
            return fillSubject(text);
        }).filter(Boolean);
        if (stylePrompts.length > 0) {
            presetStyleSubject = subject;
            presetStyleExpanded = stylePrompts.join(', ');
            promptInput.value = presetStyleExpanded;
        } else if (presetStyleExpanded && currentPrompt === presetStyleExpanded) {
            presetStyleExpanded = '';
            promptInput.value = presetStyleSubject;
        }
    } else {
        // 标签模式：合并到现有提示词
        const current = promptInput.value.trim();
        const parts = current.split(',').map(p => p.trim()).filter(p => p);
        const lastSet = presetPickerLastAppliedTokens || new Set();
        const newPresetTokens = presetPickerSelected.map(p => {
            return (p.prompt || p.name || p.id || '').trim();
        }).filter(Boolean);
        const seen = new Set();
        const orderedPresetParts = [];
        newPresetTokens.forEach(t => {
            const tl = t.toLowerCase();
            if (!seen.has(tl)) { seen.add(tl); orderedPresetParts.push(t); }
        });
        if (typeof window.applyPromptTokensAtCaret === 'function') {
            window.applyPromptTokensAtCaret(lastSet, orderedPresetParts);
        } else {
            const lastSetLower = new Set([...lastSet].map(s => s.toLowerCase()));
            const partsAfterRemove = parts.filter(t => !lastSetLower.has(t.toLowerCase()));
            const charParts = partsAfterRemove.filter(p => !p.startsWith('@') && !p.startsWith('by ') && !p.startsWith('['));
            const artistParts = partsAfterRemove.filter(p => p.startsWith('@') || p.startsWith('by '));
            const allParts = [...charParts, ...orderedPresetParts, ...artistParts];
            promptInput.value = allParts.filter(p => p).join(', ');
        }
        presetPickerLastAppliedTokens = new Set(orderedPresetParts.map(t => t.toLowerCase()));
    }

    if (typeof updatePromptTags === 'function') updatePromptTags();
}

// 用户改了排序下拉框：重新计算锁定顺序
function presetPickerSortChanged() {
    presetPickerSort = document.getElementById('presetPickerSort')?.value || 'name';
    presetPickerFrozenOrder = presetPickerBuildFrozenOrder();
    presetPickerRenderGrid();
}

/**
 * 刷新预设：清除缓存，从后端重新加载所有预设数据并重建 UI
 */
function presetPickerRefresh() {
    const btn = document.getElementById('presetPickerRefreshBtn');
    if (btn) {
        btn.style.color = '#06b6d4';
        btn.style.pointerEvents = 'none';
    }
    // 清除本地缓存
    _presetI18nMap = null;
    _flatIndex = [];
    _flatById.clear();
    _categoryCounts = {};
    _vsList = [];
    _vsRendered = 0;
    presetPickerFrozenOrder = null;
    // 调后端强制刷新 + 加载全部最新数据
    fetch('/api/reload-presets')
        .then(r => r.json())
        .then(data => {
            // 更新标签预设数据
            if (data.tag_presets) {
                presetPickerData = { categories: data.tag_presets };
            }
            if (data.style_presets) {
                _stylePickerData = { categories: data.style_presets };
            }
            // 重新加载 i18n
            return _loadPresetI18n();
        })
        .then(() => {
            _buildFlatIndex();
            // 重新渲染 UI
            presetPickerCategory = 'all';
            presetPickerSubcategory = 'all';
            presetPickerRenderCategories();
            presetPickerRenderSubcategories();
            _vsList = [];
            _vsRendered = 0;
            presetPickerRenderGrid();
            document.getElementById('presetPickerSearch').value = '';
        })
        .catch(e => console.error('[PresetPicker] Refresh failed:', e))
        .finally(() => {
            if (btn) {
                btn.style.color = '';
                btn.style.pointerEvents = '';
            }
        });
}

function presetPickerClose() {
    // 关闭即应用（与 LoRA 选择器一致：选择后关闭即直接使用）
    // apply 内部处理 callback：有 callback 时调 callback 并 return（不直接改 prompt），
    //                    无 callback 时走原逻辑（直接改 prompt）—— 与 character/artist picker 行为一致
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

function presetPickerOpenWithCategory(categoryId, callback) {
    presetPickerCallback = callback || null;
    presetPickerSelected = [];
    presetPickerShowSelected = false;
    // 把 category 设置为预选项；不匹配的分类会被隐藏
    presetPickerCategory = categoryId || 'all';
    presetPickerSubcategory = 'all';
    const openFn = arguments.callee._openFn || (arguments.callee._openFn = function(){
        try {
            const promptInput = document.getElementById('prompt');
            if (promptInput && _flatById) {
                const tokens = (promptInput.value || '').match(/\([^()]*\)/g) || [];
                tokens.forEach(t => {
                    const matched = _flatById.find(it => it && it.token === t);
                    if (matched && !presetPickerSelected.some(s => s.id === matched.id)) {
                        presetPickerSelected.push(matched);
                    }
                });
            }
        } catch(_) {}
        showPresetPickerModal();
        // 滚动到指定 category
        setTimeout(() => {
            const cat = presetPickerData.categories.find(c => c.id === categoryId);
            if (cat) {
                presetPickerCategory = categoryId;
                presetPickerRenderSidebar();
                presetPickerRenderGrid();
            }
        }, 50);
    });
    if (!presetPickerData || !presetPickerData.categories || presetPickerData.categories.length === 0) {
        fetch('/api/prompt-libraries/categories')
            .then(r => r.ok ? r.json() : { categories: [] })
            .then(data => {
                presetPickerData = { categories: data.categories || [] };
                openFn();
            })
            .catch(() => { presetPickerData = { categories: [] }; openFn(); });
    } else {
        openFn();
    }
}

function quickPresetPick(categoryId) {
    const apply = (data) => {
        const presets = data.categories || [];
        const allItems = [];
        presets.forEach(cat => {
            if (cat.id === categoryId && Array.isArray(cat.items)) {
                allItems.push(...cat.items);
            }
        });
        if (!allItems.length) {
            alert(`未找到「${categoryId}」分类的预设`);
            return;
        }
        const pick = allItems[Math.floor(Math.random() * allItems.length)];
        const textarea = document.getElementById('promptInput') || document.getElementById('prompt');
        if (!textarea) return;
        const current = textarea.value.trim();
        const prompt = pick.prompt || pick.name || '';
        if (current) {
            textarea.value = current + ', ' + prompt;
        } else {
            textarea.value = prompt;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (presetPickerData && presetPickerData.categories && presetPickerData.categories.length) {
        apply(presetPickerData);
    } else {
        fetch('/api/prompt-libraries/categories')
            .then(r => r.ok ? r.json() : { categories: [] })
            .then(data => apply(data))
            .catch(() => alert('加载预设数据失败'));
    }
}
window.quickPresetPick = quickPresetPick;

function showPresetPickerModal() {
    const modal = document.getElementById('presetPickerModal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('presetPickerSearch').value = '';
    setTimeout(() => document.getElementById('presetPickerSearch')?.focus(), 100);
}

window.showPresetPickerModal = showPresetPickerModal;

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
                const matchedNames = new Set();   // ← 按 name（lowercase）去重，防止同名 preset 跨分类被算成多个
                const matchedTokenStrings = new Set(); // 记录匹配到的预设所贡献的 token（用于初始化「上次应用」快照）
                _flatById.forEach(p => {
                    const nameKey = (p.name || '').toLowerCase();
                    if (!nameKey) return;
                    if (tokenSet.has(p.name) && !matchedNames.has(nameKey)) {
                        matchedNames.add(nameKey);
                        matched.add(p);
                        matchedTokenStrings.add(p.name.toLowerCase());
                    }
                    if (p.prompt) {
                        const pStr = p.prompt.trim();
                        if ((tokenSet.has(pStr) || tokenLowerSet.has(pStr.toLowerCase())) && !matchedNames.has(nameKey)) {
                            matchedNames.add(nameKey);
                            matched.add(p);
                            matchedTokenStrings.add(pStr.toLowerCase());
                        } else {
                            // 预设 prompt 含逗号时被拆成多个 token，检查是否全部存在于当前输入中
                            const pTokens = pStr.split(',').map(s => s.trim()).filter(Boolean);
                            if (pTokens.length > 1 && pTokens.every(t => tokenLowerSet.has(t.toLowerCase())) && !matchedNames.has(nameKey)) {
                                matchedNames.add(nameKey);
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
    showPresetPickerModal();
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
    if (!document.getElementById('presetPickerModal')) {
        const modalHTML = `
        <div id="presetPickerModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 960px; height: 680px; background: linear-gradient(180deg, #191918 0%, #262623 100%); border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.6); border: 1px solid rgba(6, 182, 212, 0.15);">
                <!-- 顶部 Tab 切换 -->
                <div style="display: flex; padding: 12px 20px 0; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
                    <div class="preset-mode-tab active" data-mode="tag" onclick="_presetSwitchMode('tag')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🏷️ 标签</div>
                    <div class="preset-mode-tab" data-mode="style" onclick="_presetSwitchMode('style')" style="padding: 10px 20px; font-size: 13px; font-weight: 600; color: #666666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;">🎨 风格</div>
                </div>
                <!-- 顶部工具栏 -->
                <div id="presetPickerToolbar" style="display: flex; align-items: center; padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;">
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <span id="presetPickerTitle" style="font-size: 14px; font-weight: 700; color: #fcfcfb;">标签</span>
                        <span id="presetPickerTotalCount" style="font-size: 12px; color: #666666;"></span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input id="presetPickerSearch" type="text" placeholder="搜索预设..." oninput="_presetPickerSearchInput()" style="width: 180px; height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 12px; font-size: 12px; color: #fcfcfb; outline: none;">
                        <select id="presetPickerSort" onchange="presetPickerSortChanged()" style="height: 32px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0 8px; font-size: 12px; color: #fcfcfb; outline: none;">
                            <option value="heat">按热度</option>
                            <option value="name">按名称</option>
                            <option value="category">按分类</option>
                        </select>
                        <button onclick="presetPickerShowSelectedOnly()" id="presetPickerShowSelBtn" style="height: 32px; padding: 0 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fcfcfb; cursor: pointer;">已选 (<span id="presetPickerSelectedCount">0</span>)</button>
                        <button onclick="presetPickerSelectAll()" style="height: 32px; padding: 0 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fcfcfb; cursor: pointer;">全选</button>
                        <button onclick="presetPickerInvertSelection()" style="height: 32px; padding: 0 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 12px; color: #fcfcfb; cursor: pointer;">反选</button>
                        <button onclick="presetPickerCopySelected()" id="presetPickerCopyBtn" style="height: 32px; padding: 0 12px; background: rgba(6, 182, 212, 0.2); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 8px; font-size: 12px; color: #06b6d4; cursor: pointer;">复制</button>
                        <button onclick="presetPickerClearAll()" id="presetPickerClearBtn" style="height: 32px; padding: 0 12px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; font-size: 12px; color: #ef4444; cursor: pointer;">清空</button>
                        <button onclick="presetPickerRefresh()" id="presetPickerRefreshBtn" style="height: 32px; width: 32px; padding: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 16px; color: #999999; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="刷新预设">↻</button>
                        <button onclick="presetPickerClose()" style="height: 32px; width: 32px; padding: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 16px; color: #999999; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="关闭并应用">&times;</button>
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
                    <span id="presetPickerPageInfo" style="font-size: 12px; color: #666666;"></span>
                    <span style="font-size: 12px; color: #666666;">↓ 滚动加载更多</span>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Tab 样式
        const style = document.createElement('style');
        style.textContent = ".preset-mode-tab.active { color: #06b6d4 !important; border-bottom-color: #06b6d4 !important; } .preset-mode-tab:hover { color: #fcfcfb !important; }";
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
