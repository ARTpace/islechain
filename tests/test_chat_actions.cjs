const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const timers = new Map(); let timerId = 0;
function node(className = '') {
    const el = {className, dataset:{}, children:[], events:{}, textContent:'',
        addEventListener:(name, fn) => el.events[name]=fn,
        appendChild(child) {child.remove(); child.parentElement=el; el.children.push(child);},
        remove() {if (el.parentElement) el.parentElement.children=el.parentElement.children.filter(child=>child!==el);},
        closest(selector) {return el.matches(selector) ? el : el.parentElement?.closest(selector);},
        matches(selector) {return selector==='button' ? el.tag==='button' : selector.startsWith('[data-act=')
            ? el.dataset.act===selector.match(/"([^"]+)"/)[1] : el.className.split(' ').includes(selector.slice(1));},
        querySelectorAll(selector) {return el.children.flatMap(child => [...(child.matches(selector)?[child]:[]), ...child.querySelectorAll(selector)]);},
        querySelector(selector) {return el.querySelectorAll(selector.replace(':scope > ',''))[0] || null;}
    };
    el.classList = {contains:value=>el.className.split(' ').includes(value),
        add:value=>{el.className+=' '+value;}, remove:value=>{el.className=el.className.split(' ').filter(v=>v!==value).join(' ');}};
    Object.defineProperty(el,'innerHTML',{set(value) {
        el.children=[];
        for (const match of value.matchAll(/<(button|pre)\b([^>]*)>/g)) {
            const child=node(match[2].match(/class="([^"]*)"/)?.[1]); child.tag=match[1];
            child.dataset.act=match[2].match(/data-act="([^"]*)"/)?.[1];
            el.appendChild(child);
        }
    }});
    return el;
}
const listeners = new Set();
const document = {createElement:()=>node(), addEventListener:(_,fn)=>listeners.add(fn), removeEventListener:(_,fn)=>listeners.delete(fn)};
const window = {document};
vm.runInNewContext(fs.readFileSync('static/modules/chat-actions.js','utf8'), {window,
    setTimeout:fn=>{timers.set(++timerId,fn); return timerId;}, clearTimeout:id=>timers.delete(id)});
const click = {stopPropagation(){}};
(async () => {
    let resent, input, copied, viewed=0, deleted=0;
    const thread=node(), row=node('chat-row user'), foot=node('chat-user-foot');
    row.dataset.chatText='保留原文'; row._chatRefs=[{url:'/original.png'}]; row.appendChild(foot); thread.appendChild(row);
    const asst=node('chat-row'), stack=node('chat-stack'), bubble=node('chat-asst');
    asst.previousElementSibling=row; asst.appendChild(stack); stack.appendChild(bubble); thread.appendChild(asst);
    const reply=node('chat-reply'); reply.dataset.rawText='**原始格式**'; bubble.appendChild(reply);
    const actions=window.ChatActions.create({thread, onResend:value=>resent=value, onToInput:async value=>input=value,
        onViewPrompt:()=>viewed++, onDelete:()=>deleted++, copyText:async text=>copied=text});
    actions.ensureUserActions(row); actions.ensureUserActions(row);
    assert.equal(foot.children.length,1,'mount once');
    foot.querySelector('[data-act="resend"]').events.click(click);
    assert.equal(resent.text,row.dataset.chatText); assert.equal(resent.refs,row._chatRefs);
    await foot.querySelector('[data-act="to-input"]').events.click(click); assert.equal(input,row);
    actions.ensureChatActions(bubble,'图片提示词'); actions.ensureChatActions(bubble);
    assert.equal(stack.querySelectorAll('.chat-prompt').length,1);
    const box=actions.chatActionBox(bubble);
    assert.equal(box.querySelector('.chat-prompt-toggle').hidden,false);
    box.querySelector('.chat-prompt-toggle').events.click(click); assert.equal(viewed,1);
    await box.querySelector('.chat-prompt-copy').events.click(click);
    assert.match(copied,/\*\*原始格式\*\*/); assert.match(copied,/图片提示词/);
    const del=box.querySelector('.chat-prompt-delete'); del.events.click(click); assert.equal(deleted,0);
    del.events.click(click); assert.equal(deleted,1,'destructive action requires second click');
    const second=window.ChatActions.create({thread:node()}); second.dispose();
    assert.equal(listeners.size,1,'disposing another instance does not remove this listener');
    actions.dispose(); assert.equal(timers.size,0); assert.equal(listeners.size,0);
    console.log('Direct message actions, deduplication, raw copy, confirmation and isolated disposal passed');
})().catch(error=>{console.error(error); process.exitCode=1;});
