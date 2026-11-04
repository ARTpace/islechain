/* 首条无依赖 Web 2D 灰盒。源码不访问宿主接口；只使用注入的固定内容与资源。 */
(() => {
    'use strict';
    const config = window.GAME_CONFIG;
    const data = config.content.datasets;
    const playerData = data.find(d => d.datasetId === 'characters').rows[0]?.values;
    const enemyData = data.find(d => d.datasetId === 'enemies').rows;
    const level = data.find(d => d.datasetId === 'levels').rows[0]?.values;
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    const hud = document.getElementById('hud'), message = document.getElementById('message');
    const keys = new Set();
    const saveKey = () => `art-game:${config.projectId}:${config.saveSlot}:${document.getElementById('slot').value}:v1`;
    let state, previous = 0, cooldown = 0;
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const images = new Map();
    for (const [id, url] of Object.entries(config.assets)) { const image = new Image(); image.src = url; images.set(id, image); }
    function restart() {
        if (!playerData || !level) { message.textContent = '角色或关卡数据为空，请补全后重新构建。'; return; }
        keys.clear(); cooldown = 0;
        const target = Number.isInteger(level.target) ? level.target : 5;
        state = {saveVersion: 1, x: 70, y: 70, hp: playerData.hp ?? 3, collected: 0, status: 'playing',
            items: Array.from({length: target}, (_, i) => ({x: 160 + (i % 5) * 125, y: 120 + Math.floor(i / 5) * 65, collected: false})),
            enemies: [{x: 700, y: 480}]};
        message.textContent = '方向键 / WASD 移动，收集金色方块，避开敌人。'; draw();
    }
    function step(dt) {
        if (!state || state.status !== 'playing') return;
        let dx = Number(keys.has('ArrowRight') || keys.has('d')) - Number(keys.has('ArrowLeft') || keys.has('a'));
        let dy = Number(keys.has('ArrowDown') || keys.has('s')) - Number(keys.has('ArrowUp') || keys.has('w'));
        const length = Math.hypot(dx, dy) || 1;
        state.x = clamp(state.x + dx / length * (playerData.speed ?? 160) * dt, 16, 784);
        state.y = clamp(state.y + dy / length * (playerData.speed ?? 160) * dt, 16, 584);
        for (const item of state.items) if (!item.collected && Math.hypot(item.x - state.x, item.y - state.y) < 25) { item.collected = true; state.collected++; }
        const enemy = enemyData.find(e => e.id === level.enemy)?.values || {};
        cooldown = Math.max(0, cooldown - dt);
        for (const item of state.enemies) {
            const distance = Math.hypot(state.x - item.x, state.y - item.y) || 1;
            const travel = Math.min((enemy.speed ?? 70) * dt, distance);
            item.x += (state.x - item.x) / distance * travel;
            item.y += (state.y - item.y) / distance * travel;
            if (distance < 28 && cooldown === 0) { state.hp = Math.max(0, state.hp - (enemy.damage ?? 1)); cooldown = 1; }
        }
        if (state.hp <= 0) state.status = 'lost';
        else if (state.collected === state.items.length) state.status = 'won';
        if (state.status !== 'playing') { keys.clear(); message.textContent = state.status === 'won' ? '胜利！点击重开再来一次。' : '失败。点击重开恢复全部初始状态。'; }
    }
    function draw() {
        ctx.fillStyle = '#142125'; ctx.fillRect(0, 0, 800, 600);
        if (!state) return;
        const ready = id => { const image = images.get(id); return image?.complete && image.naturalWidth ? image : null; };
        const background = ready(level.backgroundAsset); if (background) ctx.drawImage(background, 0, 0, 800, 600);
        for (const item of state.items) if (!item.collected) {
            const image = ready(level.itemAsset);
            if (image) ctx.drawImage(image, item.x - 12, item.y - 12, 24, 24);
            else { ctx.fillStyle = '#f5cf69'; ctx.fillRect(item.x - 8, item.y - 8, 16, 16); }
        }
        for (const item of state.enemies) {
            const image = ready(level.enemyAsset);
            if (image) ctx.drawImage(image, item.x - 16, item.y - 16, 32, 32);
            else { ctx.fillStyle = '#f17f7b'; ctx.beginPath(); ctx.arc(item.x, item.y, 14, 0, Math.PI * 2); ctx.fill(); }
        }
        const image = images.get(playerData.spriteAsset);
        if (image?.complete && image.naturalWidth) ctx.drawImage(image, state.x - 16, state.y - 16, 32, 32);
        else { ctx.fillStyle = cooldown > 0 ? '#fff' : '#76d7b5'; ctx.fillRect(state.x - 12, state.y - 12, 24, 24); }
        const health = ready(level.healthAsset); if (health) for (let i = 0; i < Math.min(state.hp, 20); i++) ctx.drawImage(health, 12 + i * 22, 12, 18, 18);
        hud.textContent = `生命 ${state.hp} · 收集 ${state.collected}/${state.items.length} · ${state.status}`;
    }
    function loop(time) { const dt = previous ? Math.min((time - previous) / 1000, .05) : 0; previous = time; step(dt); draw(); requestAnimationFrame(loop); }
    window.addEventListener('keydown', event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); keys.add(key); }
    });
    window.addEventListener('keyup', event => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
    window.addEventListener('blur', () => keys.clear());
    document.getElementById('restart').onclick = restart;
    document.getElementById('pause').onclick = () => { if (state && ['playing', 'paused'].includes(state.status)) { state.status = state.status === 'playing' ? 'paused' : 'playing'; keys.clear(); } };
    function validateSave(raw) {
        const value = JSON.parse(raw);
        if (value.saveVersion !== 1) throw new Error('存档版本不兼容');
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 16 || value.x > 784 || value.y < 16 || value.y > 584
            || !Number.isInteger(value.hp) || value.hp < 0 || value.hp > 10000
            || !Number.isInteger(value.collected) || !['playing', 'paused', 'won', 'lost'].includes(value.status)
            || !Array.isArray(value.items) || value.items.length !== (level.target ?? 5)
            || !Array.isArray(value.enemies) || value.enemies.length !== 1
            || value.items.some(i => !Number.isFinite(i.x) || !Number.isFinite(i.y) || typeof i.collected !== 'boolean')
            || value.enemies.some(i => !Number.isFinite(i.x) || !Number.isFinite(i.y))
            || value.items.filter(i => i.collected).length !== value.collected) throw new Error('存档内容损坏');
        return value;
    }
    document.getElementById('save').onclick = () => { try { if (!state) return; localStorage.setItem(saveKey(), JSON.stringify(state)); message.textContent = '已保存当前独立存档槽'; } catch { message.textContent = '当前隔离预览不提供持久存储；请导出开发包后保存。'; } };
    document.getElementById('load').onclick = () => {
        try { const raw = localStorage.getItem(saveKey()); if (!raw) { message.textContent = '当前槽没有存档'; return; } state = validateSave(raw); keys.clear(); cooldown = 0; message.textContent = '存档已载入'; }
        catch (error) { message.textContent = `${error.message}；原存档保留，可先备份后重置。隔离预览可能不提供存储。`; }
    };
    document.getElementById('clear').onclick = () => {
        try { const key = saveKey(); const raw = localStorage.getItem(key); if (raw) localStorage.setItem(key + ':backup', raw); localStorage.removeItem(key); restart(); message.textContent = '原槽已备份后清空'; }
        catch { message.textContent = '无法完成备份，未清空存档'; }
    };
    document.getElementById('slot').onchange = () => { message.textContent = '已切换存档槽，点击载入读取该槽；当前游戏进度保持。'; };
    restart(); requestAnimationFrame(loop);
})();
