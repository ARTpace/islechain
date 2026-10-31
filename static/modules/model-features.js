/**
 * 模型 → 落盘 feature 的单一映射表。
 *
 * 新增模型：可以只在 MAP 里加一行；也可以完全不加 ——
 *   1) 落盘目录 output/{user}/{type}/{feature}/{date} 由后端 resolve_media_dir 强制，永远规范；
 *   2) 未登记的模型按工作流文件名自动推导 feature，首次落盘自动登记进注册表；
 *   3) 本文件在页面启动时向 /api/media-registry 同步，把注册表里已出现的模型
 *      自动并入画廊白名单（historyType），因此新模型不必改代码也能在画廊里看到。
 *
 * MAP 的作用降级为「人工指定优先顺序 + 别名映射」，不再是必经环节。
 */
(function () {
    // 人工登记：key 为工作流文件名里的标识，value 为注册表 feature。
    // 顺序即画廊分类顺序；不在这里的模型会自动追加在后面。
    const MAP = {
        zimage: 'zimage',
        anima: 'anima',
        krea2: 'krea2',
        ideogram4: 'ideogram4',
        boogu: 'boogu',
    };

    const CACHE_KEY = 'artcanvas_media_features';
    const DEFAULT_TYPE = 'zimage';
    // 注册表补齐出来的 feature（同步初值取上次缓存，避免首帧空白）
    let extra = readCache();

    function readCache() {
        try {
            const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
            return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
        } catch (e) {
            return [];
        }
    }

    function writeCache(list) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(list));
        } catch (e) { /* 隐私模式/配额满：忽略，退化为仅用 MAP */ }
    }

    function featureForWorkflow(workflow) {
        const name = String(workflow || '').toLowerCase();
        if (!name) return DEFAULT_TYPE;
        // 长 key 优先，避免短前缀误匹配（如 krea 抢走 krea2）
        const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
        for (const key of keys) {
            if (name.includes(key)) return MAP[key];
        }
        // 未登记：取文件名主干作为 feature，后端会自动登记
        const base = name.replace(/\\/g, '/').split('/').pop() || '';
        return base.replace(/\.json$/, '') || DEFAULT_TYPE;
    }

    /** 画廊查询白名单：人工登记在前，注册表自动发现的后补。 */
    function historyType() {
        const known = new Set(Object.keys(MAP));
        const rest = extra.filter((id) => id && !known.has(id));
        return Object.keys(MAP).concat(rest).join(',');
    }

    /**
     * 在线 API 模型的落盘 feature：按模型分目录，不再全塞进 zimage。
     * 例：gpt-image-1 → online-gpt-image-1；空模型 → online。
     */
    function featureForCloudModel(model) {
        const raw = String(model || '').trim();
        if (!raw) return 'online';
        const safe = raw
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')  // 路径非法字符
            .replace(/\s+/g, '-')
            .replace(/^[.\-\s]+|[.\-\s]+$/g, '')          // 首尾点/横杠
            .slice(0, 40);
        return safe ? 'online-' + safe : 'online';
    }

    /**
     * 从后端注册表同步已登记的 image 类 feature。
     * @returns {Promise<boolean>} 相比上次缓存是否有变化（有变化说明画廊需要重载）
     */
    async function syncRegistry() {
        try {
            const res = await fetch('/api/media-registry', { cache: 'no-store' });
            if (!res.ok) return false;
            const data = await res.json();
            const ids = (data.features || [])
                .filter((f) => f && f.type === 'image' && f.id)
                .map((f) => String(f.id));
            const changed = ids.join(',') !== extra.join(',');
            extra = ids;
            writeCache(ids);
            return changed;
        } catch (e) {
            return false; // 后端未起/离线：沿用缓存与 MAP，不影响生成
        }
    }

    window.ModelFeatures = { MAP, featureForWorkflow, featureForCloudModel, historyType, syncRegistry };
})();
