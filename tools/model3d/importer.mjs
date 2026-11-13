// Browser-only local conversion. No uploaded model is allowed to fetch a remote dependency.
import {Group, Mesh, MeshStandardMaterial, LoadingManager, Color, Texture, Vector2,
    SphereGeometry, BoxGeometry, PlaneGeometry, DoubleSide, FrontSide,
    SRGBColorSpace, NoColorSpace, RepeatWrapping} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';
import {parseAsciiFbx} from './fbx-ascii.mjs';

const extensions = ['glb','gltf','fbx','obj','stl','ply'];
const extension = file => file.name.split('.').pop().toLowerCase();

// FBX 有两种封装：二进制（Kaydara FBX Binary，交给 three.js 的 FBXLoader）和 ASCII 文本
// （FBXLoader 读不了，走自带的 parseAsciiFbx）。先看文件头分流，再把失败原因说清楚。
function inspectFbx(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength < 27) throw new Error('FBX 文件不完整（不足 27 字节），请确认文件没有损坏或被截断');
    let magic = '';
    for (let i = 0; i < 21; i++) magic += String.fromCharCode(bytes[i]);
    if (magic === 'Kaydara FBX Binary  \u0000') {
        return { binary: true, version: bytes[23] | (bytes[24] << 8) | (bytes[25] << 16) | (bytes[26] << 24) };
    }
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.byteLength, 2048)));
    return { binary: false, version: 0, ascii: /(^|\n)\s*(;|FBXHeaderExtension\s*:|FBXVersion\s*:)/.test(head) };
}

// three.js 的 loader 抛的是英文内部异常，翻成用户能照着做的说明；已经是中文的错误原样透传。
function fbxError(error) {
    const message = String(error?.message || error || '');
    if (/[\u4e00-\u9fa5]/.test(message)) return error;
    if (/Unknown format/i.test(message)) return new Error('无法解析该 FBX：文件头不是标准二进制 FBX，请重新导出为 Binary FBX');
    if (/FBX version not supported/i.test(message)) return new Error('FBX 版本过旧，请导出 FBX 7.4（2014）或更高版本');
    if (/TGA loader not found/i.test(message)) return new Error('FBX 使用了 TGA 贴图但未能读取，请把 .tga 贴图与模型一起导入');
    return new Error('FBX 解析失败：' + message);
}
function pathKey(value) {
    const parts=[];
    for(const part of decodeURIComponent(value).replace(/\\/g,'/').split('/')) {
        if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);
    }
    return parts.join('/');
}
export async function convertModel(file, files=[file]) {
    if(!extensions.includes(extension(file)))throw new Error('支持 GLB、glTF、FBX、OBJ、STL、PLY');
    if(files.length>128||files.reduce((n,f)=>n+f.size,0)>256*1048576||file.size>100*1048576)throw new Error('模型最大 100 MiB，单批最多 128 个文件、256 MiB');
    if(extension(file)==='glb')return file;
    const urls=[],local=new Map(),basenames=new Map(),manager=new LoadingManager();
    manager.addHandler(/\.tga$/i,new TGALoader(manager));
    for(const item of files){
        const path=pathKey(item.webkitRelativePath||item.name);
        if(local.has(path))throw new Error('存在同名文件，请分批导入，或通过文件夹保留路径：'+path);
        local.set(path,item);
        const base=path.split('/').pop();basenames.set(base,basenames.has(base)?null:item);
    }
    let pending=0,complete,dependencyError;
    const ready=new Promise(resolve=>complete=resolve);
    const itemStart=manager.itemStart.bind(manager),itemEnd=manager.itemEnd.bind(manager);
    manager.itemStart=url=>{pending++;itemStart(url);};
    manager.itemEnd=url=>{itemEnd(url);if(!--pending)complete();};
    manager.onError=url=>{dependencyError=new Error('无法读取模型依赖：'+url);};
    manager.setURLModifier(url=>{
        if(/^(data:|blob:)/i.test(url))return url;
        if(/^[a-z][a-z\d+.-]*:|^\/\//i.test(url))throw new Error('模型不能读取网络资源，请将贴图与模型一起导入');
        const path=pathKey(url),dependency=local.get(path)||basenames.get(path.split('/').pop());
        if(!dependency)throw new Error('缺少或存在同名依赖，请将文件一起导入：'+path);
        const objectUrl=URL.createObjectURL(dependency);urls.push(objectUrl);return objectUrl;
    });
    let root,animations=[],timer;
    try {
        const buffer=await file.arrayBuffer(),format=extension(file);
        const base=pathKey(file.webkitRelativePath||file.name).split('/').slice(0,-1).join('/');
        const resourcePath=base?base+'/':'';
        if(format==='gltf'){
            const result=await new GLTFLoader(manager).parseAsync(new TextDecoder().decode(buffer),resourcePath);
            root=result.scene;animations=result.animations;
        }else if(format==='fbx'){
            const info=inspectFbx(buffer);
            if(info.ascii){
                root=parseAsciiFbx(new TextDecoder('utf-8').decode(buffer)).object;animations=[];
            }else if(info.binary){
                if(info.version<7000)throw new Error(`FBX 版本过旧（v${info.version}），需要 FBX 7.0（2011）及以上，建议导出 FBX 7.4（2014）`);
                try {
                    root=new FBXLoader(manager).parse(buffer,resourcePath);animations=root.animations||[];
                } catch (error) {
                    throw fbxError(error);
                }
            }else{
                throw new Error('无法识别的 FBX 文件头，可能不是 FBX 文件或已损坏，请确认后重新导出');
            }
            let meshes=0;
            root.traverse(object=>{if(object.isMesh&&object.geometry?.attributes?.position?.count)meshes++;});
            if(!meshes)throw new Error('这个 FBX 里没有可用的网格（可能只包含骨骼、相机或空节点），请在导出时勾选网格后重试');
        }else if(format==='obj'){
            const text=new TextDecoder().decode(buffer),materials=[];
            for(const match of text.matchAll(/^\s*mtllib\s+(.+)$/gm)){
                const name=pathKey(resourcePath+match[1].trim());
                const materialFile=local.get(name)||basenames.get(name.split('/').pop());
                if(!materialFile)throw new Error('缺少材质文件，请一起导入：'+name);
                const creator=new MTLLoader(manager).parse(await materialFile.text(),name.includes('/')?name.slice(0,name.lastIndexOf('/')+1):'');
                creator.preload();materials.push(creator);
            }
            const loader=new OBJLoader(manager);
            if(materials.length)loader.setMaterials({create:name=>materials.find(m=>Object.hasOwn(m.materialsInfo,name))?.create(name)||new MeshStandardMaterial()});
            root=loader.parse(text);
        }else{
            if(format==='ply'&&!/element\s+face\s+[1-9]\d*/.test(new TextDecoder().decode(buffer.slice(0,16384))))throw new Error('PLY 点云暂不支持，请导出含三角面的网格模型');
            const geometry=format==='stl'?new STLLoader().parse(buffer):new PLYLoader().parse(buffer);
            if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
            root=new Group();root.add(new Mesh(geometry,new MeshStandardMaterial({color:new Color(0xbac8d8),vertexColors:!!geometry.getAttribute('color')})));
        }
        if(pending)await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('模型贴图读取超时')),30000))]);
        if(dependencyError)throw dependencyError;
        const output=await new GLTFExporter().parseAsync(root,{binary:true,animations,onlyVisible:false});
        if(output.byteLength>100*1048576)throw new Error('转换后的模型超过 100 MiB，请先简化模型或贴图');
        return new File([output],file.name.replace(/\.[^.]+$/,'.glb'),{type:'model/gltf-binary'});
    } finally {
        clearTimeout(timer);urls.forEach(url=>URL.revokeObjectURL(url));
        root?.traverse(object=>{object.geometry?.dispose();for(const material of [].concat(object.material||[])){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}});
    }
}
// —— PBR 材质球 ——
// 把一组 PBR 贴图打成自包含 GLB，交给页面里已有的 <model-viewer> 渲染。
// 这样材质预览不必再引入一套 three 渲染器，光照、环绕、缩放和模型节点完全一致。
const BALL_GEOMETRIES = {
    sphere: () => new SphereGeometry(1, 64, 48),
    cube: () => new BoxGeometry(1.5, 1.5, 1.5, 2, 2, 2),
    plane: () => new PlaneGeometry(2, 2),
};
const clamp01 = (value, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback; };

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('贴图读取失败：' + String(url).split('/').pop()));
        image.src = url;
    });
}

// 按最长边等比缩放；小于上限时原样返回，避免无谓的重采样。
function fitImage(image, maxEdge) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale >= 1) return image;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function textureFrom(image, {srgb = false, repeat = 1} = {}) {
    const texture = new Texture(image);
    texture.needsUpdate = true;
    texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.channel = 0;
    texture.anisotropy = 4;
    return texture;
}

// glTF 只有一个 metallicRoughness 贴图：G = 粗糙度，B = 金属度。这里把两张灰度图合成一张。
function packMetallicRoughness(roughness, metallic, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    const pixels = image => {
        if (!image) return null;
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
    };
    const rough = pixels(roughness), metal = pixels(metallic);
    const output = context.createImageData(width, height);
    for (let i = 0; i < output.data.length; i += 4) {
        output.data[i] = 255;
        output.data[i + 1] = rough ? rough[i] : 255;
        output.data[i + 2] = metal ? metal[i] : 0;
        output.data[i + 3] = 255;
    }
    context.putImageData(output, 0, 0);
    return canvas;
}

export async function buildMaterialBall(maps = {}, options = {}) {
    const loaded = {};
    await Promise.all(['basecolor', 'normal', 'roughness', 'metallic', 'ao']
        .filter(channel => maps[channel])
        .map(async channel => { try { loaded[channel] = await loadImage(maps[channel]); } catch { loaded[channel] = null; } }));
    if (!Object.values(loaded).some(Boolean)) throw new Error('没有可用的 PBR 贴图，或贴图全部读取失败');
    const geometry = Object.hasOwn(BALL_GEOMETRIES, options.geometry) ? options.geometry : 'sphere';
    // 平铺滑条支持半档（0.5 起），四舍五入到 0.5，避免浮点尾巴进签名
    const repeat = Math.min(4, Math.max(0.5, Math.round((Number(options.repeat) || 1) * 2) / 2));
    const reference = loaded.basecolor || loaded.normal || loaded.roughness || loaded.metallic || loaded.ao;
    // 预览窗口只有 ~200px，贴图超过 512 只会白白拉高打包体积和显存。
    const maxEdge = Math.min(512, Math.max(64, Math.max(reference.naturalWidth || reference.width, reference.naturalHeight || reference.height)));
    const fit = {};
    for (const [channel, image] of Object.entries(loaded)) if (image) fit[channel] = fitImage(image, maxEdge);
    const material = new MeshStandardMaterial({color: 0xffffff, side: geometry === 'plane' ? DoubleSide : FrontSide});
    if (fit.basecolor) material.map = textureFrom(fit.basecolor, {srgb: true, repeat});
    if (fit.normal) {
        material.normalMap = textureFrom(fit.normal, {repeat});
        material.normalScale = new Vector2(clamp01(options.normalScale, 1), clamp01(options.normalScale, 1));
    }
    if (fit.ao) material.aoMap = textureFrom(fit.ao, {repeat});
    if (fit.roughness || fit.metallic) {
        const packedSource = fit.roughness || fit.metallic;
        const packed = textureFrom(packMetallicRoughness(fit.roughness, fit.metallic, packedSource.width, packedSource.height), {repeat});
        material.roughnessMap = packed;
        material.metalnessMap = packed;
        material.roughness = 1;
        material.metalness = 1;
    } else {
        material.roughness = clamp01(options.roughness, .66);
        material.metalness = clamp01(options.metallic, 0);
    }
    const root = new Group();
    root.add(new Mesh(BALL_GEOMETRIES[geometry](), material));
    const buffer = await new GLTFExporter().parseAsync(root, {binary: true, embedImages: true, maxTextureSize: 2048});
    return new Blob([buffer], {type: 'model/gltf-binary'});
}

if(typeof window!=='undefined')window.GameModelImport={extensions,accept:extensions.map(e=>'.'+e).join(','),isModel:file=>extensions.includes(extension(file)),convert:convertModel,materialBall:buildMaterialBall,geometries:Object.keys(BALL_GEOMETRIES)};
