/**
 * 抠图模式
 * 全局依赖: ComfyUIRegistry, comfyNameForRef, CLIENT_ID
 */

/**
 * 抠图模式设置
 */
function rmbgSettings(node) {
    return `
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">抠图模型</div>
                <select class="setting-input" data-field="rmbgModel">
                    <option value="BEN2"${node.rmbgModel === 'BEN2' ? ' selected' : ''}>BEN2</option>
                    <option value="RMBG-2.0"${node.rmbgModel === 'RMBG-2.0' ? ' selected' : ''}>RMBG-2.0</option>
                </select>
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">背景类型</div>
                <select class="setting-input" data-field="rmbgBackground">
                    <option value="Alpha"${node.rmbgBackground === 'Alpha' ? ' selected' : ''}>透明 (Alpha)</option>
                    <option value="White"${node.rmbgBackground === 'White' ? ' selected' : ''}>白色</option>
                    <option value="Black"${node.rmbgBackground === 'Black' ? ' selected' : ''}>黑色</option>
                    <option value="Color"${node.rmbgBackground === 'Color' ? ' selected' : ''}>自定义颜色</option>
                </select>
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field"><div class="setting-title">处理分辨率</div><input class="setting-input" data-field="rmbgRes" type="number" min="512" max="2048" step="64" value="${Number(node.rmbgRes || 1024)}"></label>
        </div>
    `;
}

/**
 * 抠图模式执行
 */
async function rmbgExecute(node, refs, prompt, promptId) {
    const inputName = await comfyNameForRef(refs[0]);
    
    const response = await fetch('/api/image-cutout/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            branch: node.rmbgModel === 'RMBG-2.0' ? 'RMBG-2.0' : 'BEN2',
            params: {
                "3": { image: inputName },
                "1": {
                    model: node.rmbgModel === 'RMBG-1.4' ? 'RMBG-2.0' : (node.rmbgModel || 'BEN2'),
                    background: node.rmbgBackground || 'Alpha',
                    process_res: Number(node.rmbgRes || 1024)
                }
            }
        })
    });
    if (!response.ok) throw new Error((await response.json()).detail || '抠图工作流加载失败');
    const workflowData = (await response.json()).workflow;

    const result = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: prompt || "抠图",
            workflow_data: workflowData,
            type: 'rmbg',
            params: {
                "3": { image: inputName },
                "1": {
                    model: node.rmbgModel === 'RMBG-1.4' ? 'RMBG-2.0' : (node.rmbgModel || "BEN2"),
                    background: node.rmbgBackground || "Alpha",
                    process_res: Number(node.rmbgRes || 1024)
                }
            },
            client_id: CLIENT_ID,
            canvas_id: window.canvas?.id || ''
        })
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail || '抠图失败'); return r.json(); });
    
    if (result.error) throw new Error(`抠图失败：${result.error}`);
    if (!result.images?.length) throw new Error('抠图失败：未返回图片');
    return { images: result.images || [] };
}

// 注册到 ComfyUI 注册表
ComfyUIRegistry.rmbg = {
    label: '抠图',
    requiresImage: true,
    tooltip: '自动去除图像背景，支持透明、白色、黑色等背景',
    settings: rmbgSettings,
    execute: rmbgExecute
};
