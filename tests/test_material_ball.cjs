/* PBR 材质球：通道识别与贴图来源汇总（不依赖 DOM 的部分） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(nodes, connections, refs) {
    const context = {
        window: {},
        nodes,
        connections,
        imageRefsFromNode: refs || (node => node.url ? [{url: node.url, name: node.name || node.url}] : []),
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('static/js/canvas-material-preview.js', 'utf8'), context);
    return context.window.CanvasMaterialPreview;
}

// 1. 文件名 → 通道
const {channelFor} = load([], []);
const cases = [
    ['brick_basecolor.png', 'basecolor'],
    ['Brick_Albedo.PNG', 'basecolor'],
    ['wall_color.jpg', 'basecolor'],
    ['砖墙_颜色.png', 'basecolor'],
    ['brick_normal.png', 'normal'],
    ['wall_NRM.jpg', 'normal'],
    ['brick_rough.png', 'roughness'],
    ['brick_metallic.png', 'metallic'],
    ['brick_metal.png', 'metallic'],
    ['brick_ao.png', 'ao'],
    ['brick_occlusion.png', 'ao'],
    ['photo.png', null],
    ['IMG_0042.jpg', null],
];
for (const [name, expected] of cases) assert.equal(channelFor(name), expected, `${name} → ${expected}`);

// 2. PBR 材质节点：通道已知，直接用 result.maps
const material = {id: 'pbr', type: 'materialPbr', name: '红砖', materialJob: {result: {maps: {
    basecolor: '/m/basecolor.png', normal: '/m/normal.png', roughness: '/m/roughness.png', metallic: '/m/metallic.png', ao: '/m/ao.png', height: '/m/height.png',
}}}};
const ball = {id: 'ball', type: 'model3d'};
let api = load([material, ball], [{from: 'pbr', to: 'ball'}]);
let data = api.sources(ball);
assert.deepEqual(Object.keys(data.maps).sort(), ['ao', 'basecolor', 'height', 'metallic', 'normal', 'roughness']);
assert.equal(data.maps.normal, '/m/normal.png');
assert.equal(data.from.basecolor, '红砖');
assert.equal(data.geometry, 'sphere', '默认球体');
assert.equal(data.repeat, 1);

// 3. 没有连线的模型节点不产生预览
assert.equal(api.sources({id: 'lonely', type: 'model3d'}), null);
assert.equal(api.sources({id: 'x', type: 'image'}), null, '非模型节点不参与');

// 4. 普通图片节点按文件名识别通道
const loose = {id: 'loose', type: 'model3d', ballGeometry: 'plane', ballRepeat: 3};
api = load([{id: 'i1', type: 'image', name: 'brick_normal.png', url: '/a/n.png'},
            {id: 'i2', type: 'image', name: 'brick_color.png', url: '/a/c.png'}, loose],
           [{from: 'i1', to: 'loose'}, {from: 'i2', to: 'loose'}]);
data = api.sources(loose);
assert.deepEqual(Object.keys(data.maps).sort(), ['basecolor', 'normal']);
assert.equal(data.maps.normal, '/a/n.png');
assert.equal(data.geometry, 'plane');
assert.equal(data.repeat, 3);

// 5. 同一通道以第一条连线为准，后面的不覆盖
api = load([{id: 'i1', type: 'image', name: 'a_color.png', url: '/a/1.png'},
            {id: 'i2', type: 'image', name: 'b_basecolor.png', url: '/a/2.png'}, ball],
           [{from: 'i1', to: 'ball'}, {from: 'i2', to: 'ball'}]);
assert.equal(api.sources(ball).maps.basecolor, '/a/1.png');

// 6. 只连了非贴图名字的图片 → 没有可用通道，不生成预览
api = load([{id: 'i3', type: 'image', name: 'screenshot.png', url: '/a/s.png'}, ball],
           [{from: 'i3', to: 'ball'}]);
assert.equal(api.sources(ball), null);

// 7. 平铺次数越界要收敛到 1–4
api = load([material, ball], [{from: 'pbr', to: 'ball'}]);
assert.equal(api.sources({...ball, ballRepeat: 99}).repeat, 4);
assert.equal(api.sources({...ball, ballRepeat: 0}).repeat, 1);
assert.equal(api.sources({...ball, ballRepeat: 'abc'}).repeat, 1);
assert.equal(api.sources({...ball, ballRepeat: 1.2}).repeat, 1.2);
assert.equal(api.sources({...ball, ballRepeat: 1.3}).repeat, 1.3);

console.log('material ball: channel detection, map sources, plane repeat and dedupe passed');

assert.equal(channelFor('wood_height.png'),'height');
assert.equal(channelFor('wood_displacement.png'),'height');
