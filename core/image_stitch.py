"""多图横向拼接：把「同一物体的多个视角」合成一张参考横图。

只做像素拼接，不碰存储 —— 落盘由调用方走 media_paths，保持单一职责。
典型用法：三视图（正视 / 侧视 / 背视）出 3 张单图后拼成一条横图，
下游工具（3D 重建、贴图参考）直接吃一张图即可。
"""
from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from PIL import Image

# 单边像素上限：3 张 4K 拼起来会到 1.2 亿像素，内存容易炸，超出就等比缩到这条线
MAX_PIXELS = 64_000_000

WHITE = (255, 255, 255)


def parse_color(value: str, default: Optional[Tuple[int, int, int]] = None):
    """'#ffffff' / 'fff' / 'white' → (255,255,255)；空值返回 default。"""
    text = (value or '').strip().lower()
    if not text:
        return default
    if text in ('white', '白', '白色'):
        return WHITE
    if text in ('black', '黑', '黑色'):
        return (0, 0, 0)
    if text.startswith('#'):
        text = text[1:]
    if len(text) == 3:
        text = ''.join(c * 2 for c in text)
    if len(text) == 6:
        try:
            return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
        except ValueError:
            return default
    return default


def _target_height(images: Sequence[Image.Image]) -> int:
    """取最高的一张为基准高度；整体像素超限时等比收缩。"""
    height = max(im.height for im in images)
    total_w = sum(round(im.width * height / im.height) for im in images)
    if total_w * height > MAX_PIXELS:
        height = max(1, int(height * (MAX_PIXELS / (total_w * height)) ** 0.5))
    return height


def stitch_horizontal(
    images: Sequence[Image.Image],
    gap: int = 0,
    flatten: Optional[Tuple[int, int, int]] = None,
) -> Image.Image:
    """横向拼成一张。

    - 高度不一致时以最高那张为基准，其余等比缩放（同一工作流出的图尺寸一致，
      行为退化成「直接排排站」，不会触发重采样）
    - `gap` 是相邻图之间的像素间距
    - `flatten` 给 RGB 元组时把结果平铺到该底色，输出 RGB 去掉透明度 ——
      3D 重建 / 参考图这类下游不吃 alpha，透明会被当成黑色，白底最稳
    - 不给 `flatten` 且原图确实带透明时保留 RGBA；全不透明则转 RGB（体积小一半）
    """
    if not images:
        raise ValueError('没有可拼接的图片')

    height = _target_height(images)
    scaled = []
    for im in images:
        if im.height != height:
            width = max(1, round(im.width * height / im.height))
            im = im.resize((width, height), Image.LANCZOS)
        scaled.append(im.convert('RGBA'))

    total_w = sum(im.width for im in scaled) + gap * (len(scaled) - 1)
    fill = (255, 255, 255, 0) if flatten else (0, 0, 0, 0)
    canvas = Image.new('RGBA', (max(1, total_w), height), fill)

    x = 0
    for im in scaled:
        canvas.alpha_composite(im, (x, 0))
        x += im.width + gap

    if flatten:
        out = Image.new('RGB', canvas.size, tuple(flatten))
        out.paste(canvas, mask=canvas.split()[3])
        return out
    # 原图是 RGBA 但实际全不透明（ComfyUI 出图常见）时转回 RGB
    if canvas.getextrema()[3] == (255, 255):
        return canvas.convert('RGB')
    return canvas


def stitch_files(
    paths: Sequence[str],
    gap: int = 0,
    flatten: Optional[Tuple[int, int, int]] = None,
) -> Image.Image:
    """按路径拼接；全部读进内存后立即关句柄，避免 Windows 上文件被占用。"""
    loaded: List[Image.Image] = []
    try:
        for path in paths:
            im = Image.open(path)
            im.load()
            loaded.append(im)
        return stitch_horizontal(loaded, gap=gap, flatten=flatten)
    finally:
        for im in loaded:
            im.close()
