const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const code=fs.readFileSync('static/modules/generation-menu-position.js','utf8');
for(const scale of [0.58,0.8,1,1.4]) {
    const viewport={width:1280,height:800,offsetLeft:0,offsetTop:0,addEventListener(){}};
    const body={offsetWidth:1280/scale,getBoundingClientRect:()=>({width:1280,left:7,top:11})};
    const window={visualViewport:viewport,addEventListener(){}};
    const context=vm.createContext({window,document:{body,addEventListener(){}},Map,
        getComputedStyle:()=>({transform:`scale(${scale})`})});
    vm.runInContext(code,context);
    let rect={left:100,right:268,top:60,bottom:104};
    const anchor={isConnected:true,getBoundingClientRect:()=>rect};
    const menu={isConnected:true,style:{},getClientRects:()=>[1],
        getBoundingClientRect(){return {height:Math.min(480,parseFloat(this.style.maxHeight))*scale};}};
    window.GenerationMenuPosition.place(menu,anchor,{width:320});
    assert(Math.abs((parseFloat(menu.style.left)*scale+7)-100)<0.01,'model left aligns after UI scale conversion');
    assert(Math.abs((parseFloat(menu.style.top)*scale+11)-112)<0.01,'model opens below its button');
    viewport.width=768;viewport.height=600;
    rect={left:600,right:750,top:500,bottom:544};
    window.GenerationMenuPosition.place(menu,anchor,{width:520,preferAbove:true,align:'end'});
    const left=parseFloat(menu.style.left)*scale+7;
    const top=parseFloat(menu.style.top)*scale+11;
    const width=parseFloat(menu.style.width)*scale;
    const height=menu.getBoundingClientRect().height;
    assert(left>=12 && left+width<=756.01,'resized menu stays within horizontal bounds');
    assert(top>=12 && top+height<=492.01,'menu fits above the moved button');
}
console.log('Generation menus: scaled coordinate conversion, anchor alignment and resized viewport bounds passed');
