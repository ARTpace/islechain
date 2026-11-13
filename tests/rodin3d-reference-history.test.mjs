import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../static/app/rodin3d-tripo.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
test('optimization branches from selected version and changes reference only on acceptance',async()=>{
  const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false});return elements.get(id);};
  $('tpToolModel').value='model';$('tpPrompt').value='edit';$('tpImage').value='imported';
  let input;
  const ctx=vm.createContext({$,toolModels:[{id:'model',model:'edit',provider:{protocol:'openai'}}],localStorage:{setItem(){},getItem(){return null;}},
    imageTools:{generate:async(_model,options)=>{input=options.reference;return 'result';}},asPng:async url=>url,
    toolValues:()=>({}),message(){},renderOptimizeHistory(){},imagePreview(){},persist(){},run:fn=>fn(),
    optimizeVersions:[{url:'original',label:'原图'},{url:'selected',label:'版本 1'}],optimizeSelected:1,optimizeOriginal:'original',optimizeBefore:true,reference:'unchanged',state:{kind:'image-to-model'}});
  vm.runInContext(source.match(/async function generateToolImage\(\) \{[\s\S]*?\n\}\nfunction sync/)[0].replace(/\nfunction sync$/,''),ctx);
  await vm.runInContext('generateToolImage()',ctx);
  assert.equal(input,'selected');assert.equal(ctx.reference,'unchanged');assert.equal($('tpImage').value,'imported');
  assert.equal(ctx.optimizeVersions.length,3);assert.equal(ctx.optimizeSelected,2);assert.equal(ctx.optimizeBefore,false);
  const accept=source.match(/\$\('tpOptimizeAccept'\)\.onclick=\(\)=>run\(async\(\)=>\{[\s\S]*?\n\}\);/)[0];
  vm.runInContext(accept,ctx);await $('tpOptimizeAccept').onclick();
  assert.equal(ctx.reference,'result');assert.equal($('tpImage').value,'');assert.equal($('tpOptimizer').hidden,true);
});

