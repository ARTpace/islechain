/* MiniMax 节点的 RunningHub 云端工作流通道。
 *
 * 从 nodes/minimax/index.js 拆出。依赖 helpers.js（先加载），
 * 通过 window.MiniMaxRunningHub.run(...) 供 index.js 的 runMiniMaxNode 调用。
 */
(() => {
const { miniMaxAspectValue, miniMaxCompactJson, miniMaxDetailedError, miniMaxFullAspectLabel, miniMaxSelectedSegment } = window.MiniMaxHelpers;

function miniMaxApplyRunningHubParams(rhNode, fields, node, prompt){
    const seg = miniMaxSelectedSegment(node);
    const params = rhNode.rhParams || {};
    miniMaxSetRunningHubParam(params, fields, [/prompt|positive|text|caption|description|关键词|提示词|正向/], ['138::value'], prompt);
    miniMaxSetRunningHubParam(params, fields, [/duration|seconds|时长|秒/], ['132::value'], Math.max(1, Math.min(60, Number(seg?.duration || node.duration || 8) || 8)));
    miniMaxSetRunningHubParam(params, fields, [/aspect[_\s-]?ratio|\bratio\b|画面比例|比例/], ['115::aspect_ratio'], miniMaxAspectValue(seg?.aspectRatio || node.aspectRatio || '16:9'));
    miniMaxSetRunningHubParam(params, fields, [/megapixels?|百万像素/], ['115::megapixels'], Number(seg?.megapixels || node.megapixels || 0.4));
    rhNode.rhParams = params;
}

async function miniMaxBuildRunningHubNodeInfoList(rhNode, fields, media){
    const result = [];
    const indexes = rhFieldIndexes(fields);
    for(const field of fields){
        const kind = rhFieldKind(field);
        const role = rhFieldRole(field);
        const key = rhParamKey(field.nodeId, field.fieldName);
        if(['image','video','audio'].includes(kind)){
            const idx = indexes[key] || 0;
            const hasInput = Boolean(media[kind]?.[idx]?.url);
            if(!hasInput && field.required !== true) continue;
            if(!hasInput && field.required === true) throw new Error(`RunningHub 工作流缺少必选素材：${rhRequiredLabel(field)}`);
        }
        let value = '';
        const param = rhNode.rhParams?.[key];
        if(field.sourceFromUpstream === false && !['image','video','audio'].includes(kind) && !param) continue;
        if(['image','video','audio'].includes(kind)){
            const idx = indexes[key] || 0;
            value = media[kind]?.[idx]?.url || param?.value || rhDefaultValue(field);
            value = await rhUploadValueIfNeeded(value, rhNode);
        } else if(role === 'prompt') {
            value = param?.value ?? (media.prompt || rhDefaultValue(field));
        } else {
            value = param?.value ?? rhDefaultValue(field);
        }
        if(['number','slider'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
        result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
    }
    return result;
}

async function miniMaxBuildRunningHubWorkflowExtras(rhNode, fields, media, nodeInfoList){
    const config = await ensureRunningHubWorkflowConfigForNode(rhNode);
    if(!config || (config.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return {};
    const indexes = rhFieldIndexes(fields);
    const missingOptional = [];
    for(const field of fields){
        const kind = rhFieldKind(field);
        if(!['image','video','audio'].includes(kind)) continue;
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = indexes[key] || 0;
        const hasInput = Boolean(media[kind]?.[idx]?.url);
        if(field.required === true && !hasInput) throw new Error(`RunningHub 工作流缺少必选素材：${rhRequiredLabel(field)}`);
        if(field.required !== true && !hasInput) missingOptional.push(field);
    }
    if(!missingOptional.length) return {};
    missingOptional.forEach(field => {
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = nodeInfoList.findIndex(item => rhParamKey(item.nodeId, item.fieldName) === key);
        if(idx >= 0) nodeInfoList.splice(idx, 1);
    });
    const workflow = rhPruneWorkflowForMissingFields(config.workflowJson || {}, missingOptional);
    return workflow ? {workflow} : {};
}

function miniMaxRunningHubEntry(node=null){
    const workflows = runningHubEntries('workflow');
    const currentId = String(node?.minimaxRunningHubWorkflowId || '').trim();
    const titleKey = CANVAS_MINIMAX_RUNNINGHUB_WORKFLOW_TITLE.toLowerCase().replace(/\s+/g, '');
    return workflows.find(item => String(item.title || item.name || '').toLowerCase().replace(/\s+/g, '') === titleKey)
        || workflows.find(item => runningHubEntryId(item, 'workflow') === currentId)
        || workflows.find(item => runningHubEntryId(item, 'workflow') === CANVAS_MINIMAX_RUNNINGHUB_WORKFLOW_ID)
        || null;
}

function miniMaxRunningHubFieldMatches(field, patterns=[], fallbackKeys=[]){
    const key = rhParamKey(field?.nodeId, field?.fieldName);
    if((fallbackKeys || []).includes(key)) return true;
    const text = miniMaxRunningHubFieldText(field);
    return (patterns || []).some(pattern => pattern.test(text));
}

function miniMaxRunningHubFieldText(field){
    return [field?.nodeId, field?.fieldName, field?.label, field?.group, field?.title, field?.description, field?.source]
        .filter(v => v !== undefined && v !== null)
        .map(String)
        .join(' ')
        .toLowerCase();
}

function miniMaxRunningHubFullAspectField(field){
    return /widescreen|portrait|square|画面比例|比例/.test(miniMaxRunningHubFieldText(field) || '') && String(rhDefaultValue(field) || '').includes('(');
}

function miniMaxRunningHubPayloadError(stage, data, fallback, extra={}){
    const detailObj = data?.detail && typeof data.detail === 'object' ? data.detail : null;
    const rawDetail = detailObj?.message || data?.detail || data?.error || data?.message || data?.failReason || data?.msg || fallback || 'RunningHub 失败';
    const detail = typeof rawDetail === 'object' ? miniMaxCompactJson(rawDetail, 1200) : String(rawDetail || '');
    const raw = detailObj?.raw || data?.raw || data?.data?.raw || data;
    const code = detailObj?.code ?? data?.code ?? data?.data?.code ?? raw?.code ?? '';
    const taskId = detailObj?.taskId || detailObj?.task_id || data?.taskId || data?.task_id || data?.data?.taskId || extra.taskId || '';
    const parts = [`RunningHub ${stage}失败`, detail].filter(Boolean);
    if(taskId) parts.push(`taskId=${taskId}`);
    if(code !== '') parts.push(`code=${code}`);
    return miniMaxDetailedError(parts.join('：'), {stage, taskId, code, raw, ...(detailObj || {}), ...extra});
}

async function miniMaxRunningHubSettings(node){
    const entry = miniMaxRunningHubEntry(node);
    const workflowId = runningHubEntryId(entry, 'workflow');
    if(!entry || !workflowId) throw new Error(`请先在 API 设置中添加「${CANVAS_MINIMAX_RUNNINGHUB_WORKFLOW_TITLE}」`);
    node.minimaxRunningHubWorkflowId = workflowId;
    node.rhPayment = node.rhPayment || 'free';
    const cached = await ensureRunningHubWorkflow(workflowId).catch(() => null);
    const fields = rhUsableFields(
        Array.isArray(entry?.fields) && entry.fields.length ? entry.fields : (cached?.fields || [])
    );
    if(!fields.length) throw new Error(`请先在 API 设置中打开「${runningHubEntryLabel(entry, 'workflow')}」，拉取并保存工作流参数`);
    const rhNode = {
        type:'rh',
        rhMode:'workflow',
        rhConfigKey:runningHubEntryKey('workflow', workflowId),
        workflowId,
        rhPayment:node.rhPayment || 'free',
        rhParams:{},
        rhWorkflowInfo:{workflowId, nodeInfoList:fields},
        rhOptionalImageMode:entry.optionalImageMode || cached?.optionalImageMode || 'prune-workflow'
    };
    return {entry, workflowId, fields, rhNode};
}

function miniMaxRunningHubValue(field, desired){
    if(miniMaxRunningHubFullAspectField(field)) return miniMaxFullAspectLabel(desired);
    const value = String(desired ?? '');
    const options = rhExtractFieldOptions(field) || [];
    if(options.length){
        const normalized = value.replace(/\s+/g, '');
        return options.find(opt => String(opt).replace(/\s+/g, '') === normalized)
            || options.find(opt => String(opt).replace(/\s+/g, '').startsWith(normalized))
            || value;
    }
    return desired;
}

function miniMaxSetRunningHubParam(params, fields, patterns, fallbackKeys, desired){
    const field = (fields || []).find(item => miniMaxRunningHubFieldMatches(item, patterns, fallbackKeys));
    if(!field) return false;
    params[rhParamKey(field.nodeId, field.fieldName)] = {value:miniMaxRunningHubValue(field, desired)};
    return true;
}

async function runMiniMaxRunningHub(node, media, options={}){
    const {entry, workflowId, fields, rhNode} = await miniMaxRunningHubSettings(node);
    miniMaxApplyRunningHubParams(rhNode, fields, node, media.prompt);
    const nodeInfoList = await miniMaxBuildRunningHubNodeInfoList(rhNode, fields, media);
    const workflowExtras = await miniMaxBuildRunningHubWorkflowExtras(rhNode, fields, media, nodeInfoList);
    const body = {workflowId, nodeInfoList, useWallet:rhUseWallet(rhNode), ...workflowExtras};
    const cascadeTargetId = cascadeTargetIdFromOptions(options);
    const submit = await cascadeFetch('/api/runninghub/workflow-submit', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
    }, {cascadeTargetId}).then(async r => {
        const data = await r.clone().json().catch(async () => ({detail:await r.text().catch(() => '')}));
        if(!r.ok || data.success === false) throw miniMaxRunningHubPayloadError('提交', data, 'RunningHub 工作流提交失败', {
            endpoint:'/api/runninghub/workflow-submit',
            workflowId,
            nodeInfoList:nodeInfoList.slice(0, 40),
            hasWorkflow:Boolean(body.workflow)
        });
        return data.data || data;
    });
    const taskId = submit.taskId;
    if(!taskId) throw new Error(tr('canvas.rhNoTaskId'));
    for(let i = 0; i < 720; i++){
        if(cascadeTargetId) ensureCascadeActive(cascadeTargetId);
        await sleep(2500);
        const data = await cascadeFetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}&useWallet=${rhUseWallet(rhNode) ? '1' : '0'}`, {}, {cascadeTargetId}).then(async r => {
            const json = await r.clone().json().catch(async () => ({detail:await r.text().catch(() => '')}));
            if(!r.ok || json.success === false) throw miniMaxRunningHubPayloadError('查询', json, 'RunningHub 查询失败', {taskId, workflowId});
            return json.data || json;
        });
        if(data.status === 'SUCCESS'){
            const outputs = resultMediaUrls(data.image_items?.length ? data.image_items : (data.urls || []));
            if(!outputs.length) throw new Error(tr('canvas.rhOutputsEmpty'));
            return {outputs, request:{task_id:taskId, workflowId, workflowTitle:runningHubEntryLabel(entry, 'workflow'), backend:'runninghub', mode:'workflow', useWallet:rhUseWallet(rhNode)}};
        }
        if(data.status === 'FAILED') throw miniMaxRunningHubPayloadError('执行', data, data.failReason || 'RunningHub 执行失败', {taskId, workflowId});
    }
    throw new Error(tr('canvas.rhTimeout'));
}

window.MiniMaxRunningHub = { run: runMiniMaxRunningHub };
})();
