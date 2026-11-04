// Provider adapters vendored from ohmygame; see LICENSE.
import {writeFile, readFile} from 'node:fs/promises';
import {VolcengineTtsProvider} from './vendor/daemon/volcengine-tts-provider.js';
import {VolcengineSeedAudioProvider} from './vendor/daemon/volcengine-seed-audio-provider.js';
import {VOLCENGINE_TTS_VOICES} from './vendor/shared/doubao-voices.js';
async function main(){
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const p=JSON.parse(raw), c=p.connection||{};
const adapters=[new VolcengineTtsProvider(()=>c.apiKey,fetch,c.baseUrl||undefined,()=>true,()=>c.voiceId),new VolcengineSeedAudioProvider(()=>c.apiKey,fetch,c.baseUrl||undefined)];
try{
 if(p.command==='catalog') console.log(JSON.stringify({result:{models:adapters.flatMap(a=>a.models()),voices:VOLCENGINE_TTS_VOICES}}));
 else {
  const a=adapters.find(a=>a.id===c.protocol);if(!a)throw Error('Unknown audio provider');
  const marker=p.output+'.submitted';
  try{await readFile(marker);throw Error('This request was already submitted; do not resubmit a possibly billed request');}catch(e){if(e.code!=='ENOENT')throw e;}
  await writeFile(marker,'submitted',{flag:'wx'});
  console.log(JSON.stringify({stage:'generating-audio'}));
  const model=a.models().find(m=>m.capabilities.operations.includes(p.input.operation));if(!model)throw Error('Operation unavailable');
  const result=await a.generate({...p.input,model:{provider:a.id,id:model.id}});
  await writeFile(p.output,result.bytes);
  console.log(JSON.stringify({result:{metadata:result.metadata,mediaType:result.mediaType}}));
 }
}catch(e){console.log(JSON.stringify({error:String(e.message||e)}));process.exitCode=1;}

}
main().catch(e=>{console.log(JSON.stringify({error:String(e.message||e)}));process.exitCode=1;});
