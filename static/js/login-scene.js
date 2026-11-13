/* The supplied backdrop stays still; only the transparent characters and boats move. */
(function () {
    'use strict';
    var stage = document.querySelector('.scene-stage');
    var panel = document.querySelector('.login-panel');
    if (!stage || !panel) return;
    function fitForm() {
        stage.style.setProperty('--login-scale', stage.getBoundingClientRect().width / 1600);
    }
    fitForm();
    new ResizeObserver(fitForm).observe(stage);
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    stage.querySelectorAll('.scene-toy').forEach(function (toy) {
        var home = { x: parseFloat(toy.style.left), y: parseFloat(toy.style.top) };
        var drag = null;
        var suppressClick = false;
        function place(x, y) {
            var bounds = stage.getBoundingClientRect();
            var item = toy.getBoundingClientRect();
            var form = panel.getBoundingClientRect();
            x = Math.max(0, Math.min(x, 100 - item.width / bounds.width * 100));
            y = Math.max(0, Math.min(y, 100 - item.height / bounds.height * 100));
            var left = bounds.left + x / 100 * bounds.width;
            var top = bounds.top + y / 100 * bounds.height;
            // Keep the real form clear, including while dragging with touch.
            if (left < form.right && left + item.width > form.left && top < form.bottom && top + item.height > form.top) {
                x = Math.max(0, (form.left - bounds.left - item.width - 10) / bounds.width * 100);
            }
            toy.style.left = x + '%';
            toy.style.top = y + '%';
        }
        function greet() {
            if (reduced.matches) return;
            toy.classList.remove('is-playing');
            void toy.offsetWidth;
            toy.classList.add('is-playing');
        }
        toy.querySelector('img').addEventListener('animationend', function () { toy.classList.remove('is-playing'); });
        toy.addEventListener('pointerdown', function (event) {
            if (!event.isPrimary || event.button !== 0) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: parseFloat(toy.style.left), top: parseFloat(toy.style.top), moved: false };
            suppressClick = false;
            toy.setPointerCapture(event.pointerId);
        });
        toy.addEventListener('pointermove', function (event) {
            if (!drag || drag.id !== event.pointerId) return;
            var dx = event.clientX - drag.x;
            var dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 5) return;
            drag.moved = true;
            toy.classList.add('is-dragging');
            var bounds = stage.getBoundingClientRect();
            place(drag.left + dx / bounds.width * 100, drag.top + dy / bounds.height * 100);
        });
        function finish(event) {
            if (!drag || event.pointerId !== drag.id) return;
            suppressClick = drag.moved;
            if (event.type === 'pointercancel') place(drag.left, drag.top);
            drag = null;
            toy.classList.remove('is-dragging');
            if (toy.hasPointerCapture(event.pointerId)) toy.releasePointerCapture(event.pointerId);
        }
        toy.addEventListener('pointerup', finish);
        toy.addEventListener('pointercancel', finish);
        toy.addEventListener('lostpointercapture', finish);
        toy.addEventListener('click', function () {
            if (suppressClick) { suppressClick = false; return; }
            greet();
        });
        toy.addEventListener('dblclick', function () { place(home.x, home.y); greet(); });
        toy.addEventListener('keydown', function (event) {
            var delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (event.key === 'Home') { event.preventDefault(); place(home.x, home.y); }
            if (delta) {
                event.preventDefault();
                place(parseFloat(toy.style.left) + delta[0], parseFloat(toy.style.top) + delta[1]);
            }
        });
    });
    document.addEventListener('visibilitychange', function () {
        document.body.classList.toggle('scene-paused', document.hidden);
    });
})();
