const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
function fixture() {
    const listeners = {}, timers = new Map(), ids = new Map(), dialogs = [];
    let clock = 0;
    function element(tag = 'button') {
        const classes = new Set(), attrs = new Map(), events = {};
        const el = {tagName:tag.toUpperCase(), isConnected:true, childNodes:[{textContent:'删除'}], textContent:'删除',
            classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)},
            replaceChildren(...nodes){this.childNodes=nodes;this.textContent=nodes.map(n=>n.textContent||'').join('');},
            getAttribute:k=>attrs.has(k)?attrs.get(k):null, removeAttribute:k=>attrs.delete(k),
            addEventListener:(type,fn)=>{events[type]=fn;}, removeEventListener:type=>{delete events[type];},
            contains:node=>node===el, closest:()=>el, focus(){}, remove(){this.isConnected=false;},
            showModal(){this.open=true;}, close(){this.open=false;events.close?.();}, events,
        };
        if(tag==='dialog') {
            const children = {p:element('p'),'[data-no]':element(),'[data-yes]':element()};
            el.querySelector=selector=>children[selector];
            dialogs.push(el);
        }
        return el;
    }
    const window = {addEventListener:(type,fn)=>{listeners['window:'+type]=fn;}};
    const document = {documentElement:{lang:'zh-CN'},getElementById:id=>ids.get(id),createElement:element,
        head:{appendChild:el=>ids.set(el.id,el)},body:{appendChild(){}},addEventListener:(type,fn)=>{listeners[type]=fn;}};
    vm.runInNewContext(fs.readFileSync('static/js/ui-confirm.js','utf8'), {window,document,localStorage:{getItem:()=>null},
        setTimeout:fn=>{timers.set(++clock,fn);return clock;},clearTimeout:id=>timers.delete(id),queueMicrotask});
    return {api:window.StudioConfirm,element,listeners,timers,dialogs,click:button=>listeners.click({target:button})};
}
async function interaction() {
    const f=fixture(), button=f.element();
    f.click(button);
    assert.equal(await f.api.ask('确定删除这条历史对话吗？'),false);
    assert(button.classList.contains('studio-delete-armed'));
    assert.equal(button.textContent,'确认删除');
    f.click(button);
    assert.equal(await f.api.ask('确定删除这条历史对话吗？'),true);
    assert.equal(button.textContent,'删除');
    f.click(button); await f.api.ask('删除画布 A？');
    f.click(button); assert.equal(await f.api.ask('删除画布 B？'),false);
    button.events.pointerleave(); assert(!button.classList.contains('studio-delete-armed'));
    f.click(button); await f.api.ask('删除画布 A？');
    [...f.timers.values()][0](); assert(!button.classList.contains('studio-delete-armed'));
    f.click(button); await f.api.ask('删除画布 A？');
    f.listeners.pointerdown({target:f.element()}); assert(!button.classList.contains('studio-delete-armed'));
    f.click(button); await f.api.ask('删除画布 A？');
    f.listeners.keydown({key:'Escape'}); assert(!button.classList.contains('studio-delete-armed'));
    let resolved=false;
    const result=f.api.ask('是否覆盖当前设置？').then(value=>{resolved=true;return value;});
    await Promise.resolve(); assert.equal(resolved,false);
    f.dialogs.at(-1).querySelector('[data-no]').onclick(); assert.equal(await result,false);
    const next=f.api.ask('继续等待生成任务？'); await Promise.resolve(); await Promise.resolve();
    f.dialogs.at(-1).querySelector('[data-yes]').onclick(); assert.equal(await next,true);
    const keyboard=f.api.ask('删除选中画布？'); await Promise.resolve(); await Promise.resolve();
    assert(f.dialogs.at(-1).querySelector('[data-yes]').classList.contains('danger'));
    f.dialogs.at(-1).events.cancel({preventDefault(){}}); assert.equal(await keyboard,false);
    console.log('二段删除、目标切换、取消/超时恢复、主题对话框等待及快捷键确认检查通过');
}
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]); }
function syntax() {
    let checked=0;
    for(const file of files('static').filter(f=>/\.(js|html)$/.test(f))) {
        const source=fs.readFileSync(file,'utf8');
        if(!source.includes('StudioConfirm')) continue;
        if(file.endsWith('.js')) {new vm.Script(source,{filename:file});checked++;}
        else {
            assert(source.includes('/static/js/ui-confirm.js'),file+' missing confirmation component');
            for(const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
                if(/\bsrc\s*=|type\s*=\s*["'](?:module|importmap|application\/json)/.test(m[1])) continue;
                if(!m[2].includes('window.StudioConfirm.ask')) continue;
                new vm.Script(m[2],{filename:file}); checked++;
            }
        }
    }
    console.log(`确认迁移相关 ${checked} 段脚本语法检查通过`);
}
interaction().then(syntax).catch(error=>{console.error(error);process.exitCode=1;});
