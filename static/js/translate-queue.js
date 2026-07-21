/**
 * TranslateQueue — 翻译请求队列 + 限速器
 *
 * 作用：
 *   1. 合并相同文本的并发请求（去重）
 *   2. 限制并发数和 QPS，避免打爆 API
 *   3. 保证最后一个请求优先执行（debounce-last）
 *
 * 用法：
 *   const queue = new TranslateQueue({ maxConcurrent: 2, minInterval: 300 });
 *   const result = await queue.submit({ text, direction, cacheKey });
 */
(function () {
    'use strict';

    class TranslateQueue {
        /**
         * @param {object} opts
         * @param {number} [opts.maxConcurrent=2] 最大并发数
         * @param {number} [opts.minInterval=300] 相邻请求最小间隔（ms）
         * @param {number} [opts.dedupWindow=1000] 去重窗口（ms），窗口期内相同文本只发一次请求
         */
        constructor(opts = {}) {
            this.maxConcurrent = opts.maxConcurrent ?? 2;
            this.minInterval = opts.minInterval ?? 300;
            this.dedupWindow = opts.dedupWindow ?? 1000;

            this._running = 0;
            this._queue = [];          // 等待中的请求
            this._lastReqTime = 0;
            this._dedupMap = new Map(); // text+dir → { promise, timestamp }
        }

        /**
         * 提交一个翻译请求
         * @param {{ text: string, direction: string, cacheKey: string|null }} params
         * @returns {Promise<{text:string, fromCache:boolean, fromDict:boolean, fromApi:boolean}>}
         */
        submit(params) {
            const { text, direction } = params;
            const dedupKey = `${text}||${direction}`;

            // 去重：窗口期内相同文本的请求共享同一个 promise
            const dedupEntry = this._dedupMap.get(dedupKey);
            if (dedupEntry && Date.now() - dedupEntry.timestamp < this.dedupWindow) {
                return dedupEntry.promise;
            }

            // 如果当前有空闲，立即执行；否则排队
            if (this._running < this.maxConcurrent) {
                const p = this._execute(params);
                this._dedupMap.set(dedupKey, { promise: p, timestamp: Date.now() });
                return p;
            }

            // 排队：插入到相同文本之前，后面的请求排在末尾
            return new Promise((resolve, reject) => {
                this._queue.push({
                    params,
                    resolve,
                    reject,
                    dedupKey,
                    text,
                    direction
                });
            });
        }

        /**
         * 执行一个翻译请求
         */
        async _execute(params) {
            this._running++;

            // 限速：距离上次请求太近就等
            const elapsed = Date.now() - this._lastReqTime;
            if (elapsed < this.minInterval) {
                await this._sleep(this.minInterval - elapsed);
            }
            this._lastReqTime = Date.now();

            try {
                const result = await this._callBackend(params);
                return result;
            } finally {
                this._running--;
                // 从队列里取下一个
                this._drainNext();
            }
        }

        /**
         * 从队列中取出下一个可执行的请求
         */
        _drainNext() {
            if (this._queue.length === 0) return;

            // 找到第一个还没被去重的请求
            const idx = this._queue.findIndex(item => {
                const entry = this._dedupMap.get(item.dedupKey);
                return !entry || Date.now() - entry.timestamp >= this.dedupWindow;
            });

            if (idx === -1) {
                // 所有都在去重窗口内，跳过（它们的 promise 已经被共享了）
                this._queue.splice(0, 1);
                this._drainNext();
                return;
            }

            const item = this._queue.splice(idx, 1)[0];
            const p = this._execute(item.params);
            p.then(item.resolve).catch(item.reject);
        }

        /**
         * 调用后端翻译 API
         */
        async _callBackend(params) {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: params.text,
                    direction: params.direction
                })
            });
            const data = await res.json();
            if (data.success && data.result) {
                return {
                    text: data.result,
                    fromCache: false,
                    fromDict: false,
                    fromApi: true
                };
            }
            throw new Error(data.error || '翻译失败');
        }

        _sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        /**
         * 清空队列和缓存
         */
        reset() {
            this._queue = [];
            this._running = 0;
            this._dedupMap.clear();
            this._lastReqTime = 0;
        }
    }

    window.TranslateQueue = TranslateQueue;
})();
