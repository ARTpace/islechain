"""FeyNoBg adapter using a separate Transformers runtime."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
import torch
import folder_paths
import comfy.model_management
from comfy_api.latest import ComfyExtension, io


class ArtCanvasFeyNoBg(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='ArtCanvasFeyNoBg', display_name='FeyNoBg (Art Canvas · isolated)', category='Art Canvas/抠图',
                         inputs=[io.Image.Input('image'),
                                 io.Boolean.Input('refine_foreground', default=True, optional=True),
                                 io.Combo.Input('background', options=['Alpha', 'Color'], default='Alpha', optional=True),
                                 io.String.Input('background_color', default='#222222', optional=True)],
                         outputs=[io.Image.Output(), io.Mask.Output(), io.Image.Output()])

    @classmethod
    def execute(cls, image, refine_foreground=True, background='Alpha', background_color='#222222'):
        worker = Path(sys.executable).parent.parent / 'cutout-fey-runtime' / 'run_fey.py'
        if not worker.is_file():
            raise RuntimeError('FeyNoBg isolated runtime is missing; run the Art Canvas cutout installer')
        comfy.model_management.unload_all_models()
        images, masks = [], []
        with tempfile.TemporaryDirectory(prefix='art-canvas-fey-') as directory:
            for index, tensor in enumerate(image):
                source = Path(directory) / f'{index}.png'
                output = Path(directory) / f'{index}-cutout.png'
                Image.fromarray(np.clip(tensor.cpu().numpy() * 255, 0, 255).astype(np.uint8)).convert('RGB').save(source)
                command = [sys.executable, str(worker), '--input', str(source), '--output', str(output),
                           '--models', str(Path(folder_paths.models_dir) / 'RMBG' / 'FeyNoBg')]
                if refine_foreground:
                    command.append('--refine')
                process = subprocess.run(command, capture_output=True, timeout=900,
                                         creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                if process.returncode:
                    raise RuntimeError('FeyNoBg failed: ' + process.stderr.decode('utf-8', errors='replace')[-1600:])
                with Image.open(output) as result:
                    rgba = result.convert('RGBA')
                    mask = np.array(rgba.getchannel('A'), dtype=np.float32) / 255
                    if background == 'Color':
                        base = Image.new('RGBA', rgba.size, background_color)
                        rgba = Image.alpha_composite(base, rgba).convert('RGB')
                    images.append(torch.from_numpy(np.array(rgba, dtype=np.float32) / 255))
                    masks.append(torch.from_numpy(mask))
        mask = torch.stack(masks)
        return io.NodeOutput(torch.stack(images), mask, mask.unsqueeze(-1).repeat(1, 1, 1, 3))


class FeyExtension(ComfyExtension):
    async def get_node_list(self):
        return [ArtCanvasFeyNoBg]


async def comfy_entrypoint():
    return FeyExtension()
