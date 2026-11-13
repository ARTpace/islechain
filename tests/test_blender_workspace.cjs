// 工作区预览：验证图片/模型互斥切换和底部模型缩略图。
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
    constructor(){ this.children=[]; this.attrs={}; this.hidden=false; this.style={}; this.dataset={}; this.selectors={};
        const classes=new Set(); this.classList={add:v=>classes.add(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)};
    }
    set innerHTML(value){this.html=value;} get innerHTML(){return this.html;}
    appendChild(el){ if(el.parent) el.remove(); this.children.push(el); el.parent=this; return el; }
    prepend(el){if(el.parent) el.remove(); this.children.unshift(el);el.parent=this;}
    remove(){if(this.parent){const p=this.parent;p.children=p.children.filter(v=>v!==this);this.parent=null;}}
    replaceChildren(){this.children.forEach(v=>v.parent=null);this.children=[];}
    get firstChild(){return this.children[0];}
    setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k];}
    querySelector(s){return this.selectors[s] || null;}
    querySelectorAll(s){return s==='.blender-ref'?this.children:[];}
}
const preview=new Element(),editor=new Element(),expand=new Element();
const root=new Element();root.selectors={'.bw-preview':preview,'.bw-editor':editor,'.bw-expand':expand};
let first=true;
const context={window:{BlenderGenNode:{previewUrl:()=>'/base.glb'}},document:{createElement:()=>{if(first){first=false;return root;}return new Element();}},scheduleSave(){},render(){}};
vm.runInNewContext(fs.readFileSync('static/nodes/blender-gen/workspace.js','utf8'),context);
const controls=new Element(),stage=new Element(),viewer=new Element(),refs=new Element(),link=new Element();
stage.appendChild(viewer);link.setAttribute('href','/cat.png');refs.appendChild(link);
controls.selectors={'.blender-stage':stage,'.blender-refs':refs};
const node={id:'scene'};
context.window.BlenderWorkspace.body(node,()=>controls);
const modelMain=preview.children.find(el=>el.className==='bw-model-main');
const image=preview.children.find(el=>el.className==='bw-reference-main');
const modelButton=refs.children[0];
assert.equal(modelButton.className,'blender-ref bw-model-thumbnail');
assert.equal(modelButton.children[0].getAttribute('src'),'/base.glb');
assert.equal(modelMain.hidden,false);assert.equal(image.hidden,true);
link.onclick({preventDefault(){},stopPropagation(){}});
assert.equal(modelMain.hidden,true,'图片预览必须隐藏整个模型区域');
assert.equal(image.hidden,false);assert.equal(image.src,'/cat.png');
modelButton.onclick({stopPropagation(){}});
assert.equal(modelMain.hidden,false);assert.equal(image.hidden,true);
assert.equal(viewer.parent,modelMain,'切换不能丢失原模型查看器');
console.log('BLENDER_WORKSPACE_OK: model thumbnail, exclusive preview, return to model');
