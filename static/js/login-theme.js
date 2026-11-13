/* 登录页昼夜配色：以设备本地时间为准，不读写工作台主题偏好。 */
(function () {
    'use strict';
    var timer;
    function syncLoginTheme() {
        window.clearTimeout(timer);
        var now = new Date();
        var hour = now.getHours();
        var night = hour >= 18 || hour < 6;
        var root = document.documentElement;
        root.dataset.loginTheme = night ? 'night' : 'day';
        root.classList.toggle('studio-theme-dark', night);
        var meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.content = night ? 'dark' : 'only light';
        // 最多一分钟校时；同时精确守住最近的切换边界，兼容跨日及系统时钟变更。
        var next = new Date(now.getTime());
        next.setHours(hour < 6 ? 6 : hour < 18 ? 18 : 30, 0, 0, 0);
        timer = window.setTimeout(syncLoginTheme, Math.min(60000, Math.max(1, next.getTime() - now.getTime())));
    }
    syncLoginTheme();
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) syncLoginTheme();
    });
    window.addEventListener('pageshow', syncLoginTheme);
    window.addEventListener('focus', syncLoginTheme);
})();
