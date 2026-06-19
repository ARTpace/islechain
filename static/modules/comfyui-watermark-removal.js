/**
 * 去水印模式
 * 全局依赖: ComfyUIRegistry, comfyNameForRef, CLIENT_ID
 *
 * 工作流：图片去水印-工作流.json
 *  - 17 GJJ_MultiImageLoader   多图加载（sequence_range 控制范围）
 *  - 14 GJJ_BatchWatermarkRemover  批量去水印核心节点
 *  - 19 PreviewImage           预览输出（返回 IMAGE 批次）
 */

/**
 * 去水印模式设置（画布节点面板）
 */
function watermarkRemovalSettings(node) {
    return `
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">水印清理提示词</div>
                <input class="setting-input" data-field="wrPrompt" type="text" placeholder="clean all watermark,text,logo,signature,caption,overlay" value="${(node.wrPrompt || 'clean all watermark,text,logo,signature,caption,overlay').replace(/"/g, '&quot;')}">
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">负向提示词</div>
                <input class="setting-input" data-field="wrNegative" type="text" placeholder="(可选)" value="${(node.wrNegative || '').replace(/"/g, '&quot;')}">
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">处理分辨率 (MP)</div>
                <input class="setting-input" data-field="wrMegapixels" type="number" min="0.25" max="4" step="0.25" value="${Number(node.wrMegapixels || 1)}">
            </label>
            <label class="field">
                <div class="setting-title">输出尺寸模式</div>
                <select class="setting-input" data-field="wrOutputMode">
                    <option value="保持输入尺寸"${node.wrOutputMode === '保持输入尺寸' ? ' selected' : ''}>保持输入尺寸</option>
                    <option value="自定义"${node.wrOutputMode === '自定义' ? ' selected' : ''}>自定义</option>
                </select>
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">缩放方法</div>
                <select class="setting-input" data-field="wrScaleMethod">
                    <option value="nearest-exact"${node.wrScaleMethod === 'nearest-exact' ? ' selected' : ''}>nearest-exact</option>
                    <option value="lanczos"${node.wrScaleMethod === 'lanczos' ? ' selected' : ''}>lanczos</option>
                    <option value="bilinear"${node.wrScaleMethod === 'bilinear' ? ' selected' : ''}>bilinear</option>
                    <option value="bicubic"${node.wrScaleMethod === 'bicubic' ? ' selected' : ''}>bicubic</option>
                </select>
            </label>
            <label class="field">
                <div class="setting-title">步数</div>
                <input class="setting-input" data-field="wrSteps" type="number" min="1" max="50" step="1" value="${Number(node.wrSteps || 4)}">
            </label>
        </div>
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">CFG</div>
                <input class="setting-input" data-field="wrCfg" type="number" min="0" max="20" step="0.1" value="${Number(node.wrCfg || 1)}">
            </label>
            <label class="field">
                <div class="setting-title">种子 (空=随机)</div>
                <input class="setting-input" data-field="wrSeed" type="text" placeholder="随机" value="${node.wrSeed != null && node.wrSeed !== '' ? node.wrSeed : ''}">
            </label>
        </div>
    `;
}

/**
 * 去水印模式执行（画布节点调用）
 * 接收单张图片（refs），但工作流支持多图，所以只取首张；
 * 多图处理请使用独立页面 watermark-removal.html
 */
async function watermarkRemovalExecute(node, refs, prompt, promptId) {
    if (!refs || refs.length === 0) {
        throw new Error('请先拖入至少一张图片');
    }
    const inputName = await comfyNameForRef(refs[0]);

    const seedRaw = (node.wrSeed || '').toString().trim();
    const seed = seedRaw === '' ? Math.floor(Math.random() * 10 ** 15) : Number(seedRaw);

    const workflowData = {
        "14": {
            "inputs": {
                "prompt": node.wrPrompt || "clean all watermark,text,logo,signature,caption,overlay",
                "negative_prompt": node.wrNegative || "",
                "unet_name": node.wrUnet || "flux2-klein\\flux-2-klein-4b-fp8.safetensors",
                "clip_name": node.wrClip || "qwen_3_4b.safetensors",
                "vae_name": node.wrVae || "flux2-vae.safetensors",
                "working_megapixels": Number(node.wrMegapixels || 1),
                "output_size_mode": node.wrOutputMode || "保持输入尺寸",
                "scale_method": node.wrScaleMethod || "nearest-exact",
                "steps": Number(node.wrSteps || 4),
                "cfg": Number(node.wrCfg || 1),
                "seed": seed,
                "auto_save": !!node.wrAutoSave,
                "filename_prefix": node.wrFilenamePrefix || "GJJ/去水印",
                "filename_regex": node.wrFilenameRegex || "",
                "image": ["17", 0]
            },
            "class_type": "GJJ_BatchWatermarkRemover",
            "_meta": { "title": "GJJ · 🧼 批量图片去水印" }
        },
        "17": {
            "inputs": {
                "selected_images": JSON.stringify([{ filename: inputName, subfolder: "" }]),
                "sequence_range": "[1:1]"
            },
            "class_type": "GJJ_MultiImageLoader",
            "_meta": { "title": "GJJ · 🧡·📂 批量多图加载浏览,队列执行" }
        },
        "19": {
            "inputs": { "images": ["14", 0] },
            "class_type": "PreviewImage",
            "_meta": { "title": "预览图像" }
        }
    };

    // GJJ_MultiImageLoader 的 selected_images 不在 INPUT_TYPES，inputs 里的值会被丢弃
    // 必须通过 extra_pnginfo.workflow.nodes[].properties 传递
    const selectedImagesJson = JSON.stringify([{ filename: inputName, subfolder: "" }]);
    const result = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: prompt || '去水印',
            workflow_data: workflowData,
            type: 'watermark_removal',
            extra_pnginfo: {
                workflow: {
                    nodes: [
                        {
                            id: 17,
                            type: 'GJJ_MultiImageLoader',
                            properties: { selected_images: selectedImagesJson }
                        }
                    ]
                }
            },
            params: {
                "17": { sequence_range: "[1:1]" },
                "14": {
                    prompt: node.wrPrompt || "clean all watermark,text,logo,signature,caption,overlay",
                    negative_prompt: node.wrNegative || "",
                    working_megapixels: Number(node.wrMegapixels || 1),
                    output_size_mode: node.wrOutputMode || "保持输入尺寸",
                    scale_method: node.wrScaleMethod || "nearest-exact",
                    steps: Number(node.wrSteps || 4),
                    cfg: Number(node.wrCfg || 1),
                    seed: seed,
                    auto_save: !!node.wrAutoSave,
                    filename_prefix: node.wrFilenamePrefix || "GJJ/去水印"
                }
            },
            client_id: CLIENT_ID,
            canvas_id: window.canvas?.id || ''
        })
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).detail || '去水印失败'); return r.json(); });

    if (result.error) throw new Error(`去水印失败：${result.error}`);
    if (!result.images?.length) throw new Error('去水印失败：未返回图片');
    return { images: result.images || [] };
}

// 注册到 ComfyUI 注册表
ComfyUIRegistry.watermarkRemoval = {
    label: '去水印',
    requiresImage: true,
    returnsText: false,
    tooltip: 'AI 智能去除图片水印/文字/Logo/签名，单图批量处理',
    settings: watermarkRemovalSettings,
    execute: watermarkRemovalExecute
};
