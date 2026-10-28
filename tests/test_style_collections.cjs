const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app/preset-picker.js', 'utf8');
const rules = source.slice(source.indexOf('const _styleCollections ='), source.indexOf('let _stylePickerData ='));
const context = vm.createContext({});
vm.runInContext(rules, context);
const classify = (name, category = 'misc', id = 'opennana_example') => context._styleCollection({ name, id }, category);
assert.equal(classify('3D卡通少女表情贴纸组', 'anime_manga'), 'stickers');
assert.equal(classify('2027年韩系手绘日历海报', 'film_cinema'), 'poster');
assert.equal(classify('老照片修复与色彩还原', 'photography'), 'edit');
assert.equal(classify('3D人物角色设定图', 'anime_manga'), 'character');
assert.equal(classify('普通照片', 'photography'), 'photo');
assert.equal(classify('无法判断的创作'), 'review');
assert.equal(classify('sai-cinematic', 'sai', 'sai_cinematic'), 'style');
assert.equal(classify('街头直闪写实摄影'), 'photo');
assert.equal(classify('简约黑笔手绘涂鸦插画'), 'painting');
assert.equal(classify('东亚少女自然抓拍'), 'photo');
assert.equal(context._styleCollection({ name: '枫影织秋', id: 'yuanbao_example' }, 'yuanbao', '写实人像'), 'portrait');
assert.equal(context._styleCollection({ name: '竹影淡月', id: 'yuanbao_example' }, 'yuanbao', '海报设计'), 'poster');
const collectionIds = vm.runInContext('_styleCollections.map(([id]) => id)', context);
assert.equal(new Set(collectionIds).size, collectionIds.length);
assert.equal(classify('2026世界杯女球迷故事板'), 'storyboard');
assert.equal(classify('跑车机械细节'), 'vehicle');
assert.equal(classify('海豚与虎鲸', 'misc', 'opennana_animal'), 'review');
assert.equal(classify('几何原色美学'), 'concept');
assert.equal(classify('精准构建YAML格式提示词'), 'assistant');
assert.equal(context._styleCollection({ id: 'opennana_test', name: '竹影', prompt: '负面：年轻女性，水彩画' }, 'misc'), 'review');
assert.equal(context._styleCollection({ id: 'opennana_test', name: '童绘', prompt: '采用儿童绘本画风与丙烯笔刷' }, 'misc'), 'painting');
const data = JSON.parse(fs.readFileSync('data/style-presets.json', 'utf8'));
const counts = {};
let total = 0;
for (const c of data.categories) for (const s of c.subcategories) for (const p of s.presets) {
    const before = JSON.stringify(p);
    const key = context._styleCollection(p, c.id, s.name);
    assert.ok(vm.runInContext('_styleCollections', context).some(([id]) => id === key));
    assert.equal(JSON.stringify(p), before);
    counts[key] = (counts[key] || 0) + 1;
    total++;
}
assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), total);
// 跨来源按新分类筛选，仍使用旧 category_id 识别已选项。
context._flatIndex = [
    { id: 'a', _type: 'style', _collection: 'poster', category_id: 'style_commercial', _subcats: [] },
    { id: 'b', _type: 'style', _collection: 'poster', category_id: 'style_yuanbao', _subcats: [] }
];
Object.assign(context, {
    presetPickerFrozenOrder: null, _presetMode: 'style', presetPickerCategory: 'collection_poster',
    presetPickerSubcategory: 'all', presetPickerShowSelected: false, presetPickerSelected: [],
    document: { getElementById: () => null }
});
vm.runInContext(source.slice(source.indexOf('function _getFilteredPresets()'), source.indexOf('function presetPickerRenderCategories()')), context);
assert.equal(context._getFilteredPresets().length, 2);
context.presetPickerShowSelected = true;
context.presetPickerSelected = [{ id: 'b', category_id: 'style_yuanbao' }];
assert.equal(context._getFilteredPresets()[0].id, 'b');
context.presetPickerShowSelected = false;
context.presetPickerCategory = 'commercial';
assert.equal(context._getFilteredPresets()[0].id, 'a');
context._flatIndex.push({ id: 'opennana_new', _type: 'style', _collection: 'poster', category_id: 'style_commercial', _subcats: [] });
assert.equal(context._getFilteredPresets().length, 1);
context.presetPickerCategory = 'opennana';
assert.equal(context._getFilteredPresets()[0].id, 'opennana_new');
context.presetPickerSubcategory = 'poster';
assert.equal(context._getFilteredPresets().length, 1);
context.presetPickerSubcategory = 'portrait';
assert.equal(context._getFilteredPresets().length, 0);
console.log(JSON.stringify({ total, counts }));
console.log('分类规则及原始数据保留检查通过');
