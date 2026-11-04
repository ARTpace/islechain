/* Isolated declarative plugin forms. Plugin HTML never enters the canvas DOM. */
(() => {
    'use strict';
    const sessions=new Map();
    const tags=new Set(['DIV','SPAN','P','LABEL','INPUT','SELECT','OPTION','TEXTAREA','BUTTON','FIELDSET','LEGEND','H2','H3','H4','BR','HR','OUTPUT','SECTION','STRONG','SMALL']);
    const attributes=new Set(['class','title','type','min','max','step','placeholder','rows','cols','value','disabled','data-field','data-action','aria-label']);
    function sanitize(html,fields){
        const template=document.createElement('template'),out=document.createElement('div');
        template.innerHTML=html;let count=0;
        function copy(source,target,depth){
            if(depth>20)return;
            for(const child of source.childNodes){
                if(++count>300)throw new Error('自定义界面元素过多');
                if(child.nodeType===3){target.append(document.createTextNode(child.textContent));continue;}
                if(child.nodeType!==1||!tags.has(child.tagName))continue;
                const element=document.createElement(child.tagName.toLowerCase());
                for(const attr of child.attributes){
                    if(!attributes.has(attr.name)||attr.value.length>500)continue;
                    if(attr.name==='data-field'&&!fields.some(field=>field.id===attr.value))continue;
                    if(attr.name==='type'&&!['text','number','range','color','checkbox','button'].includes(attr.value))continue;
                    element.setAttribute(attr.name,attr.value);
                }
                if(child.tagName==='BUTTON')element.type='button';
                copy(child,element,depth+1);target.append(element);
            }
        }
        copy(template.content,out,0);return out.innerHTML;
    }
    const bridge=`(() => {
        const tags=new Set(${JSON.stringify([...tags])}),attributes=new Set(${JSON.stringify([...attributes])});
        const sanitize=${sanitize.toString()};
        let session='', fields=[],params={},worker=null,timer=0,messageCount=0,windowStart=0;
        const controls=()=>[...document.querySelectorAll('[data-field]')];
        const stop=message=>{worker?.terminate();worker=null;clearTimeout(timer);document.getElementById('plugin-status').textContent=message;};
        const sendWorker=message=>{if(!worker)return;clearTimeout(timer);timer=setTimeout(()=>stop('组件响应超时，已停止 UI worker；节点数据已保留'),2000);worker.postMessage(message);};
        const publish=(field,value)=>parent.postMessage({channel:'art-node-form-change',session,field,value},'*');
        function sync(){for(const control of controls()){
            const field=fields.find(item=>item.id===control.dataset.field);if(!field)continue;
            const value=params[field.id]??field.default;
            if(field.component==='boolean'){control.type='checkbox';control.checked=value;}else control.value=value;
        }}
        addEventListener('message',event=>{
            if(event.source!==parent||event.data?.channel!=='art-node-form-init')return;
            session=event.data.session;fields=event.data.fields;params={...event.data.params};sync();
            document.documentElement.style.colorScheme=event.data.dark?'dark':'light';
            if(event.data.script&&!worker){
                const url=URL.createObjectURL(new Blob([event.data.script],{type:'text/javascript'}));
                worker=new Worker(url);URL.revokeObjectURL(url);
                worker.onerror=()=>stop('自定义 UI worker 出错，标准参数和节点数据仍然保留');
                worker.onmessage=({data})=>{
                    if(Date.now()-windowStart>1000){windowStart=Date.now();messageCount=0;}
                    if(++messageCount>60){stop('自定义 UI 消息过于频繁，已停止组件');return;}
                    if(!data||typeof data!=='object')return;
                    clearTimeout(timer);
                    if(data.type==='render'&&typeof data.html==='string'&&data.html.length<=8000){
                        try{document.getElementById('plugin-root').innerHTML=sanitize(data.html,fields);
                            if(typeof data.css==='string'&&data.css.length<=4000)document.getElementById('plugin-style').textContent=data.css;
                            sync();
                        }catch{stop('自定义 UI 返回了不支持的界面');}
                    }else if(data.type==='change'&&fields.some(field=>field.id===data.field)){
                        params[data.field]=data.value;publish(data.field,data.value);sync();
                    }
                };
                sendWorker({type:'init',fields,params,dark:event.data.dark});
            }
        });
        addEventListener('change',event=>{
            const control=event.target,field=fields.find(item=>item.id===control.dataset.field);if(!field)return;
            const value=field.component==='boolean'?control.checked:['number','slider'].includes(field.component)?Number(control.value):control.value;
            params[field.id]=value;publish(field.id,value);sendWorker({type:'change',field:field.id,value,params});
        });
        addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action)sendWorker({type:'action',action,params});});
        addEventListener('pagehide',()=>worker?.terminate());
    })();`;
    function mount(definition,params,onChange){
        const frame=document.createElement('iframe'),session=crypto.randomUUID();
        const html=sanitize(definition.ui.html,definition.fields);
        frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
        frame.title=definition.title+' 参数';frame.style.cssText=`width:100%;height:${definition.ui.height}px;border:0;`;
        const css=definition.ui.css.replaceAll('<','\\3c ');
        frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'"><style>body{font:13px system-ui;margin:8px;color:CanvasText;background:Canvas}input,select,textarea{box-sizing:border-box;max-width:100%}${css}</style><style id="plugin-style"></style></head><body><main id="plugin-root">${html}</main><p id="plugin-status" role="status"></p><script>${bridge}<\/script></body></html>`;
        sessions.set(session,{frame,definition,onChange});
        frame.onload=()=>{
            if(!frame.isConnected)return;
            frame.contentWindow.postMessage({channel:'art-node-form-init',session,fields:definition.fields,params,
                script:definition.ui.kind==='isolated.worker'?definition.ui.script:'',dark:document.documentElement.dataset.theme==='dark'},'*');
        };
        return frame;
    }
    function changed(event){
        const data=event.data;if(!data||data.channel!=='art-node-form-change')return;
        const entry=sessions.get(data.session);
        if(!entry||event.origin!=='null'||event.source!==entry.frame.contentWindow||!entry.frame.isConnected)return;
        const field=entry.definition.fields.find(item=>item.id===data.field);if(!field)return;
        const value=data.value;
        if(field.component==='boolean'){if(typeof value!=='boolean')return;}
        else if(['number','slider'].includes(field.component)){
            if(typeof value!=='number'||!Number.isFinite(value)||(field.minimum!=null&&value<field.minimum)||(field.maximum!=null&&value>field.maximum))return;
        }else if(typeof value!=='string'||value.length>16000||(field.component==='dropdown'&&!field.options.includes(value)))return;
        entry.onChange(field.id,value);
    }
    addEventListener('message',changed);
    // Release listeners' references when canvas render replaces the old views.
    new MutationObserver(()=>{for(const [id,entry] of sessions)if(!entry.frame.isConnected)sessions.delete(id);}).observe(document.documentElement,{childList:true,subtree:true});
    window.CanvasPluginUI={mount};
})();
