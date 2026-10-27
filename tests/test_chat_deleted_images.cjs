// 历史画廊加载不能重新导入图片；结果只属于发起生成时的回复。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const page = fs.readFileSync(path.join(__dirname, '../static/app/zimage.html'), 'utf8');
const start = page.indexOf("            window.addEventListener('studio-gen-complete'");
const end = page.indexOf('            function clearSparePending(', start);
assert.ok(start >= 0 && end > start);
const listeners = {};
const imported = [];
const context = vm.createContext({
    armed:true,
    window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},
    thread:{contains:target=>target.inThread},
    addImage:(src,target)=>imported.push({src,target}),
});
vm.runInContext(page.slice(start,end),context);
const receive = listeners['studio-gen-complete'];
const target = {isConnected:true,inThread:true};
receive({detail:{record:{images:['fresh-1.png','fresh-2.png']},target}});
assert.equal(imported.length,2);
assert.equal(imported[0].target,target);
// 删除原回复、切换会话后返回的结果均不得附加到其他回复。
receive({detail:{record:{images:['deleted.png']},target:{isConnected:false,inThread:false}}});
receive({detail:{record:{images:['other-chat.png']},target:{isConnected:true,inThread:false}}});
receive({detail:{record:{images:['no-owner.png']}}});
assert.equal(imported.length,2);
context.armed=false;
receive({detail:{record:{images:['not-chat.png']},target}});
assert.equal(imported.length,2);
// 回归根因：不再通过扫描所有画廊图片推断生成结果。
assert.doesNotMatch(page,/if \(!armed\) return;\s*masonry.querySelectorAll\('img'\)/);
assert.equal((page.match(/studio-gen-complete', \{ detail: \{ record, target: chatResultTarget \}/g)||[]).length,2);
assert.match(page,/window\.__chatResultTarget = host/);
for(const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2]);
}
console.log('对话删除回归：历史图不重导入、逐回复归属、删除/切换会话后迟到结果隔离通过');
