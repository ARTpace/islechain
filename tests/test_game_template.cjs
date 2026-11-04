// 宿主模拟环境的玩法逻辑检查；不能代替真实浏览器输入与设备验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../templates/game-web-native/game.js'), 'utf8');
function game({target = 1, enemySpeed = 0, hp = 3, namespace = 'play'} = {}) {
    const handlers = {}, elements = {}, storage = new Map();
    const context = {fillRect() {}, beginPath() {}, arc() {}, fill() {}, drawImage() {}};
    const canvas = {getContext: () => context};
    for (const id of ['hud', 'message', 'restart', 'pause', 'save', 'load', 'clear', 'slot']) elements[id] = {textContent: '', value: '1'};
    let frame, now = 100;
    const sandbox = {window: {GAME_CONFIG: {projectId: 'test', saveSlot: namespace, assets: {}, content: {datasets: [
        {datasetId: 'characters', rows: [{values: {speed: 200, hp}}]},
        {datasetId: 'enemies', rows: [{id: 'slime', values: {speed: enemySpeed, damage: 1}}]},
        {datasetId: 'levels', rows: [{values: {target, enemy: 'slime'}}]},
    ]}}, addEventListener: (type, fn) => { handlers[type] = fn; }},
    document: {querySelector: () => canvas, getElementById: id => elements[id]},
    HTMLInputElement: class {}, HTMLSelectElement: class {}, Image: class {},
    requestAnimationFrame: fn => { frame = fn; },
    localStorage: {setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k)},
    };
    vm.runInNewContext(source, sandbox, {timeout: 1000});
    function ticks(count) { for (let i = 0; i < count; i++) { now += 50; frame(now); } }
    function key(type, value) { handlers[type]({key: value, target: {}, preventDefault() {}}); }
    function saved() { elements.save.onclick(); return JSON.parse([...storage.values()][0]); }
    return {elements, storage, handlers, ticks, key, saved};
}
{
    const g = game(); g.ticks(1);
    g.key('keydown', 'ArrowRight'); g.ticks(9); g.key('keyup', 'ArrowRight');
    assert.equal(g.saved().x, 160);
    g.ticks(3); assert.equal(g.saved().x, 160);
    g.key('keydown', 'ArrowDown'); g.ticks(5); g.key('keyup', 'ArrowDown');
    assert.match(g.elements.hud.textContent, /won/);
    assert.equal(g.saved().collected, 1);
    g.elements.restart.onclick(); assert.equal(g.saved().collected, 0); assert.equal(g.saved().x, 70);
}
{
    const g = game({enemySpeed: 2000, hp: 1}); g.ticks(30);
    assert.match(g.elements.hud.textContent, /lost/);
    g.elements.restart.onclick(); assert.equal(g.saved().hp, 1); assert.equal(g.saved().status, 'playing');
    g.elements.pause.onclick(); g.key('keydown', 'd'); g.ticks(4); assert.equal(g.saved().x, 70);
    g.elements.pause.onclick(); g.handlers.blur(); g.ticks(1); assert.equal(g.saved().x, 70);
}
{
    const g = game(); const original = g.saved();
    g.elements.slot.value = '2'; g.elements.load.onclick(); assert.match(g.elements.message.textContent, /没有存档/);
    g.elements.slot.value = '1'; g.elements.load.onclick(); assert.equal(g.saved().x, original.x);
    const key = [...g.storage.keys()][0]; g.storage.set(key, '{corrupted'); g.elements.load.onclick();
    assert.equal(g.storage.get(key), '{corrupted');
    g.elements.clear.onclick(); assert.equal(g.storage.get(key + ':backup'), '{corrupted'); assert(!g.storage.has(key));
    const test = game({namespace: 'test-session'}); test.saved(); assert.notEqual([...test.storage.keys()][0], key);
}
console.log('GAME_TEMPLATE_LOGIC_OK');
