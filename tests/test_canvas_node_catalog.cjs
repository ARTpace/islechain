const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.value='';this.textContent='';this.classList={add(){},toggle(){}};}
    append(...children){this.children.push(...children);for(const child of children)if(typeof child==='object')child.parent=this;}
    prepend(...children){this.children.unshift(...children);for(const child of children)child.parent=this;}
    getBoundingClientRect(){return this.tag==='summary'?{left:100,right:300,top:150,width:200,height:36}:{left:0,right:224,top:0,width:224,height:240};}
    replaceChildren(...children){this.children=[];this.append(...children);}
    cloneNode(){const copy=new Element(this.tag);copy.textContent=this.textContent;copy.className=this.className;copy.title=this.title;copy.dataset={...this.dataset};copy.onclick=this.onclick;return copy;}
    contains(child){return this===child||this.children.some(c=>typeof c==='object'&&c.contains(child));}
    querySelectorAll(selector){const all=this.children.flatMap(c=>typeof c==='object'?[c,...c.querySelectorAll('*')]:[]);if(selector==='*')return all;return all.filter(c=>selector==='.menu-btn'?c.className==='menu-btn':selector==='[data-catalog-type]'?!!c.dataset.catalogType:selector==='[data-node-catalog-tools]'?!!c.dataset.nodeCatalogTools:selector==='[data-node-catalog-items]'?!!c.dataset.nodeCatalogItems:false);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
    getAttribute(key){return typeof this[key]==='string'?this[key]:null;}
    setAttribute(key,value){this[key]=value;}
}
const definition={typeId:'test.text',version:'1.0.0',title:'文本节点',description:'文本格式化',keywords:['文本'],fields:[
    {id:'text',label:'文本',component:'textarea',default:''},
    {id:'prefix',label:'前缀',component:'text',default:'['},
    {id:'count',label:'数量',component:'number',default:1,minimum:1,maximum:3,step:1},
    {id:'strength',label:'强度',component:'slider',default:0.5,minimum:0,maximum:1,step:0.1},
    {id:'mode',label:'模式',component:'dropdown',default:'a',options:['a','b']},
    {id:'enabled',label:'启用',component:'boolean',default:false}
],execution:{kind:'host.text',operation:'uppercase',textField:'text',prefixField:'prefix'}};
let catalog={definitions:[definition,{...definition,version:'2.0.0'}],groups:[{id:'text',title:'文本',members:['extension:test.text']}],hashes:{'test.text@1.0.0':'hash-1'},revision:1},requests=[],renders=0,saves=0,undo=0,fail=false;
const context={window:{innerWidth:1200,innerHeight:800},document:{createElement:tag=>new Element(tag),addEventListener(){}},JSON,Map,Set,Promise,
    nodes:[],connections:[],render(){renders++;},scheduleSave(){saves++;},pushUndo(){undo++;},wouldCreateGeneratorCycle:()=>false,
    fetch:async(url,options)=>{
        const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});
        if(body?.action==='migrate')return {ok:true,json:async()=>({definition:catalog.definitions.find(item=>item.version===body.version),params:body.params})};
        if(url.endsWith('/node-run'))return {ok:!fail,json:async()=>fail?{detail:'版本失效'}:{outputs:{text:body.inputs.join('|')+body.params.text}}};
        return {ok:true,json:async()=>JSON.parse(JSON.stringify(catalog))};
    }
};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/js/canvas-node-catalog.js','utf8'),context);
const api=context.window.CanvasNodeCatalog;
(async()=>{
    await api.load();
    const node={id:'extension-1',type:'extension'};api.initialize(node,definition);
    context.nodes.push({id:'prompt-1',type:'prompt',text:'上游'},node);
    context.connections.push({from:'prompt-1',to:node.id});
    node.extensionParams.text='正文';
    const body=api.body(node),rows=body.children.filter(child=>child.tag==='label');
    assert.equal(rows.length,6,'all six declared component types render');
    rows[5].children[1].checked=true;rows[5].children[1].onchange();
    assert.equal(node.extensionParams.enabled,true);assert.equal(undo,1);assert(saves>0);
    await api.execute(node);
    assert.equal(node.outputText,'上游正文');assert.equal(node.running,false);assert.equal(node.runStatus,'done');
    assert.equal(requests.at(-1).body.definitionHash,'hash-1');assert.equal(renders,2);
    const restored=JSON.parse(JSON.stringify(node));
    assert.equal(api.body(restored).children.filter(c=>c.tag==='label').length,6,'serialized node restores against pinned version');
    catalog.hashes['test.text@1.0.0']='hash-2';await api.load();
    assert(api.body(restored).children[0].textContent.includes('版本缺失'),'incompatible version shows placeholder');
    assert.equal(restored.extensionParams.text,'正文','placeholder preserves data');
    await assert.rejects(api.execute(restored),/版本缺失/);
    catalog.hashes['test.text@1.0.0']='hash-1';await api.load();fail=true;
    await assert.rejects(api.execute(node),/版本失效/);assert.equal(node.running,false);assert.equal(node.runStatus,'failed');
    assert.equal(api.canConnect({id:'a',type:'image'},{id:'b',type:'extension'}),false);
    assert.equal(api.canConnect({id:'a',type:'extension'},{id:'b',type:'llm'}),true);
    assert.equal(api.canConnect({id:'a',type:'prompt'},{id:'b',type:'llm'}),undefined,'old connection logic remains in control');
    const menu=new Element('div'),builtin=new Element('button');builtin.className='menu-btn';builtin.textContent='图片';builtin.onclick="menuAdd('image')";menu.append(builtin);
    api.enhanceMenu(menu);
    const tools=menu.querySelector('[data-node-catalog-tools]'),items=menu.querySelector('[data-node-catalog-items]');
    assert(!tools.children.some(child=>child.textContent==='添加文本节点'),'reuse the existing text node instead of another sample entry');
    const sections=items.children.filter(child=>child.tag==='details');
    assert.equal(sections.length,2,'custom group and ungrouped builtins remain accessible');
    const plugin=sections[0].children[1].children[0];
    assert.equal(plugin.textContent,'文本节点');assert(plugin.title.includes('2.0.0'));
    assert(sections.every(section=>section.open===false),'categories start collapsed');
    sections[0].onmouseenter();assert.equal(sections[0].open,true);assert.equal(sections[0].children[1].style.left,'300px');
    sections[1].onmouseenter();assert.equal(sections[0].open,false);assert.equal(sections[1].open,true);
    sections[1].onmouseleave();assert.equal(sections[1].open,false);
    context.window.innerWidth=400;sections[0].onmouseenter();assert.equal(sections[0].children[1].style.left,'8px');context.window.innerWidth=1200;
    const search=tools.children[0];search.value='图片';search.oninput();
    assert.equal(sections[0].hidden,true);assert.equal(sections[1].open,true);
    search.value='test.text';search.oninput();assert.equal(sections[0].hidden,false);
    assert.equal(menu.children.at(-1).hidden,true,'search hides management actions');
    search.value='';search.oninput();assert.equal(menu.children.at(-1).hidden,false);
    api.enhanceMenu(menu);
    assert.equal(menu.querySelectorAll('[data-catalog-type]').filter(b=>b.dataset.catalogType==='image').length,1,'reopening does not duplicate nodes');
    fail=false;catalog.hashes['test.text@2.0.0']='hash-v2';await api.load();
    await api.switchVersion(node,catalog.definitions[1]);assert.equal(api.definition(node).version,'2.0.0');
    assert.equal(node.extensionParams.text,'正文');assert.equal(node.extensionVersionStates['test.text@1.0.0'].params.text,'正文');
    node.extensionParams.text='version-two';await api.switchVersion(node,catalog.definitions[0]);
    assert.equal(node.extensionParams.text,'正文','rollback restores the earlier parameter snapshot');
    node.running=true;await assert.rejects(api.switchVersion(node,catalog.definitions[1]),/运行中/);node.running=false;
    console.log('CANVAS_NODE_CATALOG_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
