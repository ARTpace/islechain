const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run(repeatCursor = false) {
    const calls = [];
    let disposed = false;
    let downloaded;
    let downloadClicks = 0;
    const api = {
        async getTabs() { return { tabs: [{ id: 'all', name: '全部' }, { id: 'poster', name: '海报' }] }; },
        async getTemplates(args) {
            calls.push([args.tabId, args.cursor]);
            const first = { id: 'a', templateName: '风格 A', templatePrompt: '真实提示词 A' };
            if (args.tabId === 'poster') return { templates: [first], hasMore: false };
            if (args.cursor === '0') return { templates: [first], hasMore: true, nextCursor: repeatCursor ? '0' : '20' };
            return {
                templates: [{ id: 'b', templateName: '风格 B' }], hasMore: false,
                feedItems: [{ kind: 'promotion', promotion: { materials: [{ action: {
                    kind: 'template', template: { id: 'c', templateName: '横幅模板', templatePrompt: '横幅提示词' }
                } }] } }]
            };
        },
        async getTemplateById({ templateId }) {
            assert.equal(templateId, 'b');
            return { template: { id: 'b', templateName: '风格 B', templatePrompt: '详情补齐提示词 B', minCount: 1 } };
        },
        dispose() { disposed = true; }
    };
    const chunks = [];
    chunks.push = entry => entry[2](id => { assert.equal(id, 93460); return { UE: () => api }; });
    const context = {
        window: { webpackChunk_N_E: chunks }, location: { hostname: 'yuanbao.tencent.com' },
        Blob, URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
        document: { createElement: () => ({ click() { downloadClicks++; } }) },
        console: { log() {}, warn() {}, error() {} }, setTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync('tools/yuanbao-export/browser-export.js', 'utf8'), context);
    const result = await context.window.yuanbaoStyleExport;
    assert.equal(disposed, true);
    assert.equal(downloadClicks, 1);
    assert.equal(JSON.parse(await downloaded.text()).count, result.count);
    if (repeatCursor) {
        assert.equal(result.complete, false);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0].error, /游标重复/);
    } else {
        assert.equal(result.complete, true);
        assert.equal(result.count, 3);
        assert.equal(result.templates.find(t => t.id === 'a').categories.length, 2);
        assert.equal(result.templates.find(t => t.id === 'b').templatePrompt, '详情补齐提示词 B');
        assert.deepEqual(calls, [['all', '0'], ['all', '20'], ['poster', '0']]);
    }
}

(async () => {
    await run();
    await run(true);
    const { normalize } = await import('../tools/yuanbao-export/download.mjs');
    const row = normalize({ id: 'a', templateName: '风格 A', templatePrompt: '正文', minCount: 2,
        preview: { sourceUrl: 'https://cdn-pro.yuanbao.tencent.com/a.webp' },
        originalImages: [{ sourceUrl: 'https://cdn-pro.yuanbao.tencent.com/ref.jpg' }]
    }, 0);
    assert.equal(row.name, '风格 A');
    assert.equal(row.prompt, '正文');
    assert.equal(row.min_images, 2);
    assert.equal(row.reference_images.length, 1);
    assert.equal(normalize({ name: '旧记录', prompt: '提示词', thumbnail: 'https://example.com/a.jpg' }, 0).name, '旧记录');
    console.log('元宝导出：分页、分类去重、横幅模板、详情补齐、异常保留和数据归一化检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
