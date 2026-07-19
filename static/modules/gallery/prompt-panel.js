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
    background: rgba(15,23,42,0.72);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: #f1f5f9;
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
    color: #e2e8f0; border: none;
    transition: background .15s ease, color .15s ease, transform .15s ease;
    cursor: pointer; padding: 0;
}
.pp-btn:hover { background: rgba(0,180,216,0.45); color: #fff; }
.pp-btn:active { transform: scale(0.92); }
.pp-btn.copied { background: rgba(34,197,94,0.5); color: #fff; }

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
.pp-sec-copy:hover { background: rgba(255,255,255,0.1); color: #fff; }

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
    background: rgba(0,180,216,0.2); color: #7dd3fc;
    border: 1px solid rgba(0,180,216,0.3);
    user-select: none; white-space: nowrap; line-height: 1.4;
}
.pp-tag.pp-tag-warm { background: rgba(251,146,60,0.18); color: #fdba74; border-color: rgba(251,146,60,0.3); }
.pp-tag.pp-tag-green { background: rgba(34,197,94,0.18); color: #86efac; border-color: rgba(34,197,94,0.3); }

/* ---- 正文区 ---- */
.pp-body {
    padding: 6px 14px 12px; overflow-y: auto;
    font-size: 13px; line-height: 1.75; word-break: break-word;
}
.pp-text { white-space: pre-wrap; opacity: 0.92; }
.pp-text-dim { opacity: 0.55; font-size: 12px; margin-top: 6px; white-space: pre-wrap; }
.pp-empty { opacity: 0.45; font-size: 12px; font-style: italic; }

/* ---- 元数据网格 ---- */
.pp-meta-grid {
    display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 14px 12px;
}
.pp-meta-item {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11.5px; font-weight: 600;
    padding: 5px 10px; border-radius: 8px;
    background: rgba(59,130,246,0.15); color: #93c5fd;
    border: 1px solid rgba(59,130,246,0.22);
    user-select: all; white-space: nowrap;
}
.pp-meta-key { opacity: 0.65; font-weight: 500; }
.pp-meta-val { opacity: 1; font-weight: 700; font-variant-numeric: tabular-nums; }

/* ---- 滚动条 ---- */
.pp-body::-webkit-scrollbar,
.pp-box > div:last-child::-webkit-scrollbar { width: 5px; }
.pp-body::-webkit-scrollbar-thumb,
.pp-box > div:last-child::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 6px; }
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

    /** 将 genParams / meta 对象 + record 字段展平为统一元数据键值对 */
    function buildMetaDict(recordMeta, genParams, extra) {
        var d = {};
        // genParams 展平
        if (genParams && typeof genParams === 'object') {
            var gp = genParams;
            if (gp.cfg != null) d['CFG'] = gp.cfg;
            if (gp.cfg_scale != null) d['CFGSCALE'] = gp.cfg_scale;
            if (gp.steps != null) d['步骤'] = gp.steps;
            if (gp.sampler != null || gp.sampler_name != null) d['采样曲'] = gp.sampler || gp.sampler_name;
            if (gp.scheduler) d['调度器'] = gp.scheduler;
            if (gp.seed != null) d['种子'] = gp.seed;
            if (gp.width != null) d['宽度'] = gp.width;
            if (gp.height != null) d['身高'] = gp.height;
            if (gp.batchCount != null) d['批次数'] = gp.batchCount;
            if (gp.resolution != null) d['分辨率档'] = ['标清','高清'][gp.resolution] || gp.resolution;
            if (gp.ratioW && gp.ratioH) d['比例'] = gp.ratioW + ':' + gp.ratioH;
            if (gp.workflow) d['工作流'] = gp.workflow.split('/').pop().replace('.json','');
            if (gp.loras && gp.loras.length) {
                d['LoRA'] = gp.loras.map(function(l){ return (l.name||'').split('/')[0] + (l.strength!=null? '('+l.strength+')':''); }).join(', ');
            }
            // 兜底：把未知字段也展进去（排除已处理的和复杂对象）
            var _skip = {cfg:1,cfg_scale:1,steps:1,sampler:1,sampler_name:1,scheduler:1,seed:1,width:1,height:1,batchCount:1,resolution:1,ratioW:1,ratioH:1,workflow:1,loras:1};
            for (var k in gp) {
                if (_skip[k] || typeof gp[k] === 'object' || Array.isArray(gp[k])) continue;
                if (!(k in d)) d[k] = gp[k];
            }
        }
        // record 级别的字段
        if (recordMeta && typeof recordMeta === 'object') {
            if (recordMeta.model && !d['模型']) d['模型'] = recordMeta.model;
            if (recordMeta.type && !d['类型']) d['类型'] = recordMeta.type;
            if (recordMeta.seed != null && !d['种子']) d['种子'] = recordMeta.seed;
        }
        // 调用方额外传入的 meta
        if (extra && typeof extra === 'object') {
            for (var k2 in extra) { if (!(k2 in d)) d[k2] = extra[k2]; }
        }
        return d;
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
        var metaDict = buildMetaDict(opts.recordMeta, opts.genParams, opts.meta);
        var tagItems = buildTagsArray(opts.tags, opts.recordType, opts.recordModel, (opts.genParams && opts.genParams.workflow));
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
            html += '<div class="pp-sec-head"><span class="pp-sec-title">其他元数据</span></div>';
            html += '<div class="pp-meta-grid">';
            var keys = Object.keys(metaDict);
            for (var mi = 0; mi < keys.length; mi++) {
                html += '<span class="pp-meta-item"><span class="pp-meta-key">' + escHtml(keys[mi]) + '：</span><span class="pp-meta-val">' + escHtml(String(metaDict[keys[mi]])) + '</span></span>';
            }
            html += '</div></div>';
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
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var gap = 12;
        var left = r.right + gap;
        if (left + bw > vw - 8) left = r.left - bw - gap;
        if (left < 8) left = Math.max(8, Math.min((vw - bw) / 2, vw - bw - 8));
        var top = r.top;
        if (top + bh > vh - 8) top = vh - bh - 8;
        if (top < 8) top = 8;
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
