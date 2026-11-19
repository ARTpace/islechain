const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/canvas-list.js', 'utf8');
const frames = [], classes = new Set();
let navigations = 0;
const ctx = {
    encodeURIComponent, currentProjectId: 'default', rememberProjectId(){}, L: zh => zh,
    window: {frameElement: {classList: {add: v => classes.add(v), remove: v => classes.delete(v)}}},
    document: {
        body: {appendChild: frame => frames.push(frame)},
        createElement(){ return {dataset: {}, style: {}, set src(value){ this.url = value; navigations++; }}; }
    }
};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('let canvasEditorFrame ='), source.indexOf('/* ===== Card create flow')), ctx);
ctx.openCanvas({id: 'a', project: 'p'});
assert.equal(navigations, 1);
assert(classes.has('canvas-editor'));
assert.equal(ctx.closeCanvasEditorInList(), true);
assert.equal(frames[0].hidden, true);
assert(!classes.has('canvas-editor'));
ctx.openCanvas({id: 'a', project: 'p'});
assert.equal(navigations, 1, 'reopening the same canvas must reuse the loaded editor');
assert.equal(frames[0].hidden, false);
ctx.openCanvas({id: 'b', kind: 'smart', project: 'p'});
assert.equal(frames.length, 1, 'keep only one editor instance');
assert.equal(navigations, 2);
assert(frames[0].url.startsWith('/static/smart-canvas.html?id=b&'));
for(const file of ['canvas.js', 'smart-canvas.js']){
    const editor = fs.readFileSync('static/js/' + file, 'utf8');
    assert(editor.includes('window.parent.closeCanvasEditorInList?.()'), file + ' must return without navigation');
}
console.log('Canvas navigation checks passed');
