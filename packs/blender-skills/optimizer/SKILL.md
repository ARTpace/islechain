# 减面拓扑师 · 作业手册

## 取舍原则（先读这一节）

- **减面任务只做一件事：让三角面数下降。** 不加部件、不改轮廓、不改比例、不换材质。任何造型变化都算缺陷。
- **先量后减。** 每一步都以打印出来的三角面数为准，不靠"看起来差不多"。没量过的面数不许写进结论。
- **比例算出来，不要拍。** `ratio = 目标 / 当前`，不是随手写 0.3。多物体场景按整体总量算，再逐个按同一比例减。
- **保留优先级**：轮廓与比例 > 关键特征（凹槽、开口、把手的洞）> UV 与贴图 > 硬边倒角的圆滑度。牺牲顺序从左到右反过来。
- **达不到目标就如实说。** 两轮追减仍不达标，报告实际面数并说明原因（例如形变已经明显、有形态键无法减面），不要谎称达标。

## 判定标准

减完自问三句，任何一句不成立就回退：

1. 黑色剪影和减面前一样吗？
2. 有没有破面、翻转法线、缺口、塌陷的薄壁？
3. 贴图有没有明显拉伸错位（UV 还在不在）？

## 四步流程（每步一段脚本）

**步骤 1 读基线**：导入模型，打印每个对象的名字、三角面数、材质槽数量、UV 层数量、是否有形态键与修改器。这组数字是后面所有对比的基准。

**步骤 2 预处理**：把会阻碍减面的东西清掉——先 apply 掉 Mirror / Bevel / Subdivision 等修改器（`export_apply` 救不了减面，减面必须在真实网格上做）；单用户化多用户网格；有形态键的对象单独列出并跳过。

**步骤 3 减面**：按下面的配方算 ratio 并 apply DECIMATE。硬表面先用 DISSOLVE 删共面细分，再用 COLLAPSE 压到预算；有机体只用 COLLAPSE。

**步骤 4 自检导出**：打印减面前后三角面数与降幅百分比，四视角 look 对比轮廓，导出 GLB。

## 精确配方（照抄，只改 TARGET）

```python
import bpy

TARGET = 5000  # 目标三角面总数

def tris(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)

targets = [o for o in bpy.context.scene.objects if o.type == 'MESH']
before = sum(tris(o) for o in targets)
print("before_tris", before, "target", TARGET)

# 预处理：形态键会让 DECIMATE 无法 apply，先报出来
for o in targets:
    if o.data.shape_keys:
        print("skip_shapekeys", o.name)
    if o.data.users > 1:
        o.data = o.data.copy()          # 多用户网格必须先单用户化
targets = [o for o in targets if not o.data.shape_keys]

ratio = min(1.0, TARGET / max(before, 1))
for o in targets:
    m = o.modifiers.new("decimate", 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = True    # 直接出三角面，避免导出时二次三角化
    with bpy.context.temp_override(object=o, active_object=o,
                                   selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=m.name)

after = sum(tris(o) for o in targets)
print("after_tris", after, "drop_pct", round((1 - after / max(before, 1)) * 100, 1))
```

`ratio` 是**每个对象按同一比例**收缩，总量近似等于 `before * ratio`。减完总量仍高于目标 10% 以上，就再算一次 `TARGET / after` 补一轮（最多两轮）。

## 减面方式怎么选

| 场景 | 用法 | 关键参数 |
|---|---|---|
| 有机体、角色、曲面道具 | `COLLAPSE` | `ratio`；`use_collapse_triangulate=True` |
| 左右对称的角色/载具 | `COLLAPSE` + 对称 | `m.use_symmetry = True`；`m.symmetry_axis = 'X'` |
| 硬表面、建筑、机械（大量共面细分） | 先 `DISSOLVE` 再 `COLLAPSE` | `m.decimate_type='DISSOLVE'`；`m.angle_limit = 0.087`（约 5°）；`m.delimit = {'UV'}` |
| 等距网格（雕刻后未重拓扑） | `UNSUBDIV` | `m.iterations = 2~3`，一次降一级，形变最小 |

硬表面推荐顺序：`DISSOLVE(5°)` 删掉平板上多余的边 → 打印剩余面数 → 不够再用 `COLLAPSE` 收到预算。这一步能保住棱角，比直接 COLLAPSE 好得多。

## 必须保留的东西

- **UV**：`COLLAPSE` 默认保留 UV，但会拉伸。贴图明显的模型减完要看一眼贴图有没有错位；`DISSOLVE` 的 `delimit` 要带 `'UV'`，否则会合并掉 UV 岛边界。
- **材质槽**：减面不碰材质。不要为了减面删材质槽或重排 slot 顺序。
- **朝向与落地**：不动 `location` / `rotation` / 缩放，底面仍贴 z=0，整体仍居中。
- **对象命名与层级**：保持原名字与父子关系，方便对回原模型。

## 常见坑（Blender 4.x / 5.0 实测）

- `modifier_apply` 需要对象处于活动状态，后台或批量时用 `bpy.context.temp_override(...)`，不要靠 `view_layer.objects.active = o` 在循环里碰运气。
- 有形态键（shape keys）的网格无法 apply 修改器：先报出来，除非需求明确允许，否则跳过该对象并在结论里说明。
- 多用户网格（`o.data.users > 1`）apply 会失败，先 `o.data = o.data.copy()`。
- 修改器顺序：DECIMATE 必须排在 ARMATURE / SUBSURF **之前**，否则减的是变形后的结果；不确定就先 apply 前面的修改器。
- 带骨骼蒙皮的模型：减面会重建顶点，权重按最近点插值，之后要确认没有掉权重；不要把 DECIMATE 放在 ARMATURE 之后。
- 减到极低面数（< 300 面）时薄壁和细杆最容易消失，先把这类小件单独列出来，必要时合并进主体而不是硬减。
- `export_scene.gltf(..., use_selection=True, export_apply=True)` 只导选中的对象；减完必须只选中本次产物，别把用户场景里的其他对象带出去。
- 不要用 `bpy.ops.object.select_all(action='SELECT')`，也不要删改场景里不属于本次任务的物体。

## 验收打印格式（最后必须输出这三行）

```
before_tris 24800
after_tris 4980
drop_pct 79.9
```
