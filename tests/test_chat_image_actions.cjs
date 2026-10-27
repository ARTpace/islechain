const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const card = read('static/modules/gallery/card.js');
const start = card.indexOf('    function mountDownloadAction(');
const end = card.indexOf('    global.GalleryCard =', start);
const hosts = [[], []];
let shown, favorite, downloaded;
const context = vm.createContext({
    BTN_INLINE:'shared-button-style;', FAV_OUT_SVG:'shared-star', ICONS:{download:'download-icon'},
    document:{createElement:()=>({style:{}, dataset:{}, events:{}, classList:{toggle(){}}, setAttribute(){}, addEventListener(name,fn){this.events[name]=fn;}})},
    global:{__galleryFavorites:new Set(), GalleryActions:{viewPrompt:record=>{shown=record;}, downloadImage:(...args)=>{downloaded=args;}}, GalleryDisplay:{Favorites:{toggle:url=>{favorite=url;}}}},
});
vm.runInContext(card.slice(start,end),context);
const records = [{prompt:'第一张'}, {prompt:'第二张'}];
hosts.forEach((nodes,index)=>context.mountImageActions({appendChild:node=>nodes.push(node)},()=>records[index],`/image${index}.png`));
let stopped=0;
hosts[1][0].events.click({stopPropagation:()=>stopped++});
hosts[1][1].events.click({stopPropagation:()=>stopped++});
assert.equal(shown,records[1]);
assert.equal(favorite,'/image1.png');
assert.equal(stopped,2);
hosts[1][2].events.click({stopPropagation:()=>stopped++});
assert.equal(downloaded[0], '/image1.png');
assert.equal(downloaded[1], 'image1.png');
assert.equal(stopped,3);
assert.match(hosts[1][2].style.cssText,/right:8px;bottom:8px/);
assert.match(hosts[0][0].style.cssText,/left:12px;bottom:12px/);
assert.match(hosts[0][1].style.cssText,/right:12px;top:12px/);
assert.equal(hosts[1][1].dataset.favUrl,'/image1.png');
const page=read('static/app/zimage.html');
for(const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2]);
}
assert.equal((page.match(/generation_time_ms: Date.now\(\) - generationStartedAt/g)||[]).length,2);
assert.match(page,/slot.replaceWith\(card\)/);
assert.match(page,/row.appendChild\(card\)/);
const bundle=read('static/modules/gallery/bundle.js');
assert.ok(bundle.includes(card.slice(start,end).trim()));
new vm.Script(bundle);
console.log('对话图片：逐图信息、逐图收藏、按钮位置、计时接入及脚本语法检查通过');
