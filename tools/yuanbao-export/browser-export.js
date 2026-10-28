// 在已登录的 https://yuanbao.tencent.com/chat/ai-creation 控制台运行。
// ponytail: 复用页面自身的只读模板 API，既不导出凭证，也不提交生图任务。
window.yuanbaoStyleExport = (async () => {
    if (location.hostname !== 'yuanbao.tencent.com') throw Error('请在元宝网站运行');
    if (!Array.isArray(window.webpackChunk_N_E)) throw Error('未找到页面模块，请先打开 AI 创作页');
    const requirePage = await new Promise(resolve => {
        window.webpackChunk_N_E.push([[`local-style-export-${Date.now()}`], {}, resolve]);
    });
    // 模块号取自 2026-10-27 页面公开脚本；平台升级后可能需要更新。
    const api = requirePage(93460).UE();
    const templates = new Map();
    const errors = [];
    const pages = [];
    let tabs = [];
    try {
        ({ tabs } = await api.getTabs({ creationType: 'image' }));
        if (!tabs.length) throw Error('接口未返回任何分类，不能确认导出完整');
        const categories = new Map();
        for (const tab of tabs) {
            categories.set(tab.id, { id: tab.id, name: tab.name });
            for (const sub of tab.subTabs || []) {
                categories.set(sub.id, { id: sub.id, name: `${tab.name}/${sub.name}` });
            }
        }
        for (const category of categories.values()) {
            let cursor = '0';
            const visited = new Set();
            try {
                for (;;) {
                    if (visited.has(cursor)) throw Error(`分页游标重复：${cursor}`);
                    visited.add(cursor);
                    const result = await api.getTemplates({
                        creationType: 'image', tabId: category.id, cursor, limit: 20
                    });
                    const items = [...result.templates];
                    for (const item of result.feedItems || []) {
                        if (item.kind !== 'promotion') continue;
                        for (const material of item.promotion.materials || []) {
                            if (material.action?.kind === 'template') items.push(material.action.template);
                        }
                    }
                    for (const item of items) {
                        if (!item.id) throw Error('模板缺少 ID');
                        const previous = templates.get(item.id);
                        const memberships = previous?.categories || [];
                        if (!memberships.some(c => c.id === category.id)) memberships.push(category);
                        templates.set(item.id, { ...previous, ...item, categories: memberships });
                    }
                    pages.push({ category: category.name, cursor, count: items.length,
                        hasMore: result.hasMore, totalCount: result.totalCount });
                    console.log(`[元宝导出] ${category.name} / 游标 ${cursor} / 已去重 ${templates.size} 条`);
                    if (!result.hasMore) break;
                    if (result.nextCursor == null) throw Error('接口声明还有下一页，但没有返回游标');
                    cursor = String(result.nextCursor);
                }
            } catch (error) {
                errors.push({ category: category.name, cursor, error: String(error) });
                console.warn('[元宝导出] 分类读取不完整', category.name, error);
            }
        }
        for (const item of templates.values()) {
            if (item.templatePrompt?.trim()) continue;
            try {
                const { template } = await api.getTemplateById({ templateId: item.id, tabId: item.tabId });
                templates.set(item.id, { ...item, ...template, categories: item.categories });
                if (!template.templatePrompt?.trim()) throw Error('详情接口也未公开提示词');
            } catch (error) {
                errors.push({ templateId: item.id, name: item.templateName, error: String(error) });
            }
        }
    } catch (error) {
        errors.push({ error: String(error) });
    } finally {
        api.dispose();
    }
    const output = {
        source: 'https://yuanbao.tencent.com/chat/ai-creation',
        exportedAt: new Date().toISOString(),
        complete: errors.length === 0 && templates.size > 0,
        count: templates.size, tabs, pages, templates: [...templates.values()], errors
    };
    // 只下载风格数据，不包含账号资料、Cookie、令牌或聊天历史。
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'yuanbao-export.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    console.log(`[元宝导出] 完成：${output.count} 条，${errors.length} 项异常，已下载 yuanbao-export.json`);
    return output;
})().catch(error => { console.error('[元宝导出] 启动失败', error); throw error; });
