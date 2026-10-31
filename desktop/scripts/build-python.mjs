// 准备随安装包分发的 Python 3.13，并装上 requirements.txt。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pyDir = path.join(here, 'src-tauri', 'sidecar-server', 'python');
const pyExe = path.join(pyDir, 'python.exe');
const version = '3.13.5';
const zipName = `python-${version}-embed-amd64.zip`;
const zipUrl = `https://www.python.org/ftp/python/${version}/${zipName}`;

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {cwd, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function download(url, dest) {
  console.log('下载 ' + url);
  const response = await fetch(url);
  if (!response.ok) throw new Error('下载失败 ' + response.status + ' ' + url);
  await pipeline(response.body, createWriteStream(dest));
}

if (!fs.existsSync(pyExe)) {
  fs.mkdirSync(pyDir, {recursive: true});
  const zipPath = path.join(pyDir, zipName);
  await download(zipUrl, zipPath);
  run('tar', ['-xf', zipPath, '-C', pyDir]);
  fs.rmSync(zipPath, {force: true});
  const pth = fs.readdirSync(pyDir).find((name) => name.endsWith('._pth'));
  if (!pth) {
    console.error('嵌入式 Python 缺少 ._pth');
    process.exit(1);
  }
  const pthPath = path.join(pyDir, pth);
  let text = fs.readFileSync(pthPath, 'utf8');
  text = text.replace(/^#\s*import site/m, 'import site');
  if (!text.includes('Lib\\site-packages')) text += '\nLib\\site-packages\n';
  if (!text.includes('import site')) text += '\nimport site\n';
  fs.writeFileSync(pthPath, text);
}

// 嵌入式 Python 的 sys.path 完全由 ._pth 决定，既不含脚本目录也不含 cwd，
// 因此必须显式登记 app 目录，否则 main.py 连 tools/user_paths 都 import 不到。
// 这一步放在解压判断之外，保证幂等：python 已存在时也会补齐。
{
  const pth = fs.readdirSync(pyDir).find((name) => name.endsWith('._pth'));
  if (!pth) {
    console.error('嵌入式 Python 缺少 ._pth');
    process.exit(1);
  }
  const pthPath = path.join(pyDir, pth);
  let text = fs.readFileSync(pthPath, 'utf8');
  if (!/^\.\.\\app$/m.test(text)) text = text.replace(/\s*$/, '') + '\n..\\app\n';
  fs.writeFileSync(pthPath, text);
  console.log('已把 app 目录登记进 ' + pth);
}

const getPip = path.join(pyDir, 'get-pip.py');
if (!fs.existsSync(path.join(pyDir, 'Lib', 'site-packages', 'pip'))) {
  await download('https://bootstrap.pypa.io/get-pip.py', getPip);
  run(pyExe, [getPip, '--no-warn-script-location'], pyDir);
}

const requirements = path.join(here, '..', 'requirements.txt');
console.log('安装依赖…');
run(pyExe, ['-m', 'pip', 'install', '-r', requirements, '--no-warn-script-location'], pyDir);
console.log('Python 运行时准备完成');
