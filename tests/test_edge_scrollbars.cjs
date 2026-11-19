const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/theme.js', 'utf8');
const start = source.indexOf('    function installEdgeScrollbars()');
const end = source.indexOf("    document.addEventListener('DOMContentLoaded'", start);
const handlers = {}, windowHandlers = {};
let style;
const classes = new Set();
const scroller = {
    nodeType:1, parentElement:null, scrollHeight:1000, clientHeight:300, scrollWidth:200, clientWidth:200,
    getBoundingClientRect: () => ({left:0, top:0, right:200, bottom:300}),
    classList:{add: c => classes.add(c), remove: c => classes.delete(c)},
};
const ctx = {
    document:{getElementById:()=>null, createElement:()=>({}), head:{appendChild:el=>{style=el;}},
        addEventListener:(type,fn)=>{handlers[type]=fn;}},
    window:{addEventListener:(type,fn)=>{windowHandlers[type]=fn;}},
    getComputedStyle:()=>({overflowY:'auto',overflowX:'hidden',direction:'ltr'}),
};
vm.runInNewContext(source.slice(start,end) + '\ninstallEdgeScrollbars();', ctx);
const move = (x,y=150,buttons=0) => handlers.pointermove({target:scroller,clientX:x,clientY:y,buttons});
move(100); assert.equal(classes.size,0);
move(190); assert(classes.has('studio-scrollbar-visible'));
move(100,150,1); assert.equal(classes.size,1);
move(100); assert.equal(classes.size,0);
move(190); handlers.pointerleave(); assert.equal(classes.size,0);
move(190); windowHandlers.blur(); assert.equal(classes.size,0);
scroller.scrollHeight=300;
move(190); assert.equal(classes.size,0);
assert.match(style.textContent,/width:6px!important/);
console.log('滚动条边缘显隐、拖动保持、离开隐藏和无溢出检查通过');
