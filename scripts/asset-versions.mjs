/** Version migrated source assets without bundling classic scripts or changing load order. */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const assets = [
  'css/zimage.css', 'css/chat-layout.css', 'modules/chat-outline.css',
  'modules/chat-media.js', 'modules/chat-transcript.js', 'modules/chat-conversations.js',
  'modules/chat-session.js', 'modules/chat-image-generation.js', 'modules/page-lifecycle.js', 'modules/chat-outline.js',
  'js/canvas-list.js', 'js/canvas.js', 'js/smart-canvas.js'
];
function htmlFiles(dir) {
  return readdirSync(dir, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (['vendor', 'dist', 'node_modules'].includes(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? htmlFiles(path) : entry.name.endsWith('.html') ? [path] : [];
  });
}
export function syncAssets({root = resolve(fileURLToPath(new URL('..', import.meta.url))), check = false, paths = assets} = {}) {
  const versions = Object.fromEntries([...paths].sort().map(path => [
    '/static/' + path,
    createHash('sha256').update(readFileSync(join(root, 'static', path))).digest('hex').slice(0, 16)
  ]));
  const changes = [];
  for (const path of htmlFiles(join(root, 'static'))) {
    const before = readFileSync(path, 'utf8');
    const after = before.replace(/((?:src|href)=["'])(\/static\/[^"'?#]+)(\?[^"']*)?(["'])/g,
      (match, prefix, asset, query, quote) => {
        if (!versions[asset]) return match;
        const params = new URLSearchParams(query?.slice(1) || '');
        params.set('v', versions[asset]);
        return prefix + asset + '?' + params + quote;
      });
    if (before !== after) { changes.push(path); if (!check) writeFileSync(path, after); }
  }
  const manifest = join(root, 'static', 'asset-versions.json');
  const content = JSON.stringify({schemaVersion: 1, assets: versions}, null, 2) + '\n';
  let previous;
  try { previous = readFileSync(manifest, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== content) { changes.push(manifest); if (!check) writeFileSync(manifest, content); }
  return changes;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const changes = syncAssets({check});
  if (check && changes.length) {
    console.error('Asset versions are stale. Run node scripts/asset-versions.mjs');
    process.exitCode = 1;
  } else console.log(`${check ? 'Checked' : 'Updated'} asset versions; ${changes.length} file(s) ${check ? 'stale' : 'changed'}.`);
}
