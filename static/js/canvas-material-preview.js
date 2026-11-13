/* PBR 材质球预览：自动识别连入 3D 模型节点的 PBR 贴图，打成自包含 GLB 后交给 model-viewer 渲染。
   贴图来源有两种：PBR 材质节点的 result.maps（通道已知），以及普通图片节点按文件名识别通道。 */
(function(){
    'use strict';
    const CHANNELS = ['basecolor', 'normal', 'roughness', 'metallic', 'ao', 'height'];
    const LABELS = {basecolor:'颜色', normal:'法线', roughness:'粗糙度', metallic:'金属度', ao:'AO', height:'高度'};
    // 文件名识别：先匹配特征更强的通道，basecolor 放最后，避免 color 误吃别的词。
    const RULES = [
        ['height', /(height|displacement|disp|高度|置换)/i],
        ['normal', /(normal|nrm|法线)/i],
        ['roughness', /(rough|粗糙)/i],
        ['metallic', /(metal|金属)/i],
        ['ao', /(occlusion|(^|[^a-z])ao([^a-z]|$)|ambient|遮蔽)/i],
        ['basecolor', /(basecolor|base[_ -]?color|albedo|diffuse|color|colour|颜色|底色|漫反射)/i],
    ];
    const blocks = new Map();
    const builds = new Map();

    function channelFor(name){
        const text = String(name || '');
        for(const [channel, rule] of RULES) if(rule.test(text)) return channel;
        return null;
    }
    function inbound(node){
        if(typeof connections === 'undefined' || typeof nodes === 'undefined') return [];
        return connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean);
    }
    // imageRefsFromNode 在画布页是全局函数；这里同时兼容挂到 window 上的情况，便于单测。
    function refsOf(node){
        const fn = typeof imageRefsFromNode === 'function' ? imageRefsFromNode : window.imageRefsFromNode;
        return typeof fn === 'function' ? (fn(node) || []) : [];
    }
    // 读取连入的贴图，返回 {maps, from, geometry, repeat}；一个可用通道都没有时返回 null。
    // 「模型资产」和旧版「3D 模型」都能当材质预览的落点——资产节点自己就能显示材质球，
    // 不必为了看材质再多建一个节点。
    function sources(node){
        if(!node || !['model3d','gameModelAsset'].includes(node.type)) return null;
        const maps = {}, from = {};
        for(const source of inbound(node)){
            const result = source.type === 'materialPbr' ? source.materialJob?.result : null;
            if(result?.maps){
                for(const channel of CHANNELS){
                    if(result.maps[channel] && !maps[channel]){maps[channel] = result.maps[channel];from[channel] = source.name || 'PBR 材质';}
                }
                continue;
            }
            for(const ref of refsOf(source)){
                const channel = channelFor(ref.name || ref.url);
                if(channel && !maps[channel]){maps[channel] = ref.url;from[channel] = source.name || source.type;}
            }
        }
        if(!Object.keys(maps).length) return null;
        return {maps, from, geometry: node.ballGeometry || 'sphere', repeat: Math.min(4, Math.max(0.5, Math.round((Number(node.ballRepeat) || 1) * 10) / 10))};
    }
    const signature = data => [data.geometry, data.repeat, ...CHANNELS.map(c => data.maps[c] || '')].join('|');

    // 同一份贴图只打包一次；换通道或换几何体才重建。
    function ensure(node, data){
        const key = signature(data);
        const existing = builds.get(node.id);
        if(existing?.key === key) return existing.promise;
        if(existing?.url) URL.revokeObjectURL(existing.url);
        const promise = (async () => {
            if(!window.GameModelImport?.materialBall) throw new Error('模型导入模块未加载，无法生成材质球');
            const blob = await window.GameModelImport.materialBall(data.maps, {geometry: data.geometry, repeat: data.repeat});
            const url = URL.createObjectURL(blob);
            if(builds.get(node.id)?.promise === promise) builds.set(node.id, {key, url, promise});
            return url;
        })();
        builds.set(node.id, {key, url: '', promise});
        return promise;
    }
    function drop(nodeId){
        blocks.delete(nodeId);
        const build = builds.get(nodeId);
        if(build?.url) URL.revokeObjectURL(build.url);
        builds.delete(nodeId);
    }
    // 重绘时元素会短暂脱离文档，所以不能只看 isConnected；以节点是否还存在为准。
    function sweep(){
        const alive = new Set((typeof nodes !== 'undefined' ? nodes : []).map(n => n.id));
        for(const id of [...blocks.keys()]) if(!alive.has(id)) drop(id);
        if(blocks.size > 60){
            const oldest = [...blocks.keys()].filter(id => !blocks.get(id).el.isConnected)[0];
            if(oldest) drop(oldest);
        }
    }
    function button(label, title, active, onclick){
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = label;
        if(title) element.title = title;
        if(active) element.className = 'active';
        element.addEventListener('click', event => {event.stopPropagation();onclick();});
        return element;
    }
    function block(node, options){
        const data = sources(node);
        if(!data) return null;
        // compact：只要球本身，不要自带工具条——画布节点自己提供平铺/几何按键（模型资产节点走这条路）。
        const compact = Boolean(options?.compact);
        const key = signature(data) + (compact ? '|c' : '|f');
        const cached = blocks.get(node.id);
        if(cached?.key === key) return cached.el;
        sweep();

        const root = document.createElement('div');
        root.className = compact ? 'material-ball is-compact' : 'material-ball';
        // 节点 body 里的控件要自己挡住画布拖拽，model3d 分支在通用绑定之前就 return 了。
        for(const event of ['pointerdown', 'mousedown', 'dblclick', 'wheel']) root.addEventListener(event, event => event.stopPropagation());

        const stage = document.createElement('div');
        stage.className = 'material-ball-stage';
        const message = document.createElement('div');
        message.className = 'material-ball-msg';
        message.textContent = '正在生成材质球…';
        stage.append(message);

        if(compact){
            root.append(stage);
        }else{
            const bar = document.createElement('div');
            bar.className = 'material-ball-bar';
            const group = document.createElement('div');
            group.className = 'material-ball-seg';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', '预览几何体');
            for(const [value, label, title] of [['sphere', '球', '球体：看整体反射与法线'], ['cube', '方', '立方体：看相邻面是否连续'], ['plane', '平铺', '平板：检查贴图无缝平铺']]){
                group.append(button(label, title, data.geometry === value, () => {node.ballGeometry = value;scheduleSave();render();}));
            }
            const chips = document.createElement('span');
            chips.className = 'material-ball-channels';
            chips.textContent = CHANNELS.filter(c => data.maps[c]).map(c => LABELS[c]).join(' · ');
            chips.title = CHANNELS.filter(c => data.maps[c]).map(c => `${LABELS[c]}：${data.from[c] || ''}`).join('\n');
            bar.append(group);
            // 平板是专门用来检查无缝平铺的，给它一个平铺次数。
            if(data.geometry === 'plane'){
                const repeat = document.createElement('select');
                repeat.className = 'material-ball-repeat';
                repeat.title = '平铺次数';
                repeat.setAttribute('aria-label', '平铺次数');
                for(const count of [1, 2, 3, 4]) repeat.append(new Option(count + '×' + count, String(count)));
                repeat.value = String(data.repeat);
                repeat.addEventListener('pointerdown', event => event.stopPropagation());
                repeat.addEventListener('change', () => {node.ballRepeat = Number(repeat.value);scheduleSave();render();});
                bar.append(repeat);
            }
            bar.append(chips);
            root.append(stage, bar);
        }

        const entry = {key, el: root};
        blocks.set(node.id, entry);
        ensure(node, data).then(url => {
            if(!root.isConnected) return;
            message.remove();
            const viewer = document.createElement('model-viewer');
            viewer.setAttribute('src', url);
            viewer.setAttribute('alt', (node.name || 'PBR 材质球') + ' 预览');
            viewer.setAttribute('camera-controls', '');
            if(!node.spinPaused) viewer.setAttribute('auto-rotate', '');
            viewer.setAttribute('rotation-per-second', '22deg');
            viewer.setAttribute('shadow-intensity', '0.8');
            viewer.setAttribute('exposure', '1.1');
            viewer.setAttribute('interaction-prompt', 'none');
            viewer.setAttribute('style', 'width:100%;height:100%;--poster-color:transparent');
            stage.append(viewer);
        }).catch(error => {
            drop(node.id);
            message.textContent = error?.message || '材质球生成失败';
            message.classList.add('is-error');
        });
        return root;
    }
    function invalidate(nodeId){
        blocks.get(nodeId)?.el.remove();
        drop(nodeId);
    }
    // 给节点自己的按键用：识别到哪些通道、各来自哪个上游。
    function channels(node){
        const data = sources(node);
        if(!data) return [];
        return CHANNELS.filter(channel => data.maps[channel])
            .map(channel => ({channel, label: LABELS[channel], from: data.from[channel] || ''}));
    }
    window.CanvasMaterialPreview = {sources, channels, block, invalidate, channelFor};
})();
