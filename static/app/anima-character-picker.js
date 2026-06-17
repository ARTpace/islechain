/**


 * Anima 角色选择器组件 v2


 * 可在任何页面中调用 pickerOpen() 打开选择器


 * 选择完成后会触发 callback 或直接操作 prompt 输入框


 *


 * v2 新增：


 * - 双击卡片打开详情面板（显示 trigger / tags / 高清图）


 * - 一键复制 trigger / tags / 全部


 * - 支持 animadex 完整数据集（36000+ 角色）


 */





// ── 状态 ─────────────────────────────────────────────────────────────


let pickerSelected = [];


let pickerCategory = 'all';


let pickerPage = 1;


const PICKER_PAGE_SIZE = 60;


const PICKER_MAX_SELECTED = 20;


const PICKER_HISTORY_MAX = 50;


let pickerShowSelected = false;


let pickerSortType = 'post_count';  // post_count | name | copyright


let pickerSortAsc = false;          // true=升序, false=降序


let pickerFoldState = { gender: true, hair: true, eye: true, copy: true, popularity: true, feature: true, history: true };


let pickerFavorites = JSON.parse(localStorage.getItem('anima-char-favorites') || '[]');


let pickerHistory = JSON.parse(localStorage.getItem('anima-char-history') || '[]');


let pickerCallback = null;





// 角色数据（延迟加载）


let ANIMA_CHAR_DB = [];





// ── 工具函数 ─────────────────────────────────────────────────────────





function pickerImgUrl(name, copyright, trigger, thumbUrl) {


    // 优先用预构建的 thumb_url，回退到手动构建


    if (thumbUrl) return thumbUrl;


    const raw = trigger || (copyright ? name + ', ' + copyright : name);


    const encoded = encodeURIComponent(raw).replace(/%28/g, '(').replace(/%29/g, ')');


    return 'https://blobs.animadex.net/Outputs/thumbs/' + encoded + '.webp';


}





function pickerFullImgUrl(trigger) {


    if (!trigger) return '';


    const encoded = encodeURIComponent(trigger).replace(/%28/g, '(').replace(/%29/g, ')');


    return 'https://blobs.animadex.net/Outputs/' + encoded + '.png';


}





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





function pickerImgOnError(img) {


    if (img.dataset.fallback === '1') return;


    img.dataset.fallback = '1';


    img.src = PICKER_PLACEHOLDER_SVG;


    img.style.objectFit = 'contain';


    img.style.opacity = '0.55';


}





// Toast


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





function pickerCompactNumber(n) {


    if (n == null) return '';


    if (n < 1000) return String(n);


    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';


    if (n < 1000000) return Math.round(n / 1000) + 'k';


    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';


}





function pickerCopyText(text, label) {


    navigator.clipboard.writeText(text).then(


        () => pickerShowToast('已复制 ' + label, 'info'),


        () => pickerShowToast('复制失败,请检查浏览器权限', 'error')


    );


}





// ── 已选 chip ────────────────────────────────────────────────────────





function pickerUpdateSelectedChips() {


    const wrap = document.getElementById('pickerSelectedChips');


    const countEl = document.getElementById('pickerSelectedCount');


    if (countEl) countEl.textContent = pickerSelected.length;


    if (!wrap) return;


    const max = 5;


    const visible = pickerSelected.slice(0, max);


    const overflow = pickerSelected.length - visible.length;


    let html = visible.map(n => '<span class="picker-sel-chip" data-name="' + n.replace(/"/g, '&quot;') + '">' +


        '<span class="picker-sel-chip-name" title="' + n.replace(/"/g, '&quot;') + '">' + n + '</span>' +


        '<button class="picker-sel-chip-x" onclick="pickerRemoveSelectedByChip(event, this)" title="移除">×</button></span>').join('');


    if (overflow > 0) html += '<span class="picker-sel-chip picker-sel-overflow">+' + overflow + '</span>';


    wrap.innerHTML = html;


}





function pickerRemoveSelectedByChip(e, btn) {


    e.stopPropagation();


    const chip = btn.closest('.picker-sel-chip');


    if (!chip) return;


    const name = chip.dataset.name;


    const i = pickerSelected.indexOf(name);


    if (i > -1) pickerSelected.splice(i, 1);


    pickerUpdateSelectedChips();


    pickerRenderGrid();


}





// ── 数据加载 ─────────────────────────────────────────────────────────





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


                // 迁移旧版 localStorage（小写名字 → title case）


                pickerMigrateLocalData();


            }


        })


        .catch(e => console.error('[AnimaPicker] Failed to load character data', e));


}





// 旧数据名字是小写，新数据是 title case，自动迁移


function pickerMigrateLocalData() {


    // 构建 lowercase → actual name 的映射


    const nameMap = {};


    ANIMA_CHAR_DB.forEach(c => {


        nameMap[c.name.toLowerCase()] = c.name;


    });


    function migrate(arr) {


        let changed = false;


        const result = [];


        for (let i = 0; i < arr.length; i++) {


            const fixed = nameMap[arr[i].toLowerCase()];


            if (fixed) {


                // 已有条目：更新名字


                if (fixed !== arr[i]) changed = true;


                result.push(fixed);


            } else {


                // 旧数据中不存在，丢弃


                changed = true;


                console.log('[AnimaPicker] Removed stale entry: ' + arr[i]);


            }


        }


        if (changed) arr.length = 0, arr.push(...result);


        return changed;


    }


    if (migrate(pickerFavorites)) {


        localStorage.setItem('anima-char-favorites', JSON.stringify(pickerFavorites));


        console.log('[AnimaPicker] Migrated favorites: ' + pickerFavorites.length + ' kept');


    }


    if (migrate(pickerHistory)) {


        localStorage.setItem('anima-char-history', JSON.stringify(pickerHistory));


        console.log('[AnimaPicker] Migrated history: ' + pickerHistory.length + ' kept');


    }


}





// ── 分类 ─────────────────────────────────────────────────────────────





// slug 转可读格式


function _slugToReadable(slug) {


    if (!slug) return slug;


    return slug


        .replace(/_/g, ' ')


        .replace(/\([^)]+\)/g, (m) => m.toUpperCase())


        .replace(/\b\w/g, c => c.toUpperCase())


        .replace(/\btv\b/gi, 'TV')


        .replace(/\bai\b/gi, 'AI')


        .replace(/\bpc\b/gi, 'PC')


        .replace(/\bmmorpg\b/gi, 'MMORPG')


        .replace(/\bfps\b/gi, 'FPS')


        .replace(/\brpg\b/gi, 'RPG')


        .replace(/\bar\b/gi, 'AR')


        .replace(/\bvr\b/gi, 'VR')


        .replace(/\bii\b/gi, 'II')


        .replace(/\biii\b/gi, 'III')


        .replace(/\biv\b/gi, 'IV')


        .replace(/\bvi\b/gi, 'VI')


        .replace(/\bvii\b/gi, 'VII')


        .replace(/\bviii\b/gi, 'VIII')


        .replace(/\bix\b/gi, 'IX')


        .replace(/\bx\b/gi, 'X')


        .trim();


}





// 版权系列中文名映射


const PICKER_COPYRIGHT_CN = {
    'touhou': '东方Project',
    'kantai_collection': '舰队Collection',
    'fate_(series)': 'Fate系列',
    'pokemon': '宝可梦',
    'hololive': 'Hololive',
    'blue_archive': '蔚蓝档案',
    'genshin_impact': '原神',
    'idolmaster': '偶像大师',
    'arknights': '明日方舟',
    'vocaloid': 'VOCALOID',
    'umamusume': '赛马娘',
    'azur_lane': '碧蓝航线',
    'fire_emblem': '火焰纹章',
    'original': '原创',
    'honkai_(series)': '崩坏系列',
    'mahou_shoujo_madoka_magica': '魔法少女小圆',
    'love_live!': 'LoveLive!',
    'final_fantasy': '最终幻想',
    'girls_und_panzer': '少女与战车',
    'nijisanji': 'Nijisanji',
    'jojo_no_kimyou_na_bouken': 'JOJO的奇妙冒险',
    'precure': '光之美少女',
    'girls\'_frontline': '少女前线',
    'fate/grand_order': 'Fate/Grand Order',
    'danganronpa_(series)': '弹丸论破',
    'kemono_friends': '兽娘动物园',
    'gundam': '高达',
    'granblue_fantasy': '碧蓝幻想',
    'persona': '女神异闻录',
    'splatoon_(series)': '斯普拉遁',
    'one_piece': '海贼王',
    'lyrical_nanoha': '魔法少女奈叶',
    'league_of_legends': '英雄联盟',
    'k-on!': '轻音少女',
    'the_legend_of_zelda': '塞尔达传说',
    'boku_no_hero_academia': '我的英雄学院',
    'neon_genesis_evangelion': '新世纪福音战士',
    'suzumiya_haruhi_no_yuuutsu': '凉宫春日的忧郁',
    'toaru_majutsu_no_index': '魔禁',
    'mario_(series)': '马力欧系列',
    'bishoujo_senshi_sailor_moon': '美少女战士',
    'dragon_ball': '龙珠',
    'yu-gi-oh!': '游戏王',
    'chainsaw_man': '电锯人',
    'touken_ranbu': '刀剑乱舞',
    'xenoblade_chronicles_(series)': '异度神剑',
    'princess_connect!': '公主连结',
    'street_fighter': '街头霸王',
    'bang_dream!': 'BanG Dream!',
    'world_witches_series': '强袭魔女',
    'kill_la_kill': '斩！赤红之瞳',
    'bocchi_the_rock!': '孤独摇滚',
    'tales_of_(series)': '传说系列',
    'zenless_zone_zero': '绝区零',
    'naruto_(series)': '火影忍者',
    'project_moon': 'Project Moon',
    'omori': 'OMORI',
    'sword_art_online': '刀剑神域',
    'guilty_gear': '罪恶装备',
    'overwatch': '守望先锋',
    'indie_virtual_youtuber': '独立VTuber',
    'jujutsu_kaisen': '咒术回战',
    'goddess_of_victory:_nikke': 'NIKKE',
    'umineko_no_naku_koro_ni': '海猫鸣泣之时',
    'gochuumon_wa_usagi_desu_ka?': '请问您今天要来点兔子吗',
    'shingeki_no_kyojin': '进击的巨人',
    'ragnarok_online': '仙境传说',
    'dungeon_meshi': '迷宫饭',
    'kono_subarashii_sekai_ni_shukufuku_wo!': '为美好的世界献上祝福',
    'project_sekai': '世界计划',
    're:zero_kara_hajimeru_isekai_seikatsu': 'Re:从零开始',
    'voiceroid': 'VoiSona',
    'monogatari_(series)': '物语系列',
    'marvel': '漫威',
    'dragon_quest': '勇者斗恶龙',
    'kirby_(series)': '星之卡比',
    'code_geass': 'Code Geass',
    'lucky_star': '幸运星',
    'spy_x_family': '间谍过家家',
    'sousou_no_frieren': '葬送的芙莉莲',
};





// 特征标签中英文映射


const PICKER_FEATURE_MAP = {


    'twintails': '双马尾', 'twintail': '双马尾',


    'long hair': '长发', 'very long hair': '超长发',


    'short hair': '短发', 'medium hair': '中长发',


    'ponytail': '马尾', 'high ponytail': '高马尾', 'side ponytail': '侧马尾',


    'bob cut': '波波头', 'pixie cut': '精灵短发',


    'glasses': '眼镜', 'sunglasses': '墨镜',


    'animal ears': '兽耳', 'cat ears': '猫耳', 'fox ears': '狐耳', 'rabbit ears': '兔耳', 'dog ears': '犬耳',


    'tail': '尾巴', 'cat tail': '猫尾', 'fox tail': '狐尾',


    'hat': '帽子', 'beret': '贝雷帽', 'crown': '王冠', 'tiara': '头冠',


    'uniform': '制服', 'school uniform': '校服', 'military uniform': '军装',


    'maid': '女仆', 'nurse': '护士', 'bikini': '比基尼', 'swimsuit': '泳装',


    'scarf': '围巾', 'ribbon': '丝带', 'bow': '蝴蝶结',


    'headphones': '耳机', 'headset': '耳麦',


    'sword': '剑', 'gun': '枪',


    'wings': '翅膀', 'angel wings': '天使翼', 'demon wings': '恶魔翼',


    'horns': '角', 'halo': '光环',


    'armor': '铠甲', 'cloak': '斗篷', 'cape': '披风',


    'thighhighs': '过膝袜', 'kneehighs': '及膝袜',


    'miniskirt': '短裙', 'pleated skirt': '百褶裙',


    'cleavage': '乳沟', 'abs': '腹肌', 'muscular': '肌肉',


    'braid': '辫子', 'twin braids': '双辫',


    'hair ornament': '发饰', 'hair flower': '头花',


    'white hair': '白发', 'black hair': '黑发', 'blonde hair': '金发',


    'blue hair': '蓝发', 'pink hair': '粉发', 'red hair': '红发',


    'purple hair': '紫发', 'green hair': '绿发', 'brown hair': '棕发',


    'blue eyes': '蓝瞳', 'red eyes': '红瞳', 'green eyes': '绿瞳',


    'yellow eyes': '黄瞳', 'purple eyes': '紫瞳', 'pink eyes': '粉瞳',


};





// 从 tags 提取特征（取高频且有意义的）


function pickerExtractFeatures() {


    const tagCounts = {};


    ANIMA_CHAR_DB.forEach(c => {


        (c.tags || []).forEach(t => {


            const tl = t.toLowerCase().trim();


            if (PICKER_FEATURE_MAP[tl]) {


                const key = PICKER_FEATURE_MAP[tl];


                tagCounts[key] = (tagCounts[key] || 0) + 1;


            }


        });


    });


    // 取出现 50 次以上的特征，按数量排序


    return Object.entries(tagCounts)


        .filter(([_, count]) => count >= 50)


        .sort((a, b) => b[1] - a[1])


        .slice(0, 25)


        .map(([label, count]) => ({ id: 'feat:' + label, label, count }));


}





function pickerBuildCategories() {


    const copyCounts = {}, hairCounts = {}, eyeCounts = {}, genderCounts = {};


    ANIMA_CHAR_DB.forEach(c => {


        if (c.copyright) copyCounts[c.copyright] = (copyCounts[c.copyright] || 0) + 1;


        if (c.hair) hairCounts[c.hair] = (hairCounts[c.hair] || 0) + 1;


        if (c.eye) eyeCounts[c.eye] = (eyeCounts[c.eye] || 0) + 1;


        if (c.gender) genderCounts[c.gender] = (genderCounts[c.gender] || 0) + 1;


    });


    // 计算每个系列的总投稿数


    const copyPostCounts = {};


    ANIMA_CHAR_DB.forEach(c => {


        if (c.copyright) copyPostCounts[c.copyright] = (copyPostCounts[c.copyright] || 0) + c.post_count;


    });


    const topCopies = Object.entries(copyCounts)


        .sort((a, b) => (copyPostCounts[b[0]] || 0) - (copyPostCounts[a[0]] || 0))


        .slice(0, 80)


        .map(([name, count]) => {


            const cn = PICKER_COPYRIGHT_CN[name] || _slugToReadable(name);


            return { id: 'copy:' + name, label: cn, rawName: name, count: copyPostCounts[name] || count };


        });


    return {


        total: ANIMA_CHAR_DB.length,


        genders: [


            { id: 'gender:1girl', label: '女性 (1girl)', count: genderCounts['1girl'] || 0 },


            { id: 'gender:1boy', label: '男性 (1boy)', count: genderCounts['1boy'] || 0 }


        ],


        hairs: [


            { id: 'hair:black', label: '黑发', count: hairCounts['black'] || 0 },


            { id: 'hair:blonde', label: '金发', count: hairCounts['blonde'] || 0 },


            { id: 'hair:white', label: '白/银发', count: hairCounts['white'] || 0 },


            { id: 'hair:brown', label: '棕发', count: hairCounts['brown'] || 0 },


            { id: 'hair:blue', label: '蓝/青发', count: hairCounts['blue'] || 0 },


            { id: 'hair:pink', label: '粉发', count: hairCounts['pink'] || 0 },


            { id: 'hair:red', label: '红发', count: hairCounts['red'] || 0 },


            { id: 'hair:purple', label: '紫发', count: hairCounts['purple'] || 0 },


            { id: 'hair:green', label: '绿发', count: hairCounts['green'] || 0 }


        ],


        eyes: [


            { id: 'eye:blue', label: '蓝瞳', count: eyeCounts['blue'] || 0 },


            { id: 'eye:red', label: '红瞳', count: eyeCounts['red'] || 0 },


            { id: 'eye:brown', label: '棕瞳', count: eyeCounts['brown'] || 0 },


            { id: 'eye:green', label: '绿瞳', count: eyeCounts['green'] || 0 },


            { id: 'eye:yellow', label: '黄/金瞳', count: eyeCounts['yellow'] || 0 },


            { id: 'eye:purple', label: '紫瞳', count: eyeCounts['purple'] || 0 },


            { id: 'eye:pink', label: '粉瞳', count: eyeCounts['pink'] || 0 }


        ],


        popularity: [


            { id: 'pop:legend', label: '传奇角色 (1万+)', count: ANIMA_CHAR_DB.filter(c => c.post_count >= 10000).length },


            { id: 'pop:famous', label: '热门角色 (5千+)', count: ANIMA_CHAR_DB.filter(c => c.post_count >= 5000 && c.post_count < 10000).length },


            { id: 'pop:notable', label: '知名角色 (1千+)', count: ANIMA_CHAR_DB.filter(c => c.post_count >= 1000 && c.post_count < 5000).length },


            { id: 'pop:active', label: '活跃角色 (100+)', count: ANIMA_CHAR_DB.filter(c => c.post_count >= 100 && c.post_count < 1000).length },


            { id: 'pop:newcomer', label: '新锐角色 (<100)', count: ANIMA_CHAR_DB.filter(c => c.post_count < 100).length },


        ],


        features: pickerExtractFeatures(),


        copies: topCopies


    };


}





function pickerNameInitials(name) {


    return (name || '').toLowerCase().split(/[\s()]+/).filter(Boolean).map(w => w[0]).join('');


}





// ── 过滤 & 排序 ──────────────────────────────────────────────────────





function pickerFilterChars() {


    const q = (document.getElementById('pickerSearch')?.value || '').toLowerCase().trim();


    let list = ANIMA_CHAR_DB.filter(c => {


        if (pickerCategory === 'history') {


            if (!pickerHistory.includes(c.name)) return false;


        } else if (q) {


            const initials = pickerNameInitials(c.name);


            if (!c.name.toLowerCase().includes(q) &&


                !(c.copyright || '').toLowerCase().includes(q) &&


                !(c.trigger || '').toLowerCase().includes(q) &&


                !initials.includes(q)) return false;


        }


        if (pickerCategory === 'all' || pickerCategory === 'history') return true;


        if (pickerCategory === 'favorites') return pickerFavorites.includes(c.name);


        if (pickerCategory.startsWith('gender:')) return c.gender === pickerCategory.replace('gender:', '');


        if (pickerCategory.startsWith('hair:')) return c.hair === pickerCategory.replace('hair:', '');


        if (pickerCategory.startsWith('eye:')) return c.eye === pickerCategory.replace('eye:', '');


        if (pickerCategory.startsWith('copy:')) return (c.copyright || '').toLowerCase() === pickerCategory.replace('copy:', '').toLowerCase();


        if (pickerCategory.startsWith('pop:')) {


            const pop = pickerCategory.replace('pop:', '');


            if (pop === 'legend') return c.post_count >= 10000;


            if (pop === 'famous') return c.post_count >= 5000 && c.post_count < 10000;


            if (pop === 'notable') return c.post_count >= 1000 && c.post_count < 5000;


            if (pop === 'active') return c.post_count >= 100 && c.post_count < 1000;


            if (pop === 'newcomer') return c.post_count < 100;


        }


        if (pickerCategory.startsWith('feat:')) {


            const feat = pickerCategory.replace('feat:', '');


            return (c.tags || []).some(t => {


                const mapped = PICKER_FEATURE_MAP[t.toLowerCase().trim()];


                return mapped === feat;


            });


        }


        return true;


    });


    if (pickerSortType === 'name') {


        list.sort((a, b) => pickerSortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));


    } else if (pickerSortType === 'copyright') {


        list.sort((a, b) => {


            const cmp = (a.copyright || '').localeCompare(b.copyright || '');


            if (cmp !== 0) return pickerSortAsc ? cmp : -cmp;


            return pickerSortAsc ? a.post_count - b.post_count : b.post_count - a.post_count;


        });


    } else {


        list.sort((a, b) => pickerSortAsc ? a.post_count - b.post_count : b.post_count - a.post_count);


    }


    return list;


}





// ── 渲染侧栏 ────────────────────────────────────────────────────────





function pickerRenderCategories() {


    const cats = pickerBuildCategories();


    const el = document.getElementById('pickerCategories');


    if (!el) return;


    let html = '';


    html += '<div class="picker-cat-header' + (pickerCategory === 'all' ? ' active' : '') + '" onclick="pickerSetCategory(\'all\')"><span>全部角色</span><span class="count">' + cats.total + '</span></div>';


    html += '<div class="picker-cat-header" style="margin-top: 16px;"><span>我的自定义分组</span><span style="margin-left: auto; font-size: 16px; color: #4ade80; cursor: pointer;">+</span></div>';


    html += '<div class="picker-cat-header' + (pickerCategory === 'favorites' ? ' active' : '') + '" onclick="pickerSetCategory(\'favorites\')"><span>默认收藏</span><span class="count">' + pickerFavorites.length + '</span>' + (pickerFavorites.length > 0 ? '<span class="picker-cat-clear" onclick="pickerClearList(\'favorites\', event)" title="清空收藏">×</span>' : '') + '</div>';


    html += '<div class="picker-cat-header' + (pickerCategory === 'history' ? ' active' : '') + '" onclick="pickerSetCategory(\'history\')"><span>最近使用</span><span class="count">' + pickerHistory.length + '</span>' + (pickerHistory.length > 0 ? '<span class="picker-cat-clear" onclick="pickerClearList(\'history\', event)" title="清空历史">×</span>' : '') + '</div>';


    const groups = [


        { key: 'popularity', title: '热度分级', items: cats.popularity },


        { key: 'feature', title: '角色特征', items: cats.features },


        { key: 'gender', title: '角色性别', items: cats.genders },


        { key: 'hair', title: '角色发色', items: cats.hairs },


        { key: 'eye', title: '角色瞳色', items: cats.eyes },


        { key: 'copy', title: '热门作品系列', items: cats.copies }


    ];


    groups.forEach(g => {


        html += '<div class="picker-cat-group">';


        html += '<div class="picker-cat-group-title" onclick="pickerToggleFold(\'' + g.key + '\')"><span>' + g.title + '</span><span class="arrow' + (pickerFoldState[g.key] ? ' collapsed' : '') + '">&#9660;</span></div>';


        html += '<div class="picker-cat-group-items' + (pickerFoldState[g.key] ? ' collapsed' : '') + '" style="max-height: ' + (g.key === 'copy' ? '1200px' : '600px') + ';">';


        g.items.forEach(item => {


            html += '<div class="picker-cat-item' + (pickerCategory === item.id ? ' active' : '') + '" onclick="pickerSetCategory(\'' + item.id.replace(/'/g, "\\'") + '\')"><span>' + item.label + '</span><span class="count">' + item.count + '</span></div>';


        });


        html += '</div></div>';


    });


    el.innerHTML = html;


}





// ── 渲染网格 ─────────────────────────────────────────────────────────





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





    grid.innerHTML = '<div class="picker-grid">' +


        pageItems.map(c => {


            const sel = pickerSelected.includes(c.name);


            const isFav = pickerFavorites.includes(c.name);


            const imgUrl = pickerImgUrl(c.name, c.copyright, c.trigger, c.thumb_url);


            const safeCopyright = (c.copyright || '').replace(/'/g, "\\'");


            const safeCopyrightAttr = (c.copyright || '').replace(/"/g, '&quot;');


            const safeName = c.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');


            // 标签预览（最多显示 3 个）


            const tagPreview = (c.tags || []).slice(0, 3).join(', ');


            return '<div class="picker-char-card' + (sel ? ' is-selected' : '') + '" data-name="' + c.name.replace(/"/g, '&quot;') + '" onclick="pickerToggle(\'' + safeName + '\')" ondblclick="pickerDetailOpen(\'' + safeName + '\')">' +


                '<div class="picker-char-cover"><img src="' + imgUrl + '" alt="' + c.name + '" loading="lazy" onerror="pickerImgOnError(this)">' +


                '<div class="picker-char-select"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +


                '<button class="picker-char-fav" onclick="pickerToggleFav(\'' + safeName + '\', event)" title="收藏"><svg width="14" height="14" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></button>' +


                '</div>' +


                '<div class="picker-char-info"><div class="picker-char-name" title="' + c.name.replace(/"/g, '&quot;') + '">' + c.name + '</div><div class="picker-char-meta">' +


                (c.copyright ? '<span class="picker-char-series" title="点击查看「' + safeCopyrightAttr + '」系列所有角色" onclick="pickerJumpToSeries(event, \'' + safeCopyright + '\')">' + (PICKER_COPYRIGHT_CN[c.copyright] || _slugToReadable(c.copyright)) + '</span>' : '') +


                '<span class="picker-char-count" title="' + c.post_count.toLocaleString() + ' 插画投稿">' + pickerCompactNumber(c.post_count) + '</span></div>' +


                (tagPreview ? '<div class="picker-char-tags" title="' + (c.tags || []).join(', ').replace(/"/g, '&quot;') + '">' + tagPreview + (c.tags && c.tags.length > 3 ? '…' : '') + '</div>' : '') +


                '</div></div>';


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





// ── 详情面板 ─────────────────────────────────────────────────────────





function pickerDetailOpen(name) {


    const char = ANIMA_CHAR_DB.find(c => c.name === name);


    if (!char) return;


    const panel = document.getElementById('pickerDetailPanel');


    if (!panel) return;





    const trigger = char.trigger || char.name;


    const tags = char.tags || [];


    const fullImg = pickerFullImgUrl(trigger);


    const thumbImg = pickerImgUrl(char.name, char.copyright, char.trigger, char.thumb_url);





    let tagsHtml = tags.map(t =>


        '<span class="pd-tag" onclick="pickerDetailCopyTag(\'' + t.replace(/'/g, "\\'") + '\')" title="点击复制">' + t + '</span>'


    ).join('');





    panel.innerHTML = `


        <div class="pd-header">


            <div class="pd-title">${char.name.replace(/</g, '&lt;')}</div>


            <button class="pd-close" onclick="pickerDetailClose()" title="关闭">×</button>


        </div>


        <div class="pd-body">


            <div class="pd-img-wrap">


                <img class="pd-img" src="${fullImg}" alt="${char.name}" onerror="this.src='${thumbImg}'; this.onerror=null;">


            </div>


            <div class="pd-section">


                <div class="pd-label">Trigger（角色触发词）</div>


                <div class="pd-trigger-row">


                    <code class="pd-trigger">${trigger.replace(/</g, '&lt;')}</code>


                    <button class="pd-copy-btn" onclick="pickerDetailCopyTrigger()" title="复制 Trigger">📋</button>


                </div>


            </div>


            <div class="pd-section">


                <div class="pd-label">特征标签（点击单个复制）</div>


                <div class="pd-tags">${tagsHtml || '<span style="color:#666">暂无标签数据</span>'}</div>


            </div>


            <div class="pd-section pd-actions">


                <button class="pd-action-btn" onclick="pickerDetailCopyAll('trigger')">复制 Trigger</button>


                <button class="pd-action-btn" onclick="pickerDetailCopyAll('tags')">复制全部标签</button>


                <button class="pd-action-btn pd-action-primary" onclick="pickerDetailCopyAll('all')">复制全部（Trigger + 标签）</button>


            </div>


            ${char.copyright ? '<div class="pd-meta">系列: ' + char.copyright.replace(/</g, '&lt;') + ' · 投稿: ' + char.post_count.toLocaleString() + '</div>' : ''}


        </div>


    `;


    panel.classList.add('is-open');


}





function pickerDetailClose() {


    const panel = document.getElementById('pickerDetailPanel');


    if (panel) panel.classList.remove('is-open');


}





function pickerDetailCopyTrigger() {


    const char = pickerDetailGetCurrentChar();


    if (char) pickerCopyText(char.trigger || char.name, 'Trigger');


}





function pickerDetailCopyTag(tag) {


    pickerCopyText(tag, '标签');


}





function pickerDetailCopyAll(mode) {


    const char = pickerDetailGetCurrentChar();


    if (!char) return;


    const trigger = char.trigger || char.name;


    const tags = char.tags || [];


    let text = '';


    let label = '';


    if (mode === 'trigger') {


        text = trigger;


        label = 'Trigger';


    } else if (mode === 'tags') {


        text = tags.join(', ');


        label = '全部标签';


    } else {


        text = trigger + (tags.length ? ', ' + tags.join(', ') : '');


        label = 'Trigger + 标签';


    }


    pickerCopyText(text, label);


}





function pickerDetailGetCurrentChar() {


    const panel = document.getElementById('pickerDetailPanel');


    if (!panel || !panel.classList.contains('is-open')) return null;


    const title = panel.querySelector('.pd-title');


    if (!title) return null;


    return ANIMA_CHAR_DB.find(c => c.name === title.textContent) || null;


}





// ── 操作函数 ─────────────────────────────────────────────────────────





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


function pickerJumpToSeries(e, copyright) {


    e.stopPropagation();


    e.preventDefault();


    if (!copyright) return;


    pickerSetCategory('copy:' + String(copyright).toLowerCase());


    pickerShowToast('已切换到: ' + copyright, 'info');


}


function pickerGoPage(p) { pickerPage = p; pickerRenderGrid(); }


function pickerPrevPage() { if (pickerPage > 1) { pickerPage--; pickerRenderGrid(); } }


function pickerNextPage() { pickerPage++; pickerRenderGrid(); }


function pickerShowSelectedOnly() { pickerShowSelected = !pickerShowSelected; pickerRenderGrid(); }


function pickerCopySelected() { navigator.clipboard.writeText(pickerSelected.join(', ')).then(() => pickerShowToast('已复制 ' + pickerSelected.length + ' 个角色', 'info'), () => pickerShowToast('复制失败,请检查浏览器权限', 'error')); }


function pickerClearAll() { pickerSelected = []; pickerUpdateSelectedChips(); pickerRenderGrid(); }





function pickerClearList(type, e) {


    e.stopPropagation();


    if (!confirm(type === 'favorites' ? '确定清空所有收藏？' : '确定清空所有历史记录？')) return;


    if (type === 'favorites') {


        pickerFavorites = [];


        localStorage.removeItem('anima-char-favorites');


    } else {


        pickerHistory = [];


        localStorage.removeItem('anima-char-history');


    }


    pickerRenderCategories();


    pickerRenderGrid();


    pickerShowToast(type === 'favorites' ? '收藏已清空' : '历史已清空', 'info');


}





function pickerToggleFav(name, e) {


    e.stopPropagation();


    const idx = pickerFavorites.indexOf(name);


    if (idx > -1) pickerFavorites.splice(idx, 1);


    else pickerFavorites.push(name);


    localStorage.setItem('anima-char-favorites', JSON.stringify(pickerFavorites));


    pickerRenderGrid();


    pickerRenderCategories();


}





// 应用模式状态


let pickerApplyModeType = 'name'; // name | trigger | all





function pickerGetApplyText() {


    if (pickerSelected.length === 0) return '';


    // 根据模式查找对应的角色数据


    const chars = pickerSelected.map(name => ANIMA_CHAR_DB.find(c => c.name === name)).filter(Boolean);


    if (pickerApplyModeType === 'trigger') {


        // Trigger 模式：只输出 trigger


        return chars.map(c => c.trigger || c.name).join(', ');


    } else if (pickerApplyModeType === 'all') {


        // 全部模式：trigger + 所有标签


        return chars.map(c => {


            const trigger = c.trigger || c.name;


            const tags = (c.tags || []).join(', ');


            return tags ? trigger + ', ' + tags : trigger;


        }).join(', ');


    }


    // 名称模式（默认）


    return pickerSelected.join(', ');


}





function pickerApply() {


    if (pickerSelected.length > 0) {


        pickerSelected.slice().reverse().forEach(name => {


            const idx = pickerHistory.indexOf(name);


            if (idx > -1) pickerHistory.splice(idx, 1);


            pickerHistory.unshift(name);


        });


        if (pickerHistory.length > PICKER_HISTORY_MAX) pickerHistory = pickerHistory.slice(0, PICKER_HISTORY_MAX);


        try { localStorage.setItem('anima-char-history', JSON.stringify(pickerHistory)); } catch (_) {}


    }


    const applyText = pickerGetApplyText();


    if (pickerCallback) {


        pickerCallback(pickerSelected.slice(), applyText);


    } else {


        const promptInput = document.getElementById('prompt');


        if (promptInput) {


            const current = promptInput.value.trim();


            const parts = current.split(',').map(p => p.trim()).filter(p => p);


            const artistParts = parts.filter(p => p.startsWith('@') || p.startsWith('by '));


            const allParts = [...artistParts, ...applyText.split(',').map(s => s.trim()).filter(s => s)];


            promptInput.value = [...new Set(allParts)].join(', ');


        }


    }


    pickerClose();


    if (typeof updatePromptTags === 'function') updatePromptTags();


}





function pickerOpen(callback) {


    pickerCallback = callback || null;


    const promptInput = document.getElementById('prompt');


    if (promptInput) {


        const parts = promptInput.value.split(',').map(p => p.trim()).filter(p => p);


        pickerSelected = parts.filter(p => !p.startsWith('@') && !p.startsWith('by '));


    }


    document.getElementById('pickerSelectedCount').textContent = pickerSelected.length;


    pickerUpdateSelectedChips();


    pickerCategory = 'all';


    pickerShowSelected = false;


    pickerPage = 1;


    pickerRenderCategories();


    pickerRenderGrid();


    const modal = document.getElementById('characterPickerModal');


    if (modal) modal.classList.add('is-open');


    document.getElementById('pickerSearch').value = '';


    document.getElementById('pickerSearchClear')?.classList.remove('visible');


    document.getElementById('pickerShowSelBtn')?.classList.remove('active');


    setTimeout(() => document.getElementById('pickerSearch')?.focus(), 100);


}





function pickerClose() {


    pickerDetailClose();


    const modal = document.getElementById('characterPickerModal');


    if (modal) modal.classList.remove('is-open');


}





// ── 初始化 ───────────────────────────────────────────────────────────





function pickerInit() {


    pickerLoadData();





    if (!document.getElementById('characterPickerModal')) {


        const modalHTML = `


        <div id="characterPickerModal" class="picker-shell">


            <div class="picker-window">


                <div class="picker-header">


                    <div class="picker-search">


                        <svg class="picker-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>


                        <input id="pickerSearch" type="text" placeholder="搜索角色名 / 作品 / Trigger / 缩写..." autocomplete="off">


                        <button id="pickerSearchClear" class="picker-search-clear" title="清空">×</button>


                    </div>


                    <div class="picker-header-right">


                        <button id="pickerFavBtn" class="picker-icon-btn" title="收藏" aria-label="收藏">


                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>


                        </button>


                        <button id="pickerCloseBtn" class="picker-icon-btn picker-close" title="关闭" aria-label="关闭">


                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>


                        </button>


                    </div>


                </div>





                <div class="picker-chipbar">


                    <div class="picker-chip-group">


                        <span class="picker-chip-label">排序</span>


                        <button id="pickerSortTypeBtn" class="picker-chip picker-sort-type-chip" title="点击切换排序类型">


                            <span class="picker-chip-text" id="pickerSortTypeText">热度</span>


                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 10 5 5 5-5"/></svg>


                        </button>


                        <button id="pickerSortDirBtn" class="picker-chip picker-sort-dir-chip" title="点击切换升降序">


                            <svg id="pickerSortDirIcon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>


                        </button>


                    </div>


                    <div class="picker-chip-sep"></div>


                    <div class="picker-chip-group">


                        <span class="picker-chip-label">视图</span>


                        <button id="pickerShowSelBtn" class="picker-chip"><span class="picker-chip-text">只看已选</span></button>


                        <button id="pickerCopyBtn" class="picker-chip"><span class="picker-chip-text">复制</span></button>


                        <button id="pickerClearBtn" class="picker-chip picker-chip-warn"><span class="picker-chip-text">清除</span></button>


                    </div>


                </div>





                <div class="picker-body">


                    <aside id="pickerCategories" class="picker-sidebar"></aside>


                    <div class="picker-main">


                        <div class="picker-toolbar">


                            <span id="pickerTotalCount" class="picker-count">共 0 个角色</span>


                            <span id="pickerPageInfo" class="picker-pageinfo"></span>


                        </div>


                        <div id="pickerGrid" class="picker-grid-wrap"></div>


                        <div class="picker-pager">


                            <button id="pickerPrevBtn" class="picker-page-btn">‹ 上一页</button>


                            <div id="pickerPages" class="picker-pages"></div>


                            <button id="pickerNextBtn" class="picker-page-btn">下一页 ›</button>


                        </div>


                    </div>


                </div>





                <div class="picker-footer">


                    <div class="picker-footer-left">


                        <button id="pickerCancelBtn" class="picker-text-btn">取消</button>


                        <div id="pickerSelectedChips" class="picker-selected-chips"></div>


                    </div>


                    <div class="picker-footer-right">


                        <div class="picker-apply-mode" id="pickerApplyMode">


                            <button class="picker-apply-mode-btn" id="pickerApplyModeBtn" title="切换应用模式">


                                <span id="pickerApplyModeText">角色名</span>


                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 10 5 5 5-5"/></svg>


                            </button>


                            <div class="picker-apply-mode-list" id="pickerApplyModeList">


                                <div class="picker-apply-mode-item active" data-mode="name">角色名</div>


                                <div class="picker-apply-mode-item" data-mode="trigger">Trigger（触发词）</div>


                                <div class="picker-apply-mode-item" data-mode="all">全部（Trigger + 标签）</div>


                            </div>


                        </div>


                        <button id="pickerApplyBtn" class="picker-fab">


                            <span>应用到节点</span>


                            <span class="picker-fab-count" id="pickerSelectedCount">0</span>


                        </button>


                    </div>


                </div>


            </div>


            <!-- 详情面板（右侧滑出） -->


            <div id="pickerDetailPanel" class="pd-panel"></div>


        </div>`;


        document.body.insertAdjacentHTML('beforeend', modalHTML);


    }





    // 事件绑定


    if (!document.getElementById('characterPickerModal').dataset.bound) {


        const modal = document.getElementById('characterPickerModal');


        modal.dataset.bound = '1';


        modal.addEventListener('click', (e) => {


            if (e.target === modal) pickerClose();


        });


        document.getElementById('pickerCloseBtn').onclick = pickerClose;


        document.getElementById('pickerCancelBtn').onclick = pickerClose;


        document.getElementById('pickerApplyBtn').onclick = pickerApply;


        // 应用模式下拉菜单


        const applyModeBtn = document.getElementById('pickerApplyModeBtn');


        const applyModeList = document.getElementById('pickerApplyModeList');


        if (applyModeBtn && applyModeList) {


            applyModeBtn.onclick = (e) => {


                e.stopPropagation();


                applyModeList.classList.toggle('is-open');


            };


            applyModeList.querySelectorAll('.picker-apply-mode-item').forEach(item => {


                item.onclick = (e) => {


                    e.stopPropagation();


                    pickerApplyModeType = item.dataset.mode;


                    document.getElementById('pickerApplyModeText').textContent = item.textContent;


                    applyModeList.querySelectorAll('.picker-apply-mode-item').forEach(i => i.classList.remove('active'));


                    item.classList.add('active');


                    applyModeList.classList.remove('is-open');


                };


            });


            // 点击外部关闭


            document.addEventListener('click', () => applyModeList.classList.remove('is-open'));


        }


        document.getElementById('pickerFavBtn').onclick = () => { pickerSetCategory('favorites'); };


        document.getElementById('pickerShowSelBtn').onclick = () => { pickerShowSelected = !pickerShowSelected; document.getElementById('pickerShowSelBtn').classList.toggle('active', pickerShowSelected); pickerRenderGrid(); };


        document.getElementById('pickerCopyBtn').onclick = pickerCopySelected;


        document.getElementById('pickerClearBtn').onclick = pickerClearAll;


        document.getElementById('pickerPrevBtn').onclick = pickerPrevPage;


        document.getElementById('pickerNextBtn').onclick = pickerNextPage;


        const searchInput = document.getElementById('pickerSearch');


        searchInput.oninput = () => {


            document.getElementById('pickerSearchClear').classList.toggle('visible', !!searchInput.value);


            pickerPage = 1; pickerRenderGrid();


        };


        document.getElementById('pickerSearchClear').onclick = () => {


            searchInput.value = '';


            document.getElementById('pickerSearchClear').classList.remove('visible');


            pickerPage = 1; pickerRenderGrid();


            searchInput.focus();


        };


        const sortTypes = [


            { value: 'post_count', label: '热度' },


            { value: 'name',       label: '名称' },


            { value: 'copyright',  label: '作品系列' }


        ];


        const typeBtn = document.getElementById('pickerSortTypeBtn');


        typeBtn.onclick = (e) => {


            e.stopPropagation();


            const i = sortTypes.findIndex(s => s.value === pickerSortType);


            const next = sortTypes[(i + 1) % sortTypes.length];


            pickerSortType = next.value;


            typeBtn.querySelector('.picker-chip-text').textContent = next.label;


            pickerPage = 1; pickerRenderGrid();


        };


        const dirBtn = document.getElementById('pickerSortDirBtn');


        const dirIcon = document.getElementById('pickerSortDirIcon');


        dirBtn.onclick = (e) => {


            e.stopPropagation();


            pickerSortAsc = !pickerSortAsc;


            dirIcon.style.transform = pickerSortAsc ? 'rotate(180deg)' : 'rotate(0deg)';


            dirBtn.title = pickerSortAsc ? '升序' : '降序';


            pickerPage = 1; pickerRenderGrid();


        };


    }


}





if (document.readyState === 'loading') {


    document.addEventListener('DOMContentLoaded', pickerInit);


} else {


    pickerInit();


}


