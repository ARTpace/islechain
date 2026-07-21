/**
 * IncrementalTranslator — 增量翻译 / 部分缓存
 *
 * 核心思路：
 *   提示词由多个 token（逗号分隔）组成，每个 token 独立翻译。
 *   缓存键 = token 本身，缓存值 = 翻译结果。
 *   翻译时只重新翻译变化的 token，不变的直接从缓存取。
 *
 * 用法：
 *   const translator = new IncrementalTranslator();
 *   // 首次翻译
 *   const result1 = await translator.translate('猫,狗,鸟');
 *   // 部分修改后，只翻译变化的部分
 *   const result2 = await translator.translate('猫,兔子,鸟'); // 只翻译"兔子"
 *   // 获取缓存差异（用于自动学习）
 *   const diffs = translator.getDiffs(original, translated);
 */
(function () {
    'use strict';

    // token 分隔符：英文逗号 + 中文标点
    const TOKEN_SPLITTER = /[，,、；;]/;

    class IncrementalTranslator {
        constructor() {
            this._tokenCache = new Map(); // token → { zh2en, en2zh }
            this._version = 0;            // 版本号，用于失效检测
        }

        /**
         * 增量翻译
         * @param {string} text - 提示词文本
         * @param {string} [direction='zh2en'] - 翻译方向
         * @param {object} [opts]
         *   - apiFallback: 未命中的 token 走 API 翻译
         *   - onProgress: (index, total, token, status) => void
         *   - cacheKey: 全局缓存键（用于节点级缓存）
         * @returns {Promise<{text: string, changed: string[], unchanged: string[], fromApi: string[]}>}
         */
        async translate(text, direction, opts = {}) {
            const dir = direction || 'zh2en';
            const tokens = text.split(TOKEN_SPLITTER).map(t => t.trim()).filter(Boolean);
            if (!tokens.length) return { text, changed: [], unchanged: [], fromApi: [] };

            const results = [];
            const changed = [];
            const unchanged = [];
            const fromApi = [];

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const cached = this._tokenCache.get(token)?.[dir];

                if (cached) {
                    results.push(cached);
                    unchanged.push(token);
                } else {
                    let translated;
                    try {
                        translated = await this._translateToken(token, dir, opts.apiFallback);
                        fromApi.push(token);
                    } catch (e) {
                        translated = token; // 翻译失败保持原样
                    }
                    this._tokenCache.set(token, { ...this._tokenCache.get(token), [dir]: translated });
                    results.push(translated);
                    changed.push(token);
                }

                // 进度回调
                if (opts.onProgress) {
                    opts.onProgress(i + 1, tokens.length, token, cached ? 'hit' : 'miss');
                }
            }

            return {
                text: results.join(', '),
                changed,
                unchanged,
                fromApi
            };
        }

        /**
         * 翻译单个 token
         */
        async _translateToken(token, dir, useApi) {
            // 先查字典
            const dictResult = await this._dictLookup(token, dir);
            if (dictResult) return dictResult;

            // 字典没有就走 API
            if (useApi !== false) {
                const res = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: token, direction: dir })
                });
                const data = await res.json();
                if (data.success && data.result) {
                    return data.result;
                }
            }
            return token;
        }

        /**
         * 字典查找
         */
        async _dictLookup(token, dir) {
            // 用户字典
            const userDict = await window.PromptTranslate?.loadUserDict?.() 
                || { zh2en: {}, en2zh: {} };
            if (dir === 'zh2en') {
                return userDict.zh2en?.[token] || null;
            } else {
                return userDict.en2zh?.[token] || null;
            }
        }

        /**
         * 获取缓存差异（用于自动学习）
         * @param {string} original - 原文
         * @param {string} translated - 译文
         * @returns {{entries: object, dirtyTokens: string[]}}
         */
        getDiffs(original, translated) {
            const origTokens = original.split(TOKEN_SPLITTER).map(t => t.trim()).filter(Boolean);
            const transTokens = translated.split(TOKEN_SPLITTER).map(t => t.trim()).filter(Boolean);
            const entries = { zh2en: {}, en2zh: {} };
            const dirty = [];

            const len = Math.min(origTokens.length, transTokens.length);
            for (let i = 0; i < len; i++) {
                const src = origTokens[i];
                const tgt = transTokens[i];
                if (src && tgt && src !== tgt) {
                    dirty.push(src);
                    if (/[\u4e00-\u9fa5]/.test(src)) {
                        entries.zh2en[src] = tgt;
                    } else {
                        entries.en2zh[tgt] = src;
                    }
                }
            }
            return { entries, dirtyTokens: dirty };
        }

        /**
         * 清除单个 token 的缓存
         */
        invalidate(token) {
            this._tokenCache.delete(token);
        }

        /**
         * 清空所有缓存
         */
        clear() {
            this._tokenCache.clear();
            this._version++;
        }

        /**
         * 获取缓存统计
         */
        stats() {
            return { size: this._tokenCache.size, version: this._version };
        }
    }

    window.IncrementalTranslator = IncrementalTranslator;
})();
