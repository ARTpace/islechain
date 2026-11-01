const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/js/asset-manager.js'), 'utf8');
function load(names, context) {
    vm.createContext(context);
    for (const name of names) {
        const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
        assert.ok(start >= 0, name);
        const tail = source.slice(start);
        const next = tail.slice(1).search(/\n(?:async )?function /);
        vm.runInContext(next < 0 ? tail : tail.slice(0, next + 1), context);
    }
    return context;
}
const escape = value => String(value || '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const flat = tag => ({dimension:'tags', tag});
test('大类、子分类、搜索和素材类型共同筛选，子分类不串到其他大类', () => {
    const one = {id:'one',name:'正面人物',kind:'image',classification:{flat:[flat('正面')]}};
    const two = {id:'two',name:'侧面人物',kind:'image',classification:{flat:[flat('侧面')]}};
    const three = {id:'three',name:'正面场景',kind:'video',classification:{flat:[flat('正面')]}};
    const cats = [{id:'people',items:[one,two]}, {id:'scenes',items:[three]}];
    const c = load(['currentAssetItems'], {assetQuery:'',assetUnclassifiedOnly:false,activeAssetCategoryId:'people',
        activeAssetSeries:'',activeAssetAngle:'',
        activeAssetClassFilter:'tags:正面',activeAssetKindFilter:'all', assetCategories:()=>cats,
        activeAssetCategory:()=>cats[0],assetClassificationFlat:i=>i.classification.flat,
        assetClassFilterKey:e=>e.dimension+':'+e.tag,assetKind:i=>i.kind,sortAssetItems:i=>i,
        assetKindLabel:i=>i.kind,assetClassificationSearchText:()=>''});
    assert.deepEqual(Array.from(c.currentAssetItems(), x=>x.id), ['one']);
    c.activeAssetCategoryId='all';
    assert.deepEqual(Array.from(c.currentAssetItems(), x=>x.id), ['one','three']);
    c.activeAssetKindFilter='image';
    assert.deepEqual(Array.from(c.currentAssetItems(), x=>x.id), ['one']);
    c.assetQuery='侧面';
    assert.equal(c.currentAssetItems().length,0);
});
test('缩略图列表不读取原图，点击详情后才展示原图且保留原有编辑入口', () => {
    const item={id:'one',name:'人物 <一>',url:'https://example.com/full.png',thumbnail:'/cached.webp',kind:'image'};
    const c = load(['renderAssetCard','renderAssetDialog'], {window:{},assetDialogId:'',selectedAssetId:'one',
        selectedAssetIds:new Set(),assetKind:i=>i.kind,assetKindLabel:()=> '图片',
        findAssetItem:()=>item,escapeHtml:escape,escapeAttr:escape,renderAssetDetail:()=>'<button data-asset-edit-start="one">编辑</button>'});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/modules/prompt-gallery-ui.js'),'utf8'),c);
    assert.match(c.renderAssetCard(item),/src="\/cached.webp"/);
    assert.doesNotMatch(c.renderAssetCard(item),/full.png/);
    assert.equal(c.renderAssetDialog(),'');
    c.assetDialogId='one';
    const html=c.renderAssetDialog();
    assert.match(html,/role="dialog" aria-modal="true"/);
    assert.match(html,/src="https:\/\/example.com\/full.png"/);
    assert.match(html,/data-asset-edit-start/);
    assert.doesNotMatch(html,/人物 <一>/);
});
test('普通点击打开详情，批量模式点击只切换勾选，复选框交给 change 事件', async () => {
    const c=load(['handleClick'],{assetDialogId:'',assetManageMode:false,selectedAssetIds:new Set(),
        render:()=>{}, root:{querySelector:()=>({focus(){}})}});
    const event = checkbox => ({target:{closest:selector => selector==='[data-asset-card]'
        ? {dataset:{assetCard:'one'}} : checkbox && selector==='[data-asset-check]' ? {} : null,matches:()=>false}});
    await c.handleClick(event(false));
    assert.equal(c.assetDialogId,'one');
    c.assetDialogId=''; c.assetManageMode=true;
    await c.handleClick(event(false));
    assert.equal(c.assetDialogId,'');
    assert.ok(c.selectedAssetIds.has('one'));
    await c.handleClick(event(false));
    assert.ok(!c.selectedAssetIds.has('one'));
    await c.handleClick(event(true));
    assert.equal(c.selectedAssetIds.size,0);
});

test('来源按仓库归并，切换图鉴只展示当前库，姿势以系列组织', () => {
    const libs=[{id:'local',name:'默认资产库'},
        {id:'poses',name:'PoseAtlas · 姿势',repository_source:'https://raw.githubusercontent.com/a/atlas/main/'},
        {id:'costumes',name:'PoseAtlas · 衣装',repository_source:'https://raw.githubusercontent.com/a/atlas/main/'},
        {id:'other',name:'其他平台',repository_source:'https://raw.githubusercontent.com/b/other/main/'}];
    const item={pose_id:'p1',repository_id:'p1:front',classification:{tags:['站姿','上半身单人']}};
    const c=load(['assetSourceKey','assetPoseSeries','assetPoseAngle','assetSeriesEntries','renderAssetSourceNavigation','renderAssetPrimaryCategories'],{
        assetLibraries:()=>libs,activeAssetLibrary:()=>libs[1],activeAssetLibraryId:'poses',activeAssetSeries:'',
        assetCategories:()=>[{items:[item]}],assetCountForLibrary:()=>1,assetManageMode:false,
        escapeHtml:escape,escapeAttr:escape});
    const nav=c.renderAssetSourceNavigation();
    assert.doesNotMatch(nav,/<select|<option/);
    assert.equal((nav.match(/data-asset-lib=/g)||[]).length,4);
    assert.match(nav,/data-asset-lib="poses"/);
    assert.match(nav,/data-asset-lib="costumes"/);
    assert.doesNotMatch(nav,/a \/ atlas|b \/ other|PoseAtlas/);
    assert.equal(c.assetPoseSeries(item),'上半身单人');
    assert.equal(c.assetPoseAngle(item),'front');
    const tree=c.renderAssetPrimaryCategories();
    assert.match(tree,/data-asset-series="上半身单人"/);
    assert.doesNotMatch(tree,/data-asset-cat=/);
});
test('系列和角度筛选同时生效，同一姿态分类不混入其他系列', () => {
    const items=[{id:'1',pose_id:'p1',repository_id:'p1:front',classification:{tags:['站姿','标准']}},
        {id:'2',pose_id:'p2',repository_id:'p2:front',classification:{tags:['站姿','上半身']}},
        {id:'3',pose_id:'p1',repository_id:'p1:side',classification:{tags:['站姿','标准']}}];
    const c=load(['assetPoseSeries','assetPoseAngle','currentAssetItems'],{
        assetQuery:'',assetUnclassifiedOnly:false,activeAssetCategoryId:'standing',activeAssetClassFilter:'',
        activeAssetSeries:'标准',activeAssetAngle:'front',activeAssetKindFilter:'all',
        activeAssetCategory:()=>({items}),sortAssetItems:i=>i});
    assert.deepEqual(Array.from(c.currentAssetItems(),x=>x.id),['1']);
    c.activeAssetAngle='';
    assert.deepEqual(Array.from(c.currentAssetItems(),x=>x.id),['1','3']);
});
