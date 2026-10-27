/* 对话参数只走白名单；校验全部通过后再更新界面或提交。 */
window.ChatParameters = (() => {
    const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
    function samplingFields(workflow) {
        const fields = {};
        for (const node of Object.values(workflow || {})) {
            if (!/^(KSampler|KSamplerAdvanced|SamplerCustomAdvanced|BasicScheduler|CFGGuider)$/.test(node.class_type || '')) continue;
            for (const key of ['steps', 'cfg', 'denoise']) {
                if (typeof node.inputs?.[key] === 'number') fields[key] = node.inputs[key];
            }
        }
        return fields;
    }
    function plan(params, current) {
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('生图参数格式无效');
        const controls = { ...current.controls };
        const sampling = { ...current.sampling };
        let negative = current.negative;
        const labels = [];
        for (const [key, value] of Object.entries(params)) {
            if (key === 'ratio') {
                if (!ratios.includes(value)) throw new Error('支持的比例：' + ratios.join('、'));
                [controls.ratioW, controls.ratioH] = value.split(':').map(Number);
                labels.push('比例 ' + value);
            } else if (key === 'resolution' || key === 'res') {
                const max = current.engine !== 'cloud' ? 2 : (/^agnes-image-2\.[015](?:-|$)/i.test(String(current.model || '')) ? 4 : 2);
                if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(max >= 4 ? '分辨率支持 1K、2K、3K 或 4K' : '分辨率支持 1K 或 2K');
                controls.res = value; labels.push(value + 'K');
            } else if (key === 'batch_count') {
                if (!Number.isInteger(value) || value < 1 || value > (current.engine === 'cloud' ? 1 : 4)) {
                    throw new Error(current.engine === 'cloud' ? '当前 API 通道每次支持 1 张，请分次生成' : '每次支持生成 1–4 张');
                }
                controls.batchCount = value; labels.push(value + ' 张');
            } else if (key === 'seed') {
                if (current.engine !== 'local') continue;
                if (value !== 'random' && (!Number.isSafeInteger(value) || value < 0 || value > 999999999999999)) throw new Error('种子需为 0–999999999999999 的整数或 random');
                controls.seedMode = value === 'random' ? 'random' : 'fixed';
                if (value !== 'random') controls.fixedSeed = value;
                labels.push(value === 'random' ? '随机种子' : '种子 ' + value);
            } else if (key === 'negative_prompt') {
                if (current.engine !== 'local') throw new Error('当前 API 通道不支持负向提示词');
                if (typeof value !== 'string' || value.length > 4000) throw new Error('负向提示词需为不超过 4000 字的文本');
                negative = value; labels.push(value ? '已更新负向提示词' : '已清空负向提示词');
            } else if (['steps', 'cfg', 'denoise'].includes(key)) {
                if (current.engine !== 'local' || !(key in (current.allowedSampling || {}))) throw new Error('当前工作流不支持设置 ' + key);
                const [min, max] = key === 'steps' ? [1, 100] : key === 'cfg' ? [0, 30] : [0, 1];
                if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || key === 'steps' && !Number.isInteger(value)) throw new Error(key + ' 超出范围 ' + min + '–' + max);
                sampling[key] = value; labels.push(key + ' ' + value);
            } else throw new Error('暂不支持通过对话设置参数：' + key);
        }
        return { controls, sampling, negative, labels };
    }
    function applySampling(workflow, sampling) {
        const allowed = samplingFields(workflow);
        for (const key of Object.keys(sampling || {})) {
            if (!(key in allowed)) throw new Error('实际生成工作流不支持 ' + key + '，请调整参数后重试');
        }
        for (const node of Object.values(workflow || {})) {
            if (!/^(KSampler|KSamplerAdvanced|SamplerCustomAdvanced|BasicScheduler|CFGGuider)$/.test(node.class_type || '')) continue;
            for (const [key, value] of Object.entries(sampling || {})) {
                if (typeof node.inputs?.[key] === 'number') node.inputs[key] = value;
            }
        }
    }
    function guide(current) {
        const { controls, ...context } = current;
        const params = { ratio:controls.ratioW + ':' + controls.ratioH, resolution:controls.res, batch_count:controls.batchCount };
        if (current.engine === 'local') Object.assign(params, { seed:controls.seedMode === 'fixed' ? controls.fixedSeed : 'random', negative_prompt:current.negative, ...current.sampling });
        return '\n当前实际生图设置（用户未要求更改时必须保留）：' + JSON.stringify({ ...context, params }) +
            '\n你可以用自然语言理解用户的参数要求。需要生图时在最后输出 IMAGE {"prompt":"完整画面描述","params":{...}}；只修改设置、不要求生图时输出 PARAMS {"params":{...}}。不要代码块。params 只包含用户本轮明确要求修改的字段，普通聊天不要输出指令。' +
            '\n字段：ratio 为 ' + ratios.join('/') + '；resolution 为数字 1 或 2，Agnes 2.0 / 2.1 / 2.5 还可以是 3 或 4（长边约对应 K 数，不是精确宽高）；batch_count 本地1–4、API仅1；seed 仅本地，整数或"random"，API 不要输出 seed；negative_prompt 本地文本；steps/cfg/denoise 仅限 allowedSampling 中存在的字段，范围分别1–100整数、0–30、0–1。横图无明确比例时用16:9，竖图用9:16，方图用1:1。精确像素、切换模型、LoRA等未列出的设置暂不支持，说明限制并询问，不得声称已执行或擅自替换。参考图不改变参数规则。';
    }
    return { plan, guide, samplingFields, applySampling };
})();
