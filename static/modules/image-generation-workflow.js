/* Shared local workflow construction: no page DOM or generation side effects. */
(function(){
'use strict';
const cache={};
        function _applySelectedUnet(wf, model) {
            if (!model || !wf) return;
            for (const nid in wf) {
                const node = wf[nid];
                if (!node || !node.inputs) continue;
                if (node.class_type === 'UNETLoader' && node.inputs.unet_name !== undefined) {
                    node.inputs.unet_name = model;
                }
                if (node.class_type && node.class_type.includes('LoadDiffusionModel') && node.inputs.model_name !== undefined) {
                    node.inputs.model_name = model;
                }
            }
        }

        async function buildLocalReferenceWorkflow(name, refs, prompt, seed, size, batchCount) {
            if (!refs.length || !/(qwen-image-2\.1(?:-fast|-turbo)?|moss-image-sft(?:-fast|-4step)?|flux3-klein)\.json$/i.test(name)) return null;
            const moss = /moss-image-sft(?:-fast|-4step)?\.json$/i.test(name);
            if (moss && refs.length > 1) throw new Error('MOSS 图生图目前支持一张参考图，请仅保留一张');
            if (refs.length > 16) throw new Error('Qwen 2.1 最多支持 16 张参考图');
            const editName = 'image-edit/' + name.split('/').pop();
            const response = await fetch('/api/workflows/' + encodeURIComponent(editName));
            if (!response.ok) throw new Error('参考图编辑工作流加载失败：' + editName);
            const envelope = await response.json();
            const graph = JSON.parse(JSON.stringify(envelope.workflow || envelope));
            graph['23'].inputs.text = prompt;
            graph['22'].inputs.seed = seed;
            graph['14'].inputs.image = refs[0];
            if (/flux3-klein\.json$/i.test(name)) {
                graph['144'].inputs = {width:size.width, height:size.height, batch_size:batchCount};
                graph['6'].inputs['resolution.megapixels'] = Math.max(0.01, size.width * size.height / 1000000);
                refs.slice(1).forEach((image, index) => {
                    const id = String(200 + index);
                    graph[id] = {class_type:'LoadImage', inputs:{image}};
                    graph['6'].inputs['images.image' + (index + 1)] = [id, 0];
                });
                return {workflow:graph, name:editName};
            }
            graph['11'].inputs.largest_size = Math.max(size.width, size.height);
            if (!moss) refs.slice(1).forEach((image, index) => {
                const id = String(200 + index);
                graph[id] = {class_type:'LoadImage', inputs:{image}};
                graph['6'].inputs['images.image_' + (index + 2)] = [id, 0];
            });
            if (batchCount > 1) {
                graph['2010'] = {class_type:'RepeatLatentBatch', inputs:{samples:graph['22'].inputs.latent_image, amount:batchCount}};
                graph['22'].inputs.latent_image = ['2010', 0];
            }
            return {workflow:graph, name:editName};
        }

        function mergeExtraNegative(workflow, extraText) {
            if (!extraText) {
                console.log('[NegPrompt] 无额外负面提示词，跳过');
                return;
            }
            console.log('[NegPrompt] 用户额外负面提示词: ', JSON.stringify(extraText));

            // Step 1: 找到所有 KSampler/KSamplerAdvanced → negative 引用
            const pairs = []; // { samplerNid, samplerNode, negNid, negNode }
            for (const nid in workflow) {
                const node = workflow[nid];
                if (!node || !node.inputs) continue;
                const ct = node.class_type || '';
                if (ct === 'KSampler' || ct === 'KSamplerAdvanced') {
                    const negRef = node.inputs.negative;
                    if (Array.isArray(negRef) && negRef.length === 2) {
                        const negNid = String(negRef[0]);
                        const negNode = workflow[negNid];
                        pairs.push({ samplerNid: nid, samplerNode: node, negNid, negNode });
                        console.log('[NegPrompt] ', ct, nid, '→ negative 节点', negNid, '类型:', negNode ? negNode.class_type : 'MISSING');
                    }
                }
            }

            if (pairs.length === 0) {
                console.warn('[NegPrompt] 工作流中未找到任何 KSampler/KSamplerAdvanced — 无法注入负面提示词');
                return;
            }

            // Step 2: 逐对处理（原地修改，无需新增节点，节点ID不变）
            for (const { samplerNid, samplerNode, negNid, negNode } of pairs) {
                if (!negNode) {
                    console.warn('[NegPrompt] KSampler', samplerNid, '的 negative 节点', negNid, '不存在于工作流中');
                    continue;
                }

                if (negNode.class_type === 'CLIPTextEncode') {
                    // 已有 CLIPTextEncode（ANIMA 节点12）— 直接追加
                    const oldText = (negNode.inputs.text || '').trim();
                    const separator = oldText ? ', ' : '';
                    negNode.inputs.text = oldText + separator + extraText;
                    console.log('[NegPrompt] KSampler', samplerNid, '→ CLIPTextEncode', negNid, '追加负面');
                } else if (negNode.class_type === 'TextEncodeQwenImage21') {
                    const oldText = (negNode.inputs.negative_prompt || '').trim();
                    negNode.inputs.negative_prompt = oldText ? oldText + ', ' + extraText : extraText;
                } else {
                    console.warn('[NegPrompt] KSampler', samplerNid, 'negative 节点', negNid,
                        '类型为', negNode.class_type, '— 非 CLIPTextEncode，跳过');
                }
            }

            // Step 3: 最终验证 — 遍历所有 KSampler，打印最终 negative text
            console.groupCollapsed('[NegPrompt] 最终验证: 所有 KSampler 的 negative 文本');
            for (const nid in workflow) {
                const node = workflow[nid];
                if (!node || !node.inputs) continue;
                const ct = node.class_type || '';
                if (ct === 'KSampler' || ct === 'KSamplerAdvanced') {
                    const negRef = node.inputs.negative;
                    if (Array.isArray(negRef) && negRef.length === 2) {
                        const finalNegNode = workflow[String(negRef[0])];
                        const finalText = (finalNegNode && finalNegNode.class_type === 'CLIPTextEncode')
                            ? (finalNegNode.inputs.text || '')
                            : '(非CLIPTextEncode)';
                        console.log('  KSampler', nid, '→', String(negRef[0]), ':', JSON.stringify(finalText));
                    }
                }
            }
            console.groupEnd();
        }

async function build(options){
    const {workflowName:lockedWorkflow,prompt:cleanPrompt,seed,size,controls:_gc,unet:lockedUnetModel='',loras=[],negative='',presetPrompts='',qualities={}}=options;
    const taskRefs=options.refs||[];
    const ensureRefComfyNames=options.referenceNames|| (async()=>[]);
    const PROMPT_TAG_SPLITTER=/[，,、；;]/;
    const ideogram4JsonPrompt=options.structuredPrompt||'';
    const ideogram4Quality=qualities.ideogram||'Default';
    let workflow,actualWorkflowName=lockedWorkflow;
                // 加载工作流（带缓存，避免重复请求）

                if (cache[lockedWorkflow]) {
                    workflow = JSON.parse(JSON.stringify(cache[lockedWorkflow]));
                } else {
                    const wfRes = await fetch('/api/workflows/' + encodeURIComponent(lockedWorkflow));
                    if (!wfRes.ok) throw new Error('工作流加载失败');
                    const wfEnvelope = await wfRes.json();
                    cache[lockedWorkflow] = wfEnvelope.workflow || wfEnvelope;
                    workflow = JSON.parse(JSON.stringify(cache[lockedWorkflow]));
                }


                // 注入用户选择的 UNET 模型（若已显式选择）
                _applySelectedUnet(workflow, lockedUnetModel);

                if (taskRefs?.length && !/(?:qwen-image-2\.1|moss-image-sft|flux3-klein|krea2)/i.test(lockedWorkflow)) throw new Error('当前模型未接入对话图片编辑，请选择 Qwen 2.1、MOSS、FLUX.3 Klein 或 Krea2');
                const referenceNames = /(?:qwen-image-2\.1(?:-fast|-turbo)?|moss-image-sft(?:-fast|-4step)?|flux3-klein)\.json$/i.test(lockedWorkflow) ? await ensureRefComfyNames(taskRefs) : [];
                const referenceEdit = await buildLocalReferenceWorkflow(lockedWorkflow, referenceNames, cleanPrompt, seed, size, _gc.batchCount);
                if (referenceEdit) {
                    workflow = referenceEdit.workflow;
                    actualWorkflowName = referenceEdit.name;
                    _applySelectedUnet(workflow, lockedUnetModel);
                } else if (lockedWorkflow.toLowerCase().includes('anima')) {
                    // 解析提示词，分离角色和画师标签
                    const parts = cleanPrompt.split(PROMPT_TAG_SPLITTER).map(p => p.trim()).filter(p => p);
                    const charTags = parts.filter(p => !p.startsWith('by ') && !p.startsWith('@')).join(', ');
                    const artistTags = parts.filter(p => p.startsWith('by ') || p.startsWith('@')).map(p => '@' + p.replace(/^by /, '').replace(/^@/, '')).join(', ');

                    const node51 = workflow["51"];
                    if (node51?.inputs && 'character_tags' in node51.inputs) {
                        // 旧版工作流：AnimaCharacterTagSelector 节点存在时沿用原注入方式
                        node51.inputs.character_tags = charTags;
                        // 合并画师标签和预设提示词
                        const presetPrompts = options.presetPrompts || '';
                        let optParts = [];
                        if (artistTags) optParts.push(artistTags);
                        if (presetPrompts) optParts.push(presetPrompts);
                        node51.inputs.opt_prompt = optParts.length > 0 ? optParts.join(', ') + ', ' : '';
                    } else {
                        // 新版工作流：选择器节点已旁路，角色/画师/预设直接拼进正向 CLIPTextEncode(11)
                        const presetPrompts = options.presetPrompts || '';
                        let optParts = [];
                        if (artistTags) optParts.push(artistTags);
                        if (presetPrompts) optParts.push(presetPrompts);
                        const node11 = workflow["11"];
                        if (node11?.inputs) {
                            node11.inputs.text = [
                                optParts.length > 0 ? optParts.join(', ') : '',
                                charTags
                            ].filter(Boolean).join(', ');
                        }
                    }
                    // 设置图片尺寸
                    const size = options.size;
                    const node69 = workflow["69"];
                    if (node69?.inputs) {
                        node69.inputs.width = size.width;
                        node69.inputs.height = size.height;
                    }
                    // 种子：随机模式用随机值，固定模式用用户指定值
                    const finalSeed = _gc.seedMode === 'fixed' && _gc.fixedSeed > 0 ? _gc.fixedSeed : seed;
                    if (workflow["19"]?.inputs) workflow["19"].inputs.seed = finalSeed;
                    // 覆盖 batch_size（使用与 KSampler(19).latent_image 来源节点对齐的值）
                    if (workflow["69"]?.inputs) workflow["69"].inputs.batch_size = _gc.batchCount;
                    if (workflow["64"]?.inputs) workflow["64"].inputs.batch_size = _gc.batchCount;
                } else if (lockedWorkflow.toLowerCase().includes('krea2')) {
                    // Krea2:根据是否导入参考图,决定走纯文生图还是图片编辑工作流
                    const refNames = await ensureRefComfyNames(taskRefs);
                    if (refNames.length > 2) throw new Error('Krea2 最多支持两张参考图，请减少图片数量');
                    if (refNames.length > 0) {
                        // 有参考图 → 图片编辑的 krea2 工作流(单图/双图按数量自动选)
                        const useDual = refNames.length >= 2;
                        const wfName = useDual ? 'image-edit/krea2-two_image-edit.json' : 'image-edit/krea2-image-edit.json';
                        actualWorkflowName = wfName; // 记录真实提交的工作流,供历史复用
                        const wfRes2 = await fetch('/api/workflows/' + encodeURIComponent(wfName));
                        if (!wfRes2.ok) throw new Error('Krea2 图片编辑工作流加载失败');
                        const env2 = await wfRes2.json();
                        workflow = JSON.parse(JSON.stringify(env2.workflow || env2));
                        // 重新 fetch 覆盖了 workflow,需再次注入用户选择的 UNET 权重
                        _applySelectedUnet(workflow, lockedUnetModel);
                        if (useDual) {
                            workflow["13"].inputs.image = refNames[0];
                            workflow["14"].inputs.image = refNames[1];
                            workflow["16"].inputs.prompt = cleanPrompt;
                            workflow["6"].inputs.seed = seed;
                            // 双图工作流：EmptyLatentImage 在节点2，注入生成数量
                            if (workflow["2"]?.inputs) workflow["2"].inputs.batch_size = _gc.batchCount;
                        } else {
                            workflow["23"].inputs.image = refNames[0];
                            workflow["34"].inputs.prompt = cleanPrompt;
                            workflow["8"].inputs.seed = seed;
                            // 单图工作流：EmptyLatentImage 在节点32，注入生成数量
                            if (workflow["32"]?.inputs) workflow["32"].inputs.batch_size = _gc.batchCount;
                        }
                        // 注入目标比例 + 尺寸(1K/2K)到缩放节点 → 输出不再受参考图比例限制
                        // 图片编辑页(klein.html)不注入此项,故保持 aspect_ratio='original' 原图比例
                        const _size = size;
                        const _scaleLen = Math.max(_size.width, _size.height);
                        const _applyScale = (nd) => {
                            if (nd && nd.inputs) {
                                // 用 custom + 比例宽高,支持任意比例(ImageScaleByAspectRatio V2 的
                                // aspect_ratio 枚举仅含 original/custom/1:1/3:2/4:3/16:9/2:3/3:4/9:16,
                                // 直接写比例字符串对非枚举比例会触发校验报错,故统一走 custom)。
                                nd.inputs.aspect_ratio = 'custom';
                                nd.inputs.proportional_width = _gc.ratioW;
                                nd.inputs.proportional_height = _gc.ratioH;
                                nd.inputs.scale_to_length = _scaleLen;
                                nd.inputs.fit = 'letterbox';
                            }
                        };
                        if (useDual) { _applyScale(workflow["1"]); _applyScale(workflow["5"]); }
                        else { _applyScale(workflow["24"]); }
                        // 下方统一执行 injectLoraNodes / mergeExtraNegative(对 image-edit 同样安全)
                    } else {
                        // 纯文生图:沿用 krea2-turbo。
                        // 若当前已是 image-edit 的 krea2 工作流(复用历史记录场景,用户未重新导入参考图),
                        // 退回 krea2-turbo.json,避免往不存在的节点注入导致报错。
                        if (!lockedWorkflow.toLowerCase().includes('krea2-turbo')) {
                            const wfRes0 = await fetch('/api/workflows/' + encodeURIComponent('text2image/krea2-turbo.json'));
                            if (!wfRes0.ok) throw new Error('Krea2 工作流加载失败');
                            const env0 = await wfRes0.json();
                            workflow = JSON.parse(JSON.stringify(env0.workflow || env0));
                            _applySelectedUnet(workflow, lockedUnetModel);
                            actualWorkflowName = 'text2image/krea2-turbo.json';
                        }
                        const size = options.size;
                        if (workflow["4"]?.inputs) workflow["4"].inputs.text = cleanPrompt;
                        if (workflow["6"]?.inputs) { workflow["6"].inputs.width = size.width; workflow["6"].inputs.height = size.height; workflow["6"].inputs.batch_size = _gc.batchCount; }
                        if (workflow["7"]?.inputs) workflow["7"].inputs.seed = seed;
                    }
                } else if (lockedWorkflow.toLowerCase().includes('ideogram4')) {
                    // Ideogram4：注入 prompt、尺寸、seed、质量控制
                    const size = options.size;
                    if (workflow["192"]?.inputs) workflow["192"].inputs.value = size.width;
                    if (workflow["193"]?.inputs) workflow["193"].inputs.value = size.height;
                    if (workflow["208"]?.inputs) workflow["208"].inputs.noise_seed = seed;
                    if (workflow["185"]?.inputs) workflow["185"].inputs.batch_size = _gc.batchCount;
                    if (workflow["206"]?.inputs) workflow["206"].inputs.choice = ideogram4Quality;
                    // 注入提示词
                    if (ideogram4JsonPrompt) {
                        try {
                            const j = JSON.parse(ideogram4JsonPrompt);
                            // 直接注入各字段到 Ideogram4PromptBuilderKJ (节点 220，仅 structured 变体有)
                            if (workflow["220"]?.inputs) {
                                workflow["220"].inputs.high_level_description = j.high_level_description || '';
                                workflow["220"].inputs.background = j.background || '';
                                workflow["220"].inputs.aesthetics = j.style?.aesthetics || '';
                                workflow["220"].inputs.lighting = j.style?.lighting || '';
                                workflow["220"].inputs.medium = j.style?.medium || '';
                            } else {
                                // 节点 220 不存在（ideogram4.json 无此节点），降级到普通文本提示词
                                if (workflow["190"]?.inputs) workflow["190"].inputs.text = cleanPrompt;
                            }
                        } catch(e) {
                            // JSON 解析失败，降级到普通提示词
                            if (workflow["190"]?.inputs) workflow["190"].inputs.text = cleanPrompt;
                        }
                    } else if (workflow["190"]?.inputs) {
                        // 无 JSON，直接注入普通提示词
                        workflow["190"].inputs.text = cleanPrompt;
                    }
                } else if (lockedWorkflow.toLowerCase().includes('boogu')) {
                    // Boogu：注入 prompt、尺寸、seed、batch_size
                    const size = options.size;
                    if (workflow["11"]?.inputs) workflow["11"].inputs.text = cleanPrompt;
                    if (workflow["8"]?.inputs) { workflow["8"].inputs.width = size.width; workflow["8"].inputs.height = size.height; workflow["8"].inputs.batch_size = _gc.batchCount; }
                    if (workflow["32"]?.inputs) workflow["32"].inputs.seed = seed;
                } else {
                    // Z-Image：使用与 ANIMA 相同的 ratio+res 尺寸计算
                    const size = options.size;
                    if (workflow["23"]?.inputs) workflow["23"].inputs.text = cleanPrompt;
                    if (workflow["144"]?.inputs) { workflow["144"].inputs.width = size.width; workflow["144"].inputs.height = size.height; }
                    if (workflow["22"]?.inputs) workflow["22"].inputs.seed = seed;
                    if (workflow["144"]?.inputs) workflow["144"].inputs.batch_size = _gc.batchCount;
                }

                // 注入自定义 LoRA 节点（ComfyUI/local 模式下所有工作流都支持）
                if (loras.length) {
                    LoraManager.injectNodes(workflow, loras);
                }

                // 合并额外负面提示词到工作流的默认负面提示词
                const extraNeg = negative;
                if (extraNeg) {
                    mergeExtraNegative(workflow, extraNeg);
                }
    return {workflow,name:actualWorkflowName};
}
window.ImageGenerationWorkflow={build};
})();
