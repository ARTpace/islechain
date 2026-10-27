/* 只绑定通用单图输入事件，校验、上传与预览仍由页面处理。 */
(function (global) {
    'use strict';
    function bind(zone, input, onFile) {
        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('dragover');
            if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', e => {
            if (e.target.files.length) onFile(e.target.files[0]);
        });
        document.addEventListener('paste', e => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (!item.type.startsWith('image/')) continue;
                const file = item.getAsFile();
                if (file) { e.preventDefault(); onFile(file); return; }
            }
        });
    }
    global.UploadZone = { bind };
})(window);
