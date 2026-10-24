// 把 art-canvas 运行期需要的源码装配到 src-tauri/sidecar-server/app。
// 不带个人数据：生成图、账号、会话、密钥都在系统用户目录，不进安装包。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.resolve(here, '..');
const appDir = path.join(here, 'src-tauri', 'sidecar-server', 'app');

const skipDirs = new Set([
  '.git', '.github', '.venv', '.pytest_cache', '.ruff_cache', '__pycache__',
  'node_modules', 'desktop', 'output', 'input', 'logs', 'tests', 'docs', 'tools',
  'packages', 'python', 'dist', 'build', 'conversations', 'canvases',
  'thumbnails', 'media_previews', 'tts_voices', 'backups', 'smart-prompt-presets',
]);
const skipFiles = new Set([
  'users.json', '_test_localstorage.json', 'translate-config.json',
  'user-prompt-dict.json', 'asset_library.json', 'smart-prompt-config.json',
  'history.json', 'startup_env.log', '.env',
]);

function skip(name) {
  if (skipDirs.has(name) || skipFiles.has(name)) return true;
  if (name.endsWith('.pyc') || name.endsWith('.pyo') || name.endsWith('.log')) return true;
  if (name.endsWith('.bak') || name.includes('.bak-') || name.endsWith('.md')) return true;
  return false;
}

function copyDir(from, to) {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    if (skip(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

if (fs.existsSync(appDir)) fs.rmSync(appDir, {recursive: true, force: true});
console.log('装配程序到 ' + appDir);
copyDir(project, appDir);
const mainPy = path.join(appDir, 'main.py');
if (!fs.existsSync(mainPy)) {
  console.error('main.py 没有装配成功');
  process.exit(1);
}
console.log('程序装配完成');
