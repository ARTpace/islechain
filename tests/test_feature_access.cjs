const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('static/index.html','utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if(!/\bsrc\s*=|type\s*=\s*["'](?:module|application\/json)/.test(match[1])) new Function(match[2]);
}
const saved=new Map();
const context={window:{},document:{querySelector:()=>null},localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}};
vm.createContext(context);
const start=html.indexOf('        window.FeatureModules = {');
const end=html.indexOf('        FeatureModules.ready =',start);
vm.runInContext(html.slice(start,end),context);
const mods=context.window.FeatureModules;
mods.apply=()=>{};
mods.access={visitor:false,guest_disabled:['chat-gen','generation-dashboard','training']};
assert(mods.isOn('chat-gen'));
assert(mods.isOn('generation-dashboard'));
mods.access.visitor=true;
assert.equal(mods.isOn('chat-gen'),false);
assert.equal(mods.isOn('generation-dashboard'),false);
assert.equal(mods.firstOn(),'canvas');
mods.set('zimage',true);
mods.access.guest_disabled.push('zimage');
assert.equal(mods.isOn('zimage'),false);
mods.access.guest_disabled=mods.groups.flatMap(group=>group.items.map(item=>item.id));
assert.equal(mods.firstOn(),'');
mods.access=null;
assert.equal(mods.isOn('chat-gen'),false);
console.log('本机开关与访客权限独立，默认入口遵循权限，全部关闭时不回退到对话生图');
// 排序只改变顺序，不改动模块开关或访客权限。
const originalGroups=JSON.stringify(mods.groups);
const switchesBefore=saved.get(mods.key);
const policyBefore=JSON.stringify(mods.access);
const elements=new Map();
function container() {
    return {children:[],insertBefore(node,anchor){
        const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);
        this.children.splice(this.children.indexOf(anchor),0,node);node.parentNode=this;
    },appendChild(node){
        const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);
        this.children.push(node);node.parentNode=this;
    }};
}
const nav=container(), submenu=container(), anchor={id:'nav-comfy',parentNode:nav};
nav.children.push(anchor);
mods.groups.forEach((group,index)=>group.items.forEach(item=>{
    const node={id:item.id,parentNode:index===0?nav:submenu};
    node.parentNode.children.push(node);elements.set(item.id,node);
}));
context.document.querySelector=selector=>selector==='.sidebar-nav'?nav:elements.get(selector.match(/data-module="([^"]+)"/)?.[1]) || null;
context.document.getElementById=id=>id==='nav-comfy'?anchor:id==='comfyui-submenu'?submenu:null;
mods.move('generation-dashboard',-1);
assert.equal(mods.orderedGroups()[0].items[1].id,'generation-dashboard');
assert.deepEqual(nav.children.map(item=>item.id),['chat-gen','generation-dashboard','training','canvas','asset-manager','nav-comfy']);
mods.move('zimage',1);
assert.equal(submenu.children[0].id,'klein');
assert.equal(submenu.children[1].id,'zimage');
const storedOrder=saved.get('studio_feature_module_order');
mods.move('chat-gen',-1);
mods.move('missing',1);
assert.equal(saved.get('studio_feature_module_order'),storedOrder);
assert.equal(JSON.stringify(mods.groups),originalGroups);
assert.equal(saved.get(mods.key),switchesBefore);
assert.equal(JSON.stringify(mods.access),policyBefore);
saved.set('studio_feature_module_order',JSON.stringify({'主功能':['canvas','missing','canvas']}));
const restored=mods.orderedGroups()[0].items.map(item=>item.id);
assert.equal(restored[0],'canvas');
assert.equal(restored.length,mods.groups[0].items.length);
assert.equal(new Set(restored).size,restored.length);
saved.set('studio_feature_module_order','broken json');
assert.equal(mods.orderedGroups()[0].items[0].id,'chat-gen');
console.log('模块组内排序、菜单同步、持久化恢复、边界与损坏数据兼容检查通过');

mods.moveTo('chat-gen', 'asset-manager', true);
assert.equal(mods.orderedGroups()[0].items.at(-1).id, 'chat-gen');
mods.moveTo('chat-gen', 'training', false);
assert.equal(mods.orderedGroups()[0].items[0].id, 'chat-gen');
const beforeCrossGroup = saved.get('studio_feature_module_order');
mods.moveTo('chat-gen', 'zimage', true);
mods.moveTo('chat-gen', 'missing', false);
mods.moveTo('chat-gen', 'chat-gen', true);
assert.equal(saved.get('studio_feature_module_order'), beforeCrossGroup);
console.log('任意位置排序、跨组与无效目标保护检查通过');
