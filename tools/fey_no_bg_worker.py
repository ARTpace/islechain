"""Isolated FeyNoBg inference, leaving ComfyUI's Transformers installation intact."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

import torch
from PIL import Image
from safetensors.torch import load_file
from nobg.birefnet.modeling_birefnet import BiRefNet, BiRefNetConfig
from nobg import BiRefNetImageProcessor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--models', required=True)
    parser.add_argument('--refine', action='store_true')
    args = parser.parse_args()
    directory = Path(args.models)
    config = BiRefNetConfig(**json.loads((directory / 'config.json').read_text(encoding='utf-8')))
    model = BiRefNet(config)
    model.load_state_dict(load_file(str(directory / 'FeyNobg.safetensors')))
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = model.eval().to(device)
    if device == 'cuda':
        model = model.half()
    processor = BiRefNetImageProcessor.from_pretrained(str(directory), local_files_only=True)
    with Image.open(args.input) as source:
        image = source.convert('RGB')
    pixels = processor(image, return_tensors='pt')['pixel_values'].to(device=device, dtype=next(model.parameters()).dtype)
    with torch.inference_mode():
        outputs = model(pixel_values=pixels)
        alpha = processor.post_process_alpha_matting(outputs, target_sizes=[(image.height, image.width)])[0]
    processor.cutout(image, alpha.cpu(), refine=args.refine).save(args.output, 'PNG')


if __name__ == '__main__':
    main()
