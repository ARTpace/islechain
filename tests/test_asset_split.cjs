/* Run: node tests/test_asset_split.cjs [source.png output-directory] */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process');
const context={window:{},Blob,TextEncoder,ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},document:{createElement:()=>({getContext:()=>({putImageData(){}}),toDataURL:()=>''})}};
vm.createContext(context);
for(const file of ['sprite-sheet-split.js','asset-split-export.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js',file),'utf8'),context);
const options={background:'auto',threshold:24,margin:1,minArea:4,eraseDividers:false,openRadius:0,defringe:false};
function fixture(bg){const image=new context.ImageData(24,16);for(let i=0;i<image.data.length;i+=4)image.data.set(bg,i);for(const [x0,y0,color] of [[2,2,[240,50,20,255]],[14,7,[30,100,230,255]]])for(let y=y0;y<y0+4;y++)for(let x=x0;x<x0+4;x++)image.data.set(color,(y*24+x)*4);return image;}
for(const bg of [[0,0,0,255],[255,255,255,255],[0,0,0,0]]){const pieces=context.SpriteSheetSplit.splitSpriteSheet(fixture(bg),options);assert.equal(pieces.length,2);assert.equal(pieces[0].pixelCount,16);assert.equal(pieces[0].image.data[3],0);assert.equal(pieces[0].x,1);}
for(const file of ['canvas-asset-split.js','canvas-generation-sources.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js',file),'utf8'),context);
const source={id:'split1',type:'assetSplit',splitPieces:[{url:'/assets/a.png',name:'A',selected:true},{url:'/assets/b.png',name:'B',selected:false}]};
const splitApi=context.window.CanvasAssetSplit,sources=context.window.CanvasGenerationSources;
assert.equal(splitApi.images(source).length,1);
assert.equal(splitApi.canConnect(source,{type:'output'}),true);
assert.equal(splitApi.canConnect(source,{type:'assetSplit'}),false);
assert.equal(sources.mediaRefsFromNode(source)[0].url,'/assets/a.png');
sources.init({nodes:()=>[source],connections:()=>[{from:'split1',to:'gen'}]});
assert.equal(sources.generatorSources({id:'gen'})[0].refs[0].name,'A');
(async()=>{
const pieces=context.SpriteSheetSplit.splitSpriteSheet(fixture([0,0,0,0]),options);pieces[0].name='中文图层';
const zip=Buffer.from(await context.window.AssetSplitExport.zip([{name:'测试.txt',bytes:new TextEncoder().encode('test-content')}]).arrayBuffer());
const psd=Buffer.from(await context.window.AssetSplitExport.psd(24,16,pieces).arrayBuffer());
execFileSync('python',['-c',`import io,sys,json,base64,zipfile
from PIL import Image
v=json.load(sys.stdin)
with zipfile.ZipFile(io.BytesIO(base64.b64decode(v['zip']))) as z:
 assert z.testzip() is None
 assert z.read('测试.txt')==b'test-content'
im=Image.open(io.BytesIO(base64.b64decode(v['psd'])))
assert im.size==(24,16)
assert im.getpixel((3,3))[:3]==(240,50,20)
assert im.getpixel((15,8))[:3]==(30,100,230)
assert len(im.layers)==2
`],{input:JSON.stringify({zip:zip.toString('base64'),psd:psd.toString('base64')}),encoding:'utf8'});
if(process.argv[2]){
 const raw=JSON.parse(execFileSync('python',['-c',"from PIL import Image;import sys,json,base64;i=Image.open(sys.argv[1]).convert('RGBA');print(json.dumps(dict(width=i.width,height=i.height,data=base64.b64encode(i.tobytes()).decode())))",process.argv[2]],{encoding:'utf8',maxBuffer:160*1024*1024}));
 const image=new context.ImageData(raw.width,raw.height);image.data.set(Buffer.from(raw.data,'base64'));
 const parts=context.SpriteSheetSplit.splitSpriteSheet(image,{...options,minArea:80,margin:2,defringe:true});
 const out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'拆分素材.psd'),Buffer.from(await context.window.AssetSplitExport.psd(raw.width,raw.height,parts).arrayBuffer()));
 const files=JSON.parse(execFileSync('python',['-c',`import io,sys,json,base64
from PIL import Image
v=json.load(sys.stdin);out=[]
for p in v:
 im=Image.frombytes('RGBA',(p['w'],p['h']),base64.b64decode(p['data']));b=io.BytesIO();im.save(b,format='PNG');out.append(dict(name=p['id']+'.png',data=base64.b64encode(b.getvalue()).decode()))
print(json.dumps(out))`],{input:JSON.stringify(parts.map(p=>({id:p.id,w:p.w,h:p.h,data:Buffer.from(p.image.data).toString('base64')}))),encoding:'utf8',maxBuffer:160*1024*1024}));
 const manifest={width:raw.width,height:raw.height,layers:parts.map(({id,x,y,w,h})=>({id,x,y,w,h}))};
 files.push({name:'layout.json',data:Buffer.from(JSON.stringify(manifest,null,2)).toString('base64')});
 fs.writeFileSync(path.join(out,'拆分素材.zip'),Buffer.from(await context.window.AssetSplitExport.zip(files.map(f=>({name:f.name,bytes:Buffer.from(f.data,'base64')}))).arrayBuffer()));
 console.log(`Reference: ${raw.width}x${raw.height}, ${parts.length} components; ZIP + PSD: ${out}`);
}
console.log('PASS: black/white/alpha splitting; transparent margin; ZIP CRC + Unicode names; PSD dimensions, merged pixels and layer count');
})().catch(e=>{console.error(e);process.exitCode=1;});
