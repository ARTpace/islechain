const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-conversations.js','utf8'), {window});
(async () => {
    let id='', owner='a', invalidated=0, fetch;
    const requests=[];
    const writer=window.ChatConversations.createPersistence({getConversationId:()=>id, getOwner:()=>owner,
        getHeaders:()=>({'X-Owner':owner}), onRemember:value=>id=value, onInvalidate:()=>invalidated++,
        fetch:(...args)=>fetch(...args)});
    fetch=async (url, options) => {
        requests.push([url, JSON.parse(options.body), options.headers]);
        return {ok:true, json:async ()=>({conversation:{id:'chat/a'}, boot_id:'boot'})};
    };
    await writer.saveImage('/image.png');
    assert.equal(id,'chat/a'); assert.equal(invalidated,1);
    assert.equal(requests[1][0],'/api/conversations/chat%2Fa/images');
    assert.deepEqual(requests[1][1],{image_urls:['/image.png']});
    assert.equal(await writer.removeMessages(id,['m']),true);
    assert.equal((await writer.markPending('m')).boot_id,'boot');
    fetch=async ()=>({ok:false});
    await assert.rejects(writer.saveImage('/failed.png'),/保存失败/);
    assert.equal(await writer.removeMessages(id,['m']),false);
    assert.equal(await writer.markPending('m'),null);
    id=''; let complete;
    fetch=()=>new Promise(resolve=>complete=resolve);
    const late=writer.saveImage('/late.png');
    owner='b'; id='new-chat';
    complete({ok:true,json:async ()=>({conversation:{id:'old-chat'}})});
    await assert.rejects(late,/对话已切换/);
    assert.equal(id,'new-chat','late creation cannot replace another account or conversation');
    console.log('Conversation writes, encoded targets, save failures and stale-account isolation passed');
})().catch(error=>{console.error(error); process.exitCode=1;});
