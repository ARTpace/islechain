// 验证外部图片拖入提示（#external-asset-drop-overlay）的生命周期：
// 拖入时出现、松手/拖拽中断后必须收起，不能残留在界面上。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    style: {},
    children: [],
    textContent: '',
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    querySelector(sel) {
      const want = sel.replace('#', '');
      const walk = node => {
        for (const c of node.children) {
          if (c.id === want) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
    closest() { return null; },
    addEventListener() {},
    dispatchEvent() {}
  };
  el.style.cssText = '';
  return el;
}

const listeners = [];
const body = makeEl('body');
const doc = {
  body,
  createElement: tag => makeEl(tag),
  addEventListener: (type, fn, capture) => listeners.push({ scope: 'document', type, fn, capture: !!capture }),
  querySelector: () => null
};

let clock = 1000;
let intervals = [];
const context = {
  document: doc,
  Date: { now: () => clock },
  JSON, Math, Map, Set, Promise, console, Array, Object, String, Number,
  setInterval: (fn) => { intervals.push(fn); return intervals.length; },
  clearInterval: (id) => { if (id) intervals[id - 1] = null; },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) }),
  FormData: class { append() {} },
  location: { origin: 'http://local' }
};
context.window = context;
context.addEventListener = (type, fn, capture) => listeners.push({ scope: 'window', type, fn, capture: !!capture });
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/modules/external-asset-drop.js', 'utf8'), context);

const fire = (scope, type, event, capture = false) => {
  for (const l of listeners) {
    if (l.scope === scope && l.type === type && l.capture === capture) l.fn(event);
  }
};
const tick = () => { for (const fn of intervals) if (fn) fn(); };
const overlay = () => body.children.find(c => c.id === 'external-asset-drop-overlay');
const hint = () => overlay().querySelector('#external-asset-drop-hint').textContent;
const externalDrag = () => ({ types: ['Files'], files: [], dropEffect: '' });
const dragEvent = (dataTransfer, extra = {}) => Object.assign({
  dataTransfer, target: makeEl('div'), clientX: 400, clientY: 300,
  preventDefault() {}, relatedTarget: null
}, extra);

assert.ok(context.__assetDropExternalReady === true, '模块应完成初始化');

// 1) 外部图片拖入：出现提示
fire('document', 'dragover', dragEvent(externalDrag()));
assert.equal(overlay().style.display, 'flex', '拖入外部文件时应显示提示');
assert.equal(hint(), '松开以上传图片到输入栏');

// 2) 松手（drop）：必须立即收起，且不依赖 dragleave
fire('window', 'drop', dragEvent(externalDrag()), true);
assert.equal(overlay().style.display, 'none', 'drop 后提示必须立即收起');

// 3) 拖入后中断（拖出窗口 / 系统取消拖拽，没有 drop 也没有 dragleave）：watchdog 兜底收起
fire('document', 'dragover', dragEvent(externalDrag()));
assert.equal(overlay().style.display, 'flex');
clock += 500;
tick();
assert.equal(overlay().style.display, 'flex', '拖拽仍在进行时不应误收起');
clock += 400;
tick();
assert.equal(overlay().style.display, 'none', '超过 800ms 没有 dragover 应兜底收起');

// 4) 内部拖拽（画布节点）不弹提示
fire('document', 'dragover', dragEvent({ types: ['application/x-canvas-asset'], files: [], dropEffect: '' }));
assert.equal(overlay().style.display, 'none', '内部拖拽不应触发外部资源提示');

// 5) Esc 也收起
fire('document', 'dragover', dragEvent(externalDrag()));
assert.equal(overlay().style.display, 'flex');
fire('document', 'keydown', { key: 'Escape' }, true);
assert.equal(overlay().style.display, 'none', 'Esc 应收起提示');

console.log('外部拖入提示生命周期通过：出现 / 松手收起 / 中断兜底收起 / 内部拖拽不触发');
