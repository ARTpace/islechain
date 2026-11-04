/**
 * ComfyUI 工具函数
 * 全局依赖: uploadCanvasUrlToComfy(), CLIENT_ID
 */

/**
 * 上传图片到 ComfyUI 并返回文件名
 */
async function comfyNameForRef(ref) {
    if (ref.comfy_name) return ref.comfy_name;
    if (!ref.url) throw new Error('缺少输入图片');
    return uploadCanvasUrlToComfy(ref.url);
}

/**
 * 运行 ComfyUI 超分放大
 */
async function runComfyUpscale(imageUrl, resolution) {
    if (!imageUrl) throw new Error('超分失败：缺少输入图片');
    const nextInput = await uploadCanvasUrlToComfy(imageUrl);
    const upscale = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            workflow_json: 'upscale.json',
            params: {
                "15": { image: nextInput },
                "172": { seed: Math.floor(Math.random() * 4294967295), resolution: Number(resolution || 2048) }
            },
            type: 'enhance',
            client_id: CLIENT_ID,
            canvas_id: window.canvas?.id || ''
        })
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail || '超分失败'); return r.json(); });
    if (upscale.error) throw new Error(`超分失败：${upscale.error}`);
    if (!upscale.images?.length) throw new Error('超分失败：未返回图片');
    return upscale.images || [];
}

// 导出到全局
window.comfyNameForRef = comfyNameForRef;
window.runComfyUpscale = runComfyUpscale;


/**
 * 将 ComfyUI 图片保存到用户 output 目录
 * @param {string} comfyImageUrl - ComfyUI 图片 URL (如 /api/comfyui/view?filename=xxx)
 * @param {string} featureName - 功能文件夹名 (如 '抠图', '图片编辑', '3D视角')
 * @returns {string} 本地图片 URL (如 /output/admin/抠图/2026-06-10/xxx.png)
 */
async function saveToUserOutput(comfyImageUrl, featureName, withToken = false) {
    try {
        // 从 ComfyUI URL 提取参数
        const url = new URL(comfyImageUrl, window.location.origin);
        const filename = url.searchParams.get('filename') || '';
        const subfolder = url.searchParams.get('subfolder') || '';
        const type = url.searchParams.get('type') || 'output';
        if (!filename) return comfyImageUrl;

        let saveUrl = `/api/comfyui/save-to-output?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}&feature=${encodeURIComponent(featureName)}`;
        if (withToken) saveUrl += '&token=' + encodeURIComponent(localStorage.getItem('xy_auth_token') || '');
        const res = await fetch(saveUrl);
        if (!res.ok) return comfyImageUrl;
        const data = await res.json();
        return data.url || comfyImageUrl;
    } catch (e) {
        console.warn('saveToUserOutput 失败:', e);
        return comfyImageUrl;
    }
}
window.saveToUserOutput = saveToUserOutput;
// 保留独立引用，供需要携带登录令牌的页面兼容包装调用。
window.ComfyOutput = { save: saveToUserOutput };


/**
 * 把多张本地 output 图横向拼成一张（三视图 → 单张参考横图等）
 * @param {string[]} urls - 已落盘的 /output/ 图片地址，2~12 张
 * @param {string} feature - 落盘目录名，如 '三视图'
 * @param {{gap?:number, background?:string}} [opt] - gap 像素间距；background 铺底色
 *        （默认 #ffffff —— 下游 3D 重建不吃透明通道，透明会被当成黑色）
 * @returns {Promise<string|null>} 合成图 URL；失败返回 null，由调用方决定是否降级
 */
async function mergeImagesHorizontal(urls, feature = '拼图', opt = {}) {
    if (!Array.isArray(urls) || urls.length < 2) return null;
    try {
        const res = await fetch('/api/output/merge-horizontal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                urls, feature,
                gap: opt.gap || 0,
                background: opt.background === undefined ? '#ffffff' : opt.background,
                token: localStorage.getItem('xy_auth_token') || ''
            })
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.url || null;
    } catch (e) {
        console.warn('横向拼接失败:', e);
        return null;
    }
}
window.mergeImagesHorizontal = mergeImagesHorizontal;
