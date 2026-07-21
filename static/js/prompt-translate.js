/* ──────────────────────────────────────────────────────────────
 * 提示词翻译共享模块
 *
 * 四级策略（v2）：
 *   ① 节点 / 文本缓存命中（0 API）
 *   ② 字典逐条查询（用户字典 → 系统字典）（0 API）
 *   ③ Token 级增量缓存（0 API，命中变化的 token 后只翻译未命中部分）
 *   ④ API 兜底 + 自动学习（经 TranslateQueue 限速 + 去重）
 *
 * 使用：
 *   const result = await PromptTranslate.translate(text, dir, { cacheSource: node });
 *   PromptTranslate.toggleDirection();
 *   const dir = PromptTranslate.getDirection();
 *
 * cacheSource 支持：传入一个带 textOriginal / textTranslated 字段的对象
 *                   缓存键为该对象引用，命中条件：source.text === 原始文本
 *                   不传则只走字典 + API（zimage.html 单次翻译场景）
 * ────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    let _userDict = null;
    let _userDictLoading = false;
    let _sysDict = null;       // { forward, reverse }
    let _sysDictLoading = false;
    let _dir = localStorage.getItem('translate_dir') || 'zh2en';

    /* ── 增量翻译实例 ─────────────────────────────────────── */
    let _incrTranslator = null;
    function getIncrementalTranslator() {
        if (!_incrTranslator) {
            _incrTranslator = new IncrementalTranslator();
        }
        return _incrTranslator;
    }

    /* ── 翻译队列实例 ─────────────────────────────────────── */
    let _queue = null;
    function getTranslateQueue() {
        if (!_queue) {
            _queue = new TranslateQueue({ maxConcurrent: 2, minInterval: 300 });
        }
        return _queue;
    }

    /* ── 方向 ─────────────────────────────────────────────── */
    function getDirection() { return _dir; }
    function toggleDirection() {
        _dir = _dir === 'zh2en' ? 'en2zh' : 'zh2en';
        localStorage.setItem('translate_dir', _dir);
        return _dir;
    }
    function setDirection(d) {
        if (d !== 'zh2en' && d !== 'en2zh') return;
        _dir = d;
        localStorage.setItem('translate_dir', _dir);
    }
    function directionLabel(d) {
        return d === 'zh2en' ? '中→英' : '英→中';
    }
    function directionIcon(d) {
        return d === 'zh2en' ? '🌐→' : '→🌐';
    }

    /* ── 字典加载 ─────────────────────────────────────────── */
    async function loadUserDict() {
        if (_userDict) return _userDict;
        if (_userDictLoading) {
            await new Promise(r => setTimeout(() => r(), 80));
            return _userDict;
        }
        _userDictLoading = true;
        try {
            const res = await fetch('/api/prompt-dict');
            const data = await res.json();
            _userDict = data.dict || { zh2en: {}, en2zh: {} };
        } catch (e) {
            _userDict = { zh2en: {}, en2zh: {} };
        }
        _userDictLoading = false;
        return _userDict;
    }
    function resetUserDictCache() { _userDict = null; }

    async function loadSysDict() {
        if (_sysDict) return _sysDict;
        if (_sysDictLoading) {
            await new Promise(r => setTimeout(() => r(), 80));
            return _sysDict;
        }
        _sysDictLoading = true;
        try {
            const [i18nRes, bidirRes] = await Promise.all([
                fetch('/api/preset-i18n').then(r => r.json()),
                fetch('/api/preset-bidir').then(r => r.json())
            ]);
            const forward = i18nRes || {};
            const reverse = {};
            Object.keys(forward).forEach(k => {
                const cn = forward[k];
                if (cn && !reverse[cn]) reverse[cn] = k;
            });
            if (bidirRes && bidirRes.id_to_name) {
                Object.keys(bidirRes.id_to_name).forEach(id => {
                    const cn = bidirRes.id_to_name[id];
                    if (cn && !reverse[cn]) reverse[cn] = id;
                });
            }
            _sysDict = { forward, reverse };
        } catch (e) {
            _sysDict = { forward: {}, reverse: {} };
        }
        _sysDictLoading = false;
        return _sysDict;
    }

    function normalizeKey(token) {
        return token.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function hasChinese(s) { return /[\u4e00-\u9fa5]/.test(s); }

    /* ── 第 1 级：字典逐条查询 ─────────────────────────────── */
    // tag 分隔符：英文逗号 + 中文标点（顿号、；，）
    const PROMPT_TAG_SPLITTER = /[，,、；;]/;
    async function translateByDict(text, dir) {
        const tokens = text.split(PROMPT_TAG_SPLITTER).map(t => t.trim()).filter(Boolean);
        if (!tokens.length) return { text, allHit: true };

        const userDict = await loadUserDict();
        const sysDict = await loadSysDict();
        const results = [];
        let allHit = true;

        for (const token of tokens) {
            let translated = null;
            if (dir === 'zh2en') {
                // 英文 token：本来就不需要翻译 → 视为命中，保持原样
                if (!hasChinese(token)) {
                    translated = token;
                } else {
                    translated = userDict.zh2en?.[token] || null;
                    if (!translated) translated = sysDict.reverse?.[token] || null;
                }
            } else {
                // en2zh
                // 中文 token：本来就不需要翻译 → 视为命中，保持原样
                if (hasChinese(token)) {
                    translated = token;
                } else {
                    translated = userDict.en2zh?.[token] || null;
                    if (!translated) {
                        const key = normalizeKey(token);
                        translated = sysDict.forward?.[key] || null;
                    }
                }
            }
            if (translated) {
                results.push(translated);
            } else {
                results.push(token);
                allHit = false;
            }
        }
        return { text: results.join(', '), allHit };
    }

    /* ── 自动学习 ─────────────────────────────────────────── */
    async function autoLearnDict(originalText, translatedText, dir) {
        const origTokens = originalText.split(PROMPT_TAG_SPLITTER).map(t => t.trim()).filter(Boolean);
        const transTokens = translatedText.split(PROMPT_TAG_SPLITTER).map(t => t.trim()).filter(Boolean);
        if (!origTokens.length || !transTokens.length) return;

        const entries = { [dir]: {} };
        const len = Math.min(origTokens.length, transTokens.length, 20);
        for (let i = 0; i < len; i++) {
            const src = origTokens[i];
            const tgt = transTokens[i];
            if (src && tgt && src !== tgt) {
                entries[dir][src] = tgt;
            }
        }
        if (Object.keys(entries[dir]).length === 0) return;

        try {
            await fetch('/api/prompt-dict/learn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries })
            });
            resetUserDictCache();
        } catch (e) { /* 静默失败 */ }
    }

    /* ── 第 2 级：缓存读写 ─────────────────────────────────── */
    function cacheRead(source, dir) {
        if (!source) return null;
        const cacheKey = dir === 'zh2en' ? 'textTranslated' : 'textOriginal';
        const cacheOpposite = dir === 'zh2en' ? 'textOriginal' : 'textTranslated';
        if (source[cacheKey] && source[cacheOpposite] === source.text) {
            return source[cacheKey];
        }
        return null;
    }
    function cacheWrite(source, dir, originalText, translatedText) {
        if (!source) return;
        const cacheKey = dir === 'zh2en' ? 'textTranslated' : 'textOriginal';
        const cacheOpposite = dir === 'zh2en' ? 'textOriginal' : 'textTranslated';
        source.text = originalText;
        source[cacheOpposite] = originalText;
        source[cacheKey] = translatedText;
    }

    /* ── 第 3 级：增量翻译（token 级部分缓存）───────────────── */
    async function translateWithIncremental(text, dir, options) {
        const setState = (options?.onState) || (() => {});
        const incr = getIncrementalTranslator();

        /* 先看节点级缓存是否完整命中 */
        if (options?.cacheSource) {
            const cached = cacheRead(options.cacheSource, dir);
            if (cached) {
                setState('缓存命中');
                return { text: cached, fromCache: true, fromDict: false, fromApi: false };
            }
        }

        /* 先走字典，全命中就直接返回 */
        setState('查字典…');
        const dictResult = await translateByDict(text, dir);
        if (dictResult.allHit) {
            setState('字典命中');
            if (options?.cacheSource) {
                cacheWrite(options.cacheSource, dir, text, dictResult.text);
            }
            return { text: dictResult.text, fromCache: false, fromDict: true, fromApi: false };
        }

        /* 字典部分命中 → 进入增量翻译 */
        setState('增量翻译…');
        const result = await incr.translate(text, dir, {
            apiFallback: true,
            onProgress: (idx, total, token, status) => {
                if (status === 'miss') {
                    setState(`翻译中 ${idx}/${total}`);
                }
            }
        });

        /* 写节点级缓存（如果有） */
        if (options?.cacheSource) {
            cacheWrite(options.cacheSource, dir, text, result.text);
        }

        /* 自动学习未命中的 token */
        if (result.fromApi.length > 0) {
            autoLearnDict(text, result.text, dir);
        }

        return {
            text: result.text,
            fromCache: false,
            fromDict: dictResult.allHit,
            fromApi: result.fromApi.length > 0
        };
    }

    /* ── 主入口 ───────────────────────────────────────────── */
    /**
     * @param {string} text
     * @param {string} [direction]  zh2en / en2zh
     * @param {object} [options]
     *   - cacheSource: 带 text 字段的对象（用于双缓存），传 null 跳过缓存
     *   - onState(label): 状态回调（"缓存命中"/"字典命中"/"翻译中…"/"完成"/"失败"）
     *   - forceApi: 强制走 API（跳过字典和缓存）
     * @returns {Promise<{text:string, fromCache:boolean, fromDict:boolean, fromApi:boolean}|null>}
     */
    async function translate(text, direction, options) {
        if (!text || !text.trim()) return null;
        const dir = direction || _dir;
        const opts = options || {};
        const { cacheSource, onState, forceApi } = opts;

        const setState = onState || (() => {});

        if (forceApi) {
            /* 强制 API 模式：走队列限速 */
            setState('翻译中…');
            const queue = getTranslateQueue();
            try {
                const result = await queue.submit({ text, direction: dir });
                setState('完成');
                return result;
            } catch (e) {
                setState('失败');
                console.error('[PromptTranslate] API 错误:', e);
                return null;
            }
        }

        /* 正常模式：三级策略 + 增量翻译 */
        return translateWithIncremental(text, dir, { ...opts, onState: setState });
    }

    /* ── 暴露 ─────────────────────────────────────────────── */
    window.PromptTranslate = {
        translate,
        toggleDirection,
        getDirection,
        setDirection,
        directionLabel,
        directionIcon,
        resetUserDictCache,
        cacheRead,
        cacheWrite,
        // 新增：增量翻译控制
        getIncrementalTranslator,
        getTranslateQueue,
        clearTokenCache: () => getIncrementalTranslator().clear(),
        invalidateToken: (token) => getIncrementalTranslator().invalidate(token),
        tokenCacheStats: () => getIncrementalTranslator().stats(),
    };
})();
