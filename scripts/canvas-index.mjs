#!/usr/bin/env node
/* canvas.js 分区索引：从正文的 `// @section NN · 标题` 锚点重建文件头目录，并校验是否漂移。
 *
 *   node scripts/canvas-index.mjs           只校验（默认）
 *   node scripts/canvas-index.mjs --write   重写文件头目录
 *
 * 为什么要有这个脚本：canvas.js 一万六千行、八百多个顶层函数，没有任何模块边界，
 * 唯一能让人定位的就是分区锚点。锚点是真源，文件头的目录是生成物——两者不一致时
 * 说明有人挪了代码却没重建目录，此时 check 会失败，避免目录指向错误行号。
 *
 * 加新功能时：在合适位置插一行 `// @section NN · 标题`（NN 按顺序补号），
 * 然后跑 `--write` 重建目录。不用手算行号。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'static/js/canvas.js';
const ANCHOR = /^\/\/ @section (\d+) · (.+)$/;
const TOC_START = '/* @toc';
const PAD_TO = 52;

const read = () => readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n').split('\n');

const width = s => [...s].reduce((n, c) => n + (/[\u2e80-\u9fff\uff00-\uff60]/.test(c) ? 2 : 1), 0);

function scan(lines) {
    const sections = [];
    lines.forEach((line, i) => {
        const m = ANCHOR.exec(line);
        if (m) sections.push({ no: Number(m[1]), title: m[2].trim(), line: i + 1 });
    });
    return sections;
}

/* offset：目录尚未写入时，目录会把所有锚点整体下推自己的行数；已写入时为 0。 */
function buildToc(lines, sections, offset) {
    const total = lines.length + offset;
    const out = [`${TOC_START}  canvas.js 分区目录（scripts/canvas-index.mjs 生成，勿手改）`];
    out.push(`   ${sections.length} 个分区 / ${total} 行。正文搜索 "@section" 跳到分区头；改完代码跑 node scripts/canvas-index.mjs --write 重建本目录。`);
    sections.forEach((s, i) => {
        const start = s.line + offset;
        const end = i + 1 < sections.length ? sections[i + 1].line + offset - 1 : total;
        const label = `${String(s.no).padStart(2, '0')} · ${s.title}`;
        const pad = ' '.repeat(Math.max(2, PAD_TO - width(label)));
        out.push(`   ${label}${pad}L${String(start).padStart(6)}   ${end - start + 1} 行`);
    });
    out.push('*/');
    return out;
}

function locateToc(lines) {
    const at = lines.findIndex(l => l.startsWith(TOC_START));
    if (at === -1) return null;
    const end = lines.findIndex((l, i) => i > at && l.trim() === '*/');
    return end === -1 ? null : { at, end };
}

function plan(lines) {
    const sections = scan(lines);
    const toc = locateToc(lines);
    const offset = toc ? 0 : buildToc(lines, sections, 0).length;
    return { sections, toc, expected: buildToc(lines, sections, offset) };
}

const same = (a, b) => a && b && a.length === b.length && a.every((l, i) => l === b[i]);

let failed = 0;
const fail = msg => { console.log(`  FAIL  ${msg}`); failed += 1; };
const ok = msg => console.log(`  ok    ${msg}`);

if (process.argv.includes('--write')) {
    let lines = read();
    const first = plan(lines);
    if (!first.sections.length) {
        fail(`${TARGET} 找不到 // @section 锚点`);
        process.exit(1);
    }
    if (same(first.toc && lines.slice(first.toc.at, first.toc.end + 1), first.expected)) {
        ok(`目录已是最新（${first.sections.length} 个分区，${lines.length} 行）`);
        process.exit(0);
    }
    // 目录内容含总行数，插入自身会改变总行数，因此写完重读、再算一遍直到稳定
    for (let pass = 0; pass < 4; pass += 1) {
        const { toc, expected } = plan(lines);
        lines = toc
            ? [...lines.slice(0, toc.at), ...expected, ...lines.slice(toc.end + 1)]
            : [...expected, ...lines];
        writeFileSync(TARGET, lines.join('\n'), 'utf8');
        lines = read();
        const next = plan(lines);
        if (same(lines.slice(next.toc.at, next.toc.end + 1), next.expected)) {
            ok(`已重建目录（${next.sections.length} 个分区 / ${lines.length} 行，第 ${pass + 1} 遍收敛）`);
            process.exit(0);
        }
    }
    fail('目录重建 4 遍仍未收敛，检查锚点是否重复或标题含换行');
    process.exit(1);
}

const lines = read();
const { sections, toc, expected } = plan(lines);

if (!sections.length) fail(`${TARGET} 找不到 // @section 锚点`);
for (let i = 1; i < sections.length; i += 1) {
    if (sections[i].line <= sections[i - 1].line) fail(`分区顺序错乱：${sections[i].title} 出现在 ${sections[i - 1].title} 之前`);
    if (sections[i].no !== sections[i - 1].no + 1) fail(`分区编号不连续：${sections[i - 1].no} → ${sections[i].no}`);
}
if (!toc) fail('文件头缺少 @toc 目录块，跑 --write 生成');
else if (!same(lines.slice(toc.at, toc.end + 1), expected)) fail('文件头目录与正文锚点不一致（代码挪过位置？跑 --write 重建）');
else ok(`目录与 ${sections.length} 个分区锚点一致`);

process.exit(failed ? 1 : 0);
