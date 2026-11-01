const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load() {
    const context = {window: {}, localStorage: {getItem: () => '[]'}, fetch: () => new Promise(() => {})};
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../static/modules/prompt-gallery-ui.js'), 'utf8'), context);
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../static/modules/prompt-content-library.js'), 'utf8'), context);
    return context.window.PromptContentLibrary;
}
test('画师索引复用内容包图片地址、热度和原始触发词', () => {
    const [item] = load().adapt('artists', {imageBase: 'https://example.com/', imageExt: '.avif', items: [{id:'test', tag:'@test', posts:42, img:'abc'}]});
    assert.equal(item.image, 'https://example.com/abc.avif');
    assert.equal(item.prompt, '@test');
    assert.equal(item.name, 'test');
    assert.equal(item.count, 42);
});
test('角色缩略图编码与现有选择器一致，保留索引缩略图', () => {
    const api = load();
    const [item] = api.adapt('characters', {items:[{id:'a', name:'A', trigger:"a:b/c!'*()", post_count:5}]});
    assert.equal(item.image, 'https://blobs.animadex.net/Outputs/thumbs/a_b_c%21%27%2A().webp');
    assert.equal(item.prompt, "a:b/c!'*()");
    assert.equal(api.adapt('characters', {items:[{thumb:'/custom.webp'}]})[0].image, '/custom.webp');
});
test('空库和加载态可展示，搜索及内容包错误不会依赖生成页组件', () => {
    const host = {innerHTML: '', isConnected:false, querySelector: () => null};
    load().render(host, 'characters');
    assert.match(host.innerHTML, /角色库/);
    assert.match(host.innerHTML, /内容包管理/);
    assert.match(host.innerHTML, /data-content-search/);
    assert.match(host.innerHTML, /disabled/);
});
test('共用卡片转义名称和地址，同时保留选择、收藏与各库点击入口', () => {
    const context = {window:{}};
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../static/modules/prompt-gallery-ui.js'), 'utf8'), context);
    const html = context.window.PromptGalleryUI.card({id:'a"b', name:'<script>', thumbnail:'/a"b.png'}, {attribute:'data-content-open', favorite:true});
    assert.match(html, /data-content-open="a&quot;b"/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /prompt-card-fav/);
    assert.doesNotMatch(html, /prompt-row-check/);
    const text = context.window.PromptGalleryUI.card({id:'p', name:'文字卡片'}, {selectable:true, checked:true, readonly:true});
    assert.match(text, /is-text/);
    assert.match(text, /checked disabled/);
});
test('共享列布局保留顺序，图片加载不重新分配，切换时释放观察器', () => {
    let resize;
    let disconnected = 0;
    const cards = Array.from({length:7}, (_, id) => ({id}));
    const gallery = {clientWidth:1000, style:{}, querySelectorAll:() => cards, replaceChildren(...columns) { this.columns = columns; }};
    const context = {window:{innerWidth:1200}, document:{createElement:() => ({cards:[], append(card) { this.cards.push(card.id); }})}, ResizeObserver:class {constructor(callback) {resize=callback;} observe() {} disconnect() {disconnected++;}}};
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../static/modules/prompt-gallery-ui.js'), 'utf8'), context);
    const api = context.window.PromptGalleryUI;
    api.mount(gallery);
    assert.deepEqual(Array.from(gallery.columns[0].cards), [0,3,6]);
    const columns = gallery.columns;
    resize();
    assert.equal(gallery.columns, columns);
    gallery.clientWidth = 650;
    resize();
    assert.equal(gallery.columns.length, 2);
    assert.deepEqual(Array.from(gallery.columns[0].cards), [0,2,4,6]);
    api.unmount();
    assert.equal(disconnected, 1);
});

test('画师分级边界完整覆盖，角色分类按已安装索引生成并支持组合筛选', () => {
    const api = load();
    const artists = api.adapt('artists', {items:[5000,1000,100,10,0].map((posts,i) => ({id:String(i),posts}))});
    assert.equal(api.categories('artists', artists)[0].options.length, 5);
    assert.equal(artists.filter(item => api.matchesFilters('artists', item, {tier:'知名画师'})).length, 1);
    const chars = api.adapt('characters', {items:[{id:'a',name:'A',gender:'1girl',copyright:'作品A',feat:['长发'],post_count:6000},{id:'b',name:'B',gender:'1boy',copyright:'作品A',post_count:50}]});
    assert.equal(api.categories('characters', chars).find(g => g.key === 'copyright').options[0][1], 2);
    assert.equal(chars.filter(item => api.matchesFilters('characters', item, {gender:'1girl',feat:'长发',tier:'热门角色'})).length, 1);
    assert.equal(chars.filter(item => api.matchesFilters('characters', item, {gender:'1boy',feat:'长发'})).length, 0);
});
