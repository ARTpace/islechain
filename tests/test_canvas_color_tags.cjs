const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const snapshots=[];
let target;
const context=vm.createContext({
    Math,Map,Set,canvas:{id:'canvas'},nodes:[{id:'one',type:'image',url:'/one.png',x:20,y:30,w:200,h:400},{id:'two',type:'image',url:'/two.png',colorTag:'cyan'},{id:'generator',type:'generator',colorTag:'cyan'}],
    selected:new Set(),viewport:{x:0,y:0,scale:1},board:{clientWidth:1000,clientHeight:800},
    document:{getElementById:()=>({offsetHeight:300})},
    render:()=>{},scheduleSave:()=>{},estimatedNodeRect:node=>node,
    centerViewportOnWorldPoint:point=>target=point,
    pushUndo:()=>snapshots.push(JSON.stringify(context.nodes))
});
vm.runInContext(fs.readFileSync('static/js/canvas-color-tags.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/js/canvas-image-tools.js','utf8'),context);
assert.equal(context.imageToolbarLeft({x:100,w:300},{scale:1,x:0},500,1000),8);
assert.equal(context.imageToolbarLeft({x:300,w:300},{scale:1,x:0},500,1000),200,'toolbar center must equal image center');
assert.equal(context.imageToolbarLeft({x:900,w:300},{scale:1,x:0},500,1000),492,'toolbar must stay inside right edge');
assert(context.setImageColorTag('one','cyan'));
assert.equal(context.taggedImageGroups(context.nodes)[0].items.length,2,'exclude non-image nodes from color results');
assert.equal(context.setImageColorTag('one','invalid'),false);
assert.equal(context.setImageColorTag('one','cyan'),false,'same color should not consume undo history');
assert(context.setImageColorTag('one',''));
assert.equal(context.taggedImageGroups(context.nodes)[0].items.length,1);
assert.equal(snapshots.length,2);
context.nodes=JSON.parse(snapshots.at(-1));
assert.equal(context.nodes[0].colorTag,'cyan','undo snapshot must restore the color');
assert(context.focusTaggedImage('one'));
assert(context.selected.has('one'));
assert.equal(target.x,120);
assert(target.y>230,'navigation must account for the bottom composer');
assert.equal(context.focusTaggedImage('missing'),false);
console.log('Color tags, grouping, undo, navigation and centered toolbar checks passed');
