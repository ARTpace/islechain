// 不支持 Canvas 时也要支持面板点击、键盘导航和后台恢复的场景唤醒。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const stageEvents = {}, docEvents = {}, winEvents = {};
const input = {}, otherInput = {}, background = {};
const panel = { contains: target => target === input || target === otherInput };
const stage = {
 dataset: {}, querySelector: () => panel, appendChild() {},
 addEventListener(name, fn) { stageEvents[name] = fn; }
};
const document = {
 activeElement: background, hidden: false, querySelector: () => stage,
 createElement: () => ({ setAttribute() {}, getContext: () => null, remove() {} }),
 addEventListener(name, fn) { docEvents[name] = fn; }
};
vm.runInNewContext(fs.readFileSync('static/js/login-effects.js', 'utf8'), {
 document, window: { addEventListener(name, fn) { winEvents[name] = fn; } }
});
const awake = () => stage.dataset.sceneAwake;
assert.equal(awake(), 'false');
stageEvents.pointerdown({ target: input }); assert.equal(awake(), 'true');
stageEvents.focusout({ target: input, relatedTarget: otherInput }); assert.equal(awake(), 'true');
stageEvents.pointerdown({ target: background }); assert.equal(awake(), 'false');
stageEvents.focusin({ target: input }); assert.equal(awake(), 'true');
stageEvents.focusout({ target: input, relatedTarget: background }); assert.equal(awake(), 'false');
document.activeElement = input;
docEvents.visibilitychange(); assert.equal(awake(), 'true');
document.hidden = true;
docEvents.visibilitychange(); assert.equal(awake(), 'false');
document.hidden = false;
docEvents.visibilitychange(); assert.equal(awake(), 'true');
winEvents.blur(); assert.equal(awake(), 'false');
winEvents.focus(); assert.equal(awake(), 'true');
console.log('Scene wake: pointer, keyboard, focus transfer and visibility tests passed');
