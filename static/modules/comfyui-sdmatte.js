/**
 * 抠半透明模式
 * 全局依赖: ComfyUIRegistry, comfyNameForRef, uploadMaskOnly, CLIENT_ID
 */

/**
 * 抠半透明模式设置
 */
function sdmatteSettings(node) {
    return `
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">推理尺寸</div>
                <input class="setting-input" data-field="sdmatteInferenceSize" type="number" 
                       min="512" max="2048" step="64" 
                       value="${Number(node.sdmatteInferenceSize || 1024)}">
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">遮罩优化</div>
                <select class="setting-input" data-field="sdmatteMaskRefine">
                    <option value="true"${node.sdmatteMaskRefine !== 'false' ? ' selected' : ''}>开启</option>
                    <option value="false"${node.sdmatteMaskRefine === 'false' ? ' selected' : ''}>关闭</option>
                </select>
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">遮罩约束</div>
                <input class="setting-input" data-field="sdmatteTrimapConstraint" type="number" 
                       min="0" max="1" step="0.1" 
                       value="${Number(node.sdmatteTrimapConstraint || 0.8)}">
            </label>
        </div>
    `;
}

/**
 * 抠半透明模式执行
 */
async function sdmatteExecute(node, refs, prompt, promptId) {
    const ref = refs[0];
    
    let inputName, maskName;
    if (ref.mask) {
        inputName = await comfyNameForRef(ref);
        maskName = await uploadMaskOnly(ref.mask);
    } else {
        inputName = await comfyNameForRef(ref);
        maskName = null;
    }
    
    const response = await fetch('/api/image-cutout/workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            branch: 'sdmatte',
            params: {
                "1": { image: inputName },
                "54": {
                    inference_size: Number(node.sdmatteInferenceSize || 1024),
                    mask_refine: node.sdmatteMaskRefine !== 'false',
                    trimap_constraint: Number(node.sdmatteTrimapConstraint || 0.8)
                },
                ...(maskName ? { "73": { image: maskName } } : {})
            },
            use_image_mask: !maskName
        })
    });
    if (!response.ok) throw new Error((await response.json()).detail || '抠半透明工作流加载失败');
    const workflowData = (await response.json()).workflow;

    const result = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: prompt || "抠半透明",
            workflow_data: workflowData,
            type: 'sdmatte',
            client_id: CLIENT_ID,
            canvas_id: window.canvas?.id || ''
        })
    }).then(async r => { 
        if (!r.ok) throw new Error((await r.json()).detail || '抠半透明失败'); 
        return r.json(); 
    });
    
    if (result.error) throw new Error(`抠半透明失败：${result.error}`);
    if (!result.images?.length) throw new Error('抠半透明失败：未返回图片');
    return { images: result.images || [] };
}

// 注册到 ComfyUI 注册表
ComfyUIRegistry.sdmatte = {
    label: '抠半透明',
    requiresImage: true,
    tooltip: '需要在图像节点双击，用遮罩工具涂抹全部你需要抠出的半透明物体如玻璃、烟雾等',
    settings: sdmatteSettings,
    execute: sdmatteExecute
};
