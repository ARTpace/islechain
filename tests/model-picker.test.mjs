import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// model-picker.js 是浏览器 IIFE（挂到 window.ModelPicker），这里只测纯数据部分：
// 档位识别 / 按 title 归并 / 档位选项去重排序。DOM 部分由 Playwright 端到端覆盖。
globalThis.window = {};
const source = await readFile(new URL('../static/modules/model-picker.js', import.meta.url), 'utf8');
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const picker = globalThis.window.ModelPicker;

test('文件名后缀识别档位，任意 -Nstep 都算极速档', () => {
  assert.equal(picker.tierOfWorkflow('text2image/qwen-image-2.1.json'), '');
  assert.equal(picker.tierOfWorkflow('text2image/qwen-image-2.1-fast.json'), '低');
  assert.equal(picker.tierOfWorkflow('text2image/qwen-image-2.1-turbo.json'), '极速');
  assert.equal(picker.tierOfWorkflow('text2image/moss-image-sft-4step.json'), '极速');
  assert.equal(picker.tierOfWorkflow('text2image/moss-image-sft-12step.json'), '极速');
  assert.equal(picker.tierOfWorkflow('text2image/moss-image-sft-6step.json'), '极速');
});

test('config 里声明的 tier 优先于文件名后缀', () => {
  assert.equal(picker.tierOfItem({name: 'text2image/a-fast.json'}), '低');
  assert.equal(picker.tierOfItem({name: 'text2image/a-fast.json', tier: '中'}), '中');
  assert.equal(picker.tierOfItem({name: 'text2image/b.json', tier: '极速'}), '极速');
  assert.equal(picker.tierOfItem(null), '');
});

test('同 title 的多份工作流归并成一行，档位按 高→低→极速 排', () => {
  const rows = picker.localRows([
    {name: 'text2image/q-fast.json', title: 'Q'},
    {name: 'text2image/q-turbo.json', title: 'Q'},
    {name: 'text2image/q.json', title: 'Q'},
    {name: 'text2image/z.json', title: 'Z'}
  ], {currentWorkflow: 'text2image/q-fast.json'});
  assert.equal(rows.length, 2);
  const q = rows[0];
  assert.equal(q.multi, true);
  assert.deepEqual(q.workflows, ['text2image/q.json', 'text2image/q-fast.json', 'text2image/q-turbo.json']);
  assert.equal(q.tier, '低');
  assert.equal(q.selected, 'text2image/q-fast.json');
  assert.equal(q.active, true);
  assert.equal(rows[1].multi, false);
});

test('单档模型没有档位选项，多档模型按标签去重且保留当前档', () => {
  const single = [{name: 'text2image/z.json', title: 'Z'}];
  assert.deepEqual(picker.tierOptions(single, 'text2image/z.json'), []);

  const multi = [
    {name: 'text2image/m.json', title: 'M'},
    {name: 'text2image/m-fast.json', title: 'M'},
    {name: 'text2image/m-4step.json', title: 'M'},
    {name: 'text2image/m-6step.json', title: 'M'}
  ];
  const labels = picker.tierOptions(multi, 'text2image/m.json');
  assert.deepEqual(labels.map(o => o.label), ['高', '低', '极速']);
  // 两个「极速」文件重名：默认保留排序靠前的 4step，用户选中的那档优先
  assert.equal(labels[2].value, 'text2image/m-4step.json');
  assert.equal(picker.tierOptions(multi, 'text2image/m-6step.json')[2].value, 'text2image/m-6step.json');
});

test('已是 localRows 行时也接受，宿主可先按可见性筛过再用', () => {
  const rows = picker.localRows([
    {name: 'text2image/q.json', title: 'Q'},
    {name: 'text2image/q-turbo.json', title: 'Q'}
  ], {currentWorkflow: 'text2image/q.json'});
  assert.deepEqual(picker.tierOptions(rows[0], 'text2image/q.json').map(o => o.label), ['高', '极速']);
});
