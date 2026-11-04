import base64
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import av
from core import node_catalog
from core.node_audio import audio_bytes
from core.node_av import convert
from core.node_video import fixture_video
from core.node_media import NodeMedia
from core.comfy_workflow_builds import ComfyBuilds
from core.node_plugin_builds import NodePluginBuilds


def encoded_audio(codec, format):
    data=io.BytesIO()
    with av.open(data,'w',format=format) as container:
        stream=container.add_stream(codec,rate=48000)
        stream.layout='mono'
        frame=av.AudioFrame(format='s16',layout='mono',samples=4800)
        frame.sample_rate=48000;frame.planes[0].update(b'\x00'*9600)
        for packet in stream.encode(frame):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    return data.getvalue()


def sample():
    return {'typeId':'video.copy','version':'1.0.0','title':'视频复制',
      'fields':[{'id':'text','label':'备注','component':'text','default':''}],
      'ports':{'inputs':[{'id':'clip','label':'视频','type':'video'}],
               'outputs':[{'id':'clip','label':'视频','type':'video'}]},
      'execution':{'kind':'worker.python','media':True,'textField':'text','code':
        'import sys,json,shutil\nr=json.load(sys.stdin)\nshutil.copyfile(r["ports"]["clip"]["path"],"images-out/clip.mp4")\nprint(json.dumps({"protocolVersion":3,"outputs":{"clip":"images-out/clip.mp4"}}))'}}


class AVPortTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        for name,value in [('core.node_media.user_data_dir',str(self.root)),('core.node_media.media_paths.output_root',str(self.root/'output')),('core.node_catalog.catalog_path',self.root/'catalog.json')]:
            mock=patch(name,return_value=value);mock.start();self.addCleanup(mock.stop)
        self.media=NodeMedia('alice')

    def test_actual_mp3_and_aac_conversion(self):
        for codec,format in [('libmp3lame','mp3'),('aac','adts')]:
            with self.subTest(codec=codec):
                raw=encoded_audio(codec,format)
                normalized,metadata=audio_bytes(raw)
                self.assertEqual(normalized[:4],b'RIFF');self.assertEqual(metadata['sampleRate'],48000)
                self.assertGreater(metadata['frames'],0)
                handle=self.media.save(raw,audio=True)
                self.assertEqual(handle['kind'],'audio');self.assertTrue(handle['url'].endswith('.wav'))

    def test_short_video_preview_without_external_ffmpeg(self):
        from PIL import Image
        raw = fixture_video({'width':64,'height':48,'frames':1})
        preview, metadata = convert(raw, 'preview')
        with Image.open(io.BytesIO(preview)) as image:
            self.assertEqual(image.size, (64,48))
            self.assertEqual(image.format, 'PNG')
        self.assertEqual(metadata, {'width':64,'height':48})

    def test_video_worker_and_candidate(self):
        raw=fixture_video({'width':64,'height':48,'frames':4})
        handle=self.media.import_data('data:video/mp4;base64,'+base64.b64encode(raw).decode())
        self.assertEqual((handle['width'],handle['height'],handle['frames']),(64,48,4))
        item=node_catalog.definition(sample())
        result=node_catalog.execute(item,{},[],trusted=True,media=self.media,port_inputs={'clip':handle['id']})
        ref=result['outputs']['ports']['clip']
        self.assertEqual(ref['kind'],'video');self.assertEqual(ref['frames'],4)
        self.assertEqual(result['outputs']['images'],[])
        service=NodePluginBuilds(ComfyBuilds(self.root/'builds',self.root,'alice','canvas','localhost:8188'))
        record=service.create(item,[{'portInputs':{'clip':{'width':64,'height':48,'frames':4}},'expectedPorts':{'clip':{'width':64,'height':48,'frames':4}}}])
        service.approve_worker(record['id'],record['revision'])
        result=service.test(record['id'])
        self.assertEqual(result['status'],'passed',result['report'])

    def test_invalid_media_and_limits(self):
        for kind in ['audio','video']:
            with self.subTest(kind=kind),self.assertRaises(ValueError):convert(b'invalid',kind)
        with self.assertRaises(ValueError):convert(b'x'*(8*1024**2+1),'video')


if __name__=='__main__':unittest.main()
