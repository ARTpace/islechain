const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const legacy = fs.readFileSync('static/app/zimage.html', 'utf8');
const script = legacy.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const [search, hash] of [['', ''], ['?chat=1&v=123', '#message-42'], ['?canvasComposer=1', '#preview']]) {
  let target;
  vm.runInNewContext(script, {location: {search, hash, replace(url) { target = url; }}});
  assert.equal(target, '/static/app/generation-workspace.html' + search + hash);
}
assert.ok(fs.existsSync('static/app/generation-workspace.html'));
console.log('Generation workspace entry compatibility passed');
