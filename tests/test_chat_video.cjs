const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function node(tag){return {tag,children:[],dataset:{},style:{},append(...items){this.children.push(...items);},appendChild(child){this.children.push(child);},remove(){this.removed=true;},querySelectorAll(selector){return this.children.flatMap(child=>child.tag==='video'?[child]:child.querySelectorAll?.(selector)||[]);},getAttribute(key){return this[key];}};}
const env={window:{},document:{addEventListener(){},getElementById(){return null;},createElement:node},localStorage:{getItem(){return null;},setItem(){}},AbortController,DOMException,setTimeout,clearTimeout};
vm.createContext(env);vm.runInContext(fs.readFileSync('static/modules/chat-video.js','utf8'),env);
const api=env.window.ChatVideo;
for(const text of ['生成一个小猫奔跑的视频','让刚才那只猫动起来','做一段5秒竖版动画','generate a video of a cat'])assert(api.isRequest(text),text);
for(const text of ['生成一只小猫图片','现在能生成视频吗','不要生成视频','只给我视频脚本','如何制作视频'])assert.equal(api.isRequest(text),false,text);
assert(api.needsReference('让上一张图片动起来'));
const defaults={provider_id:'demo',model:'demo-video',duration:5,aspect_ratio:'16:9',resolution:'720p'};
const spec={prompt:'A cat running',params:{duration:8,ratio:'9:16',resolution:'1080p'}};
const body=api.validate(spec,defaults);assert.equal(body.duration,8);assert.equal(body.aspect_ratio,'9:16');assert.equal(defaults.duration,5);
for(const params of [{duration:0},{duration:61},{duration:2.5},{ratio:'bad'},{resolution:4},{batch_count:2}])assert.throws(()=>api.validate({prompt:'cat',params},defaults));
assert.throws(()=>api.validate({prompt:'cat'},{...defaults,model:''}),/视频模型/);
assert.equal(api.readSpec('普通回复',true),null);
assert.equal(api.readSpec('```json\n{"prompt":"cat"}\n```',true).prompt,'cat');
assert.equal(api.readSpec('',true,{kind:'VIDEO',value:{prompt:'cat'}}).prompt,'cat');
assert.equal(api.readSpec('',false,{kind:'VIDEO',value:{prompt:'cat'}}),null,'no video without user intent');
const host=node('div');api.mountVideo(host,'javascript:alert(1)');assert.equal(host.children.length,0);
api.mountVideo(host,'/output/demo.mp4');api.mountVideo(host,'/output/demo.mp4');assert.equal(host.children.length,1);
assert.equal(host.children[0].children[0].controls,true);
async function run(){
    const calls=[];
    env.fetch=async(url,options={})=>{
        calls.push([url,options]);
        if(url.endsWith('/models'))return {ok:true,json:async()=>({providers:[{id:'demo',name:'Demo',models:['demo-video'],protocol:'openai',image_to_video:true}]})};
        if(options.method==='POST')return {ok:true,json:async()=>({task_id:'job'})};
        return {ok:true,json:async()=>({status:'succeeded',result:{videos:['/output/result.mp4']}})};
    };
    await api.load();
    const task={controller:new AbortController(),videoBody:body,setStage(){},check(){if(this.controller.signal.aborted)throw new Error('stopped');},finish(error){this.error=error;this.finished=true;}};
    await api.generate(host,spec,[{url:'/output/reference.png'}],task,{conversation_id:'c',message_id:'m'});
    const posted=JSON.parse(calls.find(call=>call[1].method==='POST')[1].body);
    assert.equal(posted.images[0].url,'/output/reference.png');assert.equal(posted.conversation_id,'c');assert.equal(posted.duration,8);
    assert(task.finished);assert.equal(host.querySelectorAll('video').length,2);
    api.setMode('video');assert.equal(api.wants('生成一张小猫图片'),false);
    env.fetch=async()=>({ok:true,json:async()=>({status:'failed',error:'upstream failed'})});
    await assert.rejects(api.poll('job',new AbortController().signal),/upstream failed/);
    env.fetch=async(_,options)=>{if(options.signal.aborted)throw new DOMException('aborted','AbortError');return {ok:true,json:async()=>({status:'running'})};};
    const aborted=new AbortController();aborted.abort();await assert.rejects(api.poll('job',aborted.signal),/aborted/);
    const html=fs.readFileSync('static/app/zimage.html','utf8');
    assert.match(html,/msg.video_urls/);assert.match(html,/videoRequested.*ChatVideo.readSpec/);
    assert.match(html,/!videoRequested && !stalled/,'video failures never fall back to image generation');
    console.log('Chat video: intent, parameters, one-click selection, reference payload, playback, persistence wiring, failure and cancellation OK');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
