/* 面板极光与萤火虫，不再在背景绘制光源或光环。 */
(function () {
 'use strict';
 var stage = document.querySelector('.scene-stage');
 if (!stage) return;
 var panel = stage.querySelector('.login-panel'), emitWake;
 function inPanel(target) { return !!(panel && target && panel.contains(target)); }
 function setAwake(awake) {
  var changed = stage.dataset.sceneAwake !== 'true';
  stage.dataset.sceneAwake = awake ? 'true' : 'false';
  if (awake && changed && emitWake) emitWake();
 }
 setAwake(inPanel(document.activeElement));
 stage.addEventListener('pointerdown', function (event) { setAwake(inPanel(event.target)); });
 stage.addEventListener('focusin', function (event) { if (inPanel(event.target)) setAwake(true); });
 stage.addEventListener('focusout', function (event) {
  if (inPanel(event.target) && !inPanel(event.relatedTarget)) setAwake(false);
 });
 document.addEventListener('visibilitychange', function () { setAwake(!document.hidden && inPanel(document.activeElement)); });
 window.addEventListener('blur', function () { setAwake(false); });
 window.addEventListener('focus', function () { setAwake(inPanel(document.activeElement)); });
 var canvas = document.createElement('canvas');
 canvas.className = 'login-particles'; canvas.setAttribute('aria-hidden', 'true'); stage.appendChild(canvas);
 var ctx = canvas.getContext('2d');
 if (!ctx) { canvas.remove(); return; }
 var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
 var frame=0, previous=0, clock=0, flight=-1, box, bugs=[], rising=[], spawnIn=0;
 function resize() {
  var width=stage.clientWidth, height=stage.clientHeight, ratio=Math.min(window.devicePixelRatio||1,1.5);
  canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  var bounds=stage.getBoundingClientRect(), rect=panel.getBoundingClientRect();
  box={x:rect.left-bounds.left,y:rect.top-bounds.top,w:rect.width,h:rect.height};
  bugs=Array.from({length:13}, function () {
   var side=Math.random()>.5, u=Math.random();
   return {x:side ? (Math.random()>.5 ? 5 : box.w-5) : u*box.w,
    y:side ? u*box.h : (Math.random()>.5 ? 5 : box.h-5),
    phase:Math.random()*6.28,size:.45+Math.random()*.7,delay:Math.random()*900,
    dx:(Math.random()-.5)*260,dy:-70-Math.random()*160,duration:2400+Math.random()*1300};
  });
  if (reduced.matches) draw(0);
 }
 emitWake=function () { if(!reduced.matches && !document.hidden) flight=0; };
 function draw(delta) {
  clock+=delta; ctx.clearRect(0,0,stage.clientWidth,stage.clientHeight);
  var awake=stage.dataset.sceneAwake==='true';
  if(!awake) { flight=-1; rising=[]; spawnIn=0; }
  else if(flight>=0) flight+=delta;
  if(reduced.matches) return;
  // 点亮后从整个可见背景底部升起，不从登录面板底缘喷出。
  if(awake) {
   spawnIn-=delta;
   if(spawnIn<=0 && rising.length<80) {
    var bounds=stage.getBoundingClientRect();
    rising.push({x:stage.clientWidth*(.03+Math.random()*.94),y:Math.min(stage.clientHeight,window.innerHeight-bounds.top)+6,age:0,duration:8500+Math.random()*5000,rise:180+Math.random()*260,phase:Math.random()*6.28,size:.65+Math.pow(Math.random(),2)*1.2});
    spawnIn=100+Math.random()*170;
   }
   rising=rising.filter(function (p) {
    p.age+=delta; var t=p.age/p.duration; if(t>=1) return false;
    var x=p.x+Math.sin(t*4+p.phase)*13, y=p.y-t*p.rise;
    ctx.globalAlpha=Math.min(1,t*8)*Math.pow(1-t,.65)*.8; ctx.fillStyle='#e2f2bd'; ctx.shadowColor='#cde5a5'; ctx.shadowBlur=6;
    ctx.beginPath(); ctx.arc(x,y,p.size,0,Math.PI*2); ctx.fill(); return true;
   });
  }
  bugs.forEach(function (bug) {
   var life=flight<0 ? 0 : Math.max(0,(flight-bug.delay)/bug.duration);
   if(life>=1) return;
   var travel=life*life*(3-2*life), shimmer=.45+.25*Math.sin(clock*.0015+bug.phase);
   var x=box.x+bug.x+Math.sin(clock*.0007+bug.phase)*4+bug.dx*travel;
   var y=box.y+bug.y+Math.cos(clock*.0006+bug.phase)*5+bug.dy*travel;
   ctx.globalAlpha=shimmer*(1-life); ctx.fillStyle='#e0edac'; ctx.shadowColor='#c6dd86'; ctx.shadowBlur=5;
   ctx.beginPath(); ctx.arc(x,y,bug.size,0,Math.PI*2); ctx.fill();
  });
  ctx.shadowBlur=0; ctx.globalAlpha=1;
 }
 function tick(time) {
  frame=0; if(document.hidden || reduced.matches) return;
  if(!previous || time-previous>=32) { draw(previous?Math.min(time-previous,64):0); previous=time; }
  frame=window.requestAnimationFrame(tick);
 }
 function sync() {
  window.cancelAnimationFrame(frame); frame=0; previous=0;
  if(document.hidden) { flight=-1; rising=[]; return; }
  if(reduced.matches) { flight=-1; rising=[]; draw(0); }
  else frame=window.requestAnimationFrame(tick);
 }
 document.addEventListener('visibilitychange',sync); reduced.addEventListener('change',sync);
 window.addEventListener('resize',resize);
 window.addEventListener('pagehide',function () { window.cancelAnimationFrame(frame); frame=0; });
 window.addEventListener('pageshow',sync);
 resize(); sync();
})();
