const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-image-generation.js','utf8'), {window});
const run = window.ChatImageGeneration.run;
const task = (engine, batchCount) => ({engine, snapshot:{controls:{batchCount}}, check() {if(this.cancelled) throw new Error('cancelled');}});
(async () => {
    let renders = 0, saves = 0;
    const ordinary = task('cloud', 3);
    await run(ordinary, {beforeRound: () => {}, render: async () => {
        assert.equal(saves, renders, 'previous round must save before next request');
        renders++; ordinary.saves = [Promise.resolve().then(() => saves++)];
    }});
    assert.equal(renders, 3); assert.equal(saves, 3);
    for (const [engine, website, expected] of [['cloud',true,1], ['local',false,1], ['cloud',false,4]]) {
        let count = 0;
        await run(task(engine, 99), {website, beforeRound: () => {}, render: async () => count++});
        assert.equal(count, expected);
    }
    const cancelled = task('cloud', 4); let count = 0;
    await assert.rejects(run(cancelled, {beforeRound: () => {}, render: async () => {count++; cancelled.cancelled = true;}}), /cancelled/);
    assert.equal(count, 1, 'cancel prevents subsequent submissions');
    const failed = task('cloud', 4); failed.saveError = new Error('save failed');
    count = 0;
    await assert.rejects(run(failed, {beforeRound: () => {}, render: async () => count++}), /save failed/);
    assert.equal(count, 1, 'save failure stops batch');
    console.log('Generation batches, save ordering and cancellation passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
