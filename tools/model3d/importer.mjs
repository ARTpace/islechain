// Browser-only local conversion. No uploaded model is allowed to fetch a remote dependency.
import {Group, Mesh, MeshStandardMaterial, LoadingManager, Color} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {TGALoader} from 'three/addons/loaders/TGALoader.js';

const extensions = ['glb','gltf','fbx','obj','stl','ply'];
const extension = file => file.name.split('.').pop().toLowerCase();
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
            root=new FBXLoader(manager).parse(buffer,resourcePath);animations=root.animations||[];
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
if(typeof window!=='undefined')window.GameModelImport={extensions,accept:extensions.map(e=>'.'+e).join(','),isModel:file=>extensions.includes(extension(file)),convert:convertModel};
