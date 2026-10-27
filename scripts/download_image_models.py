"""下载并校验 Qwen-Image 2.1、MOSS-Image SFT 或 FLUX.3 Klein 必要权重，支持分块续传。"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import time
from pathlib import Path

import requests


ROOT = Path(r"H:\AI-Tools\ComfyUI_TE\ComfyUI\models")
REPO = "https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/master/"
FILES = [
    ("diffusion_models/qwen-image-2.1/qwen_image_2.1_int8_convrot.safetensors", 7256783064, "cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d"),
    ("text_encoders/qwen3vl_8b_int8_convrot.safetensors", 9350798360, "8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f"),
    ("vae/qwen_image_2.1_vae_bf16.safetensors", 675509688, "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9"),
]
CHUNK = 32 * 1024 * 1024
CACHE_NAME = "qwen-image-2.1"
REQUEST_HEADERS = {}
REMOTE_NAMES = {}


def download_part(job):
    filename, size, index, part = job
    start = index * CHUNK
    end = min(start + CHUNK, size) - 1
    if part.exists() and part.stat().st_size == end - start + 1:
        return
    for attempt in range(3):
        try:
            offset = part.stat().st_size if part.exists() else 0
            range_start = start + offset
            remote_name = filename.split("/")[0] + "/" + Path(filename).name
            remote_name = REMOTE_NAMES.get(remote_name, remote_name)
            with requests.get(REPO + remote_name, headers={**REQUEST_HEADERS, "Range": f"bytes={range_start}-{end}"}, stream=True, timeout=(20, 45)) as response:
                response.raise_for_status()
                if response.status_code != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {range_start}-{end}/"):
                    raise ValueError("服务器未返回请求的分块范围")
                with part.open("ab") as target:
                    for block in response.iter_content(1024 * 1024):
                        target.write(block)
            if part.stat().st_size != end - start + 1:
                raise ValueError("分块长度不完整")
            return
        except (requests.RequestException, ValueError):
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    global FILES, REPO, CACHE_NAME, REQUEST_HEADERS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["qwen21", "moss", "flux3"], default="qwen21")
    parser.add_argument("--flux3-mirror", action="store_true", help="使用已核对 SHA256 的 FLUX.3 公开镜像")
    args = parser.parse_args()
    if args.model == "moss":
        REPO = "https://modelscope.cn/models/Comfy-Org/MOSS-Image/resolve/master/"
        CACHE_NAME = "moss-image"
        FILES = [
            ("diffusion_models/moss-image/moss_image_sft_int8_convrot.safetensors", 5413698958, "b4d1475bc7eeffd7b809e82ea13a1fba1fb85c4e18365af3813722faa5c0fe4f"),
            ("text_encoders/qwen3.5_9b_int8_convrot.safetensors", 9748121532, "32e3787472f708fa5f83624acbf5ef23f7fc89c439e05065ea57cfe5a97f025a"),
            ("vae/flux2-vae_small.safetensors", 249521340, "d8d52ba036475f5fb07c8b435e176d3d97ebfa82f0d1a1c317f9cc1e25bd013b"),
        ]
    if args.model == "flux3":
        REPO = "https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/"
        CACHE_NAME = "flux3-klein"
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        token_path = Path(os.environ.get("HF_TOKEN_PATH", str(Path(os.environ.get("HF_HOME", str(Path.home() / ".cache/huggingface"))) / "token")))
        if not token and token_path.is_file():
            token = token_path.read_text(encoding="utf-8").strip()
        if token:
            REQUEST_HEADERS = {"Authorization": "Bearer " + token}
        if args.flux3_mirror:
            REPO = "https://huggingface.co/KoalaNation/FLUX-3-KLEIN-MODELS/resolve/main/"
            REQUEST_HEADERS = {}
            REMOTE_NAMES["diffusion_models/flux3-image-klein-int8-convrot.safetensors"] = "diffusion_models/flux3_image_klein_sd_int8_convrot.safetensors"
        access = requests.get(REPO + "README.md", headers=REQUEST_HEADERS, timeout=30)
        if access.status_code in (401, 403):
            raise RuntimeError("FLUX.3 官方仓库需要授权：请先在 Hugging Face 模型页面获取访问权限，并通过 hf auth login 配置账号。无需把 Token 发到聊天里。")
        access.raise_for_status()
        FILES = [
            ("diffusion_models/flux3/flux3-image-klein-int8-convrot.safetensors", 5827874779, "847d8933548afd93df4af2cac2498e70891bf28d9dae06d695f536992e168fe2"),
            ("text_encoders/qwen3vl_4b_int8_convrot.safetensors", 4858559240, "32de113cbf8282b02cbff0794b637b9d6676da09314a1db5a30bcea9bf4ee01c"),
            ("vae/flux3/flux2-vae.safetensors", 336211292, "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3"),
        ]
    jobs = []
    for filename, size, digest in FILES:
        destination = ROOT / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            with destination.open("rb") as source:
                actual = hashlib.file_digest(source, "sha256").hexdigest()
            if actual != digest:
                raise ValueError(f"已有文件校验失败，未覆盖：{destination}")
            print(f"已校验：{filename}", flush=True)
            continue
        parts = ROOT / ".cache" / CACHE_NAME / Path(filename).name
        parts.mkdir(parents=True, exist_ok=True)
        for index in range((size + CHUNK - 1) // CHUNK):
            jobs.append((filename, size, index, parts / f"{index:04d}.part"))
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8 if args.flux3_mirror else 64) as pool:
        futures = [pool.submit(download_part, job) for job in jobs]
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            if count % 16 == 0 or count == len(jobs):
                print(json.dumps({"完成分块": count, "总分块": len(jobs), "耗时秒": round(time.monotonic() - started)}, ensure_ascii=False), flush=True)
    for filename, size, digest in FILES:
        destination = ROOT / filename
        if destination.exists():
            continue
        parts = ROOT / ".cache" / CACHE_NAME / Path(filename).name
        temporary = destination.with_suffix(".downloading")
        actual = hashlib.sha256()
        with temporary.open("wb") as target:
            for part in sorted(parts.glob("*.part")):
                with part.open("rb") as source:
                    while block := source.read(8 * 1024 * 1024):
                        actual.update(block)
                        target.write(block)
        if temporary.stat().st_size != size or actual.hexdigest() != digest:
            raise ValueError(f"权重校验失败：{filename}")
        os.replace(temporary, destination)
        for part in parts.glob("*.part"):
            part.unlink()
        print(f"下载及 SHA256 校验完成：{filename}", flush=True)


if __name__ == "__main__":
    main()
