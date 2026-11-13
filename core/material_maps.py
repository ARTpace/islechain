"""Estimated PBR maps from color, with an optional normal (no AI/network calls)."""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

CHANNELS = ('basecolor', 'normal', 'height', 'ao', 'roughness', 'metallic')


def prepare(color_path, normal_path, output, *, size=1024, normal_format='opengl', roughness=.66, metallic=0):
    try:
        import numpy as np
    except ImportError as exc:
        raise ValueError('PBR 需要 NumPy，请在启动画布的 Python 中安装 numpy') from exc
    if size not in (512, 1024) or normal_format not in ('opengl', 'directx'):
        raise ValueError('仅支持 512/1024 和 OpenGL/DirectX 法线')
    if not 0 <= roughness <= 1 or not 0 <= metallic <= 1:
        raise ValueError('粗糙度和金属度必须在 0–1 之间')
    with Image.open(color_path) as source:
        native = {'color': list(source.size)}
        # Keep aspect ratio, bounded resolution and fixed UV coordinates.
        color = source.convert('RGB')
        color.thumbnail((size, size), Image.Resampling.LANCZOS)
    if normal_path:
        with Image.open(normal_path) as raw:
            native['normal'] = list(raw.size)
            if abs(native['color'][0] / native['color'][1] - raw.width / raw.height) > .01:
                raise ValueError('颜色与法线宽高比不同，请先校准；不能拉伸对齐')
            normal = raw.convert('RGB').resize(color.size, Image.Resampling.LANCZOS)
    if min(color.size) < 8:
        raise ValueError('图片尺寸太小')
    if not normal_path:
        # ponytail: a conservative luminance-relief estimate, not geometric reconstruction.
        rgb = np.asarray(color, dtype=float)/255
        luma = rgb @ np.array([.2126, .7152, .0722])
        fy, fx = np.fft.fftfreq(color.height)[:, None], np.fft.fftfreq(color.width)[None, :]
        radius = (2*np.pi)**2*(fx*fx+fy*fy)
        band = np.exp(-.5*.8**2*radius)*(1-np.exp(-.5*(min(color.size)/12)**2*radius))
        relief = np.fft.ifft2(np.fft.fft2(luma)*band).real
        scale = np.percentile(np.abs(relief), 98)
        height = np.full_like(relief, .5) if scale < 1e-8 else .5+.15*np.clip(relief/scale, -1, 1)
        p = (np.roll(height, -1, axis=1)-np.roll(height, 1, axis=1))*.04*min(color.size)
        q = (np.roll(height, -1, axis=0)-np.roll(height, 1, axis=0))*.04*min(color.size)
        n = np.stack([-p, q, np.ones_like(height)], axis=2)
    else:
        n = np.asarray(normal, dtype=float) / 127.5 - 1
        if normal_format == 'directx':
            n[:, :, 1] *= -1
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    p, q = -n[:, :, 0] / np.maximum(n[:, :, 2], .25), n[:, :, 1] / np.maximum(n[:, :, 2], .25)
    kx = 2 * np.pi * np.fft.fftfreq(color.width)[None, :]
    ky = 2 * np.pi * np.fft.fftfreq(color.height)[:, None]
    denom = kx*kx + ky*ky
    denom[0, 0] = 1
    spectrum = (-1j*kx*np.fft.fft2(p) - 1j*ky*np.fft.fft2(q)) / denom
    spectrum[0, 0] = 0
    if normal_path:
        height = np.fft.ifft2(spectrum).real
        lo, hi = np.percentile(height, [1, 99])
        height = np.full_like(height, .5) if hi-lo < 1e-8 else np.clip(.3 + .4*(height-lo)/(hi-lo), 0, 1)
    padded = Image.fromarray(np.uint8(np.pad(height, 26, mode='wrap')*255))
    blurred = np.asarray(padded.filter(ImageFilter.GaussianBlur(6)), dtype=float)[26:-26, 26:-26]/255
    cavity = np.maximum(blurred-height, 0)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    color.save(output/'basecolor.png')
    Image.fromarray(np.uint8(np.clip(n*.5+.5, 0, 1)*255+.5)).save(output/'normal.png')
    Image.fromarray(np.uint16(height*65535+.5)).save(output/'height.png')
    for name, values in [('ao', np.clip(1-2*cavity, .65, 1)),
                         ('roughness', np.clip(roughness+.1*(1-n[:, :, 2])+.18*cavity, 0, 1)),
                         ('metallic', np.full_like(height, metallic))]:
        Image.fromarray(np.uint8(values*255+.5)).save(output/(name+'.png'))
    checks = {}
    for name in ('basecolor', 'normal'):
        with Image.open(output/(name+'.png')) as im:
            a = np.asarray(im, dtype=float)
            checks[name] = {'wrap_mae_x': float(np.abs(a[:, 0]-a[:, -1]).mean()),
                            'wrap_mae_y': float(np.abs(a[0]-a[-1]).mean())}
            ImageChops.offset(im, im.width//2, im.height//2).save(output/(name+'_offset.png'))
            tile = im.copy()
            tile.thumbnail((384, 384))
            sheet = Image.new('RGB', (tile.width*2, tile.height*2))
            for x in (0, tile.width):
                for y in (0, tile.height):
                    sheet.paste(tile, (x, y))
            sheet.save(output/(name+'_2x2.jpg'))
    return {'size': list(color.size), 'sourceSizes': native, 'normalFormat': 'opengl', 'checks': checks,
            'method': 'normal' if normal_path else 'color',
            'limitations': ('高度为法线积分估计。' if normal_path else '仅颜色推导：按亮凸暗凹估计高度与法线，色差和阴影可能被误判为几何；不恢复真实凹凸。')+
            'AO 为局部凹陷近似，粗糙度为艺术估计，金属度为指定常量。不会修复原图接缝；边缘指标不代表无缝通过。'}
