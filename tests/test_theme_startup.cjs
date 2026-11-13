const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function startup(saved, denied = false) {
    const ids = new Map(), listeners = new Map(), frames = [], observers = [];
    function element() {
        const classes = new Set();
        return {dataset:{}, style:{setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}},
            classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
            appendChild(el){if(el.id) ids.set(el.id,el);}};
    }
    const root = element();
    const document = {documentElement:root,head:element(),body:null,readyState:'loading',
        createElement:element,getElementById:id=>ids.get(id),querySelector:()=>null,querySelectorAll:()=>[],
        addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}};
    const computed = el=>({overflow:'visible',getPropertyValue:k=>el.style[k]||''});
    const window = {document,STUDIO_DEFAULT_THEME:'dark',innerWidth:1440,innerHeight:1000,screen:{width:1440,height:1000},
        getComputedStyle:computed,addEventListener(){},dispatchEvent(){},scrollTo(){}};
    window.self=window;window.top=window;
    const localStorage={getItem(k){if(denied)throw Error('denied');return saved[k]??null;},setItem(k,v){saved[k]=v;}};
    vm.runInNewContext(fs.readFileSync('static/js/theme.js','utf8'),{window,document,localStorage,getComputedStyle:computed,
        CustomEvent:class{},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},
        requestAnimationFrame:fn=>{frames.push(fn);return 1;}});
    assert(!root.classList.contains('studio-appearance-pending'));
    const dark = (saved.studio_theme||'dark')==='dark';
    assert.equal(root.classList.contains('studio-theme-dark'),dark);
    assert.equal(root.style.colorScheme,dark?'dark':'only light');
    function contrast(a,b){
        const lum=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
    }
    function checkAccent(){
        if(!saved.studio_accent)return;
        const style=root.style;
        for(const role of ['hover','active','soft','soft-hover','text','line','focus'])assert.match(style['--studio-accent-'+role],/^#[0-9a-f]{6}$/);
        for(const bg of ['--accent','--studio-accent-hover','--studio-accent-active'])assert(contrast(style[bg],style['--accent-ink'])>=4.5,`${saved.studio_accent}: ${bg} contrast`);
        for(const bg of ['--studio-accent-soft','--studio-accent-soft-hover'])assert(contrast(style[bg],style['--studio-accent-text'])>=4.5,`${saved.studio_accent}: selected contrast`);
    }
    checkAccent();

    assert.equal(window.StudioLook.paletteColors('sand')[0],dark?'#1a1612':'#f1ece2');
    if(saved.studio_ui_scale_mode==='90')assert.equal(root.style['--studio-ui-scale'],'0.900');
    const before=ids.get('studio-palette-style').textContent;
    const firstBackground=root.style['--ui-bg'];
    assert(firstBackground);assert.equal(root.style['background-color'],firstBackground);
    if(saved.studio_palette==='custom')assert.equal(firstBackground,'#2b1e2b');
    document.body=element();
    observers[0]();
    assert.equal(document.body.style['--ui-bg'],firstBackground);
    assert.equal(document.body.classList.contains('studio-theme-dark'),dark);
    document.readyState='interactive';
    for(const fn of listeners.get('DOMContentLoaded')||[])fn();
    // 不隐藏正文或等待资源齐全；初始变量就具备高于后续样式表的行内优先级。
    assert(!root.classList.contains('studio-appearance-pending'));
    assert.equal(document.body.style['--ui-bg'],firstBackground);
    assert.equal(root.style['--ui-bg'],firstBackground);
    assert.equal(document.body.classList.contains('studio-theme-dark'),dark);
    assert.equal(ids.get('studio-palette-style').textContent,before);
    assert.equal(ids.get('studio-controls').href,'/static/css/studio-controls.css?v=20261111016');
    assert.equal(ids.get('studio-ui-base').href,'/static/css/studio-ui.css?v=20261111016');
    if(!dark && !saved.studio_accent){
        assert.equal(root.style['--accent'],'#795b3c');
        assert.equal(root.style['--ui-accent'],'#795b3c');
        assert.equal(root.style['--accent-ink'],'#fffdf7');
    }
    while(frames.length)frames.shift()();
    if(!denied){
        window.StudioTheme.apply(dark?'light':'dark');
        assert.notEqual(root.style['--ui-bg'],firstBackground);
        assert.equal(root.style['background-color'],root.style['--ui-bg']);
        checkAccent();
        window.StudioLook.setAccent('');
        assert.equal(root.style['--studio-accent-soft'],undefined);
    }
    assert(!root.classList.contains('studio-appearance-pending'));
}
startup({studio_theme:'dark',studio_palette:'custom',studio_palette_color:'#70465e',studio_accent:'violet',studio_ui_scale_mode:'90'});
startup({studio_theme:'light',studio_palette:'sand'});
startup({studio_theme:'light'});
startup({studio_theme:'light',studio_accent:'#658273'});
startup({},true);
for(const seed of ['violet','#ffffff','#000000','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#808080','#fdf6df']) {
    for(const theme of ['light','dark'])startup({studio_theme:theme,studio_accent:seed});
}

let pages=0;
function inspect(dir){
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
        const file=path.join(dir,item.name);
        if(item.isDirectory()){inspect(file);continue;}
        if(!file.endsWith('.html')||file.includes('sync-conflict'))continue;
        const html=fs.readFileSync(file,'utf8');
        if(!/src=["']\/static\/(?:js\/)?theme\.js/.test(html))continue;
        const tag=html.match(/<script\b[^>]*src=["']\/static\/js\/theme\.js[^"']*["'][^>]*>/);
        assert(tag,`${file}: must use the shared runtime directly`);
        assert(!/\b(?:async|defer)\b/.test(tag[0]),`${file}: theme must block parsing`);
        assert(tag.index<html.indexOf('</head>'),`${file}: theme must run before the body`);
        assert(!html.includes('var P={ink:'),`${file}: no second inline palette bootstrap`);
        pages++;
    }
}
inspect('static');assert(pages>=40);
console.log(`Theme startup: first-paint inline colors without hidden body, mode switching, storage fallback, ${pages} synchronous page entries passed`);
