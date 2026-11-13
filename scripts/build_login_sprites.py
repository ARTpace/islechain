"""从用户授权的透明素材图导出登录场景贴图，不包含表单或第三方登录图标。"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFilter

source = Image.open(sys.argv[1]).convert('RGBA')
out = Path('static/assets/login/layers')
out.mkdir(parents=True, exist_ok=True)
regions = {
    'island-large': (58, 345, 875, 750),
    'island-small': (937, 474, 1325, 693),
    'cloud': (877, 327, 1103, 459),
    'mountains': (1475, 126, 1870, 273),
    'ripples': (1615, 641, 2123, 837),
    'waterfall': (2420, 623, 2674, 927),
    'sign': (1352, 672, 1575, 1002),
    'tree': (1617, 850, 1796, 1125),
    'bush': (1602, 1159, 1820, 1323),
    'star': (2420, 959, 2570, 1113),
    'bridge': (1018, 750, 1337, 1017),
    'windmill': (770, 670, 985, 1000),
}
for name, box in regions.items():
    source.crop(box).save(out / (name + '.webp'), lossless=True)
# 叶片单独遮罩；塔身贴图保留原结构，用旋转叶片盖住原叶片区域。
rotor = source.crop((770, 670, 985, 890))
mask = Image.new('L', rotor.size)
draw = ImageDraw.Draw(mask)
for polygon in [[(29,30),(63,3),(132,113),(96,138)], [(100,104),(183,29),(211,76),(126,143)], [(106,120),(152,183),(119,217),(76,140)], [(94,108),(119,141),(31,193),(2,161)]]:
    draw.polygon(polygon, fill=255)
draw.ellipse((77, 99, 129, 151), fill=255)
from PIL import ImageChops
tower = source.crop(regions['windmill'])
tower_mask = Image.new('L', tower.size)
tower_mask.paste(mask, (0, 0))
tower.putalpha(ImageChops.multiply(tower.getchannel('A'), ImageChops.invert(tower_mask)))
tower.save(out / 'tower.webp', lossless=True)
rotor.putalpha(ImageChops.multiply(rotor.getchannel('A'), mask))
rotor.save(out / 'rotor.webp', lossless=True)
# 仅复用旧背景的无前景海天中央带，避免伪称 AI 生图。
background = Image.open('static/assets/login/island-blue-background.webp')
background.crop((1060, 0, 1650, 1546)).resize((1600, 1000), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(2)).save(out / 'sea-sky.webp', quality=88)
print('Exported', len(list(out.glob('*.webp'))), 'login scene assets')
