const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('static/modules/chat-parameters.js', 'utf8'), context);
const api = context.window.ChatParameters;
const workflow = {
    sampler: { class_type:'KSampler', inputs:{ steps:20, cfg:3, denoise:1 } },
    unrelated: { class_type:'OtherNode', inputs:{ steps:9 } }
};
const current = { engine:'local', controls:{ ratioW:9, ratioH:16, res:1, batchCount:1, seedMode:'random' },
    sampling:{}, negative:'old', allowedSampling:api.samplingFields(workflow) };
const result = api.plan({ ratio:'16:9', resolution:2, batch_count:2, seed:0, steps:30, cfg:4, denoise:0.6, negative_prompt:'blur' }, current);
assert.equal(result.controls.ratioW, 16);
assert.equal(result.controls.batchCount, 2);
assert.equal(result.controls.fixedSeed, 0);
assert.equal(api.plan({ res:2 }, current).controls.res, 2);
assert.equal(api.plan({ res:2 }, { ...current, engine:'cloud' }).controls.res, 2);
assert.throws(() => api.plan({ res:99 }, current), /分辨率/);
assert.equal(result.negative, 'blur');
assert.equal(current.controls.ratioW, 9, 'planning must not mutate live controls');
api.applySampling(workflow, result.sampling);
assert.equal(workflow.sampler.inputs.steps, 30);
assert.equal(workflow.unrelated.inputs.steps, 9);
for (const params of [{ steps:101 }, { cfg:-1 }, { denoise:2 }, { seed:1.5 }, { batch_count:5 }, { ratio:'100:1' }, { model:'unrequested-model' }]) {
    assert.throws(() => api.plan(params, current));
}
assert.throws(() => api.plan({ ratio:'16:9', steps:30 }, { ...current, allowedSampling:{} }));
assert.equal(current.controls.ratioW, 9, 'invalid combinations must be atomic');
for (const params of [{ steps:20 }, { negative_prompt:'x' }, { batch_count:2 }]) {
    assert.throws(() => api.plan(params, { ...current, engine:'cloud' }));
}
const cloudSeed = api.plan({ seed:42, ratio:'16:9' }, { ...current, engine:'cloud' });
assert.equal(cloudSeed.controls.seedMode, 'random');
assert.equal(cloudSeed.controls.ratioW, 16);
assert.equal(cloudSeed.labels.includes('种子 42'), false);
assert.equal(api.plan({ ratio:'1:1', resolution:1 }, { ...current, engine:'cloud' }).controls.ratioH, 1);
assert.equal(api.plan({ resolution:4 }, { ...current, engine:'cloud', model:'agnes-image-2.0-flash' }).controls.res, 4);
assert.throws(() => api.plan({ resolution:4 }, { ...current, engine:'cloud', model:'gpt-image-1' }));
assert.equal(api.plan({ resolution:4 }, { ...current, engine:'cloud', model:'agnes-image-2.5-flash' }).controls.res, 4);
assert.equal(api.plan({ resolution:3 }, { ...current, engine:'cloud', model:'agnes-image-2.1-flash' }).controls.res, 3);
assert.throws(() => api.applySampling({}, { steps:20 }), /工作流不支持/);
assert.match(api.guide(current), /PARAMS/);
assert.doesNotMatch(api.guide(current), /"res":|"batchCount":|"ratioW":/);
assert.match(api.guide(current), /"resolution":1/);
const page = fs.readFileSync('static/app/zimage.html', 'utf8');
for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2]);
}
assert.match(page, /ChatParameters\.guide\(parameterContext\)/);
assert.match(page, /sampling:ChatTasks\.clone\(chatSampling\)/);
assert.match(page, /ChatParameters\.applySampling\(workflow, chatTask\.snapshot\.sampling\)/);
assert.match(page, /const settingsOnly =/);
console.log('Natural-language parameters: validation, atomicity, workflow injection, API limits and script syntax OK');
