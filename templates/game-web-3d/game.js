(() => {
    const canvas=document.querySelector('canvas'), T=window.THREE;
    const renderer=new T.WebGLRenderer({canvas,antialias:true});
    const scene=new T.Scene();scene.background=new T.Color('#182632');
    const camera=new T.PerspectiveCamera(45,4/3,.01,1000);camera.position.set(3,2,4);camera.lookAt(0,.5,0);
    scene.add(new T.HemisphereLight(0xffffff,0x334455,3));
    const light=new T.DirectionalLight(0xffffff,3);light.position.set(4,8,5);scene.add(light);
    const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0x344b48}));floor.rotation.x=-Math.PI/2;scene.add(floor);
    const keys=new Set();let model,mixer,previous=0;
    addEventListener('keydown',e=>{keys.add(e.key.toLowerCase());if(e.key.startsWith('Arrow'))e.preventDefault();});
    addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));addEventListener('blur',()=>keys.clear());
    const id=Object.keys(window.GAME_CONFIG.assetInfo).find(id=>window.GAME_CONFIG.assetInfo[id].kind==='model');
    if(id) window.GameAssets.loadModel(id).then(gltf=>{
        model=gltf.scene;const box=new T.Box3().setFromObject(model),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
        const scale=2/Math.max(size.x,size.y,size.z,.001);model.scale.setScalar(scale);model.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);scene.add(model);
        if(gltf.animations.length){mixer=new T.AnimationMixer(model);mixer.clipAction(gltf.animations[0]).play();}
        document.getElementById('hud').textContent='3D 模型已加载 · WASD / 方向键移动';
    }).catch(error=>{document.getElementById('hud').textContent=error.message;console.error(error);});
    else {model=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0x85c9ab}));model.position.y=.5;scene.add(model);}
    function reset(){if(model){model.position.x=0;model.position.z=0;}keys.clear();}
    document.getElementById('restart').onclick=reset;
    let paused=false;document.getElementById('pause').onclick=()=>{paused=!paused;};
    function loop(time){const dt=previous?Math.min((time-previous)/1000,.05):0;previous=time;
        const width=canvas.clientWidth || 800,height=canvas.clientHeight || 600;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
        if(!paused){if(model){model.position.x+=((keys.has('d')||keys.has('arrowright'))-(keys.has('a')||keys.has('arrowleft')))*dt*2;model.position.z+=((keys.has('s')||keys.has('arrowdown'))-(keys.has('w')||keys.has('arrowup')))*dt*2;}mixer?.update(dt);}
        renderer.render(scene,camera);requestAnimationFrame(loop);
    }
    window.Game={scene,camera,renderer,reset};requestAnimationFrame(loop);
})();
