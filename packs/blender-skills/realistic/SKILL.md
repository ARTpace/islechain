# 写实道具师 · 作业手册

## 取舍原则（先读这一节）

- **几何细节优先，不要指望贴图**。GLB 只导出 Principled BSDF 的常数参数和图片贴图，**程序化节点（Noise/Musgrave/ColorRamp）在 GLB 里会全部丢失**。所以写实感必须靠：分段倒角、板缝、真实的厚度变化、独立零件。
- **1 单位 = 1 米，精确到厘米**。写实道具的尺寸经不起估，先报数字再写代码。
- **面数预算 15000 三角面以内**。倒角段数可以给 3，圆柱 24 边。
- **材质槽 3~6 个**，靠色相和粗糙度的细微差别分层，不要一个纯色打天下。写实的 Base Color 永远不是纯色（往灰里压 15%~25%）。
- **必须有厚度**。任何板材壁厚 ≥ 0.008m，看不到厚度的面片看起来像纸。
- **检查穿模**。零件互相穿插是写实建模最常见的翻车，每加一批零件就打印一次包围盒核对。

## 四阶段流程

**阶段 1 体块**：主形体 + 正确壁厚。先只建外壳，验证尺寸。
**阶段 2 结构**：真实构造层——框架、板材拼接缝、加强筋、五金件（螺丝、合页、铰链、铭牌）。每类零件用 ARRAY 阵列。
**阶段 3 材质**：按真实材质分层。金属给 Metallic=1.0、Roughness 0.3~0.5；木材 Metallic=0、Roughness 0.6~0.8；橡胶 Metallic=0、Roughness 0.85。Base Color 全部写实偏灰。
**阶段 4 自检导出**：打印包围盒、面数、材质槽清单，四视角 look 检查穿模和厚度。

## 常见品类尺寸参考

| 品类 | 尺寸 (X×Y×Z, m) | 构造细节 |
|---|---|---|
| 木质货箱 | 0.62×0.62×0.60 | 板材厚 0.018，四角立柱 0.05 见方，顶部 6 颗铁钉 |
| 工业工作台 | 1.55×0.72×0.88 | 台面 0.045 厚 + 包边，腿 0.06 方管，横撑 2 道，下层搁板 |
| 油桶 | Ø0.58 × H0.88 | 桶壁 0.012，2 道滚箍（截面 0.02），顶盖内凹 0.015 |
| 街道路灯 | 杆 Ø0.11 × H4.2 | 底座法兰 0.28 见方，灯头 0.42×0.22，检修门 |
| 石块 | 1.3×1.0×0.75 | 立方体 4 段细分 + 顶点随机位移 0.06，倒角 0.035 |

## Blender 5.0 API 要点

- 体块：`primitive_cube_add(size=1)` → 改 scale → `transform_apply(scale=True)`。圆柱 `vertices=24`。
- 多段倒角：`m.width = 0.006; m.segments = 3; m.limit_method = 'ANGLE'`。应用前设 `view_layer.objects.active`。
- 板缝做法：把整块板拆成 3~5 块独立板，之间留 0.003 的缝，比在一块板上做切角更真实。
- 顶点位移做不规则表面：`for v in obj.data.vertices: v.co += Vector((rand,rand,rand)) * 0.02`，位移前 `obj.data.update()` 不必要，位移后要重新算 normals（`obj.data.update()`）。
- 阵列：`'ARRAY'` 修改器，`m.count`、`m.relative_offset_displace`。螺丝这类用 count=6 阵列，不要手写 6 个。
- 材质：`mat.use_nodes = True` → `nodes.get("Principled BSDF")`，输入名一律 `inputs.get()` 判空（4.0 改过名：Specular IOR Level / Subsurface Weight / Transmission Weight）。
- 不要设 `mesh.use_auto_smooth`（4.1 已删除）。要硬边靠倒角，要平滑用 `shade_smooth()` + 倒角段数。
- 导出：`bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)`。`export_apply=True` 才会烘修改器。
- 集合归属：`col.objects.link(obj)` 后从原 `users_collection` unlink。

## 标杆脚本（写实木箱：板材拼接 + 角柱 + 铁钉 + 分层材质）

```python
import bpy
from mathutils import Vector

OUT = r"{out_path}"
col = bpy.data.collections.get("ai_build")
if col is None:
    col = bpy.data.collections.new("ai_build")
    bpy.context.scene.collection.children.link(col)

def adopt(obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj

def box(name, size, loc, bevel=0.0, seg=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = adopt(bpy.context.active_object)
    o.name = name
    o.scale = size
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new("bevel", 'BEVEL')
        m.width = bevel
        m.segments = seg
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o

def paint(obj, name, color, rough, metal=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
    obj.data.materials.append(mat)
    return obj

# 阶段 1 体块：0.60 高，壁厚按 0.018 板材
box("crate_shell", (0.30, 0.30, 0.29), (0, 0, 0.30), bevel=0.010)

# 阶段 2 结构：四角立柱 + 六块拼板（留 3mm 板缝）+ 铁钉
for sx in (1, -1):
    for sy in (1, -1):
        box("post_%d%d" % (sx, sy), (0.025, 0.025, 0.30),
            (sx * 0.288, sy * 0.288, 0.30), bevel=0.006, seg=3)

for i, z in enumerate((0.10, 0.30, 0.50)):
    box("plank_front_%d" % i, (0.27, 0.009, 0.088), (0, -0.303, z), bevel=0.004, seg=2)
    box("plank_back_%d" % i, (0.27, 0.009, 0.088), (0, 0.303, z), bevel=0.004, seg=2)

for sx in (1, -1):
    for i, z in enumerate((0.10, 0.30, 0.50)):
        box("plank_side_%d_%d" % (sx, i), (0.009, 0.27, 0.088),
            (sx * 0.303, 0, z), bevel=0.004, seg=2)

bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.006, depth=0.004, location=(0.24, -0.312, 0.56))
nail = adopt(bpy.context.active_object)
nail.name = "nail_a"
for i in range(1, 6):
    dup = nail.copy()
    dup.data = nail.data.copy()
    dup.name = "nail_%d" % i
    dup.location = (0.24 - i * 0.095, -0.312, 0.56)
    col.objects.link(dup)

# 阶段 3 材质：木材偏灰 + 铁件
shell = bpy.data.objects["crate_shell"]
paint(shell, "wood_grey", (0.30, 0.22, 0.14, 1.0), 0.72)
for o in col.objects:
    if o.name.startswith("post") or o.name.startswith("plank"):
        paint(o, "wood_grey", (0.30, 0.22, 0.14, 1.0), 0.72)
    elif o.name.startswith("nail"):
        paint(o, "iron_rough", (0.28, 0.28, 0.29, 1.0), 0.55, metal=1.0)

# 阶段 4 自检 + 导出
pts = [o.matrix_world @ Vector(c) for o in col.objects for c in o.bound_box]
print("bbox_min", [round(min(p[i] for p in pts), 3) for i in range(3)])
print("bbox_max", [round(max(p[i] for p in pts), 3) for i in range(3)])
print("faces", sum(len(o.data.polygons) for o in col.objects))
print("materials", sorted({m.name for o in col.objects for m in o.data.materials if m}))
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in col.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          use_selection=True, export_apply=True)
```
