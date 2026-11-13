/* 装饰场景不依赖账号状态，资源均来自本地透明素材。 */
(function () {
 'use strict';
 var scene = document.getElementById('loginScene');
 if (!scene) return;
 function image(parent, name, className) {
  var img = document.createElement('img');
  img.src = '/static/assets/login/layers/' + name + '.webp';
  img.alt = ''; img.draggable = false; img.className = className;
  parent.appendChild(img);
 }
 function layer(parent, className) {
  var div = document.createElement('div'); div.className = className; parent.appendChild(div); return div;
 }
 image(scene, 'mountains', 'scene-horizon'); image(scene, 'mountains', 'scene-horizon far');
 layer(scene, 'scene-sky-glow'); layer(scene, 'scene-stars');
 image(scene, 'cloud', 'scene-cloud'); image(scene, 'cloud', 'scene-cloud second');
 var left = layer(scene, 'scene-island');
 image(left, 'ripples', 'scene-ring'); image(left, 'island-large', 'scene-land');
 image(left, 'tree', 'scene-tree back'); image(left, 'tree', 'scene-tree');
 image(left, 'sign', 'scene-sign'); image(left, 'bush', 'scene-bush'); image(left, 'bridge', 'scene-bridge');
 var right = layer(scene, 'scene-island right');
 image(right, 'ripples', 'scene-ring'); image(right, 'island-large', 'scene-land');
 image(right, 'tree', 'scene-tree'); image(right, 'tree', 'scene-tree back');
 var mill = layer(right, 'scene-mill'); image(mill, 'tower', 'tower'); image(mill, 'rotor', 'rotor');
 image(right, 'waterfall', 'scene-falls'); layer(right, 'scene-lamp');
 var tiny = layer(scene, 'scene-island tiny');
 image(tiny, 'ripples', 'scene-ring'); image(tiny, 'island-small', 'scene-land');
 image(tiny, 'tree', 'scene-tree'); image(tiny, 'star', 'scene-star');
 function pauseWhenHidden() { document.documentElement.toggleAttribute('data-scene-paused', document.hidden); }
 document.addEventListener('visibilitychange', pauseWhenHidden);
 pauseWhenHidden();
})();
