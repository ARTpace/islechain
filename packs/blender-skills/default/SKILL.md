# 通用建模师 · 作业手册

没有特定风格要求时使用本手册。原则是**先做对，再做细**：形状正确、尺寸合理、能导出可用的 GLB，比细节丰富更重要。

## 取舍原则

- **1 单位 = 1 米**。按真实规格估尺寸，别用"看起来差不多"的比例。
- **面数按需求分配**。优先完成轮廓与曲面，不以简单几何堆叠代替塑形；用户有预算时遵守预算。
- **露在外面的硬边都做倒角**（0.008~0.012m，2 段）。没有倒角的物体在引擎里看起来像纸盒。
- **正朝向 +Y、底面贴 z=0、X/Y 居中于世界原点**，便于被游戏引擎和其他 DCC 直接复用。
- **材质槽 ≤ 4 个**，只用 Principled BSDF 的 Base Color / Metallic / Roughness。

## 四阶段流程

**阶段 1 体块**：主形体 + 尺寸，打完就停，先验证包围盒。
**阶段 2 结构**：附加件、支撑、开口、把手，每个零件命名能看出是什么。
**阶段 3 材质**：主材 + 辅材，颜色压灰一点（不要纯色）。
**阶段 4 自检导出**：打印包围盒和面数，四视角 look 确认，导出 GLB。

## Blender 5.0 API 要点（实际踩过的坑）

- 体块：`bpy.ops.mesh.primitive_cube_add(size=1, location=(x,y,z))` → 改 `obj.scale` → `bpy.ops.object.transform_apply(scale=True)` 把尺寸烘进网格。圆柱 `primitive_cylinder_add(vertices=16)`。
- 不要设 `mesh.use_auto_smooth`：4.1 起已删除，设置会 AttributeError。要平滑就 `bpy.ops.object.shade_smooth()`。
- 修改器：`m = obj.modifiers.new("bevel", 'BEVEL'); m.width = 0.01; m.segments = 2`；应用前先 `bpy.context.view_layer.objects.active = obj`，再 `bpy.ops.object.modifier_apply(modifier=m.name)`。
- 阵列用 `'ARRAY'` 修改器（`m.count`、`m.relative_offset_displace`），不要手写循环复制网格。
- 布尔挖洞：`m.operation = 'DIFFERENCE'; m.object = cutter`；应用后 `bpy.data.objects.remove(cutter, do_unlink=True)`。
- 材质：`mat.use_nodes = True` → `nodes.get("Principled BSDF")`。4.0 起输入名改过（Specular IOR Level / Subsurface Weight / Transmission Weight / Emission Color），一律用 `bsdf.inputs.get("名字")` 判空，不要按下标取。
- 包围盒：`from mathutils import Vector; pts = [o.matrix_world @ Vector(c) for o in col.objects for c in o.bound_box]`。
- 集合归属：`col.objects.link(obj)` 之后还要从原来的 `users_collection` 里 unlink，否则对象会同时属于两个集合。
- 导出：`bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)`；`export_apply=True` 才会把修改器烘进网格。
- 取消选择不要用 `select_all(action='SELECT')`；用 `for o in bpy.context.scene.objects: o.select_set(False)`。

## 标杆脚本（0.6 米木箱，照这个结构写）

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

# 阶段 1 体块：0.6 x 0.6 x 0.6 米，底面贴 z=0
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.3))
body = adopt(bpy.context.active_object)
body.name = "crate_body"
body.scale = (0.3, 0.3, 0.3)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# 阶段 2 结构：倒角 + 三道横向加固条
bev = body.modifiers.new("bevel", 'BEVEL')
bev.width = 0.012
bev.segments = 2
bpy.ops.object.modifier_apply(modifier=bev.name)
for z in (0.12, 0.3, 0.48):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
    band = adopt(bpy.context.active_object)
    band.name = "crate_band_%d" % int(z * 100)
    band.scale = (0.312, 0.312, 0.018)
    bpy.context.view_layer.objects.active = band
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# 阶段 3 材质
mat = bpy.data.materials.new("wood_dark")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
if bsdf is not None:
    bsdf.inputs["Base Color"].default_value = (0.24, 0.14, 0.08, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.72
body.data.materials.append(mat)

# 阶段 4 自检 + 导出
pts = [o.matrix_world @ Vector(c) for o in col.objects for c in o.bound_box]
print("bbox_min", [round(min(p[i] for p in pts), 3) for i in range(3)])
print("bbox_max", [round(max(p[i] for p in pts), 3) for i in range(3)])
print("faces", sum(len(o.data.polygons) for o in col.objects))
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in col.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          use_selection=True, export_apply=True)
```
