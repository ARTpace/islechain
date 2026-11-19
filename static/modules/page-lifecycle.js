/* Same-origin cached-frame lifecycle. No messages or authentication data cross origins. */
(function (root) {
    'use strict';
    if (root.PageLifecycle) return;
    const hooks = new Set();
    let active = true, disposed = false;
    try {
        const frame = root.frameElement;
        if (frame) active = !frame.hidden && (root.parent.PageLifecycle?.active ?? true)
            && (frame.id?.startsWith('frame-') ? frame.classList.contains('active') : true);
    } catch (_) {}
    function setFrameActive(frame, value) {
        try { frame.contentWindow?.PageLifecycle?.setActive(value); } catch (_) {}
    }
    function setActive(value) {
        if (disposed) return;
        value = !!value;
        if (active === value) return;
        active = value;
        for (const hook of hooks) hook[active ? 'activate' : 'deactivate']?.();
        root.document.querySelectorAll('iframe').forEach(frame => {
            setFrameActive(frame, active && !frame.hidden && (!frame.id?.startsWith('frame-') || frame.classList.contains('active')));
        });
    }
    function register(hook) {
        if (disposed) return () => {};
        hooks.add(hook);
        hook[active ? 'activate' : 'deactivate']?.();
        return () => hooks.delete(hook);
    }
    // Uninstrumented pages cannot prove they have no pending saves or tasks.
    function canDispose() {
        return hooks.size > 0 && [...hooks].every(hook => typeof hook.canDispose === 'function' && hook.canDispose());
    }
    function canReleaseFrame(frame) {
        try { return frame.contentWindow?.PageLifecycle?.canDispose() === true; }
        catch (_) { return false; }
    }
    function onLoad(event) {
        const frame = event.target;
        if (frame.tagName !== 'IFRAME') return;
        setFrameActive(frame, active && !frame.hidden && (!frame.id?.startsWith('frame-') || frame.classList.contains('active')));
    }
    function onPageHide(event) {
        if (event.persisted || disposed) return;
        disposed = true;
        for (const hook of hooks) hook.dispose?.();
        hooks.clear();
        root.document.removeEventListener('load', onLoad, true);
        root.removeEventListener('pagehide', onPageHide);
    }
    root.document.addEventListener('load', onLoad, true);
    root.addEventListener('pagehide', onPageHide);
    root.PageLifecycle = {register, setActive, setFrameActive, canDispose, canReleaseFrame, get active() {return active;}};
})(window);
