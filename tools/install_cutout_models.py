"""Install the requested cutout weights into an existing ComfyUI installation."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import shutil
from pathlib import Path
import urllib.request

FILES = [
    ('1038lab/BiRefNet', 'RMBG/BiRefNet', name) for name in (
        'birefnet.py', 'BiRefNet_config.py', 'config.json',
        'BiRefNet-general.safetensors', 'Lucida.safetensors',
        'BiRefNet-HR-matting.safetensors', 'BiRefNet_toonout.safetensors')
] + [
    ('1038lab/FeyNobg', 'RMBG/FeyNoBg', name) for name in (
        'config.json', 'preprocessor_config.json', 'FeyNobg.safetensors')
] + [('1038lab/sam3', 'sam3', 'sam3.1_multiplex_fp16.safetensors')]


def install(models_dir):
    metadata = {}
    for repo, _, _ in FILES:
        if repo not in metadata:
            with urllib.request.urlopen('https://huggingface.co/api/models/' + repo + '?blobs=true', timeout=30) as response:
                metadata[repo] = {item['rfilename']: item for item in json.load(response)['siblings']}
    def download(item):
        repo, folder, filename = item
        target = models_dir / folder / filename
        info = metadata[repo][filename]
        size = info['size']
        if target.is_file() and (not filename.endswith('.safetensors') or target.stat().st_size == size):
            print('Exists: ' + str(target), flush=True)
            return
        print('Downloading: ' + filename, flush=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + '.partial')
        offset = partial.stat().st_size if partial.exists() else 0
        ranges = [(start, min(start + 32 * 1024 * 1024, size) - 1) for start in range(offset, size, 32 * 1024 * 1024)]
        parts = target.with_name(target.name + '.parts')
        parts.mkdir(exist_ok=True)
        def download_range(bounds):
            start, end = bounds
            part = parts / f'{start}-{end}'
            if not part.exists() or part.stat().st_size != end - start + 1:
                url = f'https://huggingface.co/{repo}/resolve/main/{filename}?art_canvas_range={start}-{end}'
                request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
                with urllib.request.urlopen(request, timeout=45) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                        raise RuntimeError('Server did not honor resume offset: ' + filename)
                    with part.open('wb') as output:
                        while chunk := response.read(1024 * 1024):
                            output.write(chunk)
                if part.stat().st_size != end - start + 1:
                    raise RuntimeError('Chunk size mismatch: ' + filename)
            return part
        with ThreadPoolExecutor(max_workers=4) as chunks:
            for part in chunks.map(download_range, ranges):
                with partial.open('ab') as output, part.open('rb') as source:
                    shutil.copyfileobj(source, output)
                part.unlink()
                print(f'{filename}: {partial.stat().st_size / size:.0%}', flush=True)
        if partial.stat().st_size != size:
            raise RuntimeError('Download size mismatch: ' + filename)
        digest = info.get('lfs', {}).get('sha256')
        if digest:
            with partial.open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != digest:
                    raise RuntimeError('Download checksum mismatch: ' + filename)
        partial.replace(target)
        print('Installed: ' + filename, flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, FILES))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--comfyui', required=True, type=Path)
    args = parser.parse_args()
    if not (args.comfyui / 'main.py').is_file():
        parser.error('--comfyui must point to the ComfyUI directory containing main.py')
    runtime = args.comfyui.parent / 'cutout-fey-runtime'
    runtime.mkdir(exist_ok=True)
    shutil.copyfile(Path(__file__).with_name('fey_no_bg_worker.py'), runtime / 'run_fey.py')
    shutil.copytree(Path(__file__).parent / 'comfyui' / 'art-canvas-fey',
                    args.comfyui / 'custom_nodes' / 'art-canvas-fey', dirs_exist_ok=True)
    install(args.comfyui / 'models')
