/* 一句话策划使用真实函数，模拟上游响应，不调用真实渠道。 */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/game-pipeline.js', 'utf8');
function extract(start, end) {
    const offset = source.indexOf(start);
    assert.ok(offset >= 0);
    return source.slice(offset, source.indexOf(end, offset + start.length));
}
let request, renders = 0, remembered = 0;
const plan = {title: '猫咪探险', visualDirection: {description: '温暖手绘', palette: [], referenceAssetIds: []}, characters: [], scenes: [], openQuestions: [], assumptions: [], acceptanceCriteria: []};
for (const name of ['playerFantasy', 'coreLoop', 'controls', 'progression', 'successFailureRestart', 'firstPlayable']) plan[name] = '具体玩法';
const context = vm.createContext({
    project: {id: 'p1', title: '游戏', revision: 1, candidates: [], plan: null},
    ideaDraft: '猫咪在太空修飞船', draftPlan: null, candidateId: null, dirty: false, tab: 'plan',
    structuredClone, Object, Array, JSON, Error,
    value: name => name === 'provider' ? 'configured-provider' : '',
    chatApiProviders: () => [{id: 'default-provider'}],
    api: async (path, method, data) => {
        request = {path, method, data};
        return {project: {id: 'p1', revision: 2, candidates: [{id: 'c1', kind: 'plan', status: 'valid', data: plan}]}};
    },
    renderPanel: () => renders++, remember: () => remembered++,
    esc: value => String(value ?? ''), llmControls: () => '<textarea name="idea"></textarea>',
    candidateList: () => '', field: name => `<input name="${name}">`,
    button: action => `<button data-action="${action}"></button>`,
});
vm.runInContext(extract('    function blankPlan()', '    function blankAsset'), context);
vm.runInContext(extract('    async function generatePlan()', '    function candidateList'), context);
vm.runInContext(extract('    function renderPlan()', '    function renderAssets'), context);
(async () => {
    let html = context.renderPlan();
    assert.ok(html.includes('generate-plan'));
    assert.ok(!html.includes('data-action="save-plan"'), '空表不提供保存入口');
    assert.ok(html.includes('<details><summary>详细编辑（可选）</summary>'));
    await context.generatePlan();
    assert.equal(request.path, '/p1/plan-candidates');
    assert.equal(request.data.idea, '猫咪在太空修飞船');
    assert.equal(request.data.provider, 'configured-provider');
    assert.equal(context.draftPlan.title, plan.title);
    assert.equal(context.candidateId, 'c1');
    assert.equal(context.dirty, true);
    assert.equal(renders, 1); assert.equal(remembered, 1);
    html = context.renderPlan();
    assert.ok(html.includes('猫咪探险') && html.includes('data-action="save-plan"'));
    context.ideaDraft = '';
    await context.generatePlan();
    assert.ok(request.data.idea.includes('自由构思'));
    const previous = context.draftPlan;
    context.api = async () => ({project: {id: 'p1', candidates: [{kind: 'plan', status: 'invalid'}]}});
    await assert.rejects(() => context.generatePlan(), /暂未生成完整方案/);
    assert.equal(context.draftPlan, previous, '失败保留此前方案');
    console.log('GAME_PIPELINE_IDEA_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
