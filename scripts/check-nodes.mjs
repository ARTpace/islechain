#!/usr/bin/env node
/* 节点目录自检：核对 static/nodes/<name>/index.js 与页面加载、宿主调用点是否一致。
 *
 *   node scripts/check-nodes.mjs
 *
 * 检查项：
 *   1. 每个节点模块必须导出 window.XxxNode 且声明 type
 *   2. canvas.html 必须加载该模块，且位置在 canvas.js 之前
 *   3. 宿主（canvas.js）里必须存在对 window.XxxNode 的调用
 *   4. 模块行数超过 600 时提示拆分（README 里的阈值）
 *   5. 模块内不应出现裸的 nodes / connections / canvas 状态引用（必须走 deps getter）
 *   6. 模块里的函数不能被其他 js 文件裸调用（必须走 window.XxxNode.xxx 或由模块导出）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'static';
const NODES = join(ROOT, 'nodes');
const HOST = join(ROOT, 'js', 'canvas.js');
const PAGE = join(ROOT, 'canvas.html');
const LINE_LIMIT = 600;

// 剥掉注释与字符串字面量，避免说明文字、tr('canvas.xxx') 文案 key、class 属性值误报
const stripCode = s => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

const host = readFileSync(HOST, 'utf8');
const page = readFileSync(PAGE, 'utf8');
const hostLine = page.split('\n').findIndex(l => l.includes('/static/js/canvas.js'));

let failed = 0;
const fail = (name, msg) => { console.log(`  FAIL  ${name}  ${msg}`); failed += 1; };
const warn = (name, msg) => console.log(`  WARN  ${name}  ${msg}`);
const ok = (name, msg) => console.log(`  ok    ${name}  ${msg}`);

// shared/ 放节点共用控件，不是节点，不参与「一个节点一个目录」的契约检查
const SHARED_DIRS = new Set(['shared']);
const dirs = readdirSync(NODES).filter(name => {
    if (SHARED_DIRS.has(name)) return false;
    try { return statSync(join(NODES, name)).isDirectory(); } catch { return false; }
});

if (!dirs.length) {
    console.log('static/nodes/ 下没有节点目录');
    process.exit(0);
}

for (const dir of dirs) {
    const file = join(NODES, dir, 'index.js');
    let src;
    try { src = readFileSync(file, 'utf8'); }
    catch { fail(dir, '缺少 index.js'); continue; }

    const lines = src.split('\n').length;

    // 多文件目录（如 minimax 的 helpers/runninghub）：这些文件同样要过阈值、
    // 同样不能出现裸状态名、同样必须加载在 canvas.js 之前
    const extraFiles = readdirSync(join(NODES, dir))
        .filter(f => f.endsWith('.js') && f !== 'index.js')
        .map(f => ({ name: f, src: readFileSync(join(NODES, dir, f), 'utf8') }));

    const exported = src.match(/window\.([A-Z]\w*Node)\s*=/);
    if (!exported) { fail(dir, '没有导出 window.XxxNode'); continue; }
    const global = exported[1];

    // type 必须来自导出对象，不能取模块内第一个 type: ——
    // 节点内部会有 {type:'image'} 这类端口/字段描述，取到就是错的；
    // 也不能取第一个 window.XxxNode，因为文件头注释里常会提到它。导出块总在末尾，用 lastIndexOf
    const exportAt = src.lastIndexOf(`window.${global}`);
    const type = (exportAt >= 0 ? src.slice(exportAt) : src).match(/\btype:\s*'([\w-]+)'/);
    if (!type) fail(dir, `${global} 没有声明 type`);

    if (!/^\s*init\s*\(/m.test(src) && !/init\s*\(next\)/.test(src)) warn(dir, '没有 init()，状态可能无处注入');

    const scriptIdx = page.split('\n').findIndex(l => l.includes(`nodes/${dir}/index.js`));
    if (scriptIdx < 0) fail(dir, 'canvas.html 未加载该模块');
    else if (hostLine >= 0 && scriptIdx > hostLine) fail(dir, '加载位置在 canvas.js 之后，注入会失效');
    for (const f of extraFiles) {
        const i = page.split('\n').findIndex(l => l.includes(`nodes/${dir}/${f.name}`));
        if (i < 0) fail(dir, `canvas.html 未加载 ${f.name}`);
        else if (i > scriptIdx) fail(dir, `${f.name} 必须在 index.js 之前加载（index.js 会解构它的导出）`);
    }

    const callCount = (host.match(new RegExp(`window\\.${global}\\.`, 'g')) || []).length;
    if (callCount === 0) warn(dir, `canvas.js 里没有调用 window.${global}.，可能是死模块`);

    // 裸状态引用：允许多次赋值的 let/const 之外的直接访问都要走 getter
    // 注释与字符串已在 stripCode 里剥掉，否则 tr('canvas.xxx') 的文案 key 会误报
    const allFiles = [{ name: 'index.js', src }, ...extraFiles];
    for (const f of allFiles) {
        const code = stripCode(f.src);
        const bare = code.match(/(?<![.\w$])(nodes|connections|canvas)(?![.\w$])/g) || [];
        if (bare.length) {
            const hits = [...new Set(bare)].join(', ');
            warn(dir, `${f.name} 出现裸状态名（${hits}），确认是否已走 deps getter`);
        }
    }

    for (const f of allFiles) {
        const n = f.src.split('\n').length;
        if (n > LINE_LIMIT) warn(dir, `${f.name} ${n} 行，超过 ${LINE_LIMIT} 行阈值，建议按职责再拆`);
    }

    if (!failed) {
        const fileNote = extraFiles.length ? ` · +${extraFiles.length} 个附属文件` : '';
        ok(dir, `${global} · type=${type?.[1] ?? '?'} · ${lines} 行${fileNote} · 宿主调用 ${callCount} 处`);
    }
}

// 6. 模块里的函数不能被其他文件裸调用
// 迁出后，原先的全局函数只存在于模块闭包里；别的文件还写 callCanvasLLM(...) 就会
// 在运行时 ReferenceError（这是 msgen/llm 两次迁移里唯一漏掉的坑）。
const hostCode = stripCode(host);
const hostFns = new Set([...hostCode.matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)].map(m => m[1]));
const moduleFns = new Map(); // 函数名 -> 所在目录
for (const dir of dirs) {
    let src;
    try { src = readFileSync(join(NODES, dir, 'index.js'), 'utf8'); } catch { continue; }
    for (const m of stripCode(src).matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)) {
        // 只看像业务函数的名字：太短的多半是同名局部变量（init / render）
        if (m[1].length >= 8 && /[A-Z]/.test(m[1]) && !hostFns.has(m[1])) moduleFns.set(m[1], dir);
    }
}
const jsDir = join(ROOT, 'js');
for (const file of readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
    const code = stripCode(readFileSync(join(jsDir, file), 'utf8'));
    // 跳过压缩过的第三方包（game-model-import.js 是 three.js 打包产物，单行上万字符）
    if (/\.min\.js$/.test(file) || code.split('\n', 20).some(l => l.length > 2000)) continue;
    const ownFns = new Set([...code.matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)].map(m => m[1]));
    for (const [fn, dir] of moduleFns) {
        if (ownFns.has(fn)) continue;
        if (new RegExp(`(?<![.\\w$])${fn}\\s*\\(`).test(code)) {
            fail(file, `裸调用 ${fn}()，该函数已迁到 nodes/${dir}/，应改为 window.模块名.${fn}(...)`);
        }
    }
}

console.log(failed ? `\n${failed} 项不通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
