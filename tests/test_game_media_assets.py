import base64
import io
import json
import struct
import subprocess
import sys
import wave
import zipfile
import os

import pytest
from PIL import Image

from test_game_workspace import env, call
from test_game_web_builds import install
from core.game_media_assets import inspect_media, asset_context
from core.game_web_builds import WebBuilds


def wav_bytes():
    stream=io.BytesIO()
    with wave.open(stream,'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(8000);audio.writeframes(b'\0\0'*800)
    return stream.getvalue()


def glb_bytes(external=False):
    binary=struct.pack('<9f',-1,0,0,1,0,0,0,2,0)
    document=dict(asset={'version':'2.0'},scene=0,scenes=[{'nodes':[0]}],nodes=[{'mesh':0}],
        meshes=[{'primitives':[{'attributes':{'POSITION':0}}]}],buffers=[{'byteLength':len(binary)}],
        bufferViews=[{'buffer':0,'byteOffset':0,'byteLength':len(binary)}],
        accessors=[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-1,0,0],'max':[1,2,0]}])
    if external: document['images']=[{'uri':'https://external.invalid/texture.png'}]
    raw=json.dumps(document).encode();raw+=b' '*((-len(raw))%4)
    return struct.pack('<4sII',b'glTF',2,12+8+len(raw)+8+len(binary))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary


def upload(env, name, raw, asset_id=None, owner='alice'):
    repository=env[1].repository
    project=repository.read('p1','alice')
    body=dict(baseRevision=project.revision,filename=name,purpose='测试运行素材',contentBase64=base64.b64encode(raw).decode())
    if asset_id:body['assetId']=asset_id
    return call(env,'POST','/media-assets',body,owner)


def test_import_ownership_and_metadata_only_context(env):
    install(env)
    assert upload(env,'music.wav',wav_bytes(),owner='bob').status_code==403
    result=upload(env,'music.wav',wav_bytes())
    assert result.status_code==200,result.text
    project=env[1].repository.read('p1','alice');asset=project.mediaAssets[0]
    assert asset.kind=='audio' and asset.metadata['duration']==.1
    context=asset_context(project)
    assert context[0]['id']==asset.id and 'contentBase64' not in json.dumps(context)
    assert call(env,'GET',f'/media-assets/{asset.id}/content',owner='bob').status_code==403
    assert call(env,'GET',f'/media-assets/{asset.id}/content').content==wav_bytes()


def test_frozen_resource_replacement_disable_and_zip(env, tmp_path):
    state=install(env);first=upload(env,'music.wav',wav_bytes()).json()['project']['mediaAssets'][0]
    built=call(env,'POST','/builds',{'baseRevision':state['revision']})
    assert built.status_code==200,built.text
    record=built.json();name=next(iter(record['resources']))
    workspace=env[1]
    project=workspace.repository.read('p1','alice');builds=WebBuilds(workspace.repository,project)
    page=builds.artifact(record['buildId'])[1]
    assert name.encode() in page and b'data:audio/wav;base64' not in page
    assert b'data:audio/wav;base64' in builds.preview(record['buildId'])
    with zipfile.ZipFile(io.BytesIO(builds.export(record['buildId']))) as archive:
        assert archive.read(name)==wav_bytes()
    exported=workspace.repository.export(project, True)
    with zipfile.ZipFile(workspace.repository.directory(project.id)/('exports/'+exported['exportId']+'.zip')) as archive:
        assert archive.read(name)==wav_bytes()
    replacement=upload(env,'other.wav',wav_bytes()+b'new',first['id'])
    assert replacement.status_code==200,replacement.text
    changed=replacement.json()['project']['mediaAssets'][0]
    assert changed['id']==first['id'] and changed['revision']==2 and changed['contentHash']!=first['contentHash']
    assert builds.resources(record)[name][0]==wav_bytes(),'历史构建独立于当前素材'
    response=call(env,'PATCH','/media-assets/'+first['id'],dict(baseRevision=replacement.json()['project']['revision'],enabled=False,purpose='保留但停用'))
    assert response.status_code==200
    project=workspace.repository.read('p1','alice');builds=WebBuilds(workspace.repository,project)
    assert not builds.build(state['revision'])['resources']
    workspace.path(f"builds/{record['buildId']}/"+name).write_bytes(b'broken')
    with pytest.raises(Exception,match='409'):
        builds.export(record['buildId'])


def test_glb_template_and_source_package_rebuild(env,tmp_path):
    state=install(env)
    result=upload(env,'hero.glb',glb_bytes());assert result.status_code==200,result.text
    installed=call(env,'POST','/template-3d',dict(baseRevision=state['revision']))
    assert installed.status_code==200,installed.text
    built=call(env,'POST','/builds',dict(baseRevision=installed.json()['revision']))
    assert built.status_code==200,built.text
    record=built.json();project=env[1].repository.read('p1','alice');builds=WebBuilds(env[1].repository,project)
    page=builds.preview(record['buildId'])
    assert b'data:model/gltf-binary;base64,' in page and b'GameGLTFLoader' in page
    assert project.mediaAssets[0].metadata['triangles']==1
    from core.game_workspace import Workspace
    archive=Workspace(env[1].repository,project).export_source()
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        source.extractall(tmp_path/'source')
    checked=subprocess.run([sys.executable,'build.py'],cwd=tmp_path/'source',capture_output=True,timeout=20)
    assert checked.returncode==0,checked.stderr.decode(errors='replace')
    assert list((tmp_path/'source/dist/resources').glob('*.glb'))


@pytest.mark.parametrize('name,raw',[('bad.glb',b'bad'),('bad.glb',glb_bytes(True)),('fake.mp3',b'not audio'),('bad.png',b'bad'),('../script.js',b'alert(1)')])
def test_rejects_unsupported_or_external_assets(env,name,raw):
    response=upload(env,name,raw)
    assert response.status_code==422,response.text
    assert not env[1].repository.read('p1','alice').mediaAssets


def test_image_import_and_stale_revision(env):
    raw=io.BytesIO();Image.new('RGBA',(8,8),(20,100,30,255)).save(raw,format='PNG')
    imported=upload(env,'sprite.png',raw.getvalue())
    assert imported.status_code==200,imported.text
    asset=imported.json()['project']['mediaAssets'][0]
    stale=call(env,'PATCH','/media-assets/'+asset['id'],dict(baseRevision=1,enabled=False,purpose='stale'))
    assert stale.status_code==409
    assert inspect_media('sprite.png',raw.getvalue())[0]=='image'


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST')!='1',reason='显式开启真实 headed 浏览器')
def test_real_browser_loads_image_audio_and_glb(env):
    import asyncio
    from core.game_candidate_runtime import run_regression
    from core.game_projects import digest
    from core.game_workspace import Workspace
    state=install(env)
    png=io.BytesIO();Image.new('RGB',(8,8),(40,160,80)).save(png,format='PNG')
    image=upload(env,'sprite.png',png.getvalue()).json()['project']['mediaAssets'][-1]['id']
    audio=upload(env,'music.wav',wav_bytes()).json()['project']['mediaAssets'][-1]['id']
    model=upload(env,'hero.glb',glb_bytes()).json()['project']['mediaAssets'][-1]['id']
    script='''(async()=>{const button=document.createElement('button');button.id='asset-play';button.textContent='play';button.disabled=true;document.querySelector('main').append(button);
    const image=await GameAssets.loadImage(IMAGE),gltf=await GameAssets.loadModel(MODEL);
    const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')});const scene=new THREE.Scene();scene.add(gltf.scene);const camera=new THREE.PerspectiveCamera();camera.position.z=4;renderer.render(scene,camera);
    const audio=GameAssets.createAudio(AUDIO);await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=reject;audio.load();});
    button.disabled=false;button.onclick=()=>audio.play().then(()=>{document.getElementById('hud').textContent=(image.width===8 && gltf.scene.children.length>0 && audio.duration>0)?'image audio model ready':'invalid assets';});
    })().catch(error=>{document.getElementById('hud').textContent=error.message;console.error(error);});'''.replace('IMAGE',json.dumps(image)).replace('AUDIO',json.dumps(audio)).replace('MODEL',json.dumps(model))
    project=env[1].repository.read('p1','alice');workspace=Workspace(env[1].repository,project)
    state=workspace.patch(state['revision'],[dict(path='game.js',baseHash=digest(workspace.read('game.js')['content'].encode()),content=script)],True)
    files=workspace.files(state['active'])
    case=dict(name='图片音频模型真实加载',actions=[dict(type='click',selector='#asset-play')],assertions=[dict(kind='contains',selector='#hud',text='image audio model ready')])
    report=asyncio.run(run_regression(workspace,project,files,{'regressionCases':[case]}))
    assert report['passed'],report
    state=WebBuilds(env[1].repository,project).install_3d_template(state['revision'])
    files=workspace.files(state['active'])
    case=dict(name='默认3D场景加载',actions=[],assertions=[dict(kind='contains',selector='#hud',text='3D 模型已加载')])
    report=asyncio.run(run_regression(workspace,project,files,{'regressionCases':[case]}))
    assert report['passed'],report

def test_intake_deduplicates_and_canvas_update_keeps_asset_id(env):
    install(env)
    first=upload(env,'bgm.wav',wav_bytes()).json()['project']
    asset=first['mediaAssets'][0]
    duplicate=upload(env,'copy.wav',wav_bytes())
    assert duplicate.status_code==200
    assert duplicate.json()['reusedAssetId']==asset['id']
    assert len(duplicate.json()['project']['mediaAssets'])==1
    assert duplicate.json()['project']['revision']==first['revision']
    project=env[1].repository.read('p1','alice')
    source='canvas:canvas1:node1:0'
    def send(raw):
        current=env[1].repository.read('p1','alice')
        return call(env,'POST','/media-assets',dict(baseRevision=current.revision,filename='player.png',purpose='player',sourceKey=source,contentBase64=base64.b64encode(raw).decode()))
    def picture(color):
        output=io.BytesIO();Image.new('RGBA',(16,16),color).save(output,format='PNG');return output.getvalue()
    added=send(picture('red'))
    assert added.status_code==200,added.text
    before=added.json()['project']['mediaAssets'][-1]
    repeated=send(picture('red'))
    assert repeated.json()['reusedAssetId']==before['id']
    assert repeated.json()['project']['revision']==added.json()['project']['revision']
    changed=send(picture('blue'))
    assert changed.status_code==200,changed.text
    after=changed.json()['project']['mediaAssets'][-1]
    assert before['id']==after['id'] and after['revision']==before['revision']+1
    assert after['contentHash']!=before['contentHash'] and len(changed.json()['project']['mediaAssets'])==2
    assert after['metadata']['sourceKey']==source
    from core.game_workspace import Workspace
    from core.game_native_runtime import project_context
    current=Workspace(env[1].repository,env[1].repository.read('p1','alice'))
    context=project_context(current)
    manifest=json.loads(context['public/__art_canvas_assets/manifest.json'])
    assert after['id'] in manifest
    assert context['public/'+manifest[after['id']]['path']]==picture('blue')
