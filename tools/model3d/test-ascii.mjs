import fs from 'node:fs';
import { parseAsciiFbx } from './fbx-ascii.mjs';

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const checks = [];
const check = (label, ok, detail = '') => { checks.push({ label, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`); };

console.log('file     :', file, (text.length / 1024).toFixed(1), 'KB\n');

let result;
try {
    result = parseAsciiFbx(text);
} catch (error) {
    console.log('FAILED   :', error.message);
    process.exit(1);
}

let meshes = 0, verts = 0, tris = 0, normals = 0;
result.object.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    verts += o.geometry.attributes.position.count;
    normals += o.geometry.attributes.normal?.count || 0;
    if (o.geometry.index) tris += o.geometry.index.count / 3;
});

check('解析出网格', meshes > 0, `${meshes} 个 mesh`);
check('有三角面', tris > 0, `${Math.round(tris)} 个三角形`);
check('顶点数合理', verts > 0, `${verts} 个顶点`);
check('法线已生成', normals === verts, `${normals} 个法线 / ${verts} 顶点`);

const mesh = (() => { let found = null; result.object.traverse(o => { if (o.isMesh && !found) found = o; }); return found; })();
if (mesh) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const hex = mat.color.getHexString();
    check('材质颜色非默认灰', hex !== 'bac8d8', '#' + hex);
    check('材质透明度已读取', mat.transparent === (mat.opacity < 1), `opacity=${mat.opacity} transparent=${mat.transparent}`);

    const parent = mesh.parent && mesh.parent !== result.object ? mesh.parent : mesh;
    const pos = parent.position;
    const rotY = parent.rotation.y;
    check('Lcl Translation 生效', pos.x !== 0 || pos.y !== 0 || pos.z !== 0, `(${pos.x}, ${pos.y}, ${pos.z})`);
    check('Lcl Rotation 生效', Math.abs(rotY) > 1e-6, `rotY=${(rotY * 180 / Math.PI).toFixed(1)}°`);

    const box = mesh.geometry.boundingBox;
    check('包围盒有效', Boolean(box), box ? `min=${box.min.toArray()} max=${box.max.toArray()}` : '无');
}

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) process.exit(1);
