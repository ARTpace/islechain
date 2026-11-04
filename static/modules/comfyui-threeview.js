/**
 * 三视图 / 多视图模式
 * 一张角色参考图 → 正视图 / 侧视图 / 背视图 / 人脸特写（纯白背景设定图）
 *
 * 全局依赖: ComfyUIRegistry, comfyNameForRef, CLIENT_ID
 *
 * 配方（2026-11-02 实测跑通：ComfyUI 0.43.0 / RTX 3080 Ti / 4 步约 10-18s 每张）：
 *   UNET qwen-image-2.1 int8 + NSW Image Edit LoRA(0.85) + viggle-turbo-4step LoRA(1.0)
 *   CLIP 必须 qwen3vl_8b（4096 维）；配 qwen_2.5_vl_7b（3584 维）会报 normalized_shape 错
 *   参考图只接 image1；若 image2 也塞同一张图，模型会"复制原图"而不换视角
 */

const TV_UNET = 'qwen-image-2.1\\qwen_image_2.1_int8_convrot.safetensors';
const TV_LORA_EDIT = 'qwen2.1\\Qwen-Image-2.1 NSW Image Edit.safetensors';
const TV_LORA_TURBO = 'qwen2.1\\Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors';
const TV_CLIP = 'qwen3vl_8b_int8_convrot.safetensors';
const TV_VAE = 'qwen_image_2.1_vae_bf16.safetensors';

const TV_WHITE_SUFFIX = '一致的照明和风格，没有背景噪音，没有阴影。';

/** 默认视角提示词（可被用户在节点设置里覆盖） */
const TV_PRESETS = {
    front: '创建该角色的正视图，纯白色背景上的全身站姿，双眼平视镜头，双臂自然下垂。'
         + '严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。',
    side:  '创建该角色的右侧面视图，纯白色背景上的全身站姿，身体朝向画面右侧。'
         + '严格保持参考图人物的面部五官、发色发型、服装款式与材质、身体纹样完全一致。',
    back:  '创建该角色的背视图，纯白色背景上的全身站姿，背对镜头，身形挺直。'
         + '双臂自然下垂贴在身体两侧，双手垂在身后，不要抬手臂。'
         + '严格保持参考图人物的发型、服装背面款式与材质、身体纹样完全一致。',
    face:  '创建该角色的人脸特写正视图，纯白色背景，面部占满画面。'
         + '严格保持参考图人物的五官比例、肤色、发色与发型完全一致。'
};
const TV_VIEW_LABELS = { front: '正视图', side: '侧视图', back: '背视图', face: '人脸特写' };

function tvEscape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function threeviewSettings(node) {
    const views = Number(node.tvViews || 4);
    const rows = ['front', 'side', 'back', 'face'].map(k => `
        <div class="gen-settings-row">
            <label class="field">
                <div class="setting-title">${TV_VIEW_LABELS[k]}提示词</div>
                <textarea class="setting-input" data-field="tvPrompt_${k}" rows="2"
                    placeholder="${tvEscape(TV_PRESETS[k])}">${tvEscape(node['tvPrompt_' + k] || '')}</textarea>
            </label>
        </div>`).join('');
    return `
        <div class="gen-settings-row">
            <label class="field"><div class="setting-title">输出视图</div>
                <select class="setting-input" data-field="tvViews">
                    <option value="3" ${views === 3 ? 'selected' : ''}>三视图（正 / 侧 / 背）</option>
                    <option value="4" ${views === 4 ? 'selected' : ''}>四视图（+ 人脸特写）</option>
                </select>
            </label>
        </div>
        <div class="gen-settings-row">
            <button type="button" class="setting-check ${node.tvWhiteBg !== false ? 'active' : ''}"
                data-toggle-field="tvWhiteBg"><span class="check-dot"></span>纯白背景</button>
        </div>
        <div class="gen-settings-row">
            <label class="field"><div class="setting-title">一致性强度</div>
                <input class="setting-input" data-field="tvLoraStrength" type="number"
                    min="0" max="2" step="0.05" value="${Number(node.tvLoraStrength ?? 0.85)}"></label>
        </div>
        <div class="gen-settings-row">
            <label class="field"><div class="setting-title">每张步数</div>
                <input class="setting-input" data-field="tvSteps" type="number"
                    min="4" max="20" step="1" value="${Number(node.tvSteps || 4)}"></label>
        </div>
        <div class="gen-settings-row">
            <label class="field"><div class="setting-title">宽 × 高</div>
                <input class="setting-input" data-field="tvWidth" type="number" min="512" max="2048"
                    step="64" value="${Number(node.tvWidth || 832)}"></label>
            <label class="field"><div class="setting-title">&nbsp;</div>
                <input class="setting-input" data-field="tvHeight" type="number" min="512" max="2048"
                    step="64" value="${Number(node.tvHeight || 1216)}"></label>
        </div>
        <div class="gen-settings-row">
            <div class="setting-title" style="opacity:.6;font-size:11px;line-height:1.4">
                提示词留空则用内置默认值。四视图约 40-70 秒。
            </div>
        </div>
        ${rows}
    `;
}

/** 构建 API 格式工作流（共享模型链 + 每条视角一条采样支线） */
function threeviewBuildWorkflow(node, inputName, keys) {
    const strength = Number(node.tvLoraStrength ?? 0.85);
    const steps = Number(node.tvSteps || 4);
    const width = Number(node.tvWidth || 832);
    const height = Number(node.tvHeight || 1216);
    const whiteBg = node.tvWhiteBg !== false;
    const baseSeed = node.tvSeed ? Number(node.tvSeed) : Math.floor(Math.random() * 1e15);

    const wf = {
        '1': { class_type: 'UNETLoader', inputs: { unet_name: TV_UNET, weight_dtype: 'default' } },
        '2': { class_type: 'LoraLoaderModelOnly',
               inputs: { lora_name: TV_LORA_EDIT, strength_model: strength, model: ['1', 0] } },
        '3': { class_type: 'LoraLoaderModelOnly',
               inputs: { lora_name: TV_LORA_TURBO, strength_model: 1, model: ['2', 0] } },
        '4': { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3.1, model: ['3', 0] } },
        '5': { class_type: 'CFGNorm', inputs: { strength: 1, model: ['4', 0] } },
        '6': { class_type: 'CLIPLoader',
               inputs: { clip_name: TV_CLIP, type: 'qwen_image', device: 'default' } },
        '7': { class_type: 'VAELoader', inputs: { vae_name: TV_VAE } },
        '8': { class_type: 'LoadImage', inputs: { image: inputName } },
        // 共用负向条件（空提示词 + 同一参考图）
        '9': { class_type: 'TextEncodeQwenImageEditPlus',
               inputs: { clip: ['6', 0], prompt: '', vae: ['7', 0], image1: ['8', 0] } },
        '10': { class_type: 'FluxKontextMultiReferenceLatentMethod',
                inputs: { conditioning: ['9', 0], reference_latents_method: 'index_timestep_zero' } },
        // 共用空 latent（尺寸会被后端 req.width/height 覆盖，这里给默认值）
        '11': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } }
    };

    const params = { '8': { image: inputName } };
    keys.forEach((key, i) => {
        const b = 100 + i * 10;
        const userPrompt = (node['tvPrompt_' + key] || '').trim();
        const text = (userPrompt || TV_PRESETS[key]) + (whiteBg ? TV_WHITE_SUFFIX : '');
        wf[b] = { class_type: 'TextEncodeQwenImageEditPlus',
                  inputs: { clip: ['6', 0], prompt: text, vae: ['7', 0], image1: ['8', 0] } };
        wf[b + 1] = { class_type: 'FluxKontextMultiReferenceLatentMethod',
                      inputs: { conditioning: [String(b), 0],
                                reference_latents_method: 'index_timestep_zero' } };
        wf[b + 2] = { class_type: 'KSampler',
                      inputs: { seed: baseSeed + i, steps, cfg: 1, sampler_name: 'euler',
                                scheduler: 'simple', denoise: 1, model: ['5', 0],
                                positive: [String(b + 1), 0], negative: ['10', 0],
                                latent_image: ['11', 0] } };
        wf[b + 3] = { class_type: 'VAEDecode',
                      inputs: { samples: [String(b + 2), 0], vae: ['7', 0] } };
        wf[b + 4] = { class_type: 'SaveImage',
                      inputs: { filename_prefix: `threeview_${key}`, images: [String(b + 3), 0] } };
        params[String(b)] = { prompt: text };
        params[String(b + 2)] = { seed: baseSeed + i };
    });
    return { wf, params, width, height };
}

async function threeviewExecute(node, refs, prompt, promptId) {
    if (!refs?.length) throw new Error('三视图需要一张角色参考图');
    const inputName = await comfyNameForRef(refs[0]);
    const views = Number(node.tvViews || 4);
    const keys = views >= 4 ? ['front', 'side', 'back', 'face'] : ['front', 'side', 'back'];
    const { wf, params, width, height } = threeviewBuildWorkflow(node, inputName, keys);

    const result = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: prompt || '',
            width,
            height,
            workflow_data: wf,
            type: 'threeview',
            params,
            client_id: CLIENT_ID,
            canvas_id: window.canvas?.id || '',
            feature: '三视图'
        })
    }).then(async r => {
        if (!r.ok) throw new Error((await r.json()).detail || '三视图生成失败');
        return r.json();
    });

    if (result.error) throw new Error(`三视图生成失败：${result.error}`);
    if (!result.images?.length) throw new Error('三视图生成失败：未返回图片');
    return { images: result.images };
}

// 注册到 ComfyUI 注册表
ComfyUIRegistry.threeview = {
    label: '三视图',
    requiresImage: true,
    tooltip: '一张角色图生成正/侧/背/人脸特写多视图，纯白背景，适合角色设定图',
    settings: threeviewSettings,
    execute: threeviewExecute
};
