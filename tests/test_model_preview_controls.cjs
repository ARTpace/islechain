const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const html=fs.readFileSync('templates/model3d/viewer.html','utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
test('repeat updates existing textures at decimal precision',()=>{
 const values=[],texture={repeat:{set:(x,y)=>values.push([x,y])}};
 const c={Math,materialRepeat:1.3,appliedTextures:[texture],model:null,materialGroup:{traverse:fn=>fn({isMesh:true,material:{map:texture}})},MATERIAL_SLOTS:{basecolor:['map']},renderFrame(){}};
 vm.createContext(c);vm.runInContext(section('function clampRepeat(','function normalizeGeometry(')+section('function updateMaterialRepeat(','/* ===== 材质预设'),c);
 assert.equal(c.clampRepeat(1.2),1.2);assert.equal(c.clampRepeat(1.3),1.3);
 c.updateMaterialRepeat();assert.deepEqual(values,[[1.3,1.3]]);
});
test('geometry changes reuse the mesh and its loaded material',async()=>{
 let disposed=0,loads=0,frames=0;
 const material={},mesh={material,geometry:{dispose(){disposed++;}}};
 const group={userData:{materialVersion:2,geometry:'sphere'},children:[mesh]};
 const c={materialGroup:group,materialVersion:2,materialGeometry:'plane',MATERIAL_GEOMETRY:{plane:()=>({attributes:{}})},updateMaterialRepeat(){frames++;},frameObject(){},hasMaterial:()=>true,loadMaterialTextures(){loads++;throw Error('unexpected load');}};
 vm.createContext(c);vm.runInContext(section('async function buildMaterialPreset(','function frameObject('),c);
 await c.buildMaterialPreset();await c.buildMaterialPreset(false);
 assert.equal(c.materialGroup,group);assert.equal(mesh.material,material);assert.equal(loads,0);assert.equal(disposed,1);assert.equal(frames,2);
});
test('old textured group remains visible while replacement textures load',async()=>{
 let resolve;
 const old={userData:{materialVersion:1}};
 const c={materialGroup:old,materialVersion:2,materialGeometry:'plane',MATERIAL_GEOMETRY:{plane:()=>({})},materialMaps:{},presetBuild:0,hasMaterial:()=>true,loadMaterialTextures:()=>new Promise(r=>resolve=r)};
 vm.createContext(c);vm.runInContext(section('async function buildMaterialPreset(','function frameObject('),c);
 const pending=c.buildMaterialPreset();assert.equal(c.materialGroup,old);
 c.materialVersion=3;resolve([]);await pending;assert.equal(c.materialGroup,old);
});
test('shape and repeat popovers close on selection and repeat drags render immediately',()=>{
 const elements={};
 const element=()=>({hidden:true,listeners:{},classList:{toggle(){}},setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;}});
 for(const id of ['viewer-material','vm-geometry-menu','vm-repeat-menu','vm-geometry-btn','vm-repeat-btn','vm-repeat','vm-repeat-out','vm-height-menu','vm-height-btn','vm-height','vm-height-out','viewer-textures','viewer-textures-btn'])elements[id]=element();
 const shape=element();shape.dataset={geometry:'plane'};shape.disabled=false;
 elements['viewer-material'].querySelectorAll=()=>[shape];elements['viewer-material'].contains=()=>true;
 let updates=0,reports=0,builds=0;
 const c={document:{getElementById:id=>elements[id],addEventListener(){}},materialGeometry:'sphere',materialRepeat:1,clampRepeat:Number,syncMaterialBar(){},renderMaterialPreset(){builds++;},reportMaterialControl(){reports++;},updateMaterialRepeat(){updates++;}};
 vm.createContext(c);vm.runInContext(section('function bindMaterialBar(','let sidebarUrls='),c);c.bindMaterialBar();
 elements['vm-geometry-btn'].listeners.click();assert.equal(elements['vm-geometry-menu'].hidden,false);
 shape.listeners.click();assert.equal(c.materialGeometry,'plane');assert.equal(elements['vm-geometry-menu'].hidden,true);
 elements['vm-repeat-btn'].listeners.click();elements['vm-repeat'].value='1.3';elements['vm-repeat'].listeners.input();
 assert.equal(c.materialRepeat,1.3);assert.equal(updates,1);assert.equal(builds,1);
 elements['vm-repeat'].listeners.change();assert.equal(elements['vm-repeat-menu'].hidden,true);assert.equal(reports,2);
});
test('parent sends controls without fetching unchanged maps again',async()=>{
 const source=fs.readFileSync('static/js/game-model3d.js','utf8');
 const begin=source.indexOf('async function pushMaterial('),end=source.indexOf('// 预览 iframe',begin);
 let fetches=0;const messages=[],node={id:'asset',materialPreview:'plane'},data={maps:{basecolor:'/color.png'},repeat:1.2};
 const c={window:{CanvasMaterialPreview:{sources:()=>data}},nodes:[node],materialSent:new WeakMap(),fetch:async()=>{fetches++;return {ok:true,blob:async()=>({})};}};
 vm.createContext(c);vm.runInContext(source.slice(begin,end),c);
 const frame={contentWindow:{postMessage:message=>messages.push(message)}};
 await c.pushMaterial(node,frame);data.repeat=1.3;await c.pushMaterial(node,frame);await c.pushMaterial(node,frame);
 assert.equal(fetches,1);assert.equal(messages.length,2);assert.equal(messages[1].type,'material-controls');assert.equal(messages[1].repeat,1.3);
});

test('channel materials read source maps and preserve live displacement',()=>{
 class Material{constructor(values={}){Object.assign(this,values);}}
 const c={channelMaterials:null,THREE:{MeshBasicMaterial:Material,MeshStandardMaterial:Material,MeshNormalMaterial:Material,Color:class{}}};
 vm.createContext(c);vm.runInContext(section(' function channelMaterial(',' function invertTexture('),c);
 const src={uuid:'test',map:{},normalMap:{},roughnessMap:{},metalnessMap:{},displacementMap:{},displacementScale:0.2,displacementBias:-0.1,side:2};
 for(const [name,slot] of Object.entries({normals:'normalMap',albedo:'map',reflectivity:'metalnessMap',gloss:'roughnessMap',topology:'displacementMap'})){
  const material=c.channelMaterial(name,src);assert.equal(material.map,src[slot]);assert.equal(material.displacementMap,src.displacementMap);
  src.displacementScale=0.3;assert.equal(c.channelMaterial(name,src).displacementScale,0.3);
  if(name==='reflectivity'||name==='gloss'){const shader={fragmentShader:'#include <map_fragment>'};material.onBeforeCompile(shader);assert.ok(shader.fragmentShader.includes(name==='gloss'?'.g':'.b'));}
 }
});
test('height updates source material without replacing textures',()=>{
 const height={repeat:{set(){}}},material={displacementMap:height};
 const c={materialRepeat:1.2,materialHeight:0.24,appliedTextures:[],model:null,materialGroup:{traverse:fn=>fn({isMesh:true,material})},MATERIAL_SLOTS:{height:['displacementMap']},renderFrame(){}};
 vm.createContext(c);vm.runInContext(section('function updateMaterialRepeat(','/* ====='),c);c.updateMaterialRepeat();
 assert.equal(material.displacementScale,0.24);assert.equal(material.displacementBias,-0.12);assert.equal(material.displacementMap,height);
});

test('lighting strength scales direct lights and HDR environment together',()=>{
 const out={},c={key:{},fill:{},hemisphere:{},scene:{},document:{getElementById:()=>out},renderFrame(){}};
 vm.createContext(c);vm.runInContext(section('function setLightStrength(','async function replaceEnvironment('),c);
 c.setLightStrength(0.5);assert.equal(c.key.intensity,0.85);assert.equal(c.fill.intensity,0.35);assert.equal(c.hemisphere.intensity,0.55);assert.equal(c.scene.environmentIntensity,0.5);assert.equal(out.textContent,'0.50');
 c.setLightStrength(0);assert.equal(c.scene.environmentIntensity,0);
});
test('environment replacement keeps old environment on failure and disposes replaced resources',async()=>{
 const status={},old={texture:{},dispose(){this.disposed=true;}},texture={dispose(){this.disposed=true;}},target={texture:{},dispose(){this.disposed=true;}};
 const c={updateEnvironmentSettings(){this.scene.environment=this.customEnvironment.texture;},environmentRequest:0,customEnvironment:old,scene:{environment:old.texture},renderer:{},document:{getElementById:()=>status},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},GameHDRLoader:class{async loadAsync(){return texture;}},THREE:{PMREMGenerator:class{fromEquirectangular(){return target;}dispose(){}},EquirectangularReflectionMapping:1},renderFrame(){}};
 vm.createContext(c);vm.runInContext(section('async function replaceEnvironment(','function updateEnvironmentSettings('),c);
 await c.replaceEnvironment({name:'studio.hdr'});assert.equal(c.scene.environment,target.texture);assert.equal(old.disposed,true);assert.equal(texture.disposed,true);
 c.GameHDRLoader=class{async loadAsync(){throw Error('invalid HDR');}};
 await c.replaceEnvironment({name:'broken.hdr'});assert.equal(c.scene.environment,target.texture);assert.equal(target.disposed,undefined);
});
test('white and wireframe modes keep displacement without color textures',()=>{
 class Material{constructor(values){Object.assign(this,values);}}
 const c={channelMaterials:null,THREE:{MeshStandardMaterial:Material}};
 vm.createContext(c);vm.runInContext(section(' function channelMaterial(',' function invertTexture('),c);
 const src={uuid:'source',map:{},displacementMap:{},displacementScale:0.2,displacementBias:-0.1};
 const white=c.channelMaterial('white',src),wire=c.channelMaterial('wire',src);
 assert.equal(white.map,undefined);assert.equal(white.wireframe,false);assert.equal(wire.wireframe,true);assert.equal(wire.displacementMap,src.displacementMap);
});

test('environment settings update rotation, visibility, background and blur',()=>{
 const fields={};for(const [id,value] of Object.entries({'environment-rotation':90,'environment-opacity':0.4,'environment-blur':0.7}))fields[id]={value};
 for(const id of ['rotation-value','opacity-value','blur-value'])fields[id]={};fields['scene-lights']={checked:false};fields['scene-world']={checked:true};
 const texture={},c={document:{getElementById:id=>fields[id]},scene:{environmentRotation:{},backgroundRotation:{}},lightRig:{},hemisphere:{},environment:{texture},customEnvironment:null,THREE:{Color:class{}},updateEnvironmentPreview(){},renderFrame(){}};
 vm.createContext(c);vm.runInContext(section('function updateEnvironmentSettings(','function updateEnvironmentPreview('),c);c.updateEnvironmentSettings();
 assert.equal(c.scene.environment,texture);assert.equal(c.scene.background,texture);assert.equal(c.lightRig.visible,false);assert.equal(c.scene.environmentRotation.y,Math.PI/2);assert.equal(c.scene.backgroundBlurriness,0.7);
 fields['scene-world'].checked=false;fields['environment-opacity'].value=0;c.updateEnvironmentSettings();assert.equal(c.scene.environment,null);assert.notEqual(c.scene.background,texture);
});

test('UV discovery enumerates real channels across model meshes in numeric order',()=>{
 const c={};vm.createContext(c);vm.runInContext(section('function uvAttributes(','function setUVOpen('),c);
 const target={traverse(fn){fn({isMesh:true,geometry:{attributes:{position:{},uv2:{},uv:{},uv1:{},uv10:{}}}});fn({isMesh:true,geometry:{attributes:{uv3:{}}}});}};
 assert.deepEqual(Array.from(c.uvAttributes(target)),['uv','uv1','uv2','uv3','uv10']);assert.equal(c.uvAttributes(null).length,0);
});
test('UV drawing follows selected channel and indexed triangles',()=>{
 const lines=[],ctx={scale(){},fillRect(){},strokeRect(){},beginPath(){},moveTo(...v){lines.push(v);},lineTo(...v){lines.push(v);},closePath(){},stroke(){}};
 const uv={count:3,getX:i=>[0,1,0][i],getY:i=>[0,0,1][i]},status={},elements={'viewer-uv':{hidden:false},'viewer-uv-channel':{value:'uv2'},'viewer-uv-status':status,'viewer-uv-canvas':{clientWidth:100,clientHeight:100,getContext:()=>ctx}};
 const c={document:{getElementById:id=>elements[id]},devicePixelRatio:1,channelTarget:{traverse:fn=>fn({isMesh:true,geometry:{attributes:{uv2:uv},index:{count:3,getX:i=>i}}})}};
 vm.createContext(c);vm.runInContext(section('function drawUVLayout(','function validSavedView('),c);c.drawUVLayout();assert.equal(lines.length,3);assert.notEqual(lines[0][0],lines[1][0]);assert.notEqual(lines[0][1],lines[2][1]);assert.ok(status.textContent.includes('1'));
 c.channelTarget=null;c.drawUVLayout();assert.equal(lines.length,3);
});
test('named views snapshot and restore camera independently of later movement',()=>{
 const vector=values=>({values:[...values],toArray(){return [...this.values];},fromArray(v){this.values=[...v];}});
 const messages=[],c={Date,Math,savedViews:[],channelTarget:{},camera:{position:vector([1,2,3]),near:0.1,far:100,updateProjectionMatrix(){}},controls:{target:vector([0,1,0]),minDistance:0.05,maxDistance:60,enableDamping:true,update(){}},renderFrame(){},renderSavedViews(){},parent:{postMessage:message=>messages.push(message)}};
 vm.createContext(c);vm.runInContext(section('function validSavedView(','function renderSavedViews('),c);c.saveCurrentView('Front');assert.equal(c.savedViews[0].name,'Front');assert.equal(messages[0].type,'preview-views');
 c.camera.position.values=[9,9,9];c.recallSavedView(c.savedViews[0]);assert.deepEqual(c.camera.position.values,[1,2,3]);assert.equal(c.controls.enableDamping,true);
 assert.equal(c.validSavedView({...c.savedViews[0],position:[NaN,1,2]}),false);
});

test('parent persists named views and restores them when the preview is ready',()=>{
 const source=fs.readFileSync('static/js/game-model3d.js','utf8'),messages=[],node={id:'asset'},frame={contentWindow:{postMessage:message=>messages.push(message)},closest:()=>({dataset:{id:'asset'}})};
 let receive,saves=0;const c={window:{addEventListener(type,handler){receive=handler;}},document:{querySelectorAll:()=>[frame]},nodes:[node],save(){saves++;},materialSent:new WeakMap(),pushMaterial(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf("if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('message'"),source.indexOf('    function referenceImages(')),c);
 const views=[{id:'view-1',name:'Front'}];receive({source:frame.contentWindow,data:{type:'preview-views',views}});assert.equal(node.modelViews,views);assert.equal(saves,1);
 receive({source:frame.contentWindow,data:{type:'model-ready'}});assert.equal(messages[0].type,'preview-views-init');assert.equal(messages[0].views,views);
});
