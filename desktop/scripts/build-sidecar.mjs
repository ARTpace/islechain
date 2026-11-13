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
  '.git', '.github', '.venv', '.pytest_cache', '.ruff_cache', '.playwright-cli', '.oil-ui', '__pycache__',
  'node_modules', 'desktop', 'output', 'input', 'logs', 'tests', 'docs',
  'packages', 'python', 'dist', 'build', 'conversations', 'canvases', 'projects',
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
  // 内容资产全部由 GitHub 安装，不随程序分发。
  'style-packs', 'tag-packs', 'artist-packs', 'character-packs', 'artist-packs-official', 'character-packs-official',
]);

// 「父目录名 -> 该目录下要裁掉的子项」，用于精准剔除大体积素材而不丢代码。
const prunedSubdirs = new Map([
  // 风格数据由可卸载的平台包提供，旧核心包和种子包均不随程序内置。
  ['style-packs', new Set(['art-canvas-core', 'art-canvas-seed'])],
  ['data', new Set(['presets', 'wildcards'])],
  ['images', new Set(['style_thumbnails'])],
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
  'prompt_libraries.json', 'prompt-presets.yaml', 'prompt-presets.json',
  'style-i18n.json', 'fooocus_styles.json',
]);

function skip(name) {
  if (skipDirs.has(name) || skipFiles.has(name)) return true;
  // 本机虚拟环境（.venv-comfy 等 240MB 级）：路径写死在开发机，装到别人机器上必然失效，
  // 代码也不引用，只会在安装包里白占体积。
  if (/^\.venv/.test(name)) return true;
  // 同步工具产生的冲突副本（main.sync-conflict-20261103-004531-LLY4PON.py 之类）。
  if (name.includes('.sync-conflict-')) return true;
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
// 装配自检：这些是 main.py 顶层就要 import 的模块，缺一个服务就起不来。
// core/ 是公共底座包（路径、配置、跨层共用逻辑），被 routers / 各内容包共同依赖。
const required = [
  'main.py',
  'core/canvas_store.py',
  'core/canvas_paths.py',
  'core/canvas_schema.py',
  'core/canvas_bundle.py',
  'static/schemas/canvas.schema.json',
  'static/js/canvas-schema.js',
  'core',
  'core/user_paths.py',
  'core/media_paths.py',
  'core/media_migration.py',
  'core/lan_sharing.py',
  'core/feature_access.py',
  'core/generation_data.py',
  'core/image_cutout.py',
  'core/preset_manager.py',
  'core/smart_prompt.py',
  'core/wildcard_engine.py',
  'core/genre_registry.py',
  'core/node_catalog.py',
  'core/node_plugin_builds.py',
  'core/node_plugin_package.py',
  'core/node_plugin_ui.py',
  'core/node_worker.py',
  'core/node_python_env.py',
  'core/node_media.py',
  'core/node_ports.py',
  'core/node_audio.py',
  'core/node_video.py',
  'core/node_av.py',
  'core/node_http.py',
  'core/node_credentials.py',
  'core/node_dependency_resolution.py',
  'core/comfy_model_download.py',
  'core/game_process_tree.py',
  'core/comfy_installs.py',
  'core/comfy_dependency_plan.py',
  'core/comfy_workflow_builds.py',
  'core/comfy_workflow_validation.py',
  'core/comfy_node_index.py',
  'static/js/canvas-plugin-ui.js',
  'static/js/canvas-node-catalog.js',
  'static/js/canvas-comfy-builds.js',
  'data/media-folders.json',
  'static/modules/model-features.js',
  'style_packs',
  'character_packs',
  'content_packs',
  'routers/characters.py',
  'artist_packs',
  'tag_packs',
  'routers/artists.py',
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

// 内容资源已外置（不进 git）：本地有就打进安装包，没有只警告不阻断。
// 离线资源包在 H:\AI-Tools\art-canvas-resources\，解压到项目根即可补齐。
const optionalContent = [
  ['static/images/poster_layouts/thumbnails', '版式缩略图'],
];
const absentContent = optionalContent.filter(([rel]) => !fs.existsSync(path.join(appDir, rel)));
if (absentContent.length) {
  console.warn('');
  console.warn('以下内容资源不在工作树中，安装包将不含它们（用户可自行导入）：');
  for (const [rel, label] of absentContent) console.warn('  - ' + label + '：' + rel);
  console.warn('  补齐方式：把 art-canvas-data.zip / art-canvas-images.zip 解压到项目根后重新构建。');
  console.warn('');
} else {
  console.log('内容资源：' + optionalContent.length + ' 项全部随包');
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
