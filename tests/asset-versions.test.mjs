import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {syncAssets, assets} from '../scripts/asset-versions.mjs';
const root = mkdtempSync(join(tmpdir(), 'islechain-assets-'));
try {
  mkdirSync(join(root, 'static/modules'), {recursive: true});
  writeFileSync(join(root, 'static/modules/test.js'), 'window.example = 1;');
  const html = join(root, 'static/index.html');
  writeFileSync(html, '<script src="/static/modules/test.js?mode=one&v=old"></script><script src="https://external.test/test.js?v=old"></script>');
  const options = {root, paths:['modules/test.js']};
  assert.equal(syncAssets(options).length, 2);
  assert.match(readFileSync(html, 'utf8'), /mode=one&v=[a-f0-9]{16}/);
  assert.match(readFileSync(html, 'utf8'), /external.test\/test.js\?v=old/);
  assert.deepEqual(syncAssets({...options, check:true}), []);
  for (const path of [...assets, 'css/studio-ui.css', 'css/studio-controls.css', 'css/appearance.css', 'js/appearance.js']) {
    mkdirSync(dirname(join(root, 'static', path)), {recursive:true});
    writeFileSync(join(root, 'static', path), '/* source */');
  }
  writeFileSync(join(root, 'static/js/theme.js'), "css.href = '/static/css/studio-ui.css?v=old';");
  writeFileSync(join(root, 'static/theme.js'), "script.src = '/static/js/theme.js?v=old';");
  writeFileSync(html, '<script src="/static/theme.js?v=old"></script><script src="/static/modules/test.js"></script>');
  syncAssets({root});
  assert.deepEqual(syncAssets({root, check:true}), []);
  const bootstrap = readFileSync(join(root, 'static/theme.js'), 'utf8');
  const unchangedHtml = readFileSync(html, 'utf8');
  writeFileSync(join(root, 'static/css/studio-ui.css'), '/* changed theme */');
  assert.equal(syncAssets({root, check:true}).length, 4, 'leaf change invalidates both loaders, HTML and manifest');
  assert.equal(readFileSync(html, 'utf8'), unchangedHtml, 'dynamic check also stays read-only');
  syncAssets({root});
  assert.notEqual(readFileSync(join(root, 'static/theme.js'), 'utf8'), bootstrap);
  assert.deepEqual(syncAssets({root, check:true}), []);
  const before = readFileSync(html, 'utf8');
  writeFileSync(join(root, 'static/modules/test.js'), 'window.example = 2;');
  assert.equal(syncAssets({...options, check:true}).length, 2);
  assert.equal(readFileSync(html, 'utf8'), before, 'check must not mutate sources');
  syncAssets(options);
  assert.notEqual(readFileSync(html, 'utf8'), before);
  assert.deepEqual(syncAssets({...options, check:true}), []);
  console.log('Deterministic asset versions, stale detection and query preservation passed');
} finally {rmSync(root, {recursive:true, force:true});}
