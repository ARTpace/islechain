"""Run the SDK from the assembled app with only its own embedded Python on disk."""

import base64
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / 'desktop/src-tauri/sidecar-server/python/python.exe'
APP = ROOT / 'desktop/src-tauri/sidecar-server/app'


class DesktopPluginTests(unittest.TestCase):
    @unittest.skipUnless(PYTHON.exists(), 'build the desktop embedded Python first')
    def test_packaged_media_credentials_and_restart_without_source_or_path(self):
        code = '''
import json,sys,os
from pathlib import Path
from core import node_catalog
from core.node_media import NodeMedia
from core.node_video import fixture_video
from core.node_av import convert
from core.node_audio import fixture_audio
from core.node_credentials import protect,unprotect
from core.node_plugin_package import export_package,import_package
assert Path(node_catalog.__file__).resolve().is_relative_to(Path(sys.argv[1]).resolve())
root=Path(os.environ['ART_CANVAS_HOME'])
media=NodeMedia('desktop-media')
if not (root/'state.json').exists():
 item={'typeId':'desktop.media','version':'1.0.0','title':'Media',
  'fields':[{'id':'text','label':'Text','component':'text','default':''}],
  'ports':{'inputs':[{'id':'clip','label':'Clip','type':'video'},{'id':'sound','label':'Sound','type':'audio'}],
   'outputs':[{'id':'clip','label':'Clip','type':'video'},{'id':'sound','label':'Sound','type':'audio'}]},
  'execution':{'kind':'worker.python','textField':'text','media':True,'code':
   'import json,sys,shutil;r=json.load(sys.stdin);shutil.copyfile(r["ports"]["clip"]["path"],"images-out/clip.mp4");shutil.copyfile(r["ports"]["sound"]["path"],"images-out/sound.wav");print(json.dumps({"protocolVersion":3,"outputs":{"clip":"images-out/clip.mp4","sound":"images-out/sound.wav"}}))'}}
 item=node_catalog.install(item,trusted=True)
 video_bytes=fixture_video({'width':32,'height':32,'frames':2})
 preview,metadata=convert(video_bytes,'preview')
 assert preview[:4]==bytes([137,80,78,71]) and metadata['width']==32
 clip=media.save(video_bytes,video=True)
 sound=media.save(fixture_audio({'frames':800}),audio=True)
 restored,_=import_package(export_package(item,[]));assert restored==item
 state={'hash':node_catalog.digest(item),'clip':clip['id'],'sound':sound['id'],'secret':protect('desktop-only-secret','desktop-media:version')}
 (root/'state.json').write_text(json.dumps(state))
else:
 state=json.loads((root/'state.json').read_text())
 item=node_catalog.read_catalog()['definitions'][0]
 assert node_catalog.digest(item)==state['hash']
 assert unprotect(state['secret'],'desktop-media:version')=='desktop-only-secret'
assert 'desktop-only-secret' not in (root/'state.json').read_text()
result=node_catalog.execute(item,{},[],media=media,port_inputs={'clip':state['clip'],'sound':state['sound']})
assert result['outputs']['ports']['clip']['frames']==2
assert result['outputs']['ports']['sound']['frames']==800
assert result['outputs']['images']==[]
print('DESKTOP_MEDIA_RESTART_OK')
'''
        with tempfile.TemporaryDirectory() as directory:
            env = {key: value for key, value in os.environ.items() if key.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')}
            env.update(ART_CANVAS_HOME=directory, PATH='')
            for _ in range(2):
                result = subprocess.run([str(PYTHON), '-I', '-X', 'utf8', '-c', code, str(APP)],
                    cwd=directory, env=env, capture_output=True, text=True, encoding='utf-8', timeout=45)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('DESKTOP_MEDIA_RESTART_OK', result.stdout)

    @unittest.skipUnless(PYTHON.exists(), 'build the desktop embedded Python first')
    def test_packaged_sdk_worker_and_package_without_global_python(self):
        code = '''
import json,sys
from pathlib import Path
from core import node_catalog
from core.node_plugin_package import export_package,import_package
assert Path(node_catalog.__file__).resolve().is_relative_to(Path(sys.argv[1]).resolve())
item={"typeId":"desktop.worker","version":"1.0.0","title":"Desktop worker",
 "fields":[{"id":"text","label":"Text","component":"textarea","default":"desktop"}],
 "execution":{"kind":"worker.python","textField":"text","code":
 'import json,sys,os; r=json.load(sys.stdin); assert "ART_DESKTOP_TEST_SECRET" not in os.environ; print(json.dumps({"protocolVersion":1,"outputs":{"text":r["params"]["text"].upper()}}))'}}
item=node_catalog.install(item,trusted=True)
assert node_catalog.execute(item,{},[])["outputs"]["text"]=="DESKTOP"
restored,tests=import_package(export_package(item,[{"expectedText":"DESKTOP"}]))
assert restored==item and tests[0]["expectedText"]=="DESKTOP"
assert "isolated.worker" in node_catalog.sdk()["uiModes"]
from core.node_media import NodeMedia,fixture_image
media=NodeMedia('desktop-test')
source=media.save(fixture_image({'width':3,'height':2,'color':'#123456'}))
item['typeId']='desktop.image'
item['execution'].update(media=True,code='import json,sys;from PIL import Image;r=json.load(sys.stdin);im=Image.open(r["images"][0]["path"]);im.resize((6,4)).save("images-out/result.png");print(json.dumps({"protocolVersion":2,"outputs":{"text":"image","images":["images-out/result.png"]}}))')
item=node_catalog.install(item,trusted=True)
result=node_catalog.execute(item,{},[],media=media,media_inputs=[source['id']])
assert result['outputs']['images'][0]['width']==6
assert media.read(result['outputs']['images'][0]['id'])[1]['height']==4
import base64,hashlib
from unittest.mock import patch
from core.node_python_env import PythonEnvironment
raw=base64.b64decode(sys.argv[2])
package={'name':'demo-pkg','version':'1.0.0','filename':'demo_pkg-1.0.0-py3-none-any.whl',
 'url':'https://files.pythonhosted.org/demo.whl','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
item['typeId']='desktop.dependency'
item['execution'].pop('media',None)
item['execution'].update(dependencies=[{'name':'demo-pkg','version':'1.0.0'}],
 code='import json,demo_pkg,importlib.util;assert importlib.util.find_spec("pydantic") is None;print(json.dumps({"protocolVersion":1,"outputs":{"text":demo_pkg.VALUE}}))')
def fetch(url,limit,cancel,deadline,destination=None):
 assert len(raw)<=limit
 destination.write(raw)
 return b'',len(raw),hashlib.sha256(raw).hexdigest()
with patch('core.node_python_env.inspect_package',return_value={'package':package}),patch('core.node_python_env._fetch',side_effect=fetch):
 assert PythonEnvironment('desktop-test',item).ensure()['status']=='ready'
item=node_catalog.install(item,trusted=True)
assert node_catalog.execute(item,{},[],worker_owner='desktop-test')['outputs']['text']=='1.0.0'
print(json.dumps({"status":"passed","runtime":sys.executable}))
'''
        with tempfile.TemporaryDirectory() as directory:
            env = {key: value for key, value in os.environ.items() if key.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')}
            env.update(ART_CANVAS_HOME=directory, ART_DESKTOP_TEST_SECRET='not-in-worker', PATH='')
            from test_node_python_env import wheel
            result = subprocess.run([str(PYTHON), '-I', '-X', 'utf8', '-c', code, str(APP), base64.b64encode(wheel()).decode()],
                                    cwd=directory, env=env, capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(receipt['status'], 'passed')
        self.assertEqual(Path(receipt['runtime']).resolve(), PYTHON.resolve())
