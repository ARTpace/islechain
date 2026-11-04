"""可随源码包分发的纯标准库 HTML 打包函数；不执行输入 JavaScript。"""
import html
import json
import re
from pathlib import Path


def node_preview(channel):
    """Fixed canvas viewport; the parent can enable input without rebuilding it."""
    return ('''<style>html,body,main{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#10191e!important}main>:not(canvas){display:none!important}canvas{display:block!important;width:100%!important;height:100%!important;object-fit:contain;border:0!important;border-radius:0!important}</style><script>(()=>{
const channel=CHANNEL;let enabled=false,first=true,sequence=0;const pending=new Map(),nativeRAF=window.requestAnimationFrame.bind(window),nativeCancel=window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame=callback=>{const id=++sequence;const run=time=>{if(enabled||first){first=false;pending.delete(id);callback(time);}else pending.set(id,{callback});};pending.set(id,{callback,native:nativeRAF(run)});return id;};
window.cancelAnimationFrame=id=>{const item=pending.get(id);if(item?.native)nativeCancel(item.native);pending.delete(id);};
const interval=window.setInterval.bind(window);window.setInterval=(callback,delay,...args)=>interval(()=>{if(enabled&&typeof callback==='function')callback(...args);},delay);
addEventListener('game-assets-ready',()=>{if(!enabled){first=true;for(const [id,item] of [...pending])if(!item.native){pending.delete(id);window.requestAnimationFrame(item.callback);}}});
for(const type of ['keydown','keyup','pointerdown','pointerup','mousedown','mouseup','click','touchstart','touchend','wheel'])addEventListener(type,event=>{if(!enabled){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='game-node-control'||event.data.channel!==channel)return;enabled=event.data.enabled===true;dispatchEvent(new CustomEvent('game-node-state',{detail:{enabled}}));if(!enabled){dispatchEvent(new Event('blur'));for(const audio of document.querySelectorAll('audio,video'))audio.pause();}if(enabled){for(const [id,item] of [...pending])if(!item.native){pending.delete(id);window.requestAnimationFrame(item.callback);}document.querySelector('canvas')?.focus();}});
})();</script>'''.replace('CHANNEL', json.dumps(channel))).encode('utf-8')


def make_page(title, config, script, style, build_id):
    runtime = Path(__file__).parent / 'templates'
    if not runtime.is_dir():
        runtime = Path(__file__).parents[1] / 'templates'
    script = (runtime / 'game-runtime/assets.js').read_text(encoding='utf-8') + '\n' + script
    if config.get('engine') == 'three':
        script = (runtime / 'game-web-3d/three-runtime.js').read_text(encoding='utf-8') + '\n' + script
    config_json = json.dumps(config, ensure_ascii=False).replace('<', '\\u003c')
    script = re.sub(r'</script', lambda _: '<\\/script', script, flags=re.IGNORECASE)
    style = style.replace('<', '\\3c ')
    title = html.escape(title)
    label = '游戏构建' if config.get('releaseCandidate') else '开发灰盒'
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
<title>{title} · {label}</title><style>{style}</style></head><body><main><h1>{title}</h1>
<small>{label} · 键鼠 · 触屏未验证 · 构建 {html.escape(build_id)}</small><p id="hud"></p>
<canvas width="800" height="600" tabindex="0" aria-label="游戏区域"></canvas><p id="message" role="status"></p>
<nav><button id="restart">重开</button><button id="pause">暂停 / 继续</button>
<select id="slot" aria-label="存档槽"><option value="1">存档槽 1</option><option value="2">存档槽 2</option><option value="3">存档槽 3</option></select>
<button id="save">保存</button><button id="load">载入</button><button id="clear">备份后清空当前槽</button></nav></main>
<script>window.GAME_CONFIG={config_json};</script><script>{script}</script></body></html>'''.encode('utf-8')
