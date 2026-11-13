# 色卡低模师 · 作业手册

把扁平卡通设计图还原成 lowpoly 模型：一张色卡贴图承载所有颜色，全模型单材质，每个面的 UV 收成色卡上对应颜色槽的中心点。

## 取舍原则（先读这一节）

- **目标是还原设计图的色块与轮廓，不是做写实道具。** 判断标准只有一条：转成纯色剪影后能不能一眼认出参考图里的物件，色块分区、比例与部件位置是否一致。
- **几何保持 lowpoly。** 盒子、挤出面、少量切角就够，1500~3000 三角面是合理区间。平面色块就是成品，不要求曲面、不要求分段倒角、不做细分与平滑着色的塑形。
- **全模型只有一个材质、一张贴图。** 不按部件建多个 Principled BSDF，不用程序化节点（Noise / ColorRamp 导出 GLB 会丢），不做 PBR 磨损与金属度分层。
- **颜色先列成色板再动手。** 从设计图提取颜色（深棕描边也算一个颜色），每色一个槽位，总数 ≤ 48，与项目 `PaletteRasterizer` 的 4 列 × 12 行网格对齐。描边是色卡里的一个深色槽，用薄侧面或包边几何实现，不用 inverted hull、Freestyle 或线框渲染。
- **单位与朝向沿用节点约定**：1 单位 = 1 米，+Y 朝前，底面贴 z=0，X/Y 居中于原点。设计图只有单视角时，厚度按「立牌 / 挤出板」取一个明确值（通常 0.08~0.15 米）并写进规格，不要虚构背面细节。

## 色卡规格（硬约束）

- 网格 **4 列 × 12 行 = 48 槽**；每格填一个纯色，格子四周留至少 2 像素同色 padding，防止 mipmap 与双线性插值把相邻颜色混进来。
- 采样点取色块中心：`u = (col + 0.5) / 4`，`v = (row + 0.5) / 12`，v 原点在左下，与 glTF / Blender 一致。
- 插值与延展设在 `ShaderNodeTexImage` 节点上：`tex.interpolation='Closest'`、`tex.extension='EXTEND'`（导出 GLB 后 magFilter/minFilter 为 NEAREST）。`bpy.types.Image` 没有这两个属性，写到 img 上在 Blender 4.5 会直接 AttributeError。
- **别把单视角设计图默认做成 2.5D 立牌。** 用户给的正交视图可能只是 3D 物体的一个投影：实测同一把椅子的正视图看着像平板，等距图才看出是「水平座面 + 竖直靠背 + 米黄木框 + 底座 + 四脚」的 L 形结构，且座面与靠背各有一组菱形。有等距/多视角参考时按真 3D 结构建，色卡做法不变；亮/暗两档色槽分别给朝上/朝前与朝侧/朝后的面，用离散色块做体积感，不靠真实光照。
- **单视角设计图转 2.5D 时，X 必须取反。** 相机在 +Y 看向 -Y 才能看到正面，此时屏幕右 = -X；直接把图像 x 映射到 +X 会让成品左右镜像。用 `X(px) = (cx - px) * scale`，`Z(py) = (y_bottom - py) * scale`。
- **48 个槽必须全部填满有效颜色，禁止留透明黑。** 实测：只填 8 个槽时，GLB 的 sampler 是 `minFilter=LINEAR_MIPMAP_LINEAR`，远处 mip 层会把那 40 个 `(0,0,0,0)` 平均进采样，渲染出大片黑块。同时 glTF 导出会翻转 v，所以后半部分槽位按 `mirror = (ROWS-1-row)*COLS + col` 取色，保证翻转前后颜色对应不变。
- **色卡必须打包进 GLB**：用 `bpy.data.images.new` 生成后绑定材质并 `image.pack()`，或导出时让 glTF 自动内嵌。禁止只写一个外部 PNG 路径，画布里的 GLB 是单文件流转，外链贴图一落地就丢。
- 每个面的所有 loop 必须落在**同一个**色槽中心点；同一槽位的所有采样像素颜色必须一致（项目 `PaletteImageCodec.TryImportColors` 就是按这条校验的）。
- 最终 GLB 路径为 `{out_path}`；检查点路径沿用节点约定，不另建版本目录。

## 四阶段流程

1. **拆图**：列出部件清单、每个部件的颜色槽索引、整体尺寸与厚度假设、描边宽度，先打印色板表。
2. **起形**：按部件建 lowpoly 几何，给每个 polygon 记下 `color_of[poly.index]`，打印包围盒与三角面数。轮廓优先于细节。
3. **上色卡**：生成色卡 PNG、建单材质（Base Color ← Image Texture，Principled 的 Metallic=0 / Roughness=1）、按面写 UV。
4. **导出与自检**：导出 GLB，用 `look` 的 `angles` 四视角看剪影与色块分区（不看曲面连续），打印使用的色槽数与每槽面数，确认色卡贴图已进 GLB。

## 关键代码（片段，参数按本次设计图改）

```python
COLS, ROWS, CELL = 4, 12, 8     # 48 槽，每格 8×8 像素全同色 = 自带 padding
PALETTE = [ ... ]               # [(r,g,b,a), ...]，顺序即槽位索引，长度 ≤ 48

img = bpy.data.images.new('palette', width=COLS*CELL, height=ROWS*CELL, alpha=True)
px = [0.0] * (COLS*CELL * ROWS*CELL * 4)
for slot in range(COLS * ROWS):           # 全槽填满，不留透明像素
    col, row = slot % COLS, slot // COLS
    mirror = (ROWS - 1 - row) * COLS + col
    src = slot if slot < len(PALETTE) else mirror   # 兼容 glTF 的 v 翻转
    color = PALETTE[src % len(PALETTE)]
    for y in range(row*CELL, (row+1)*CELL):
        for x in range(col*CELL, (col+1)*CELL):
            o = (y*COLS*CELL + x) * 4
            px[o:o+4] = color
img.pixels.foreach_set(px)
img.pack()  # 插值与延展设在下面的 ShaderNodeTexImage 上

mat = bpy.data.materials.new('palette_mat')
mat.use_nodes = True
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = img
tex.interpolation = 'Closest'
tex.extension = 'EXTEND'
mat.node_tree.links.new(tex.outputs['Color'],
                        mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def slot_uv(slot):
    return ((slot % COLS + 0.5) / COLS, (slot // COLS + 0.5) / ROWS)

for poly in obj.data.polygons:
    for li in poly.loop_indices:
        obj.data.uv_layers.active.data[li].uv = slot_uv(color_of[poly.index])
```

`img.pixels` 行序自下而上，与 v 原点在左下一致。若改用 `bpy.data.images.load` 读外部 PNG，记得先 `image.pack()`。

## 验收

- 三角面数、使用的色槽数、每槽面数都要打印出来，别只说「已完成」。
- **UV 展开覆盖率判定不适用于本模式**：UV 本来就收成点，后端按色卡模式豁免。不要为了覆盖率去摊开 UV，也不要用 Smart UV Project 覆盖收点结果。
- 检查每个面的角都落在同一色槽中心、色卡已打包进 GLB、材质只有 1 个、没有设计图里没要求的部件。
- `look` 失败就如实写「外观未验证」，退回尺寸与面数自检，不反复重试同一个失败调用。

## 标杆脚本

以下为完整可运行的最小范例，供「查看工作手册」面板参考；送进模型请求时本节会被自动截断，避免照抄造型。

```python
import bpy, os
COL = 'ai_build'
col = bpy.data.collections.get(COL) or bpy.data.collections.new(COL)
if not any(c.name == COL for c in bpy.context.scene.collection.children):
    bpy.context.scene.collection.children.link(col)

def adopt(obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj

# 1. 色板：深棕描边 / 珊瑚橙软包 / 浅橙描边 / 米黄侧板 / 棕色底座 / 深棕脚
PALETTE = [
    (0.23, 0.16, 0.15, 1), (0.95, 0.42, 0.33, 1), (0.99, 0.72, 0.55, 1),
    (0.94, 0.87, 0.70, 1), (0.55, 0.45, 0.36, 1), (0.32, 0.18, 0.12, 1),
]
COLS, ROWS, CELL = 4, 12, 8
img = bpy.data.images.new('palette', width=COLS*CELL, height=ROWS*CELL, alpha=True)
px = [0.0] * (COLS*CELL * ROWS*CELL * 4)
for slot in range(COLS * ROWS):
    cx, cy = slot % COLS, slot // COLS
    mirror = (ROWS - 1 - cy) * COLS + cx
    src = slot if slot < len(PALETTE) else mirror
    color = PALETTE[src % len(PALETTE)]
    for y in range(cy*CELL, (cy+1)*CELL):
        for x in range(cx*CELL, (cx+1)*CELL):
            o = (y*COLS*CELL + x)*4
            px[o:o+4] = color
img.pixels.foreach_set(px)
img.pack()  # 插值与延展设在 tex 节点上

mat = bpy.data.materials.new('palette_mat'); mat.use_nodes = True
tex = mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = img
tex.interpolation = 'Closest'; tex.extension = 'EXTEND'
mat.node_tree.links.new(tex.outputs['Color'],
                        mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

def box(name, loc, scale, slot):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = adopt(bpy.context.active_object); o.name = name
    o.scale = scale
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    uv = o.data.uv_layers.active or o.data.uv_layers.new(name='palette')
    for p in o.data.polygons:
        for li in p.loop_indices:
            uv.data[li].uv = ((slot % COLS + .5)/COLS, (slot // COLS + .5)/ROWS)
    return o

# 2. 部件：正面软包 / 侧板 / 底座 / 两只脚
box('soft_front', (0, -0.06, 0.55), (0.62, 0.10, 0.90), 1)
box('side_panel', (0.36, 0, 0.55), (0.10, 0.16, 1.05), 3)
box('base',       (0, 0, 0.06),    (0.82, 0.18, 0.12), 4)
box('foot_l',     (-0.30, 0, -0.02), (0.10, 0.14, 0.10), 5)
box('foot_r',     ( 0.30, 0, -0.02), (0.10, 0.14, 0.10), 5)

# 3. 导出
for o in bpy.context.scene.objects: o.select_set(False)
for o in col.objects: o.select_set(True)
bpy.context.view_layer.objects.active = col.objects[0]
OUT = r'{out_path}'
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True)
print('exported', os.path.isfile(OUT), os.path.getsize(OUT) if os.path.isfile(OUT) else 0)
```
