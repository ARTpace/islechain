const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const i18n = fs.readFileSync('static/js/i18n.js', 'utf8');
const appended = [];
let applied = 0;
const ctx = {window:{StudioI18n:{apply(){applied++;}}},console,
    document:{readyState:'interactive',createElement:()=>({}),head:{appendChild(script){appended.push(script);}}}};
vm.runInNewContext(i18n,ctx);
assert.equal(appended.length,7,'所有语言包同时开始下载，不等待前一个完成');
assert(appended.every(s=>s.async===false),'必须按插入顺序执行');
assert(appended[0].src.includes('i18n-core.js'));
assert.equal(applied,0);
appended.forEach(script=>script.onload());
const asset = fs.readFileSync('static/modules/asset-library.js','utf8');
let loads=0;
const overlay={classList:{add(){},contains(){return true;}}};
const assets={console,_library:null,_rendered:true,_multiSelect:false,
    _injectCss(){},_render(){},_applyKindFilter(){},
    loadLibrary(){loads++;},$:id=>id==='assetLibraryOverlay'?overlay:null,
    document:{body:{classList:{add(){}}}}};
vm.createContext(assets);
const initStart=asset.indexOf('  function init(opts)');
const initEnd=asset.indexOf('  // 监听全局变更事件',initStart);
vm.runInContext(asset.slice(initStart,initEnd),assets);
assets.init({});
assert.equal(loads,0,'隐藏素材库不预取');
const openStart=asset.indexOf('  function open(opts)');
vm.runInContext(asset.slice(openStart,asset.indexOf('  function close()',openStart)),assets);
assets.open();
assert.equal(loads,1,'打开素材库仍正常加载');
new Promise(resolve=>setImmediate(resolve)).then(()=>{
    assert.equal(applied,1);
    console.log('首屏加载：语言包并行下载且有序执行、素材库按需加载通过');
}).catch(error=>{console.error(error);process.exitCode=1;});
