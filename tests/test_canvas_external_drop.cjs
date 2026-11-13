const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/canvas.js', 'utf8');
let drop;
const received = [];
const context = vm.createContext({
    URL, Map, window:{}, internalDrag:false,
    board:{addEventListener:(name, handler)=>{drop=handler;}},
    dropOverlay:{classList:{remove(){}}},
    isSupportedUploadFile:f=>/\.(png|jpg)$/i.test(f.name),
    hasImageFiles:()=>false, screenToWorld:(x,y)=>({x,y}),
    applyImageDropPayloadToBoard:async payload=>received.push(payload),
    hasOutputImageDrag:dt=>dt.types.includes('application/x-canvas-output-image'),
    createImageCardFromOutput:url=>received.push({type:'output',url}),
    createImageCardFromUrl:url=>received.push({type:'asset',url}),
});
function load(start,end){const i=source.indexOf(start);assert.ok(i>=0);vm.runInContext(source.slice(i,source.indexOf(end,i+start.length)),context);}
load('const IMAGE_DROP_EXT_RE', 'async function importLocalImages(');
load('function isCanvasInputDrag(', 'function hasImageDropData(');
load('async function modelDropFiles(', "// 捕获阶段清理");
load("board.addEventListener('drop', async e => {", 'async function modelDropFiles(');
(async()=>{
    for(const [type,value,file] of [
        ['text/uri-list','http://127.0.0.1:8766/api/image?url=original&full=1'],
        ['Files','',{name:'original.png',type:'image/png'}],
        ['application/x-canvas-output-image','/outputs/picture.png'],
        ['application/x-canvas-asset',JSON.stringify({url:'/assets/picture.png',name:'asset'})],
    ]){
        let readable=true;
        const transfer={get types(){return readable?[type]:[];},get files(){return readable&&file?[file]:[];},items:[],getData:key=>readable&&key===type?value:''};
        const pending=drop({preventDefault(){},dataTransfer:transfer,target:{closest:()=>null},clientX:10,clientY:20});
        // 真正的浏览器会在 drop 同步分派结束后保护数据存储。
        readable=false;
        await pending;
        const result=received.at(-1);
        if(file)assert.equal(result.files[0],file);
        else assert.equal(result.url,type==='application/x-canvas-asset'?'/assets/picture.png':value);
    }
    assert.equal(received.length,4);
    console.log('CANVAS_EXTERNAL_DROP_OK: AssetVault URL/files and internal images survive async model checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
