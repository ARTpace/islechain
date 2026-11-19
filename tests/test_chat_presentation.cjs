const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function element(tag) {
    return {tag, children:[], style:{}, events:{}, textContent:'', scrollHeight:200, scrollTop:0, clientHeight:200,
        setAttribute(key,value){this[key]=value;}, addEventListener(name,fn){this.events[name]=fn;},
        appendChild(node){this.children.push(node);}, append(...nodes){this.children.push(...nodes);},
        insertBefore(node){this.children.unshift(node);}, remove(){this.removed=true;},
        querySelector(selector){return this.children.find(child => !child.removed && '.'+child.className === selector) || null;}
    };
}
const ctx={window:{},document:{createElement:element}};
vm.createContext(ctx);
for (const name of ['chat-media','chat-transcript']) vm.runInContext(fs.readFileSync(`static/modules/${name}.js`,'utf8'),ctx);
let zoomTarget;
const {card,img}=ctx.window.ChatMedia.createImage({src:'/original.png',ratio:'16 / 9',previewSrc:()=>'/thumbnail.png',bindZoom:node=>zoomTarget=node});
assert.equal(card.style.aspectRatio,'16 / 9');
assert.equal(img.src,'/thumbnail.png');
assert.equal(img['data-original-src'],'/original.png');
assert.equal(zoomTarget,img);
img.naturalWidth=600; img.naturalHeight=800; img.events.load();
assert.equal(card.style.aspectRatio,'600 / 800','actual image ratio overrides requested ratio');
const other=ctx.window.ChatMedia.createImage({src:'/second.png'});
assert.equal(other.img.src,'/second.png');
assert.equal(other.card.style.aspectRatio,'1 / 1');
const bubble=element('div');
const paint=ctx.window.ChatTranscript.paintThinking;
paint(bubble,'a\r\n\n\nb  ');
const thinking=bubble.querySelector('.chat-think');
assert.equal(thinking.open,undefined,'thinking starts collapsed');
assert.equal(thinking.querySelector('.chat-think-body').textContent,'a\n\nb');
paint(bubble,'next');
assert.equal(bubble.children.length,1,'streaming updates reuse the existing thinking panel');
paint(bubble,'');
assert.equal(thinking.removed,true);
console.log('Chat presentation: natural image ratio, original URL and thinking updates passed');
