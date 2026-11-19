const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync('static/app/zimage.html','utf8');
const ctx = {};
vm.createContext(ctx);
const start = html.indexOf('            function chatControlSuffix(');
vm.runInContext(html.slice(start,html.indexOf('            // 思考过程',start)),ctx);
const imageStart = html.indexOf('            function readImageSpec(');
vm.runInContext(html.slice(imageStart,html.indexOf('            function imageKey(',imageStart)),ctx);
for (const text of [
    '当然可以\n\n```markdown\n# 标题\n\n- 内容\n```\n\n结束',
    '```json\n{"name":"示例","prompt":"只是数据"}\n```',
    '{"name":"示例","prompt":"只是数据"}',
    '第一节\n\n***\n\n第二节',
    '开头\n\n' + '这是普通的长段落。'.repeat(30),
    '```text\nIMAGE {"prompt":"示例，不生成"}\n```',
    '~~~text\nIMAGE {"prompt":"未闭合的示例"}',
    '未完成\nIMAGE {"prompt":',
]) {
    assert.equal(ctx.splitChatReply(text).reply,text);
    assert.equal(ctx.splitChatReply(text).prompt,'');
    assert.equal(ctx.readImageSpec(text),null);
}
const text='说明\n\n```json\n{"key":1}\n```\n\nIMAGE {"prompt":"a cat"}';
for(const suffix of ['IMAGE','IMAGE {','IMAGE {"prompt":"a pig','IMAGE {"prompt":"a pig"}']) {
    assert.equal(ctx.splitChatReply('马上绘制\n'+suffix,true).reply,'马上绘制','control streaming never expands the reply');
}
assert.equal(ctx.splitChatReply('```text\nIMAGE {"prompt":"example',true).reply,'```text\nIMAGE {"prompt":"example');
assert.equal(ctx.splitChatReply(text).reply,'说明\n\n```json\n{"key":1}\n```');
assert.equal(ctx.splitChatReply(text).prompt,'a cat');
assert.equal(ctx.visibleReply('设置完成\nPARAMS {"params":{"steps":20}}'),'设置完成');
const pig = '{"prompt":"A cute pig, whimsical style, warm colors, simple shapes"}';
assert.equal(ctx.readImageSpec(pig,'生成一只猪图片').prompt,JSON.parse(pig).prompt);
assert.equal(ctx.readImageSpec(pig,'生成一张竖版的鸡头人').prompt,JSON.parse(pig).prompt);
assert.equal(ctx.readImageSpec(pig,'生成两张横版的小猪').prompt,JSON.parse(pig).prompt);
assert.equal(ctx.readImageSpec('```json\n'+pig+'\n```','帮我画一只猪').prompt,JSON.parse(pig).prompt);
for (const request of ['', '解释这个 JSON', '不要生成图片，只给我 JSON', '生成一个JSON示例']) {
    assert.equal(ctx.readImageSpec(pig,request),null);
}
assert.equal(ctx.readImageSpec('{"prompt":""}','生成一张图片'),null);
assert.equal(ctx.readImageSpec('示例：\n'+pig,'生成一张图片'),null);
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if(!/\bsrc\s*=|type\s*=\s*["'](?:module|importmap|application\/json)/.test(m[1])) new vm.Script(m[2]);
}
console.log('Markdown/JSON、分隔线、长段落、流式代码示例保留及生图指令隔离检查通过');
const nodes=[];
ctx.document={createElement(){const node={children:[],append(...items){this.children.push(...items);},remove(){this.removed=true;}};nodes.push(node);return node;}};
ctx.chatBusy=false;
ctx.chatParameterContext=()=>({engine:'cloud',model:'test'});
let submitted=0;
ctx.applyChatParameters=()=>{};ctx.showPending=()=>{};
ctx.drawWithConsole=async spec=>{assert.equal(spec.prompt,'pig');submitted++;};
const bubble={appendChild(node){this.actions=node;}};
ctx.offerChatImageGeneration(bubble,{prompt:'pig'},[],{engine:'cloud',model:'test'});
assert.equal(submitted,0,'ambiguous reply never generates before confirmation');
bubble.actions.children[2].onclick();
assert.equal(bubble.actions.removed,true);
ctx.offerChatImageGeneration(bubble,{prompt:'pig'},[],{engine:'cloud',model:'test'});
bubble.actions.children[1].onclick().then(()=>{
    assert.equal(submitted,1,'one click submits the prepared prompt');
    assert.equal(ctx.chatBusy,false);
}).catch(error=>{console.error(error);process.exitCode=1;});
