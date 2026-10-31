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
  // 完整风格库源包（45MB）：只作拆料，永不进安装包，也不进 git
  'style-packs-source',
  // 角色数据源（21MB）：只作拆料，产物是 data/character-packs 与 dist 官方包
  'character-packs-source',
  // 画师全量 release（6MB search.json + 分桶明细）：只作拆料
  'artist-packs-source',
]);

// 「父目录名 -> 该目录下要裁掉的子项」，用于精准剔除大体积素材而不丢代码。
const prunedSubdirs = new Map([
  ['tools', new Set(['opennana-import'])],
  // 完整风格库（44MB）不进安装包也不进仓库：仓库只留 art-canvas-seed 精简包，
  // 完整数据由 dist/style-packs 下的平台包提供，用户按需在资产库一键安装。
  ['style-packs', new Set(['art-canvas-core'])],
]);
const skipFiles = new Set([
  'users.json', '_test_localstorage.json', 'translate-config.json',
  'user-prompt-dict.json', 'asset_library.json', 'smart-prompt-config.json',
  'history.json', 'startup_env.log', '.env',
  // 本机 API 提供商配置（含自定义中转地址，属个人数据）。
  // 缺失时后端会在用户目录自动生成默认配置，所以不用打进包。
  'api_providers.json',
  // 角色数据已拆成角色包（data/character-packs 种子 + dist 官方包），
  // 这份 21MB 单文件不再被前端加载，也不再进安装包。
  'characters.json',
  // 画师数据同样已拆成画师包（data/artist-packs 种子 + dist 官方包），
  // 这份 8MB 的 JS 变量文件不再被加载。
  'artist_data.js',
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

// 官方可选内容包：仓库与安装目录都不含完整数据，但发布包要带上，用户才能离线一键安装。
// 源目录 dist/ 已被 skipDirs 排除，这里按需单独搬 catalog + zip。
// 每种内容包（风格 / 角色 / 画师）走同一套搬运规则，新增类型只需在下面多调一次。
function installOfficialBundles(distName, officialDirName, label, splitHint) {
  const src = path.join(project, 'dist', distName);
  const dst = path.join(appDir, 'data', officialDirName);
  if (!fs.existsSync(src)) {
    console.warn(
      '提示：dist/' + distName + ' 不存在，安装包将不含可选' + label + '（先跑 ' + splitHint + '）'
    );
    return;
  }
  fs.mkdirSync(dst, {recursive: true});
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.zip') && entry.name !== 'catalog.json') continue;
    fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name));
  }
  console.log('官方可选' + label + '：' + fs.readdirSync(dst).length + ' 个文件已装入');
}

installOfficialBundles(
  'style-packs', 'style-packs-official', '风格包',
  'python tools/style_pack_split.py split',
);
installOfficialBundles(
  'character-packs', 'character-packs-official', '角色包',
  'python tools/character_pack_split.py split',
);
installOfficialBundles(
  'artist-packs', 'artist-packs-official', '画师包',
  'python tools/artist_pack_split.py split',
);

// 装配自检：这些是 main.py 顶层就要 import 的模块，缺一个服务就起不来。
const required = [
  'main.py',
  'user_paths.py',
  'media_paths.py',
  'media_migration.py',
  'data/media-folders.json',
  // 风格预设已拆成风格包：清单缺失等于预设库全空，必须随包（种子包，约 2.5MB）
  'data/style-packs/art-canvas-seed/pack.json',
  'static/modules/model-features.js',
  'lan_sharing.py',
  'feature_access.py',
  'generation_data.py',
  'image_cutout.py',
  'preset_manager.py',
  'style_packs',
  // 角色数据已拆成角色包：种子包缺失等于角色库全空，必须随包（约 1.3MB）
  'data/character-packs/characters-seed/pack.json',
  'character_packs',
  'content_packs',
  'routers/characters.py',
  // 画师数据已拆成画师包：种子包缺失等于画师库全空，必须随包（约 47KB）
  'data/artist-packs/artists-seed/pack.json',
  'artist_packs',
  'routers/artists.py',
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
  // 角色数据源（21MB 单文件）已改为角色包分发，不该再出现在安装包里
  'static/app/characters.json',
  // 画师数据源（8MB）同样改为画师包分发
  'static/app/artist_data.js',
];
const leaked = forbidden.filter((rel) => fs.existsSync(path.join(appDir, rel)));
// 素材/上传目录是运行期数据（落点在用户目录），源码里这份只是本机测试残留，不能进包。
// 内置工作流是程序资产，必须随包：workflows/ 不在此列。
if (fs.existsSync(path.join(appDir, 'assets'))) leaked.push('assets/');
// 完整风格库只存在于开发机，绝不能跟着安装包走（44MB，且仓库不跟踪）
if (fs.existsSync(path.join(appDir, 'data', 'style-packs', 'art-canvas-core'))) {
  leaked.push('data/style-packs/art-canvas-core/');
}
if (fs.existsSync(path.join(appDir, 'data', 'style-packs-source'))) {
  leaked.push('data/style-packs-source/');
}
// 画师全量 release 只存在于开发机（6MB+），绝不能跟着安装包走
if (fs.existsSync(path.join(appDir, 'data', 'artist-packs-source'))) {
  leaked.push('data/artist-packs-source/');
}

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
