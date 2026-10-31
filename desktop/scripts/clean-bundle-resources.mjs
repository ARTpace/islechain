// Tauri 复制 bundle resources 到 target 时只做增量覆盖，不会删除目标目录里
// 已经从源目录消失的旧文件。于是一次构建打进去的历史遗留（改过排除规则的上一版
// api_providers.json、*.bak 等）会一直赖在安装包里。构建前整目录删掉强制干净复制。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const profile of ['release', 'debug']) {
  const target = path.join(here, 'src-tauri', 'target', profile, 'sidecar-server');
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, {recursive: true, force: true});
  console.log('已清理 target/' + profile + ' 下的历史资源，保证本次是新复制');
}
