"""下载本地绘图模型，完成后自动验证文生图和图生图，结果写入部署日志目录。"""
import argparse
import copy
import json
import subprocess
import sys
import time
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
COMFY = "http://127.0.0.1:8188"


def generate(graph):
    response = requests.post(COMFY + "/prompt", json={"prompt": graph}, timeout=30)
    if not response.ok:
        raise RuntimeError(f"工作流提交失败：{response.status_code} {response.text}")
    response.raise_for_status()
    prompt_id = response.json()["prompt_id"]
    deadline = time.monotonic() + 3600
    while time.monotonic() < deadline:
        response = requests.get(COMFY + "/history/" + prompt_id, timeout=30)
        response.raise_for_status()
        entry = response.json().get(prompt_id)
        if entry:
            if entry.get("status", {}).get("status_str") == "error":
                raise RuntimeError(json.dumps(entry["status"], ensure_ascii=False))
            images = [image for output in entry.get("outputs", {}).values() for image in output.get("images", [])]
            if images:
                return images[0]
            raise RuntimeError("执行完成但未返回图片")
        time.sleep(3)
    raise TimeoutError(f"出图等待超时：{prompt_id}；任务未中断，可在 ComfyUI 查看")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["qwen21", "moss", "flux3"], required=True)
    parser.add_argument("--flux3-mirror", action="store_true")
    args = parser.parse_args()
    model = args.model
    log_dir = ROOT / "logs" / "image-model-deployment"
    log_dir.mkdir(parents=True, exist_ok=True)
    status_file = log_dir / f"{model}.json"
    status = {"model": model}

    def save(state, **extra):
        status.update(state=state, **extra)
        status_file.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(status, ensure_ascii=False), flush=True)

    try:
        save("downloading")
        download_args = [sys.executable, "-u", str(ROOT / "scripts/download_image_models.py"), "--model", model]
        if args.flux3_mirror:
            download_args.append("--flux3-mirror")
        subprocess.run(download_args, check=True)
        save("testing")
        name = {"qwen21": "qwen-image-2.1", "moss": "moss-image-sft", "flux3": "flux3-klein"}[model]
        graph = json.loads((ROOT / f"workflows/text2image/{name}.json").read_text(encoding="utf-8"))
        graph["144"]["inputs"].update(width=512, height=512, batch_size=1)
        graph["22"]["inputs"]["seed"] = 123456
        first = generate(graph)
        save("testing", text_to_image=first)
        response = requests.get(COMFY + "/view", params=first, timeout=30)
        response.raise_for_status()
        upload = requests.post(COMFY + "/upload/image", files={"image": (f"{model}-deployment-test.png", response.content, "image/png")}, data={"overwrite": "true"}, timeout=30)
        upload.raise_for_status()
        reference = upload.json()
        graph = copy.deepcopy(json.loads((ROOT / f"workflows/image-edit/{name}.json").read_text(encoding="utf-8")))
        graph["14"]["inputs"]["image"] = "/".join(filter(None, [reference.get("subfolder"), reference["name"]]))
        if model == "flux3":
            graph["144"]["inputs"].update(width=512, height=512, batch_size=1)
            graph["6"]["inputs"]["resolution.megapixels"] = 0.25
        else:
            graph["11"]["inputs"]["largest_size"] = 512
        graph["22"]["inputs"]["seed"] = 123457
        graph["23"]["inputs"]["text"] = "A blue ceramic teapot on a wooden table, soft daylight, detailed product photography."
        second = generate(graph)
        save("ready", image_to_image=second)
    except Exception as error:
        save("error", error=str(error))
        raise


if __name__ == "__main__":
    main()
