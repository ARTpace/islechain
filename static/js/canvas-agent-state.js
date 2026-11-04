/* ponytail: only chat text and preferences persist; executable proposals always expire on reload. */
(() => {
    'use strict';
    const prefix='art-canvas-agent-chat-v1:';
    const labels={applied:'已采用',proposed:'尚未采用',expired:'已失效',superseded:'已被后续对话替代',failed:'任务失败',interrupted:'已停止'};
    function history(messages) {
        return messages.filter(message=>['user','assistant'].includes(message.role) && (message.text || message.summary))
            .slice(-12).map(message=>({role:message.role,content:[message.text,(message.references || []).length?`用户引用节点：${message.references.map(item=>`${item.label} (${item.id})`).join('、')}`:'',message.summary?`画布编辑方案：${message.summary}；状态：${labels[message.status] || '尚未采用'}`:''].filter(Boolean).join('\n').slice(0,16000)}));
    }
    function save(id, session) {
        // Do not serialize MCP credentials, tool outputs, canvas snapshots, or pending edit payloads.
        const value={draft:String(session.draft || '').slice(0,16000),model:session.model || '',serverIds:(session.serverIds || []).slice(0,8),
            messages:session.messages.slice(-40).map(message=>({id:message.id,role:message.role,text:message.text || '',summary:message.summary || '',status:message.status,
                references:(message.references || []).slice(0,24).map(item=>({id:item.id,label:item.label})),
                trace:(message.trace || []).slice(-64).map(item=>({name:item.name,status:item.status}))}))};
        localStorage.setItem(prefix+id,JSON.stringify(value));
    }
    function load(id) {
        let value;
        try {value=JSON.parse(localStorage.getItem(prefix+id) || '{}');if(!value || typeof value!=='object')value={};} catch {value={};}
        const messages=(Array.isArray(value.messages)?value.messages:[]).filter(message=>message && typeof message.id==='string' && ['user','assistant'].includes(message.role)).slice(-40)
            .map(message=>({...message,text:String(message.text || '').slice(0,16000),summary:String(message.summary || '').slice(0,4000),
                trace:Array.isArray(message.trace)?message.trace.filter(item=>item && typeof item.name==='string').slice(-64):[],
                references:Array.isArray(message.references)?message.references.filter(item=>item && typeof item.id==='string' && typeof item.label==='string').slice(0,24):[],
                status:message.status==='working'?'interrupted':message.status==='proposed'?'expired':message.status}));
        return {messages,draft:typeof value.draft==='string'?value.draft.slice(0,16000):'',model:typeof value.model==='string'?value.model:'',
            serverIds:Array.isArray(value.serverIds)?value.serverIds.filter(item=>typeof item==='string').slice(0,8):[]};
    }
    window.CanvasAgentState={save,load,history};
})();
