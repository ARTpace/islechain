// 验证真实页面的工作流绑定，避免只检查 JSON 文件是否存在。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const editPage = fs.readFileSync(path.join(root, 'static/app/klein.html'), 'utf8');
const textPage = fs.readFileSync(path.join(root, 'static/app/zimage.html'), 'utf8');
const load = name => JSON.parse(fs.readFileSync(path.join(root, 'workflows', name), 'utf8'));

for (const page of [editPage, textPage]) {
    for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2]);
    }
}
const edit = load('image-edit/qwen-image-2.1.json');
const text = load('text2image/qwen-image-2.1.json');
const mossEdit = load('image-edit/moss-image-sft.json');
const start = editPage.indexOf('async function buildWorkflowForModel(');
const end = editPage.indexOf('async function handleGenerate()', start);
const context = vm.createContext({
    getWorkflowForModel: model => ({ workflow: model === 'moss' ? mossEdit : edit }),
    uploadedImages: ['main.png', 'reference.png'], ignoreRef: false,
});
vm.runInContext(editPage.slice(start, end), context);

(async () => {
    let result = await context.buildWorkflowForModel('qwen21', '改为蓝色', 1234, true, 768);
    assert.equal(result['23'].inputs.text, '改为蓝色');
    assert.equal(result['22'].inputs.seed, 1234);
    assert.equal(result['11'].inputs.largest_size, 768);
    assert.equal(result['14'].inputs.image, 'main.png');
    assert.equal(result['15'].inputs.image, 'reference.png');
    assert.equal(result['6'].inputs['images.image_2'][0], '15');
    assert.equal(result['22'].inputs.latent_image[1], 2);
    context.ignoreRef = true;
    result = await context.buildWorkflowForModel('qwen21', '编辑', 5678, false, 1024);
    assert.equal(result['11'], undefined);
    assert.equal(result['15'], undefined);
    assert.equal(result['6'].inputs['images.image_1'][0], '14');
    assert.equal(edit['14'].inputs.image, 'example.png');

    result = await context.buildWorkflowForModel('moss', '蓝色茶壶', 9012, true, 768);
    assert.equal(result['23'].inputs.text, '蓝色茶壶');
    assert.equal(result['22'].inputs.seed, 9012);
    assert.equal(result['11'].inputs.largest_size, 768);
    assert.equal(result['22'].inputs.denoise, 0.65);
    assert.equal(result['15'].inputs.pixels[0], '11');
    result = await context.buildWorkflowForModel('moss', '蓝色茶壶', 9012, false, 768);
    assert.equal(result['11'], undefined);
    assert.equal(result['15'].inputs.pixels[0], '14');
    assert.equal(result['6'].inputs['images.image_2'], undefined);

    // 文生图复用页面已有的 23 / 144 / 22 参数绑定。
    assert.equal(text['6'].inputs.prompt[0], '23');
    assert.equal(text['22'].inputs.latent_image[0], '144');
    assert.equal(text['22'].inputs.positive[1], 0);
    assert.equal(text['22'].inputs.negative[1], 1);
    const negStart = textPage.indexOf('function mergeExtraNegative(');
    const negEnd = textPage.indexOf('\n        function ', negStart + 1);
    const negativeContext = vm.createContext({ console: { log() {}, warn() {}, groupCollapsed() {}, groupEnd() {} } });
    vm.runInContext(textPage.slice(negStart, negEnd), negativeContext);
    negativeContext.mergeExtraNegative(text, '模糊');
    assert.equal(text['6'].inputs.negative_prompt, '模糊');
    const mossText = load('text2image/moss-image-sft.json');
    negativeContext.mergeExtraNegative(mossText, '模糊');
    assert.equal(mossText['8'].inputs.text, '模糊');
    for (const graph of [text, edit, mossText, mossEdit]) {
        // 当前提示词绑定使用 text，必须配套接受该字段的字符串节点。
        assert.equal(graph['23'].class_type, 'Text Multiline (Code Compatible)');
        for (const node of Object.values(graph)) {
            for (const value of Object.values(node.inputs)) {
                if (Array.isArray(value)) assert.ok(graph[value[0]], '节点引用必须存在');
            }
        }
    }
    console.log('Qwen 2.1 / MOSS：页面语法、参数绑定、缩放、参考图、负面提示词及工作流连线通过。');
})().catch(error => { console.error(error); process.exitCode = 1; });
