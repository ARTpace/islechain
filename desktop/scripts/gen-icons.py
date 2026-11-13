#!/usr/bin/env python
"""重新生成 IsleChain 桌面端图标。

    python desktop/scripts/gen-icons.py

输出到 desktop/src-tauri/icons/：
    icon.png(1024)  256x256.png  128x128@2x.png(256)  128x128.png  64x64.png  32x32.png  icon.ico
ico 内含 16/24/32/48/64/128/256 七个尺寸，由 1024 主图单独降采样，小尺寸不糊。

图形：深色圆角底 + 青色等距立方体（与 static/favicon.svg 同一视觉母题）。
只用 Pillow，无外部素材。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent          # desktop/
OUT = ROOT / "src-tauri" / "icons"

S = 1024          # 主图边长
SS = 3            # 超采样倍数（Pillow 多边形无抗锯齿，靠超采样）
W = S * SS

# 配色（与 favicon 同族青色）
CYAN_TOP = (103, 232, 249)      # #67e8f9 顶面
CYAN_RIGHT = (8, 145, 178)      # #0891b2 右面
CYAN_LEFT = (14, 116, 144)      # #0e7490 左面
CYAN_LINE = (10, 42, 51, 150)   # 面间缝隙
BG_TOP = (32, 32, 31)
BG_BOTTOM = (16, 16, 15)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def rounded_mask(size: int, radius: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new("RGB", (1, size))
    px = grad.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(int(lerp(top[i], bottom[i], t)) for i in range(3))
    return grad.resize((size, size), Image.BILINEAR)


def draw_base() -> Image.Image:
    """深色圆角底 + 顶部微光 + 细内描边。"""
    radius = W * 0.225
    base = vertical_gradient(W, BG_TOP, BG_BOTTOM).convert("RGBA")
    base.putalpha(rounded_mask(W, radius))

    # 顶部 1/3 的柔和高光，避免纯平
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-W * 0.35, -W * 0.75, W * 1.35, W * 0.42), fill=(255, 255, 255, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.09))
    glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", (W, W), 0), rounded_mask(W, radius)))
    base = Image.alpha_composite(base, glow)

    # 1px 级内描边，让深色底在浅色桌面也不飘
    edge = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle(
        (W * 0.006, W * 0.006, W - W * 0.006, W - W * 0.006),
        radius=radius * 0.985,
        outline=(255, 255, 255, 30),
        width=max(1, int(W * 0.004)),
    )
    return Image.alpha_composite(base, edge)


def cube_geometry() -> dict[str, tuple[float, float]]:
    cx, cy = W * 0.5, W * 0.515
    r = W * 0.272
    return {
        "T": (cx, cy - r),
        "TR": (cx + r * 0.866, cy - r * 0.5),
        "BR": (cx + r * 0.866, cy + r * 0.5),
        "B": (cx, cy + r),
        "BL": (cx - r * 0.866, cy + r * 0.5),
        "TL": (cx - r * 0.866, cy - r * 0.5),
        "C": (cx, cy),
    }


def draw_cube() -> Image.Image:
    g = cube_geometry()
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    gap = W * 0.008  # 面间缝隙，让三个面分得开

    faces = [
        ([g["T"], g["TR"], g["C"], g["TL"]], CYAN_TOP),      # 顶
        ([g["TR"], g["BR"], g["B"], g["C"]], CYAN_RIGHT),    # 右
        ([g["TL"], g["C"], g["B"], g["BL"]], CYAN_LEFT),     # 左
    ]
    for pts, color in faces:
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        shrunk = []
        for px, py in pts:
            dx, dy = cx - px, cy - py
            dist = max(1.0, (dx * dx + dy * dy) ** 0.5)
            k = gap / dist
            shrunk.append((px + dx * k, py + dy * k))
        d.polygon(shrunk, fill=color + (255,))

    # 外轮廓：浅青描边，小尺寸下也能勾出立方体形
    outline = [g["T"], g["TR"], g["BR"], g["B"], g["BL"], g["TL"]]
    d.line(outline + [outline[0]], fill=(164, 244, 255, 235), width=max(2, int(W * 0.011)), joint="curve")
    return layer


def draw_glow() -> Image.Image:
    g = cube_geometry()
    cx, cy = g["C"]
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (cx - W * 0.40, cy - W * 0.40, cx + W * 0.40, cy + W * 0.40),
        fill=(34, 211, 238, 96),
    )
    return glow.filter(ImageFilter.GaussianBlur(W * 0.085))


def compose_master() -> Image.Image:
    img = draw_base()
    img = Image.alpha_composite(img, draw_glow())
    img = Image.alpha_composite(img, draw_cube())
    return img.resize((S, S), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = compose_master()

    outputs = {
        "icon.png": [1024],
        "256x256.png": [256],
        "128x128@2x.png": [256],
        "128x128.png": [128],
        "64x64.png": [64],
        "32x32.png": [32],
    }
    for name, sizes in outputs.items():
        master.resize((sizes[0], sizes[0]), Image.LANCZOS).save(OUT / name)
        print(f"  {name:<16} {sizes[0]}x{sizes[0]}")

    # 注意：PIL 的 ICO 插件**不读** append_images，必须把 1024 主图交给它、
    # 由 sizes 逐档 LANCZOS 降采样；否则只会写入首帧，得到一个几百字节的坏 ico。
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(OUT / "icon.ico", format="ICO", sizes=ico_sizes, bitmap_format="png")

    with Image.open(OUT / "icon.ico") as ico:
        got = sorted(ico.info.get("sizes", []))
    print(f"  {'icon.ico':<16} {len(got)} 个尺寸 {got}")

    # 启动器 exe 的图标源：launcher/build.rs 会把它编进 PE 资源节
    launcher_icon = ROOT / "launcher" / "icon.ico"
    if launcher_icon.parent.is_dir():
        shutil.copy2(OUT / "icon.ico", launcher_icon)
        print(f"  ↳ 已同步 {launcher_icon}（需重新 cargo build 才进 exe）")

    print(f"输出目录：{OUT}")


if __name__ == "__main__":
    main()
