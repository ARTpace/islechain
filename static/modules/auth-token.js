(function() {
    var AUTH_TOKEN = null;

    function refreshToken() {
        if (!AUTH_TOKEN) {
            try { AUTH_TOKEN = localStorage.getItem('xy_auth_token') || null; } catch (e) {}
        }
    }

    // 1) URL 参数优先
    var match = location.search.match(/[?&]token=([^&]+)/);
    if (match) {
        AUTH_TOKEN = decodeURIComponent(match[1]);
    }

    // 2) localStorage 兜底（父页面 postMessage 可能因时序丢失）
    refreshToken();

    // 3) 父页面 postMessage 更新
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'auth-token' && e.data.token) {
            AUTH_TOKEN = e.data.token;
        }
    });

    // 需要附带 token 的请求: 所有 /api/ 接口,以及云生成 /generate
    function shouldAttach(url) {
        if (typeof url !== 'string') return false;
        if (url.indexOf('/api/') === 0) return true;
        if (url === '/generate' || url.indexOf('/generate?') === 0 || url.indexOf('/generate#') === 0) return true;
        return false;
    }

    // 生成类接口(命中后若返回 401 则跳转登录)
    // 严格匹配: 顶层 /generate 路径(含 query/hash),以及 /api/prompt-module/generate
    // 不能用 indexOf,会把 "/api/something/regenerate" 之类的也误判
    function isGenerateUrl(url) {
        if (typeof url !== 'string') return false;
        // 剥离 query 和 hash 后判断路径
        var path = url.split('?')[0].split('#')[0];
        if (path === '/generate') return true;
        if (path === '/api/prompt-module/generate') return true;
        return false;
    }

    function redirectToLogin() {
        if (window.location.pathname.endsWith('login.html')) return;
        window.location.replace('/static/login.html');
    }

    var originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (typeof url !== 'string') return originalFetch.apply(this, arguments);
        // 每次调用时刷新一次 localStorage,防止 token 过期/切换后仍是旧值
        refreshToken();
        options = options || {};
        if (AUTH_TOKEN && shouldAttach(url)) {
            if (typeof Headers !== 'undefined' && options.headers instanceof Headers) {
                options.headers.set('Authorization', 'Bearer ' + AUTH_TOKEN);
            } else if (options.headers && typeof options.headers === 'object') {
                options.headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;
            } else {
                options.headers = { 'Authorization': 'Bearer ' + AUTH_TOKEN };
            }
        }
        var resp = originalFetch.call(window, url, options);
        // 未登录(token 无效/过期)触发生成接口时,跳转登录页
        if (resp && typeof resp.then === 'function') {
            resp.then(function(r) {
                if (r && r.status === 401 && isGenerateUrl(url)) {
                    redirectToLogin();
                }
            }).catch(function() {});
        } else if (resp && resp.status === 401 && isGenerateUrl(url)) {
            redirectToLogin();
        }
        return resp;
    };
})();
