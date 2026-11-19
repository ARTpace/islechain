const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html=fs.readFileSync('static/app/zimage.html','utf8');
function element(tag) {
    return { tag, children:[], dataset:{}, scrollTop:0, scrollLeft:0,
        append(...nodes){this.children.push(...nodes);}, appendChild(node){this.children.push(node);},
        replaceChildren(){this.children=[];},
        setAttribute(key,value){this[key]=value;}, addEventListener(type,fn){this['on'+type]=fn;},
        querySelectorAll(){return this.children.filter(n=>n.className==='chat-text-box').map(n=>n.children[1]);},
    };
}
let copied;
const ctx={window:{},document:{createElement:element,createTextNode:text=>({textContent:text})},navigator:{clipboard:{writeText:async text=>{copied=text;}}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('static/js/canvas-agent-markdown.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('static/modules/content-preview.js','utf8'),ctx);
const start=html.indexOf('            function chatReplySegments(');
vm.runInContext(html.slice(start,html.indexOf('            function paintAssistant(',start)),ctx);
const source='说明\n```json\n{ "html": "<script>test</script>" }\n```\n结束';
const parts=ctx.chatReplySegments(source);
assert.equal(parts.length,3); assert.equal(parts[1].language,'json');
assert.equal(parts[1].code,'{ "html": "<script>test</script>" }');
assert.equal(ctx.chatReplySegments('```markdown\n# 标题\n\n内容')[0].code,'# 标题\n\n内容');
assert.equal(ctx.chatReplySegments('~~~js\nconst x=1;\n~~~')[0].language,'js');
assert.equal(ctx.chatReplySegments('{"key":1}')[0].language,'json');
assert.equal(ctx.chatReplySegments('普通回复')[0].text,'普通回复');
const host=element('div');
ctx.renderChatReply(host,source);
assert.equal(host.dataset.rawText,source);
const body=host.querySelectorAll()[0];
ctx.renderChatReply(host,source);
assert.equal(host.querySelectorAll()[0],body,'unchanged text preserves DOM instead of rebuilding');
assert.equal(body.children[0].className,'chat-json-root');
assert.equal(body.children[0].children[0].children[1].textContent,'<script>test</script>');
assert.equal(ctx.chatJsonPreview({}).textContent,'空对象');
assert.equal(ctx.chatJsonPreview([]).textContent,'空列表');
assert.equal(ctx.chatJsonPreview({nested:{value:1}}).children[0].tag,'details');
const actions=host.children[1].children[0].children[1];
assert.equal(actions.children[0].textContent,'源码');
actions.children[0].onclick();
assert.equal(body.children[0].children[0].textContent,parts[1].code);
body.scrollTop=40;body.scrollLeft=20;
ctx.renderChatReply(host,source+'!');
assert.equal(host.querySelectorAll()[0].scrollTop,40);
assert.equal(host.querySelectorAll()[0].scrollLeft,20);
assert.equal(host.querySelectorAll()[0].children[0].tag,'pre','source mode survives streaming updates');
const mdHost=element('div');
ctx.renderChatReply(mdHost,'```markdown\n# 文档标题\n\n**粗体**\n```');
assert.equal(mdHost.children[0].children[0].children[0].textContent,'文档标题');
assert.match(mdHost.querySelectorAll()[0].innerHTML,/<h3>文档标题<\/h3>/);
assert.match(mdHost.querySelectorAll()[0].innerHTML,/<strong>粗体<\/strong>/);
assert(!ctx.window.CanvasAgentMarkdown.render('<script>alert(1)</script>').includes('<script>'));
assert.equal(ctx.chatPartialJson('{"prompt":"A cute pig').prompt,'A cute pig');
assert.equal(ctx.chatPartialJson('{"scene":{"description":"温馨').scene.description,'温馨');
assert.equal(ctx.chatPartialJson('{"name":"房间","ver').name,'房间');
const partialHost=element('div');
ctx.renderChatReply(partialHost,'{"prompt":"A cute');
assert.equal(partialHost.children[0].className,'chat-text-box');
assert.equal(partialHost.querySelectorAll()[0].children[0].children[0].children[1].textContent,'A cute');
const frames=new Map(), paints=[]; let frameId=0;
ctx.setTimeout=fn=>{frames.set(++frameId,fn);return frameId;};
ctx.clearTimeout=id=>frames.delete(id);
ctx.paintAssistant=(_,text)=>paints.push(text);
ctx.scrollThread=()=>{};
const stream=ctx.createChatReplyStream({});
stream.push('这是逐字显示的文档🐷');
assert.equal(paints.length,0,'large chunks do not appear immediately');
const finished=stream.finish();
while(frames.size){const [id,fn]=frames.entries().next().value;frames.delete(id);fn();}
assert(paints.length>1);
assert.equal(paints.at(-1),'这是逐字显示的文档🐷');
assert(paints.every(text=>!/[\uD800-\uDBFF]$/.test(text)),'never split emoji');
stream.push('这是逐字显示的文档🐷，继续');
stream.stop();assert.equal(frames.size,0,'stop cancels pending renders');
finished.then(()=>{});
host.children[1].children[0].children[1].children[1].onclick().then(()=>{
    assert.equal(copied,parts[1].code);
    assert.match(fs.readFileSync('static/modules/content-preview.css','utf8'),/max-height:300px; overflow:auto/);
    console.log('Markdown/JSON 默认预览、标题、源码切换、流式模式与滚动保留、安全显示和复制检查通过');
}).catch(error=>{console.error(error);process.exitCode=1;});
