/* 先套上已保存的主题和底色，再加载完整主题脚本，避免页面先闪成默认色。 */
(function(){
    var P={ink:{d:['#14161c','#1c202a','#252b38','#343b4c','#445066'],l:['#f7f6f4','#fbfaf9','#f3f2ef','#e7e5de','#d9d6cc']},night:{d:['#0e1626','#162238','#1e2d48','#314466','#42587f'],l:['#f3f6fb','#f8fafd','#eaf0f8','#d5e0ee','#c3d0e4']},pine:{d:['#101916','#17241f','#20302a','#334840','#456056'],l:['#f3f7f4','#f8fbf8','#e7f0ea','#d3e2d8','#bdd0c4']},dusk:{d:['#16141f','#211c2e','#2c243d','#43385a','#574a72'],l:['#f6f4f9','#fbf9fd','#efeaf6','#ddd4ea','#cbbfdc']},sand:{d:['#1a1612','#262018','#32281e','#4a3c2e','#5e4e3c'],l:['#f8f5f1','#fbf9f6','#f3ece4','#e6d9cb','#d4c3b0']}};
    function hex(h){h=String(h||'').replace('#','');if(h.length===3)h=h.replace(/./g,function(c){return c+c;});if(!/^[0-9a-f]{6}$/i.test(h))return [26,39,68];var n=parseInt(h,16);return [(n>>16)&255,(n>>8)&255,n&255];}
    function ladder(h,dark){var base=hex(h),toward=dark?[8,10,16]:[247,246,244],steps=dark?[.34,.48,.62,.74,.84]:[.07,.03,.12,.2,.28];return steps.map(function(t){return '#'+toward.map(function(v,i){return Math.max(0,Math.min(255,Math.round(v+(base[i]-v)*t))).toString(16).padStart(2,'0');}).join('');});}
    var dark=false,key='ink',color='#1a2744';
    try{dark=(localStorage.getItem('studio_theme')||localStorage.getItem('canvas_theme')||(window.STUDIO_DEFAULT_THEME || 'dark'))==='dark';key=localStorage.getItem('studio_palette')||'ink';color=localStorage.getItem('studio_palette_color')||'#1a2744';}catch(e){}
    var root=document.documentElement;
    root.classList.toggle('studio-theme-dark',dark);
    root.classList.toggle('theme-dark',dark);
    function paintBody(){if(!document.body)return;document.body.classList.toggle('studio-theme-dark',dark);document.body.classList.toggle('theme-dark',dark);}
    paintBody();
    if(!document.body){new MutationObserver(function(_,obs){if(document.body){paintBody();obs.disconnect();}}).observe(root,{childList:true});}
    var list=key==='custom'?ladder(color,dark):((P[key]||P.ink)[dark?'d':'l']);
    var vars='--ui-bg:'+list[0]+';--ui-panel:'+list[1]+';--ui-soft:'+list[2]+';--ui-line:'+list[3]+';--ui-line-strong:'+list[4]+';--bg:'+list[0]+';--bg-base:'+list[0]+';--stage-bg:'+list[0]+';--sidebar-bg:'+list[1]+';--card:'+list[2]+';';
    var clear=20;try{var saved=localStorage.getItem('studio_panel_alpha');if(saved!=null&&saved!==''){var n=Math.round(Number(saved));if(n>=0&&n<=40)clear=n;}}catch(e){}
    function rgba(c,a){var p=hex(c);return 'rgba('+p[0]+','+p[1]+','+p[2]+','+a+')';}
    var panelA=(1-clear/100).toFixed(3),softA=Math.min(1,1-Math.max(0,clear-6)/100).toFixed(3);
    var glass='body .sidebar.sidebar,body #settings-panel{background:'+rgba(list[1],panelA)+' !important;background-color:'+rgba(list[1],panelA)+' !important;}body .console-card.console-card,body .history-bulk-toolbar.history-bulk-toolbar,body .chat-drawer.chat-drawer,body .chat-history.chat-history{background:'+rgba(list[2],softA)+' !important;background-color:'+rgba(list[2],softA)+' !important;}';
    var style=document.getElementById('studio-palette-style');
    if(!style){style=document.createElement('style');style.id='studio-palette-style';(document.head||root).appendChild(style);}
    style.textContent=':root{'+vars+'}html.studio-theme-dark,html.studio-theme-dark body,body.theme-dark,body.studio-theme-dark{'+vars+'}html{background:'+list[0]+';color-scheme:'+(dark?'dark':'light')+';}'+glass;
})();
(function () {
    var s = document.createElement('script');
    s.src = '/static/js/theme.js?v=20261024bar';
    s.async = false;
    document.head.appendChild(s);
})();
