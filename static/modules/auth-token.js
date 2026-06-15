(function() {
    var AUTH_TOKEN = null;

    // 1) URL 参数优先
    var match = location.search.match(/[?&]token=([^&]+)/);
    if (match) {
        AUTH_TOKEN = decodeURIComponent(match[1]);
    }

    // 2) localStorage 兜底（父页面 postMessage 可能因时序丢失）
    if (!AUTH_TOKEN) {
        try { AUTH_TOKEN = localStorage.getItem('xy_auth_token') || null; } catch (e) {}
    }

    // 3) 父页面 postMessage 更新
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'auth-token' && e.data.token) {
            AUTH_TOKEN = e.data.token;
        }
    });

    var originalFetch = window.fetch;
    window.fetch = function(url, options) {
        // 每次调用时也刷新一次 localStorage，防止 token 过期/切换后仍是旧值
        if (!AUTH_TOKEN) {
            try { AUTH_TOKEN = localStorage.getItem('xy_auth_token') || null; } catch (e) {}
        }
        if (AUTH_TOKEN && typeof url === 'string' && url.startsWith('/api/')) {
            var separator = url.indexOf('?') > -1 ? '&' : '?';
            url = url + separator + 'token=' + encodeURIComponent(AUTH_TOKEN);
        }
        return originalFetch.call(window, url, options);
    };
})();
