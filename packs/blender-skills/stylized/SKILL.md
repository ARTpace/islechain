# 风格化矮模师 · 作业手册

## 取舍原则（先读这一节）

- **轮廓优先**。判断标准只有一条：只看黑色剪影能不能认出这是什么。认不出就把体块夸张化，不要开始做细节。
- **夸张比例**：道具做"粗壮加厚"——壁厚、边长、把手都放大 20%~40%；角色做"头大身短"，头身比 1:3~1:4。
- **大圆角**。倒角半径取短边的 5%~10%（普通硬表面只有 1%~2%）。圆润是风格化的第一语言。
- **着色服从风格**。只有明确要求切面低模时用 `shade_flat`；圆润卡通采用合理拓扑、细分与平滑着色。
- **纯色不上贴图**。材质槽 ≤ 3 个，颜色高饱和、高明度，对比拉开。不要 PBR 写实参数（Metallic 只在金属件上给 1.0）。
- **不默认限制为 1500 面**。只有明确要求极低模时使用该预算；其他情况优先保持轮廓与曲面。

## 四阶段流程

**阶段 1 剪影**：只建最大的一块形体，尺寸夸张化。停下来确认它能被认出来。
**阶段 2 特征件**：加 2~4 个"识别特征"（提灯的挂钩、药水瓶的软木塞、路牌的箭头）。特征件永远比本体更夸张。
**阶段 3 配色**：主色 + 次色 + 强调色，3 个材质槽封顶。
**阶段 4 自检导出**：四视角 look，重点看剪影是否清晰、有没有过于锋利的边。

## 常见品类尺寸参考

| 品类 | 尺寸 (X×Y×Z, m) | 夸张点 |
|---|---|---|
| 风格化木箱 | 0.55×0.55×0.55 | 圆角 0.045，箱盖比箱体宽 0.06 出檐 |
| 手提灯 | 0.22×0.22×0.34 | 顶部挂钩放大一倍，灯罩做成梯形 |
| 药水瓶 | Ø0.13 × H0.22 | 瓶肚鼓到 1.4 倍直径，瓶颈收窄到 0.5 倍 |
| 矮桌 | 0.9×0.6×0.5 | 桌面加厚到 0.08，桌腿外八字 |
| 路标牌 | 0.5×0.1×1.4 | 箭头做成大三角，杆子做粗 |

## Blender 5.0 API 要点

- 体块：`primitive_cube_add(size=1)` → 改 scale → `transform_apply(scale=True)`。圆柱 `primitive_cylinder_add(vertices=10)`，球 `primitive_uv_sphere_add(segments=12, ring_count=8)`。
- 大圆角用倒角修改器：`m.width = 0.045; m.segments = 2`（段数不要高，低模要保留面的清晰度）。应用前设 `view_layer.objects.active`。
- 平面着色：`bpy.ops.object.shade_flat()`。**不要**设 `mesh.use_auto_smooth`（4.1 已删除，会 AttributeError）。
- 布尔后检查拓扑；有机形体优先连续控制笼或曲线，不用相交几何体堆叠替代。
- 材质：`mat.use_nodes = True` → `nodes.get("Principled BSDF")`。只改 Base Color / Roughness / Metallic，输入名一律用 `inputs.get()` 判空（4.0 改过名）。
- 导出：`bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)`。
- 集合归属：`col.objects.link(obj)` 后要从原 `users_collection` unlink。

## 标杆脚本（风格化木箱，大圆角 + 出檐箱盖 + 三色）

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

def box(name, size, loc, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = adopt(bpy.context.active_object)
    o.name = name
    o.scale = size
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new("bevel", 'BEVEL')
        m.width = bevel
        m.segments = 2
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.shade_flat()
    return o

def paint(obj, name, color, rough=0.62, metal=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
    obj.data.materials.append(mat)
    return obj

# 阶段 1 剪影：0.55 见方，大圆角
body = box("crate_body", (0.275, 0.275, 0.275), (0, 0, 0.275), bevel=0.045)

# 阶段 2 特征件：出檐箱盖 + 两道夸张包边
box("crate_lid", (0.305, 0.305, 0.028), (0, 0, 0.565), bevel=0.022)
box("crate_band_lo", (0.29, 0.29, 0.028), (0, 0, 0.075), bevel=0.018)
box("crate_band_hi", (0.29, 0.29, 0.028), (0, 0, 0.465), bevel=0.018)

# 阶段 3 配色：暖木 / 奶油白 / 铜
paint(body, "wood_warm", (0.62, 0.36, 0.16, 1.0))
for o in col.objects:
    if o.name.startswith("crate_band"):
        paint(o, "cream", (0.92, 0.86, 0.72, 1.0), rough=0.5)
    elif o.name == "crate_lid":
        paint(o, "brass", (0.78, 0.55, 0.22, 1.0), rough=0.4, metal=1.0)

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
