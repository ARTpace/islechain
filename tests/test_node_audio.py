import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import node_catalog
from core.node_audio import audio_bytes, fixture_audio
from core.node_media import NodeMedia
from core.node_ports import NodePorts, prepare_inputs, validate_bindings
from core.comfy_workflow_builds import ComfyBuilds
from core.node_plugin_builds import NodePluginBuilds


def sample():
    return {'typeId':'audio.copy','version':'1.0.0','title':'WAV复制',
            'fields':[{'id':'text','label':'备注','component':'text','default':''}],
            'ports':{'inputs':[{'id':'sound','label':'声音','type':'audio'}],
                     'outputs':[{'id':'sound','label':'声音','type':'audio'}]},
            'execution':{'kind':'worker.python','textField':'text','media':True,'code':
                'import json,sys,shutil,wave\nr=json.load(sys.stdin)\np=r["ports"]["sound"]["path"]\n'
                'with wave.open(p,"rb") as a: assert a.getnframes()==800\n'
                'shutil.copyfile(p,"images-out/sound.wav")\n'
                'print(json.dumps({"protocolVersion":3,"outputs":{"sound":"images-out/sound.wav"}}))'}}


class AudioPortTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        for target,value in [('core.node_media.user_data_dir',str(self.root)),
                             ('core.node_media.media_paths.output_root',str(self.root/'output')),
                             ('core.node_catalog.catalog_path',self.root/'catalog.json')]:
            mock=patch(target,return_value=value);mock.start();self.addCleanup(mock.stop)
        self.media=NodeMedia('alice')
        self.raw=fixture_audio({'frames':800,'sampleRate':8000,'channels':1})

    def test_import_integrity_and_real_worker_roundtrip(self):
        handle=self.media.import_data('data:audio/wav;base64,'+base64.b64encode(self.raw).decode())
        self.assertEqual(handle['kind'],'audio');self.assertEqual(handle['frames'],800)
        with self.assertRaises(ValueError):NodeMedia('bob').read(handle['id'])
        item=node_catalog.definition(sample())
        result=node_catalog.execute(item,{},[],trusted=True,media=self.media,port_inputs={'sound':handle['id']})
        output=result['outputs']['ports']['sound']
        self.assertEqual(output['kind'],'audio');self.assertEqual(output['frames'],800)
        self.assertEqual(result['outputs']['images'],[])
        self.assertEqual(self.media.read(output['id'])[0],self.raw)

    def test_candidate_generates_audio_fixture_and_compares_real_output(self):
        service=NodePluginBuilds(ComfyBuilds(self.root/'builds',self.root,'alice','canvas','localhost:8188'))
        record=service.create(sample(),[{'portInputs':{'sound':{'frames':800,'sampleRate':8000,'channels':1}},
            'expectedPorts':{'sound':{'frames':800,'sampleRate':8000,'channels':1}}}])
        service.approve_worker(record['id'],record['revision'])
        result=service.test(record['id'])
        self.assertEqual(result['status'],'passed',result['report'])
        self.assertEqual(result['report']['results'][0]['ports']['sound']['kind'],'audio')

    def test_bad_wave_and_wrong_resource_type(self):
        for raw in [b'not wav',self.raw[:-5]]:
            with self.assertRaises(ValueError):audio_bytes(raw)
        from core.node_media import fixture_image
        image=self.media.save(fixture_image({'width':2,'height':2,'color':'#123456'}))
        ports=NodePorts.model_validate(sample()['ports'])
        with tempfile.TemporaryDirectory() as folder,self.assertRaisesRegex(ValueError,'类型与资源'):
            prepare_inputs(ports,{'sound':image['id']},self.media,folder)
        source={'type':'extension','nodeDefinition':json.dumps(sample())}
        target={'type':'extension','nodeDefinition':json.dumps({**sample(),'ports':{
            'inputs':[{'id':'picture','label':'图','type':'image'}],
            'outputs':[{'id':'picture','label':'图','type':'image'}]}})}
        with self.assertRaisesRegex(ValueError,'不兼容'):
            validate_bindings(source,target,[{'source':'sound','target':'picture'}])


if __name__=='__main__':unittest.main()
