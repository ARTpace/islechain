/* Project asset IDs stay stable when a user replaces a file. Never hardcode upload paths. */
window.GameAssets = {
    audioInstances: new Set(),
    info(id) { const info=window.GAME_CONFIG.assetInfo?.[id]; if(!info || !window.GAME_CONFIG.assets[id]) throw Error('未绑定游戏资产：'+id); return info; },
    url(id) { if(!window.GAME_CONFIG.assets[id]) throw Error('未绑定游戏资产：'+id); return window.GAME_CONFIG.assets[id]; },
    async loadImage(id) { const image=new Image();image.src=this.url(id);await image.decode();dispatchEvent(new Event('game-assets-ready'));return image; },
    createAudio(id, options={}) { if(this.info(id).kind!=='audio') throw Error('需要音频资产');const audio=new Audio(this.url(id));audio.loop=options.loop===true;audio.volume=Math.max(0,Math.min(1,options.volume ?? 1));this.audioInstances.add(audio);return audio; },
    async loadModel(id) { if(this.info(id).kind!=='model' || !window.GameGLTFLoader) throw Error('需要 GLB 资产和 3D 运行环境');const response=await fetch(this.url(id));if(!response.ok)throw Error('模型加载失败：'+id);const data=await response.arrayBuffer();const model=await new Promise((resolve,reject)=>new window.GameGLTFLoader().parse(data,'',resolve,reject));setTimeout(()=>dispatchEvent(new Event('game-assets-ready')),0);return model; }
};
addEventListener('game-node-state',event=>{if(!event.detail.enabled)for(const audio of window.GameAssets.audioInstances)audio.pause();});
