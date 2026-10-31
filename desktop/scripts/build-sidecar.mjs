// 把 art-canvas 运行期需要的源码装配到 src-tauri/sidecar-server/app。
// 不带个人数据：生成图、账号、会话、密钥都在系统用户目录，不进安装包。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.resolve(here, '..');
const appDir = path.join(here, 'src-tauri', 'sidecar-server', 'app');

// 注意：tools/ 不能整目录排除 —— main.py 顶层依赖 tools.performance_timing 与
// tools.api_compat，缺了它服务起不来。改为只裁掉里面的大体积数据目录（见 prunedSubdirs）。
const skipDirs = new Set([
  '.git', '.github', '.venv', '.pytest_cache', '.ruff_cache', '__pycache__',
  'node_modules', 'desktop', 'output', 'input', 'logs', 'tests', 'docs',
  'packages', 'python', 'dist', 'build', 'conversations', 'canvases',
  'thumbnails', 'media_previews', 'tts_voices', 'backups', 'smart-prompt-presets',
  // 运行期产物与草稿：不进安装包（artifacts 当前 700MB+，全是备份/导出，代码不引用）
  'artifacts', 'scratch',
  // 素材/上传目录：运行期内容，落点在用户目录，源码里这份只可能是本机测试残留
  'assets',
]);

// 「父目录名 -> 该目录下要裁掉的子项」，用于精准剔除大体积素材而不丢代码。
const prunedSubdirs = new Map([
  ['tools', new Set(['opennana-import'])],
]);
const skipFiles = new Set([
  'users.json', '_test_localstorage.json', 'translate-config.json',
  'user-prompt-dict.json', 'asset_library.json', 'smart-prompt-config.json',
  'history.json', 'startup_env.log', '.env',
  // 本机 API 提供商配置（含自定义中转地址，属个人数据）。
  // 缺失时后端会在用户目录自动生成默认配置，所以不用打进包。
  'api_providers.json',
]);

function skip(name) {
  if (skipDirs.has(name) || skipFiles.has(name)) return true;
  if (name.endsWith('.pyc') || name.endsWith('.pyo') || name.endsWith('.log')) return true;
  // .bak 家族：foo.bak / foo.bak-时间戳 / foo.bak.20260811093606，一律排除。
  // 早先只写 endsWith('.bak')，被 asset_library.json.bak.20260811093606 绕过去了。
  if (/\.bak([-.].*)?$/.test(name) || name.endsWith('.md')) return true;
  return false;
}

function copyDir(from, to, dirName) {
  fs.mkdirSync(to, {recursive: true});
  const pruned = dirName ? prunedSubdirs.get(dirName) : undefined;
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    if (skip(entry.name)) continue;
    if (pruned && pruned.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, entry.name);
    else fs.copyFileSync(src, dst);
  }
}

if (fs.existsSync(appDir)) fs.rmSync(appDir, {recursive: true, force: true});
console.log('装配程序到 ' + appDir);
copyDir(project, appDir, null);

// 装配自检：这些是 main.py 顶层就要 import 的模块，缺一个服务就起不来。
const required = [
  'main.py',
  'user_paths.py',
  'media_paths.py',
  'media_migration.py',
  'data/media-folders.json',
  'static/modules/model-features.js',
  'lan_sharing.py',
  'feature_access.py',
  'generation_data.py',
  'image_cutout.py',
  'preset_manager.py',
  'smart_prompt.py',
  'wildcard_engine.py',
  'genre_registry.py',
  'tools/performance_timing.py',
  'tools/api_compat.py',
  'tools/webai_gateway.py',
  'tools/training_bridge.py',
  'routers',
  'static',
  'workflows',
];
const missing = required.filter((rel) => !fs.existsSync(path.join(appDir, rel)));
if (missing.length) {
  console.error('以下必需文件/目录没有装配成功：');
  for (const item of missing) console.error('  - ' + item);
  process.exit(1);
}

// 反向安检：确认没有任何个人数据混进安装包。
const forbidden = [
  'api_providers.json',
  'users.json',
  'asset_library.json',
  'history.json',
  'global_config.json',
  '.env',
];
const leaked = forbidden.filter((rel) => fs.existsSync(path.join(appDir, rel)));
// 素材/上传目录是运行期数据（落点在用户目录），源码里这份只是本机测试残留，不能进包。
// 内置工作流是程序资产，必须随包：workflows/ 不在此列。
if (fs.existsSync(path.join(appDir, 'assets'))) leaked.push('assets/');

function findBakFiles(dir, rel) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const child = rel ? rel + '/' + entry.name : entry.name;
    if (/\.bak([-.].*)?$/.test(entry.name)) out.push(child);
    else if (entry.isDirectory()) out.push(...findBakFiles(path.join(dir, entry.name), child));
  }
  return out;
}
const bakFiles = findBakFiles(appDir, '');

if (leaked.length || bakFiles.length) {
  console.error('检测到不该进安装包的内容：');
  for (const item of leaked) console.error('  - 个人数据 ' + item);
  for (const item of bakFiles) console.error('  - 备份文件 ' + item);
  process.exit(1);
}
console.log('程序装配完成（自检 ' + required.length + ' 项就绪，个人数据 0 泄漏）');
