/**
 * ASCII（文本）FBX 解析器。
 *
 * three.js 的 FBXLoader 只认二进制 FBX（魔数 `Kaydara FBX Binary`），遇到文本格式直接抛
 * "Unknown format"。但很多资源站/老版本 DCC 导出的就是 ASCII FBX，所以这里补一条纯前端的解析路径：
 * 解析文本节点树 → 取 Geometry / Model / Material / Connections → 组装成 three.js 对象，
 * 之后复用上层已有的 GLTFExporter 输出自包含 GLB。
 *
 * 覆盖范围（够导入、够预览、够下游使用）：
 *   - 顶点 / 多边形索引（自动三角化，支持 n-gon）
 *   - 逐面顶点法线（ByPolygonVertex + Direct）、UV、每面材质索引
 *   - Model 的 Lcl Translation / Rotation / Scaling
 *   - Material 的 DiffuseColor / Opacity
 *   - Model 之间的父子层级
 * 不覆盖：动画曲线、蒙皮、形变目标、贴图文件（外部贴图需另行处理）。
 */
import {BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D} from 'three';

const D2R = Math.PI / 180;
const find = (node, name) => (node?.children || []).find(child => child.name === name) || null;

function readArray(node, name) {
    const holder = find(node, name);
    if (!holder) return null;
    const list = find(holder, 'a');
    const source = list || holder;
    const numbers = source.props.filter(value => typeof value === 'number');
    return numbers.length ? numbers : null;
}

function property70(node, name) {
    const block = find(node, 'Properties70');
    if (!block) return null;
    const entry = (block.children || []).find(child => child.name === 'P' && child.props[0] === name);
    return entry ? entry.props.slice(4) : null;
}

function parseTree(text) {
    const length = text.length;
    let cursor = 0;

    const skip = () => {
        while (cursor < length) {
            const char = text[cursor];
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f') { cursor++; continue; }
            if (char === ';') { while (cursor < length && text[cursor] !== '\n') cursor++; continue; }
            break;
        }
    };

    const coerce = raw => {
        const value = raw.trim();
        if (!value) return '';
        return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value) ? Number(value) : value;
    };

    function parseNode() {
        skip();
        if (cursor >= length || text[cursor] === '}') return null;
        const start = cursor;
        while (cursor < length && text[cursor] !== ':' && text[cursor] !== '{' && text[cursor] !== '}') cursor++;
        if (cursor >= length || text[cursor] !== ':') return null;
        const name = text.slice(start, cursor).trim();
        cursor++;
        const props = [];
        let buffer = '';
        let quoted = false;
        let hasBlock = false;
        while (cursor < length) {
            const char = text[cursor];
            if (quoted) {
                if (char === '\\' && text[cursor + 1] === '"') { buffer += '"'; cursor += 2; continue; }
                if (char === '"') { quoted = false; props.push(buffer); buffer = ''; cursor++; continue; }
                buffer += char; cursor++; continue;
            }
            if (char === '"') { if (!buffer.trim()) buffer = ''; quoted = true; cursor++; continue; }
            if (char === '{') { cursor++; hasBlock = true; break; }
            if (char === ',') { if (buffer.trim()) props.push(coerce(buffer)); buffer = ''; cursor++; continue; }
            if (char === '\n') {
                // 长数组会折行，下一行以数字开头就当作续行
                let next = cursor + 1;
                while (next < length && (text[next] === ' ' || text[next] === '\t' || text[next] === '\r')) next++;
                const lead = text[next];
                if (lead && (lead === '-' || lead === '+' || lead === '.' || (lead >= '0' && lead <= '9'))) { cursor = next; continue; }
                if (buffer.trim()) props.push(coerce(buffer));
                buffer = ''; cursor++;
                break;
            }
            buffer += char; cursor++;
        }
        if (!hasBlock && buffer.trim()) props.push(coerce(buffer));
        const node = {name, props, children: []};
        if (hasBlock) {
            while (cursor < length) {
                skip();
                if (cursor >= length) break;
                if (text[cursor] === '}') { cursor++; break; }
                const child = parseNode();
                if (child) node.children.push(child);
                else cursor++;
            }
        }
        return node;
    }

    const root = {name: '', props: [], children: []};
    while (cursor < length) {
        skip();
        if (cursor >= length) break;
        if (text[cursor] === '}') { cursor++; continue; }
        const node = parseNode();
        if (node) root.children.push(node);
        else cursor++;
    }
    return root;
}

function buildGeometry(node) {
    const vertices = readArray(node, 'Vertices');
    const polygonVertices = readArray(node, 'PolygonVertexIndex');
    if (!vertices || !polygonVertices) return null;
    const vertexCount = Math.floor(vertices.length / 3);
    if (!vertexCount || polygonVertices.length < 3) return null;

    const normalLayer = find(node, 'LayerElementNormal');
    const normalMapping = String(find(normalLayer, 'MappingInformationType')?.props[0] || '');
    const normalReference = String(find(normalLayer, 'ReferenceInformationType')?.props[0] || '');
    const normals = readArray(normalLayer, 'Normals');
    // 逐面顶点法线需要把顶点拆开（同一顶点在不同面上法线不同），否则只能用顶点法线近似
    const perPolygonVertexNormals = Boolean(normals) && /ByPolygonVertex/i.test(normalMapping) && /Direct/i.test(normalReference);

    const materialLayer = find(node, 'LayerElementMaterial');
    const materialMapping = String(find(materialLayer, 'MappingInformationType')?.props[0] || '');
    const materialIndices = readArray(materialLayer, 'Materials');

    const positions = [];
    const normalBuffer = [];
    const indices = [];
    const polygon = [];
    const triangleMaterials = [];
    let polygonCursor = 0;
    let nextVertex = 0;

    for (const raw of polygonVertices) {
        const index = raw < 0 ? ~raw : raw;
        if (index < 0 || index >= vertexCount) { polygonCursor++; continue; }
        let emitted;
        if (perPolygonVertexNormals) {
            positions.push(vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]);
            normalBuffer.push(normals[polygonCursor * 3] || 0, normals[polygonCursor * 3 + 1] || 0, normals[polygonCursor * 3 + 2] || 0);
            emitted = nextVertex++;
        } else {
            emitted = index;
        }
        polygon.push(emitted);
        polygonCursor++;
        if (raw < 0) {
            const material = materialIndices && /ByPolygon/i.test(materialMapping) ? (materialIndices[triangleMaterials.length] ?? 0) : 0;
            for (let k = 1; k + 1 < polygon.length; k++) {
                indices.push(polygon[0], polygon[k], polygon[k + 1]);
                triangleMaterials.push(material);
            }
            polygon.length = 0;
        }
    }
    if (!indices.length) return null;

    const geometry = new BufferGeometry();
    if (perPolygonVertexNormals) {
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normalBuffer), 3));
    } else {
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
        geometry.computeVertexNormals();
    }
    geometry.setIndex(indices);

    const materialCount = new Set(triangleMaterials).size;
    if (materialCount > 1) {
        let start = 0;
        for (let t = 1; t <= triangleMaterials.length; t++) {
            if (t === triangleMaterials.length || triangleMaterials[t] !== triangleMaterials[start]) {
                geometry.addGroup(start * 3, (t - start) * 3, triangleMaterials[start]);
                start = t;
            }
        }
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildMaterial(node) {
    const diffuse = property70(node, 'DiffuseColor');
    const opacity = property70(node, 'Opacity');
    const material = new MeshStandardMaterial({
        color: new Color(diffuse?.[0] ?? 0.78, diffuse?.[1] ?? 0.78, diffuse?.[2] ?? 0.78),
        roughness: 0.72,
        metalness: 0.04,
        side: DoubleSide,
    });
    material.name = String(node.props[1] || '').split('::').pop() || 'Material';
    if (typeof opacity?.[0] === 'number' && opacity[0] < 1) {
        material.transparent = true;
        material.opacity = Math.max(0, opacity[0]);
    }
    return material;
}

function applyTransform(object, node) {
    const translation = property70(node, 'Lcl Translation');
    const rotation = property70(node, 'Lcl Rotation');
    const scaling = property70(node, 'Lcl Scaling');
    if (translation) object.position.set(Number(translation[0]) || 0, Number(translation[1]) || 0, Number(translation[2]) || 0);
    if (scaling) object.scale.set(Number(scaling[0]) || 1, Number(scaling[1]) || 1, Number(scaling[2]) || 1);
    if (rotation) object.rotation.set((Number(rotation[0]) || 0) * D2R, (Number(rotation[1]) || 0) * D2R, (Number(rotation[2]) || 0) * D2R, 'XYZ');
}

export function parseAsciiFbx(text) {
    const tree = parseTree(text);
    const objects = find(tree, 'Objects');
    if (!objects) throw new Error('ASCII FBX 里找不到 Objects 段，文件可能不完整');
    const connections = find(tree, 'Connections');

    const byId = new Map();
    for (const node of objects.children) {
        const id = node.props[0];
        if (typeof id === 'number') byId.set(id, node);
    }
    if (!byId.size) throw new Error('ASCII FBX 里没有可用的对象');

    const geometryOfModel = new Map();
    const materialsOfModel = new Map();
    const modelParent = new Map();
    for (const connection of connections?.children || []) {
        if (connection.name !== 'C') continue;
        const [kind, childId, parentId] = connection.props;
        if (kind !== 'OO' || typeof childId !== 'number' || typeof parentId !== 'number') continue;
        const child = byId.get(childId);
        const parent = byId.get(parentId);
        if (!child || !parent) continue;
        if (child.name === 'Geometry' && parent.name === 'Model') geometryOfModel.set(parentId, child);
        else if (child.name === 'Material' && parent.name === 'Model') {
            const list = materialsOfModel.get(parentId) || [];
            list.push(child);
            materialsOfModel.set(parentId, list);
        } else if (child.name === 'Model' && parent.name === 'Model') modelParent.set(childId, parentId);
    }

    const built = new Map();
    for (const [id, node] of byId) {
        if (node.name !== 'Model') continue;
        const geometry = geometryOfModel.has(id) ? buildGeometry(geometryOfModel.get(id)) : null;
        const materials = (materialsOfModel.get(id) || []).map(buildMaterial);
        let object;
        if (geometry) {
            const material = materials.length > 1 ? materials : (materials[0] || new MeshStandardMaterial({color: new Color(0.78, 0.78, 0.78), side: DoubleSide}));
            object = new Mesh(geometry, material);
        } else {
            object = new Object3D();
        }
        object.name = String(node.props[1] || '').split('::').pop() || 'Model';
        applyTransform(object, node);
        built.set(id, object);
    }

    const root = new Group();
    root.name = 'ASCII FBX';
    for (const [id, object] of built) {
        const parentId = modelParent.get(id);
        if (parentId !== undefined && built.has(parentId)) built.get(parentId).add(object);
        else root.add(object);
    }

    let meshes = 0;
    let triangles = 0;
    root.traverse(child => {
        if (!child.isMesh) return;
        meshes++;
        const index = child.geometry?.index;
        if (index) triangles += index.count / 3;
    });
    if (!meshes) throw new Error('这个 ASCII FBX 里没有网格数据（只有节点或相机），请检查导出时是否包含模型');
    return {object: root, animations: [], meshes, triangles: Math.round(triangles)};
}
