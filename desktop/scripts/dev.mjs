#!/usr/bin/env node
// IsleChain 桌面端开发模式启动器
//
//   npm run dev                 启动后端 + Tauri 桌面窗口（studio）
//   npm run dev -- --overlay    额外打开「透明叠加」探针窗口（P0 验证）
//   npm run dev -- --no-server  复用已在跑的 7000 服务
//   npm run dev -- --server-only 只起后端（前端用浏览器调试时）
//
// 与打包版的区别：后端跑仓库根目录的 main.py（系统 Python），不加载 sidecar 内置运行时；
// ARTCANVAS_DEV=1 会让 Rust 侧跳过 sidecar 启动与进程托管。

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(here, '..');
const REPO = path.resolve(DESKTOP, '..');
const PORT = 7000;

const argv = process.argv.slice(2);
const pick = (name, fallback = '') => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
const flags = {
  overlay: argv.includes('--overlay'),
  probe: argv.includes('--probe'),
  canvas: pick('--canvas'),
  project: pick('--project', 'default'),
  noServer: argv.includes('--no-server'),
  serverOnly: argv.includes('--server-only'),
  help: argv.includes('--help') || argv.includes('-h'),
};

if (flags.help) {
  console.log(`用法: npm run dev -- [选项]

  --overlay          额外打开桌面叠加窗口（透明画布浮在桌面上，可穿透点桌面）
  --canvas <id>      叠加窗口显示哪个画布；不传则自动打开最近更新的画布
  --project <name>   画布所属项目（默认 default）
  --probe            叠加窗口改用 P0 白卡片探针页（只验证穿透机制）
  --no-server        假定 7000 已在运行，不再拉起后端
  --server-only      只启动后端，不启动桌面窗口
  -h, --help         显示本帮助

环境变量:
  ART_CANVAS_PY  Python 解释器路径（默认自动探测）
  ART_CANVAS_HOME  数据目录（默认沿用系统 %APPDATA%/art-canvas）`);
  process.exit(0);
}

function log(tag, line) {
  const text = String(line).replace(/\s+$/, '');
  if (text) console.log(`[${tag}] ${text}`);
}

function portOpen(port = PORT, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function resolvePython() {
  const candidates = [
    process.env.ART_CANVAS_PY,
    'C:/Users/zhengyuliang/AppData/Local/Programs/Python/Python313/python.exe',
    'python',
    'py',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  return 'python';
}

const children = new Set();

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  for (const child of children) killTree(child);
  children.clear();
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function startServer() {
  if (flags.noServer) {
    const up = await portOpen();
    if (!up) {
      console.error(`[dev] --no-server 指定了复用，但 127.0.0.1:${PORT} 没有在跑。`);
      process.exit(1);
    }
    log('dev', `复用已有后端 127.0.0.1:${PORT}`);
    return null;
  }
  if (await portOpen()) {
    log('dev', `127.0.0.1:${PORT} 已在运行，直接复用（如需重启先关掉旧进程）`);
    return null;
  }

  const python = resolvePython();
  log('dev', `启动后端：${python} main.py  (cwd=${REPO})`);
  const child = spawn(python, ['main.py'], {
    cwd: REPO,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ARTCANVAS_DEV: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => chunk.split('\n').forEach((line) => log('server', line)));
  child.stderr.on('data', (chunk) => chunk.split('\n').forEach((line) => log('server!', line)));
  child.on('exit', (code) => {
    children.delete(child);
    if (code !== 0 && code !== null) {
      console.error(`[dev] 后端进程退出，code=${code}`);
      shutdown(code || 1);
    }
  });
  return child;
}

async function waitForServer(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startTauri() {
  const isWin = process.platform === 'win32';
  const shim = path.join(DESKTOP, 'node_modules', '.bin', isWin ? 'tauri.cmd' : 'tauri');
  // 优先用 node 直接跑 CLI 的 JS 入口（package.json bin 指向 tauri.js）。
  // 不要走 `cmd /s /c "\"<path>\\tauri.cmd\" dev"`：Node 会对含引号的参数再次转义，
  // cmd 最终把 `"H:\...\tauri.cmd"` 整体当命令名，报「不是内部或外部命令」。
  const jsEntry = path.join(DESKTOP, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const useNode = existsSync(jsEntry);
  if (!useNode && !existsSync(shim)) {
    console.error(`[dev] 未找到 tauri CLI（试过 ${jsEntry} 与 ${shim}）\n      先在 desktop/ 下执行 npm install`);
    process.exit(1);
  }
  log('dev', `启动桌面窗口（overlay=${flags.overlay ? (flags.probe ? 'probe' : 'canvas') : 'off'}）`);
  const command = useNode ? process.execPath : shim;
  // 叠加模式要独占一个进程：Tauri 的单实例插件会拦掉第二个进程，
  // 而 `tauri dev -- --overlay` 的参数会被拼进 `cargo run` 而不是传给应用。
  // 直接把已在跑的实例结束掉，让新进程走 env（ARTCANVAS_OVERLAY）这条最可靠的路径。
  if (flags.overlay && process.platform === 'win32') {
    try {
      execSync('taskkill /IM IsleChain.exe /F', { stdio: 'ignore' });
      log('dev', '已结束旧实例，切换到叠加模式');
      // 同步等 600ms，让 Tauri 把窗口与单实例锁释放干净
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
    } catch {
      // 没有旧实例时会报错，忽略
    }
  }
  const args = useNode ? [jsEntry, 'dev'] : ['dev'];
  const child = spawn(command, args, {
    cwd: DESKTOP,
    shell: !useNode,
    env: {
      ...process.env,
      ARTCANVAS_DEV: '1',
      ARTCANVAS_OVERLAY: flags.overlay ? (flags.probe ? 'probe' : '1') : '0',
      ARTCANVAS_OVERLAY_CANVAS: flags.canvas,
      ARTCANVAS_OVERLAY_PROJECT: flags.project,
    },
    stdio: 'inherit',
  });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    shutdown(code ?? 0);
  });
  return child;
}

const server = await startServer();
if (server) {
  const ready = await waitForServer();
  if (!ready) {
    console.error('[dev] 后端 90s 内未就绪，请检查上面的 [server] 日志。');
    shutdown(1);
  } else {
    log('dev', '后端已就绪');
  }
}

if (flags.serverOnly) {
  log('dev', '仅后端模式，Ctrl+C 退出');
} else {
  startTauri();
}
