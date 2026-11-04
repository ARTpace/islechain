import assert from 'node:assert/strict';
import {convertModel} from '../tools/model3d/importer.mjs';
globalThis.ProgressEvent=class extends Event {constructor(type,values){super(type);Object.assign(this,values);}};
// Node has Blob/File but lacks FileReader; use its native Blob reads for exporter tests.
globalThis.FileReader=class {
    readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}
    readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+blob.type+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.();});}
};
function documentFrom(buffer){
    const view=new DataView(buffer);assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);
    return JSON.parse(new TextDecoder().decode(buffer.slice(20,20+view.getUint32(12,true))).trim());
}
const examples={
    obj:'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n',
    stl:'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle',
    ply:'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
    fbx:`; FBX 7.4.0 project file
FBXHeaderExtension:  {
    FBXVersion: 7400
}
Objects:  {
    Geometry: 1, "Geometry::Triangle", "Mesh" {
        Vertices: *9 {
            a: 0,0,0,1,0,0,0,1,0
        }
        PolygonVertexIndex: *3 {
            a: 0,1,-3
        }
    }
    Model: 2, "Model::Triangle", "Mesh" {
        Version: 232
    }
}
Connections:  {
    C: "OO",1,2
    C: "OO",2,0
}
`,
};
for(const [ext,text] of Object.entries(examples)){
    const output=await convertModel(new File([ext==='fbx'?text.replace(/ {4}/g,'\t'):text],'triangle.'+ext));
    assert.equal(output.name,'triangle.glb');
    const doc=documentFrom(await output.arrayBuffer());
    assert.ok(doc.meshes.length);assert.equal(doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION].count,3);
}
const bytes=new Float32Array([0,0,0,1,0,0,0,1,0]);
const gltf={asset:{version:'2.0'},buffers:[{uri:'triangle.bin',byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
const file=new File([JSON.stringify(gltf)],'triangle.gltf'),bin=new File([bytes],'triangle.bin');
const output=await convertModel(file,[file,bin]);assert.ok(documentFrom(await output.arrayBuffer()).meshes.length);
const animationBytes=new Float32Array([...bytes,0,1,0,0,0,1,0,0]);
const animated=structuredClone(gltf);animated.buffers[0].byteLength=animationBytes.byteLength;
animated.bufferViews.push({buffer:0,byteOffset:36,byteLength:8},{buffer:0,byteOffset:44,byteLength:24});
animated.accessors.push({bufferView:1,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]},{bufferView:2,componentType:5126,count:2,type:'VEC3'});
animated.animations=[{name:'Move',samplers:[{input:1,output:2,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}];
const animatedFile=new File([JSON.stringify(animated)],'animated.gltf');
const animatedOutput=await convertModel(animatedFile,[animatedFile,new File([animationBytes],'triangle.bin')]);
const animatedDoc=documentFrom(await animatedOutput.arrayBuffer());assert.equal(animatedDoc.animations[0].name,'Move');
assert.ok(animatedDoc.buffers.every(b=>!b.uri),'转换结果自包含，不再依赖本地 BIN');
await assert.rejects(convertModel(file,[file]),/缺少/);
gltf.buffers[0].uri='http://127.0.0.1:9/private.bin';
await assert.rejects(convertModel(new File([JSON.stringify(gltf)],'remote.gltf')),/网络资源/);
await assert.rejects(convertModel(new File([examples.obj],'model.blend')),/支持/);
await assert.rejects(convertModel(new File([examples.obj],'same.obj'),[new File([''],'x.png'),new File([''],'x.png')]),/同名/);
await assert.rejects(convertModel(new File([examples.ply.replace('element face 1','element face 0')],'points.ply')),/点云/);
assert.equal(await convertModel(output),output,'GLB 原样复用');
console.log('GAME_MODEL_IMPORT_OK: OBJ / STL / PLY / FBX / glTF + BIN / GLB; missing and remote dependencies rejected');
