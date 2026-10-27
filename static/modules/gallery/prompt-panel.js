/*!
 * PromptPanel — 通用「图片信息」悬浮查看组件（富信息版）
 * ----------------------------------------------------------------
 * 自包含：脚本加载时自动注入 CSS + 单例 DOM，无需任何调用方初始化。
 *
 * 布局（参考 ComfyUI / SD WebUI 信息面板）：
 *   ┌─ 提示 ─────────────────── [收起] ┐
 *   │  [标签:类型] [标签:模型]    [复制] │  ← 标签+复制按钮同一行
 *   │  正向提示词文本…                 │
 *   ├─ 负面提示 ─────────── [复制] ──┤  (仅当有负面提示词时显示)
 *   │  负面提示词文本…                │
 *   ├─ 其他元数据 ───────────────────┤
 *   │  [CFG: 7] [步骤: 30] …          │
 *   └────────────────────────────────┘
 *
 * 设计：
 *   - 默认 fixed 居中毛玻璃浮层；传入 anchor 时锚定到元素旁
 *   - 分区：提示(含标签) / 负面提示 / 元数据标签网格
 *   - 提示区复制按键仅复制正向提示词；负面提示区仅在存在时显示
 *   - 头部仅保留收起按键；点击空白/收起/ESC 关闭
 *
 * API：
 *   PromptPanel.open({ cn, en, raw, negative, meta, tags, translate, anchor })
 *   PromptPanel.close() / toggle(options) / isOpen()
 */
(function (global) {
    'use strict';

    const STYLE_ID = 'prompt-panel-css';
    const OVERLAY_ID = 'promptPanelOverlay';
    let openToken = 0;
    let keyBound = false;
    let currentAnchor = null;
    let reflowBound = false;

    /* ============================ 样式 ============================ */
    const CSS = `
/* === PromptPanel 图片信息悬浮面板 === */
#promptPanelOverlay {
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center; padding: 16px;
    background: rgba(0,0,0,0.001);
}
#promptPanelOverlay.pp-show { display: flex; }
#promptPanelOverlay.pp-anchored { padding: 0; }
#promptPanelOverlay.pp-anchored .pp-box { position: absolute; }
.pp-box {
    position: relative;
    width: min(92vw, 600px);
    max-height: 75vh;
    display: flex; flex-direction: column;
    background: rgba(23, 23, 22, 0.72);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: #f6f6f4;
    overflow: hidden;
    animation: pp-pop 0.16s ease-out;
}
@keyframes pp-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: none; }
}

/* ---- 头部 ---- */
.pp-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
.pp-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; opacity: 0.9; }
.pp-tools { display: flex; align-items: center; gap: 6px; }
.pp-btn {
    width: 30px; height: 30px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 9px;
    background: rgba(255,255,255,0.1);
    color: #eceae5; border: none;
    transition: background .15s ease, color .15s ease, transform .15s ease;
    cursor: pointer; padding: 0;
}
.pp-btn:hover { background: rgba(6, 182, 212, 0.45); color: #fcfcfb; }
.pp-btn:active { transform: scale(0.92); }
.pp-btn.copied { background: rgba(34,197,94,0.5); color: #fcfcfb; }

/* ---- 分区通用 ---- */
.pp-section { border-bottom: 1px solid rgba(255,255,255,0.06); }
.pp-section:last-child { border-bottom: none; }
.pp-sec-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px 6px; cursor: default;
}
.pp-sec-title {
    font-size: 12px; font-weight: 700; opacity: 0.75;
    letter-spacing: 0.03em; user-select: none;
}
.pp-sec-copy {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 6px; background: transparent;
    color: rgba(255,255,255,0.4); border: none;
    cursor: pointer; padding: 0; transition: all .15s ease;
}
.pp-sec-copy:hover { background: rgba(255,255,255,0.1); color: #fcfcfb; }

/* ---- 标签行（含复制按钮） ---- */
.pp-tags-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px 6px;
}
.pp-tags-row .pp-tags { padding: 0; flex: 0 1 auto; min-width: 0; }
.pp-tags-row .pp-sec-copy { flex-shrink: 0; margin-left: 8px; }

/* ---- 标签 ---- */
.pp-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
.pp-tag {
    font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px;
    background: rgba(6, 182, 212, 0.2); color: #00f0ff;
    border: 1px solid rgba(6, 182, 212, 0.3);
    user-select: none; white-space: nowrap; line-height: 1.4;
}
.pp-tag.pp-tag-warm { background: rgba(251,146,60,0.18); color: #fdba74; border-color: rgba(251,146,60,0.3); }
.pp-tag.pp-tag-green { background: rgba(34,197,94,0.18); color: #86efac; border-color: rgba(34,197,94,0.3); }

/* ---- 内容区（整体滚动容器） ---- */
.pp-content {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
}
/* ---- 正文区 ---- */
.pp-body {
    padding: 6px 14px 12px; overflow-y: auto;
    font-size: 13px; line-height: 1.75; word-break: break-word;
    max-height: 42vh;
}
.pp-text { white-space: pre-wrap; opacity: 0.92; }
.pp-text-dim { opacity: 0.55; font-size: 12px; margin-top: 6px; white-space: pre-wrap; }
.pp-empty { opacity: 0.45; font-size: 12px; font-style: italic; }

/* ---- 元数据网格 ---- */
.pp-meta-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px 16px; padding: 4px 14px 14px;
}
.pp-meta-item {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0;
    font-size: 11.5px; font-weight: 600;
    padding: 9px 0; color: inherit;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    user-select: all;
}
.pp-meta-key { opacity: 0.65; font-weight: 500; }
.pp-meta-val { text-align: right; overflow-wrap: anywhere; min-width: 0; font-weight: 500; font-variant-numeric: tabular-nums; }
.pp-meta-key { flex-shrink: 0; }
@media (max-width: 420px) { .pp-meta-grid { grid-template-columns: minmax(0, 1fr); } }

/* ---- 滚动条（深色主题） ---- */
.pp-content,
.pp-body { scrollbar-width: thin; scrollbar-color: rgba(89, 88, 81, 0.6) transparent; }
.pp-content::-webkit-scrollbar,
.pp-body::-webkit-scrollbar { width: 6px; }
.pp-content::-webkit-scrollbar-track,
.pp-body::-webkit-scrollbar-track { background: transparent; }
.pp-content::-webkit-scrollbar-thumb,
.pp-body::-webkit-scrollbar-thumb { background: rgba(89, 88, 81, 0.6); border-radius: 6px; }
.pp-content::-webkit-scrollbar-thumb:hover,
.pp-body::-webkit-scrollbar-thumb:hover { background: rgba(125, 124, 116, 0.85); border-radius: 6px; }
`;

    /* ============================ 图标 ============================ */
    const COPY_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHECK_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const CLOSE_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    /* ============================ 注入 ============================ */
    function inject() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (document.head || document.documentElement).appendChild(style);
        }
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'pp-overlay';
        overlay.innerHTML =
            '<div class="pp-box" role="dialog" aria-modal="true" aria-label="图片信息">' +
                '<div class="pp-head">' +
                    '<span class="pp-title">提示</span>' +
                    '<div class="pp-tools">' +
                        '<button type="button" class="pp-btn pp-close" title="收起" aria-label="收起">' + CLOSE_SVG + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="pp-content"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        // 事件委托
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { close(); return; }
            // 分区复制（提示词 / 负面提示）
            const secCopy = e.target.closest('.pp-sec-copy');
            if (secCopy) { e.stopPropagation(); doCopySec(secCopy); return; }
            // 收起
            if (e.target.closest('.pp-close')) { e.stopPropagation(); close(); return; }
        });
    }

    /* ============================ 构建内容 HTML ============================ */

    /** 统一入口：新增模型/API 复用字段别名；不把页面类型当成真实模型。 */
    function buildMetaDict(recordMeta, genParams, extra) {
        var data = Object.assign({}, recordMeta || {}, genParams || {}, extra || {});
        var used = new Set();
        function pick(names) {
            names.forEach(function(k) { used.add(k); });
            for (var k of names) {
                if (data[k] != null && data[k] !== '') return data[k];
            }
            return null;
        }
        var workflow = pick(['workflow', '工作流']);
        var model = pick(['model_name', 'modelName', 'model', '模型']);
        var type = pick(['mode', 'generation_mode', 'type', '类型']);
        var engine = pick(['engine', 'source', '来源']);
        var provider = pick(['provider_name', 'provider', 'api_provider', '服务商']);
        var width = pick(['width', '宽度']), height = pick(['height', '高度', '身高']);
        var size = pick(['size', '尺寸']);
        var rw = pick(['ratioW']), rh = pick(['ratioH']);
        var ratio = pick(['aspect_ratio', 'aspectRatio', 'ratio', '比例']);
        var generic = /^(zimage|klein|image|text2image|image-edit)$/i;
        if ((!model || generic.test(model)) && workflow) model = String(workflow).split(/[\\/]/).pop().replace(/\.json$/i, '');
        if (model && generic.test(model)) model = null;
        var modes = {text2image:'文生图', txt2img:'文生图', t2i:'文生图', 'image-edit':'图生图', img2img:'图生图', i2i:'图生图', edit:'图生图', zimage:'文生图', klein:'图生图'};
        if (!type && workflow) type = String(workflow).split(/[\\/]/)[0];
        var d = {
            '模型': model || '未记录',
            '来源': engine === 'local' ? '本地 ComfyUI' : engine === 'cloud' || engine === 'api' ? '在线 API' : engine || '未记录',
            '生成模式': modes[type] || type || '未记录',
            '尺寸': width && height ? width + ' × ' + height : size || '未记录'
        };
        if (provider) d['服务商'] = typeof provider === 'object' ? provider.name || provider.id || '未记录' : provider;
        if (ratio || (rw && rh)) d['比例'] = ratio || rw + ':' + rh;
        var fields = [
            ['种子',['seed','种子']], ['步数',['steps','num_inference_steps','步骤','步数']],
            ['引导系数',['cfg','cfg_scale','guidance','guidance_scale','CFG','CFGSCALE']],
            ['采样器',['sampler','sampler_name','采样器','采样曲']], ['调度器',['scheduler','调度器']],
            ['重绘强度',['denoise','strength','重绘强度']], ['批次数',['batchCount','batch_size','batch_count','批次数']],
            ['分辨率档',['resolution','分辨率档']]
        ];
        fields.forEach(function(field) { var value = pick(field[1]); if (value != null) d[field[0]] = value; });
        var durationMs = pick(['generation_time_ms']);
        var duration = pick(['duration','elapsed','生成时长','耗时','本批耗时']);
        d['生成时长'] = durationMs != null ? (Number(durationMs) / 1000).toFixed(1) + ' 秒（含排队）' : duration != null ? (typeof duration === 'number' ? duration + ' 秒' : duration) : '未记录';
        if (workflow) d['工作流'] = String(workflow).split(/[\\/]/).pop().replace(/\.json$/i, '');
        var loras = pick(['loras','LoRA']);
        if (Array.isArray(loras) && loras.length) d['LoRA'] = loras.map(function(l) { return (l.name || '').split(/[\\/]/).pop() + (l.strength != null ? ' (' + l.strength + ')' : ''); }).join(', ');
        else if (typeof loras === 'string' && loras) d['LoRA'] = loras;
        // ponytail: 未知标量保留在折叠区，无需为每种 API 增加渲染分支。
        var additional = {};
        Object.keys(data).sort().forEach(function(k) {
            if (!used.has(k) && data[k] != null && typeof data[k] !== 'object' && data[k] !== '') additional[k] = data[k];
        });
        return {fields: d, additional: additional};
    }

    /** 构建 tags 数组（用于顶部标签行） */
    function buildTagsArray(tags, type, model, workflow) {
        var arr = [];
        if (tags && Array.isArray(tags)) { arr = arr.concat(tags); }
        else if (typeof tags === 'string') { arr.push(tags); }
        // 自动从 record 推导标签
        if (type) arr.push({ text: type, kind: 'warm' });
        if (model) arr.push({ text: String(model), kind: 'green' });
        if (workflow) arr.push({ text: workflow.split('/').pop().replace('.json',''), kind: '' });
        // 去重
        var seen = {};
        return arr.filter(function(t) {
            var key = typeof t === 'string' ? t : (t.text || '');
            if (!key || seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    /** 渲染完整面板 HTML */
    function renderContent(opts) {
        var _rawCn = opts.cn || opts.prompt || opts.text || '';
        var cn = (typeof _rawCn === 'string') ? _rawCn.trim() : '';
        var _rawNeg = opts.negative || '';
        var neg = (typeof _rawNeg === 'string') ? _rawNeg.trim() : '';
        var normalized = buildMetaDict(Object.assign({}, opts.recordMeta, {model: opts.recordModel || (opts.recordMeta || {}).model, type: opts.recordType || (opts.recordMeta || {}).type}), opts.genParams, opts.meta);
        var metaDict = normalized.fields;
        var tagItems = buildTagsArray([], null, metaDict['模型'] === '未记录' ? null : metaDict['模型'], null);
        var hasMeta = Object.keys(metaDict).length > 0;

        var html = '';

        // ====== 提示区 ======
        html += '<div class="pp-section">';
        // 标签行（右侧带复制按钮，仅当有提示词时）
        if (tagItems.length > 0 || cn) {
            html += '<div class="pp-tags-row">';
            html += '<div class="pp-tags">';
            for (var ti = 0; ti < tagItems.length; ti++) {
                var tg = tagItems[ti];
                var tText = (typeof tg === 'string') ? tg : (tg.text || '');
                var tKind = (typeof tg === 'string') ? '' : (tg.kind || '');
                var cls = 'pp-tag' + (tKind === 'warm' ? ' pp-tag-warm' : '') + (tKind === 'green' ? ' pp-tag-green' : '');
                html += '<span class="' + cls + '">' + escHtml(tText) + '</span>';
            }
            html += '</div>';
            if (cn) {
                html += '<button type="button" class="pp-sec-copy" data-sec="positive" title="复制提示词" aria-label="复制提示词">' + COPY_SVG + '</button>';
            }
            html += '</div>';
        }
        // 正文
        html += '<div class="pp-body">';
        if (cn) {
            html += '<div class="pp-text pp-prompt-text"></div>';
            if (opts.raw || opts.en) {
                html += '<div class="pp-text-dim pp-prompt-raw"></div>';
            }
        } else {
            html += '<div class="pp-empty">（该图片没有记录提示词）</div>';
        }
        html += '</div></div>';

        // ====== 负面提示区（仅当有负面提示词时显示） ======
        if (neg) {
            html += '<div class="pp-section">';
            html += '<div class="pp-sec-head">';
            html += '<span class="pp-sec-title">负面提示</span>';
            html += '<button type="button" class="pp-sec-copy" data-sec="negative" title="复制负面提示词" aria-label="复制负面提示词">' + COPY_SVG + '</button>';
            html += '</div>';
            html += '<div class="pp-body">';
            html += '<div class="pp-text pp-neg-text">' + escHtml(neg) + '</div>';
            html += '</div></div>';
        }

        // ====== 元数据区 ======
        if (hasMeta) {
            html += '<div class="pp-section">';
            html += '<div class="pp-sec-head"><span class="pp-sec-title">生成信息</span></div>';
            html += '<div class="pp-meta-grid">';
            var keys = Object.keys(metaDict);
            for (var mi = 0; mi < keys.length; mi++) {
                html += '<span class="pp-meta-item"><span class="pp-meta-key">' + escHtml(keys[mi]) + '：</span><span class="pp-meta-val">' + escHtml(String(metaDict[keys[mi]])) + '</span></span>';
            }
            html += '</div></div>';
        }

        var extraKeys = Object.keys(normalized.additional);
        if (extraKeys.length) {
            html += '<details class="pp-section"><summary class="pp-sec-head">其他参数</summary><div class="pp-meta-grid">';
            extraKeys.forEach(function(k) { html += '<span class="pp-meta-item"><span class="pp-meta-key">' + escHtml(k) + '</span><span class="pp-meta-val">' + escHtml(String(normalized.additional[k])) + '</span></span>'; });
            html += '</div></details>';
        }
        return html;
    }

    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    /* ============================ 复制 ============================ */
    var currentData = { cn:'', negative:'', raw:'' };

    function doCopySec(btn) {
        var sec = btn.getAttribute('data-sec');
        var text = sec === 'negative' ? currentData.negative : currentData.cn;
        doCopyText(btn, text || '');
    }

    function doCopyText(btn, text) {
        if (!text.trim()) { flashCopied(btn, false); return; }
        var done = function () { flashCopied(btn, true); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, cb) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (cb) cb();
        } catch (_) { if (cb) cb(); }
    }

    function flashCopied(btn, ok) {
        if (!btn) return;
        var svg = btn.querySelector('svg');
        if (!svg) return;
        var orig = svg.outerHTML;
        if (ok) { svg.outerHTML = CHECK_SVG; btn.classList.add('copied'); }
        setTimeout(function () {
            var cur = btn.querySelector('svg');
            if (cur) cur.outerHTML = orig;
            btn.classList.remove('copied');
        }, 1400);
    }

    /* ============================ 键盘 ============================ */
    function onKey(e) { if (e.key === 'Escape') close(); }

    /* ====================== 锚定定位 ====================== */
    function positionBox(anchor) {
        var overlay = document.getElementById(OVERLAY_ID);
        var box = overlay && overlay.querySelector('.pp-box');
        if (!overlay || !box || !anchor) return;
        var prevVis = box.style.visibility;
        box.style.visibility = 'hidden';
        var r = anchor.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var gap = 12;
        var limitTop = 8;
        var limitBottom = vh - 8;
        var thread = document.getElementById('chatThread');
        if (thread && thread.contains(anchor)) {
            var tr = thread.getBoundingClientRect();
            limitTop = Math.max(8, tr.top + 8);
            limitBottom = Math.min(vh - 8, tr.bottom - 8);
        }
        var avail = Math.max(160, limitBottom - limitTop);
        box.style.maxHeight = avail + 'px';
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var left = r.right + gap;
        if (left + bw > vw - 8) left = r.left - bw - gap;
        if (left < 8) left = Math.max(8, Math.min((vw - bw) / 2, vw - bw - 8));
        var spaceBelow = limitBottom - (r.bottom + gap);
        var spaceAbove = (r.top - gap) - limitTop;
        var top;
        if (bh <= spaceBelow) top = r.bottom + gap;
        else if (bh <= spaceAbove) top = r.top - gap - bh;
        else if (spaceAbove >= spaceBelow) {
            box.style.maxHeight = Math.max(160, spaceAbove) + 'px';
            bh = box.offsetHeight;
            top = Math.max(limitTop, r.top - gap - bh);
        } else {
            box.style.maxHeight = Math.max(160, spaceBelow) + 'px';
            top = r.bottom + gap;
        }
        if (top < limitTop) top = limitTop;
        if (top + box.offsetHeight > limitBottom) top = Math.max(limitTop, limitBottom - box.offsetHeight);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.visibility = prevVis;
    }

    function onReflow() { if (currentAnchor) positionBox(currentAnchor); }

    function bindReflow() {
        if (reflowBound) return;
        window.addEventListener('scroll', onReflow, true);
        window.addEventListener('resize', onReflow);
        reflowBound = true;
    }

    function unbindReflow() {
        if (!reflowBound) return;
        window.removeEventListener('scroll', onReflow, true);
        window.removeEventListener('resize', onReflow);
        reflowBound = false;
    }

    /* ============================ 公开 API ============================ */
    /**
     * 打开/刷新面板
     * @param {Object} options
     * @param {string}  [options.cn]           正向提示词（中文/原文）
     * @param {string}  [options.en]           英文翻译
     * @param {string}  [options.raw]          原始完整文本（复制用）
     * @param {string}  [options.negative]     负面提示词
     * @param {Object}  [options.meta]         额外元数据 { key: val }
     * @param {Object}  [options.genParams]    后端传来的生成参数对象
     * @param {Object}  [options.recordMeta]   record 级别字段 { type, model, seed }
     * @param {string}  [options.recordType]   record.type（自动转标签）
     * @param {string}  [options.recordModel]  record.model（自动转标签）
     * @param {Array}   [options.tags]         额外标签 [{text,kind}] | string[]
     * @param {Function}[options.translate]    翻译回调 translate(cn) => {en}|string|Promise
     * @param {Element} [options.anchor]       锚定元素
     */
    function open(options) {
        options = options || {};
        inject();
        var overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;

        var token = ++openToken;
        // 防 Promise 渗入：提取 prompt 字符串时强制检查类型
        var _rawCn = options.cn || options.prompt || options.text || '';
        var cn = (typeof _rawCn === 'string') ? _rawCn : '';
        currentData.cn = cn;
        var _rawNeg = options.negative || '';
        currentData.negative = (typeof _rawNeg === 'string') ? _rawNeg : '';
        var _rawRaw = (options.raw != null) ? options.raw : cn;
        currentData.raw = (typeof _rawRaw === 'string') ? _rawRaw : '';

        // 渲染完整内容 HTML
        var contentEl = overlay.querySelector('.pp-content');
        if (contentEl) contentEl.innerHTML = renderContent(options);

        // 填充动态内容（翻译回调）
        var promptTextEl = overlay.querySelector('.pp-prompt-text');
        var promptRawEl = overlay.querySelector('.pp-prompt-raw');

        if (cn && promptTextEl) {
            promptTextEl.textContent = cn;
        }

        // 翻译回填（支持 res.en 是 Promise 的情况）
        if (typeof options.translate === 'function' && cn) {
            var applyTranslation = function (rawTranslated) {
                if (token !== openToken) return;
                if (!overlay.classList.contains('pp-show')) return;
                // 类型守卫：只接受字符串，非字符串兜底为空
                var translated = (typeof rawTranslated === 'string') ? rawTranslated : '';
                if (translated && promptRawEl) promptRawEl.textContent = translated;
                else if (translated && promptTextEl) promptTextEl.textContent = translated;
            };
            Promise.resolve(options.translate(cn)).then(function (res) {
                if (!res) { applyTranslation(''); return; }
                // 优先取 res.en 字段（可能是 Promise）
                var en = res.en;
                if (en && typeof en.then === 'function') {
                    // en 是 Promise，再 await
                    Promise.resolve(en).then(applyTranslation).catch(function () { applyTranslation(''); });
                } else {
                    applyTranslation(en);
                }
            }).catch(function () { applyTranslation(''); });
        } else if (options.en && promptRawEl) {
            promptRawEl.textContent = options.en;
        }

        // 锚定定位
        currentAnchor = options.anchor || null;
        if (currentAnchor) {
            overlay.classList.add('pp-anchored');
            overlay.classList.add('pp-show');
            requestAnimationFrame(function () { positionBox(currentAnchor); });
            bindReflow();
        } else {
            overlay.classList.remove('pp-anchored');
            overlay.classList.add('pp-show');
            unbindReflow();
        }

        if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
    }

    function close() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.classList.remove('pp-show');
        unbindReflow();
        currentAnchor = null;
    }

    function toggle(options) {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay.classList.contains('pp-show')) close();
        else open(options || {});
    }

    function isOpen() {
        var overlay = document.getElementById(OVERLAY_ID);
        return !!(overlay && overlay.classList.contains('pp-show'));
    }

    global.PromptPanel = { open: open, close: close, toggle: toggle, isOpen: isOpen };

    // DOM 就绪时注入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject, { once: true });
    } else {
        inject();
    }
})(window);
