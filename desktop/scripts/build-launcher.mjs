#!/usr/bin/env node
// 编译桌面端启动器：desktop/launcher -> desktop/IsleChain.exe
//
//   npm run launcher            离线优先（依赖已在 cargo 缓存里时最快）
//   npm run launcher -- --online 强制联网解析依赖
//
// 产出的 IsleChain.exe 自带图标，双击即进开发模式（内部跑 scripts/start-desktop.cmd）。
// 改完图标（scripts/gen-icons.py）后需要重跑本脚本，图标才会进 exe。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(here, '..');
const MANIFEST = path.join(DESKTOP, 'launcher', 'Cargo.toml');
const BUILT = path.join(DESKTOP, 'launcher', 'target', 'release', 'IsleChain.exe');
const TARGET = path.join(DESKTOP, 'IsleChain.exe');

function build(extra) {
  const args = ['build', '--release', '--manifest-path', MANIFEST, ...extra];
  console.log(`[launcher] cargo ${args.join(' ')}`);
  return spawnSync('cargo', args, { stdio: 'inherit', cwd: DESKTOP });
}

const wantOnline = process.argv.includes('--online');
let result = build(wantOnline ? [] : ['--offline']);

// 离线解析失败（缓存缺 crate）时自动联网重试；rustc 偶发崩溃也靠这一次重试兜住
if (result.status !== 0 && !wantOnline) {
  console.warn('[launcher] 离线编译失败，联网重试一次…');
  result = build([]);
}

if (result.status !== 0) {
  console.error('[launcher] 编译失败，检查上面的 cargo 输出');
  process.exit(result.status ?? 1);
}

if (!existsSync(BUILT)) {
  console.error(`[launcher] 没有找到产物：${BUILT}`);
  process.exit(1);
}

copyFileSync(BUILT, TARGET);
const kb = Math.round(statSync(TARGET).size / 1024);
console.log(`[launcher] 已更新 ${TARGET}（${kb} KB）`);
