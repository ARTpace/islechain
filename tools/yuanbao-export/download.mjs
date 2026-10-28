import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function normalize(item, index) {
    return {
        id: String(item.id || `yuanbao_${index + 1}`),
        name: item.templateName || item.name || `风格 ${index + 1}`,
        prompt: item.templatePrompt || item.prompt || '',
        thumbnail: item.preview?.posterUrl || item.preview?.sourceUrl || item.thumbnail || '',
        reference_images: [...new Set([
            ...(item.originalImages || []).map(image => image.sourceUrl),
            item.reference_image
        ].filter(Boolean))],
        categories: item.categories || [],
        generation_type: item.generationType || '',
        min_images: item.minCount,
        max_images: item.maxCount,
        upload_requirements: item.templateTip || item.upload_requirements || [],
        reference_slots: item.reference_slots,
        source_metadata: item
    };
}

export async function download(input, output = join(dirname(resolve(input)), 'downloaded')) {
    const source = JSON.parse(await readFile(input, 'utf8'));
    if (!Array.isArray(source.templates) || source.templates.length === 0) throw Error('数据中没有模板');
    const rows = source.templates.map(normalize);
    const tasks = new Map();
    const failures = [];
    let downloaded = 0;
    let reused = 0;
    let totalBytes = 0;
    await mkdir(join(output, 'images'), { recursive: true });
    function enqueue(url, row, field, array = false) {
        if (!url) return;
        let parsed;
        try { parsed = new URL(url); } catch { failures.push({ name: row.name, url, error: '图片地址无效' }); return; }
        if (parsed.protocol !== 'https:' || !/(^|\.)tencent\.com$|(^|\.)myqcloud\.com$/.test(parsed.hostname)) {
            failures.push({ name: row.name, url, error: '不是已知腾讯 HTTPS 图片域名，未下载' });
            return;
        }
        let task = tasks.get(url);
        if (!task) {
            task = { url, targets: [] };
            tasks.set(url, task);
        }
        task.targets.push({ row, field, array });
    }
    for (const row of rows) {
        enqueue(row.thumbnail, row, 'thumbnail_file');
        for (const url of row.reference_images) enqueue(url, row, 'reference_files', true);
    }
    const queue = [...tasks.values()];
    // ponytail: 六个下载工人 + URL 哈希去重；重复运行复用已有文件，不引入下载依赖。
    await Promise.all(Array.from({ length: 6 }, async () => {
        while (queue.length) {
            const task = queue.shift();
            try {
                const extension = extname(new URL(task.url).pathname).toLowerCase();
                const suffix = /^\.(jpg|jpeg|png|webp|gif|avif)$/.test(extension) ? extension : '.img';
                const relative = `images/${createHash('sha256').update(task.url).digest('hex').slice(0, 24)}${suffix}`;
                const file = join(output, relative);
                let size = await stat(file).then(info => info.size, () => 0);
                if (size > 0) reused++;
                else {
                    let lastError;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            const response = await fetch(task.url, {
                                headers: { Referer: 'https://yuanbao.tencent.com/' },
                                signal: AbortSignal.timeout(25000)
                            });
                            if (!response.ok) throw Error(`HTTP ${response.status}`);
                            if (!response.headers.get('content-type')?.startsWith('image/')) throw Error('返回内容不是图片');
                            const bytes = Buffer.from(await response.arrayBuffer());
                            if (!bytes.length) throw Error('图片为空');
                            await writeFile(file, bytes);
                            size = bytes.length;
                            lastError = null;
                            break;
                        } catch (error) { lastError = error; }
                    }
                    if (lastError) throw lastError;
                    downloaded++;
                }
                totalBytes += size;
                for (const { row, field, array } of task.targets) {
                    if (array) (row[field] ||= []).push(relative);
                    else row[field] = relative;
                }
            } catch (error) {
                failures.push({ url: task.url, names: task.targets.map(t => t.row.name), error: String(error) });
            }
        }
    }));
    const report = {
        source: source.source, exportedAt: source.exportedAt || source.extracted_at,
        complete: source.complete === true && failures.length === 0 &&
            (source.errors || []).length === 0 && rows.every(row => row.prompt.trim()),
        templates: rows.length, uniqueImages: tasks.size, downloaded, reused, totalBytes,
        extractionErrors: source.errors || [], missingPrompts: rows.filter(row => !row.prompt.trim()).map(row => row.name),
        failures
    };
    await writeFile(join(output, 'styles.json'), JSON.stringify(rows, null, 2));
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output: resolve(output), ...report }, null, 2));
    return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (!process.argv[2]) {
        console.error(`用法：node ${basename(process.argv[1])} <yuanbao-export.json> [输出目录]`);
        process.exitCode = 1;
    } else {
        download(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
    }
}
