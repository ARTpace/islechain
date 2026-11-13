"""AI 在 Blender 里现场建模，产物落回作业目录。

节点执行时用户不在旁边，所以审批按白名单走：只放行读场景、跑代码、截图，
联网生成和资产导入一律拒绝。这条边界不靠模型自觉，靠 approve 回调硬挡。
"""

import asyncio
import time
from pathlib import Path

from core import blender_skills, dcc_bridge, glb_stats

STATUS_BUILDING = 'building'
STATUS_DONE = 'produced'
STATUS_FAILED = 'failed'
# 灰模完成后停等人工放行，不再一口气跑完结构/材质（上游 SKILL.md:22 的异步等价物）
STATUS_AWAITING = 'awaiting_approval'
UV_COVERAGE_TARGET = 0.80

# 色卡低模人设：命中时替换建模 BRIEF、跳过通用造型策略，并按色槽验收 UV。
PALETTE_PRESET = 'palette-lowpoly'

ALLOWED = ('blender/get_scene_info', 'blender/execute_blender_code', 'blender/look')
BUILD_ROUNDS = 40

BRIEF = """你在为一个画布节点做 3D 建模，最终产物是一个 GLB 文件。

需求：
{prompt}
{materials}
工作方式：按阶段推进，每个阶段一次 execute_blender_code，不要把全部细节塞进一个脚本。
阶段 1 起形：按部件选择截面挤出、旋转体、曲线或控制笼，确定主要轮廓、比例和姿态；基本体只用于合适的部件或临时占位。打印尺寸与包围盒。
阶段 2 塑形与结构：替换临时占位，完成曲面、厚度、过渡、开口与连接关系；再按需要加倒角和重复件，打印总面数。
阶段 3 材质：给不同部件上 Principled BSDF（基础色、粗糙度、金属度），对象的命名要能看出是什么部件。
阶段 4 导出与自检：只选中 ai_build 里的对象导出，然后 look 看效果。

硬性要求：
1. 只用 Blender 工具：读场景用 get_scene_info，造东西用 execute_blender_code，自检用 look。
2. 单位约定：1 个 Blender 单位 = 1 米，尺寸按真实物体的常见规格估（例如木箱 0.6×0.6×0.6 米）。
3. 朝向 +Y，底面贴在 z=0，整体在 X/Y 上居中于世界原点。
4. 用户场景里已有对象一个都不许删、不许改。新建对象放进名为 "ai_build" 的集合，
   建完只选中它们。已有集合名冲突时用 "ai_build_2"。
5. 禁止 bpy.ops.wm.save、bpy.ops.wm.quit_blender、bpy.ops.object.select_all(action='SELECT')，
   也禁止批量删除已有对象。只操作你自己新建的东西。
6. 必须导出到这个绝对路径，只导你的产物：
   {out_path}
   参考写法：bpy.ops.export_scene.gltf(filepath=r"{out_path}", export_format='GLB', use_selection=True)
7. 导出后用 os.listdir 确认 {out_dir} 里确实有文件；没有就如实说没导出来，不要说“应该已经导出”。
8. 导出前必须用 look 出多视角自检：mode 传 'angles'，views 传 ['front','right','top','three_quarter']；
   逐个视角说一句你实际看到的形状和比例。与需求不符就修，最多 3 次。look 失败就改用 get_scene_info
   的尺寸和面数自检，不要反复重试同一个失败的 look。
9. 每次脚本保持简短（尽量 80 行以内）；报错时只读 traceback 的行号和 API 名，只改那一行，不要整段重写；
   同一段逻辑连续失败两次就换实现方式（例如 bpy.ops 换成 bmesh）。
10. 如果系统提示剩余轮次不足，立刻停止扩展，先把当前结果导出，再收尾。
11. 最后用一到两句话说明你建了什么、主要用了什么手法。不要写长篇报告。
12. 文末是你这个角色专属的作业手册，含取舍原则、尺寸参考和 Blender API 要点。
    手册只供 API 与组织方式参考，不照搬木箱的造型。按本次物体选择建模手法；拿不准的参数先 print 验证再用。
"""

EDIT_BRIEF = """你在 Blender 里改造一个已经存在的 3D 模型，最终产物仍是一个 GLB 文件。

改造需求：
{prompt}
{materials}
基准模型（已经复制进作业目录了，先导入它，不要从零重建）：
{base_path}
按扩展名用对应导入语句，直接照抄：
{import_code}

工作方式：按阶段推进，每个阶段一次 execute_blender_code。
阶段 1 读基线：导入基准模型，打印每个对象的名字、dimensions、总面数和整体包围盒。
   把这组数字记下来，后面每轮都拿它对照，别把模型改走形。
阶段 2 改造：只在刚导入的对象上动刀 —— 用 bpy.data.objects 取对象，进编辑模式改网格，
   或加修改器（Bevel / Solidify / Array）后 apply。不许删掉原件换个新的，也不许重建同名替代品。
阶段 3 材质：保留原有材质槽和贴图；只有需求明确要求时才改基础色、粗糙度、金属度。
阶段 4 导出与自检：选中所有导入对象和新增部件导出，然后 look 出四视图确认。

硬性要求：
1. 只用 Blender 工具：get_scene_info / execute_blender_code / look。
2. 导入后先确认对象数量与面数；导入失败就把完整 traceback 说出来并停下，不要改去重建。
3. 新增部件（加固条、把手之类）要和原件同一坐标系，改完 join 进原件或作为子对象保留。
4. 单位是米，保持原件的尺寸量级；除非需求要求，不要整体缩放超过 ±20%。
5. 禁止 wm.save / wm.quit / select_all(action='SELECT')；禁止删改场景里不属于这次导入的对象。
6. 必须导出到这个绝对路径，只导你的产物：
   {out_path}
   参考写法：bpy.ops.export_scene.gltf(filepath=r"{out_path}", export_format='GLB', use_selection=True, export_apply=True)
7. 导出后用 os.listdir 确认文件存在，并打印改造前后的面数与包围盒对比。
8. 导出前用 look 出多视角：mode 传 'angles'，views 传 ['front','right','top','three_quarter']；
   逐个视角说一句看到的形状。look 失败就退回 get_scene_info 的尺寸和面数自检，不要反复重试。
9. 脚本保持简短；报错只读 traceback 的行号和 API 名，只改那一行；同一段逻辑连续失败两次就换实现方式。
10. 如果系统提示剩余轮次不足，立刻停止扩展，先导出当前结果再收尾。
11. 最后用一到两句话说明改了什么、动了哪些对象。不要写长篇报告。
12. 文末是你这个角色专属的作业手册，含取舍原则和 Blender API 要点。
    只借鉴 API 写法和结构，不要照范例从零新建物体 —— 这次的任务是在基准模型上改。
"""


PALETTE_BRIEF = """你在为一个画布节点做 3D 建模，最终产物是一个 GLB 文件。
本次是【色卡低模模式】，按文末作业手册的色卡规范制作，不走通用的多材质 PBR 流程。

需求：
{prompt}
{materials}
工作方式：按阶段推进，每个阶段一次 execute_blender_code，不要把全部细节塞进一个脚本。
阶段 1 拆图：从参考设计图提取部件清单与色板（颜色名、RGB、槽位索引），打印色板表、整体尺寸与厚度假设。
阶段 2 起形：按部件建 lowpoly 几何，给每个面记下颜色槽索引，打印包围盒与三角面数。
阶段 3 上色卡：生成 4 列 12 行色卡贴图、建单材质、把每个面的 UV 收成对应色槽中心点。
阶段 4 导出与自检：导出 GLB，用 look 四视角看剪影与色块分区，打印使用的色槽数与每槽面数。

硬性要求：
1. 只用 Blender 工具：读场景用 get_scene_info，造东西用 execute_blender_code，自检用 look。
2. 1 单位 = 1 米，+Y 朝前，底面贴 z=0，X/Y 居中；单视角设计图的厚度取一个明确值并写进规格，不虚构背面。
3. 用户场景里已有对象一个都不许删、不许改。新建对象放进名为 "ai_build" 的集合，建完只选中它们。
4. 禁止 bpy.ops.wm.save、bpy.ops.wm.quit_blender、bpy.ops.object.select_all(action='SELECT')，禁止批量删除已有对象。
5. 全模型只有 1 个材质；所有颜色来自同一张色卡贴图；每个面的所有 loop UV 落在同一个色槽中心，不做 UV 展开。
6. 色卡贴图必须打包进 GLB（image.pack()），禁止只写外部 PNG 路径。
7. 必须导出到这个绝对路径，只导你的产物：
   {out_path}
   参考写法：bpy.ops.export_scene.gltf(filepath=r"{out_path}", export_format='GLB', use_selection=True)
8. 导出后用 os.listdir 确认 {out_dir} 里确实有文件，并打印色卡是否已打包、材质数量与色槽使用数。
9. 导出前用 look 出多视角自检：mode 传 'angles'，views 传 ['front','right','top','three_quarter']；
   逐个视角说一句看到的剪影与色块分区，与参考不符就修，最多 3 次。look 失败就退回尺寸和面数自检。
10. 每次脚本保持简短（尽量 80 行以内）；报错时只读 traceback 的行号和 API 名，只改那一行；
    同一段逻辑连续失败两次就换实现方式。
11. 剩余轮次不足时立刻停止扩展，先把当前结果导出，再收尾。
12. 最后用一到两句话说明建了什么、用了几个色槽。文末作业手册是本次色卡规范，优先于任何冲突的通用建模建议。
"""

PALETTE_NOTE = """
# 本次作业的最终覆盖条款（色卡低模模式，优先于上面任何冲突表述）
- 用文末色卡手册的规范：一张色卡贴图、单材质、每面 UV 收点；不按部件建多个 Principled BSDF。
- 平面色块与 lowpoly 几何就是成品，不做曲面塑形、细分、分段倒角或写实构造；上面要求弧线连续、曲面过渡、厚度变化的条款本次不适用。
- 描边是色卡里的一个深色槽，用薄侧面或包边几何实现，不用轮廓线渲染。
- 色卡贴图必须打包进 GLB；UV 不做展开，也不适用常规 UV 覆盖率验收。
- 四视角自检只看剪影与色块分区是否对齐参考设计图。
"""

QUALITY_BRIEF = """
优先遵循本次作业策略（高于手册范例）：
- 动手前先用不超过 6 行列明规格：整体尺寸和比例、部件清单、姿态/开合角度、材质、必须保留的特征。
  用户明确的规格优先；参考看不见的位置写明假设，不虚构观察。不要为次要细节中断作业询问。
- 用一个集中参数字典维护关键尺寸和角度，关联部件从参数计算；对象用稳定且可辨认的部件名。
- 灰模后先 look 检查轮廓、比例、缺件与穿插，通过后才做细节。改造任务先检查导入基线，禁止为了灰模检查简化或替换原件。
- 修改只动需求涉及的部件；保留其他对象、UV、材质。结构检查不得仅以面数多少判断质量。
- 每个阶段完成后，把当前完整产物仅选中导出到对应检查点：
  灰模/导入基线：{checkpoints}/01-blockout.glb
  结构：{checkpoints}/02-structure.glb
  材质：{checkpoints}/03-material.glb
  检查点目录已创建，不写入 out/；每次导出前确保只选中本次产物，不包含用户原有场景。
- 最终 GLB 只导出到之前指定的 model.glb；程序材质需烘焙成 GLB 支持的贴图，否则用兼容的 Principled 材质并说明简化。
- look 失败时仅能完成结构检查，最后明确写“外观未验证”，不要宣称视觉验收通过。
{scope}
"""


SHAPE_BRIEF = """
# 造型策略（优先于人设中未经用户指定的面数、材质数量与平面着色限制）
先在规格里列出“关键部件 → 建模手法 → 可见特征”，再执行。以参考和用户指定风格为准；
风格化不等于极低模，写实不等于增加方块。面数按轮廓需要分配，不为固定预算牺牲形状。
- 箱盖、弧形外壳：用截面顶点和面构成网格后挤出/封口，或用网格编辑；板材用 SOLIDIFY，硬边用 BEVEL。
- 瓶罐、碗、旋转对称件：截面旋转/SCREW，比球体圆柱套叠更能控制收腰、鼓肚与唇口。
- 舌头、触手、弯把手：曲线控制点与半径，或连续截面放样；有扁平截面时不可直接套用圆管。
- 手和有机主体：连通的低模控制笼 + MIRROR / SUBSURF，关节与根部形成连续过渡；不要用独立球柱互相穿插代替。
- 重复件：规则排列用 ARRAY；复杂散布才用几何节点，用 Realize Instances 后导出。不要为使用几何节点而使用它。
- 雕刻只在确有表面塑形需求且当前上下文支持时使用；先确认模式、对象与笔刷 API，不依赖未验证的屏幕笔画反复试错。
API 参考（只演示局部手法，须将对象加入本次集合并采用本次参数）：
```python
# 连续弯曲件：控制点半径随形变化；扁舌需另外设置扁平截面或使用网格放样
curve = bpy.data.curves.new('curved_part', 'CURVE')
curve.dimensions = '3D'
curve.bevel_depth = 0.025
curve.bevel_resolution = 3
spline = curve.splines.new('BEZIER')
spline.bezier_points.add(len(points) - 1)
for bp, co, radius in zip(spline.bezier_points, points, radii):
    bp.co = co
    bp.radius = radius
    bp.handle_left_type = bp.handle_right_type = 'AUTO'
obj = bpy.data.objects.new('curved_part', curve)
col.objects.link(obj)
# 自定义截面/控制笼：verts 与 faces 按本次轮廓生成，曲面需要合理拓扑与支撑边
mesh = bpy.data.meshes.new('shaped_mesh')
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new('shaped_part', mesh)
col.objects.link(obj)
sub = obj.modifiers.new('surface', 'SUBSURF')
sub.levels = 2
sub.render_levels = 2
```
导出注意：只对本次对象操作。导出曲线前转为网格；几何节点实例需实体化；
需要转换/应用时先在本次集合内复制评估结果进行导出，保留可编辑原件，禁止破坏其他场景对象。
完整模型验收：用四视角观察弧线是否连续、截面是否合理、连接处是否穿插、识别特征是否存在。
除非用户勾选灰模或明确要积木风格，不可把未替换的方块/球柱占位直接当成品；仅增加倒角或平滑着色不算完成塑形。
如果无法完成关键曲面或看不到实际效果，明确说明缺项，不宣称已达到参考质量。
"""


def _quality_brief(work, blockout_only=False, refine=False):
    checkpoints = Path(work) / 'checkpoints'
    checkpoints.mkdir(parents=True, exist_ok=True)
    if refine:
        scope = ('本次是灰模已人工放行后的细化：基准模型就是已通过的形状与比例，'
                 '不要重新起形或整体缩放。直接补结构、厚度、开口、UV、必要烘焙与材质；'
                 '结构写入 02-structure.glb、材质写入 03-material.glb，不要覆盖 01-blockout.glb。')
    elif blockout_only:
        scope = ('本次只做灰模：只完成主要体块、姿态和比例，不加细节或贴图。完成灰模检查后直接导出 model.glb 并结束；'
                 '若有基准模型则保留原有细节，只调整需求涉及的体块。结尾说明这是待确认的灰模。')
    else:
        scope = '本次完成完整模型，按灰模检查、结构、材质顺序推进，无需等待人工确认。'
    return QUALITY_BRIEF.format(checkpoints=checkpoints.as_posix(), scope=scope)


def _import_hint(path):
    """按扩展名给出导入语句；Blender 5.0 的 obj/stl 已经搬到 wm.* 命名空间。"""
    ext = Path(path).suffix.lower()
    literal = 'r"%s"' % path
    if ext in ('.glb', '.gltf'):
        return 'bpy.ops.import_scene.gltf(filepath=%s)' % literal
    if ext == '.fbx':
        return 'bpy.ops.import_scene.fbx(filepath=%s)' % literal
    if ext == '.obj':
        return 'bpy.ops.wm.obj_import(filepath=%s)' % literal
    if ext in ('.usd', '.usdz', '.usdc', '.usda'):
        return 'bpy.ops.wm.usd_import(filepath=%s)' % literal
    if ext == '.stl':
        return 'bpy.ops.wm.stl_import(filepath=%s)' % literal
    if ext == '.ply':
        return 'bpy.ops.wm.ply_import(filepath=%s)' % literal
    if ext == '.abc':
        return 'bpy.ops.wm.alembic_import(filepath=%s)' % literal
    if ext == '.blend':
        return 'bpy.ops.wm.append(filepath=r"%s/Object/Mesh")' % path
    return 'bpy.ops.import_scene.gltf(filepath=%s)' % literal


NOTES = """
本机 Blender 5.0 的 API 要点（都是实际踩过的坑）：
- 体块：bpy.ops.mesh.primitive_cube_add(size=1, location=(x,y,z)) 之后改 obj.scale，
  再 bpy.ops.object.transform_apply(scale=True) 把尺寸烘进网格。圆柱用 primitive_cylinder_add(vertices=16)。
- 不要设 mesh.use_auto_smooth：4.1 起已删除，设置会 AttributeError。要平滑就 bpy.ops.object.shade_smooth()。
- 修改器：m = obj.modifiers.new("bevel", 'BEVEL'); m.width = 0.01; m.segments = 2；
  应用前先 bpy.context.view_layer.objects.active = obj，再 bpy.ops.object.modifier_apply(modifier=m.name)。
- 阵列用 'ARRAY' 修改器（m.count、m.relative_offset_displace），不要手写循环复制网格。
- 布尔挖洞：m.operation = 'DIFFERENCE'; m.object = cutter；应用后 bpy.data.objects.remove(cutter, do_unlink=True)。
- 材质：mat.use_nodes = True；bsdf = mat.node_tree.nodes.get("Principled BSDF")。4.0 起输入名改过
  （Specular IOR Level / Subsurface Weight / Transmission Weight / Emission Color），
  一律用 bsdf.inputs.get("名字") 判空，不要按下标取。
- 包围盒：from mathutils import Vector；pts = [o.matrix_world @ Vector(c) for o in col.objects for c in o.bound_box]。
- 集合归属：col.objects.link(obj) 之后还要从原来的 users_collection 里 unlink，否则对象会同时属于两个集合。
- 导出：bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)；
  export_apply=True 才会把修改器烘进网格。
- 取消选择不要用 select_all(action='SELECT')；用 for o in bpy.context.scene.objects: o.select_set(False)。
"""

EXAMPLE = """
完整范例（一个 0.6 米木箱，照这个结构写；输出路径已经填好）：
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
print("bbox", [round(min(p[i] for p in pts), 3) for i in range(3)],
      [round(max(p[i] for p in pts), 3) for i in range(3)])
for o in bpy.context.scene.objects:
    o.select_set(False)
for o in col.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True)
print("exported", OUT)
"""

MAX_REF_BYTES = 1_500_000
REF_EXTS = ('.png', '.jpg', '.jpeg', '.webp')


def _shrink(raw):
    """Downscale an oversized reference to JPEG so it fits in one vision message."""
    import io as _io
    try:
        from PIL import Image
    except Exception:
        return b''
    try:
        image = Image.open(_io.BytesIO(raw)).convert('RGB')
        image.thumbnail((1024, 1024))
        buffer = _io.BytesIO()
        image.save(buffer, 'JPEG', quality=82)
        return buffer.getvalue()
    except Exception:
        return b''


def _ref_images(folder, limit=8):
    """Turn in/ pictures into data URLs. The model cannot open local paths itself,
    and passing only file names left it guessing what the reference looked like."""
    import base64
    try:
        files = sorted(item for item in Path(folder).iterdir() if item.is_file())
    except OSError:
        return []
    urls = []
    for path in files:
        suffix = path.suffix.lower()
        if suffix not in REF_EXTS or len(urls) >= limit:
            continue
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        mime = 'image/png' if suffix == '.png' else ('image/webp' if suffix == '.webp' else 'image/jpeg')
        if len(raw) > MAX_REF_BYTES:
            raw = _shrink(raw)
            if not raw:
                continue
            mime = 'image/jpeg'
        urls.append('data:%s;base64,%s' % (mime, base64.b64encode(raw).decode()))
    return urls


def _materials_block(folder, exclude=()):
    try:
        names = sorted(item.name for item in Path(folder).iterdir()
                       if item.is_file() and item.name not in set(exclude))
    except OSError:
        names = []
    if not names:
        return ''
    lines = ['\n画布送来的参考文件（都在作业的 in/ 目录里，路径前缀 {0}）：'.format(folder)]
    lines += ['  - ' + name for name in names]
    return '\n'.join(lines) + '\n'


def log(job, line):
    """Append one progress line. The job file is the only shared state between
    the background task and the polling frontend, so every step lands there."""
    job.setdefault('logs', [])
    job['logs'] = (job['logs'] + [{'at': int(time.time() * 1000), 'line': str(line)[:300]}])[-60:]
    job['updatedAt'] = int(time.time() * 1000)
    dcc_bridge.save(job)


def _salvage(job, reason):
    """对话断了，但 Blender 可能已经把 GLB 导出来了。有产物就不该判失败：
    重跑一次的代价远高于把 out/ 里已有的文件直接回收。"""
    try:
        produced = dcc_bridge.refresh(job)
    except Exception:
        return None
    models = [item for item in produced if item['kind'] == 'model']
    if not models:
        # ponytail: 固定三个 GLB 检查点，复用现有回收入口，不增加版本管理层。
        import shutil
        folder = Path(job['dir'])
        for name in ('03-material.glb', '02-structure.glb', '01-blockout.glb'):
            checkpoint = folder / 'checkpoints' / name
            if checkpoint.is_file() and checkpoint.stat().st_size > 0:
                shutil.copy2(checkpoint, folder / 'out' / 'model.glb')
                job['partial'] = True
                log(job, '已恢复阶段模型：' + name + '（尚未完成，请检查后继续修改）')
                produced = dcc_bridge.refresh(job)
                models = [item for item in produced if item['kind'] == 'model']
                break
    if not models:
        return None
    job.update({'status': STATUS_DONE, 'stage': '已出模型（对话中断）'})
    _record_tris(job, models)
    _record_uv(job, models)
    if job.get('partial'):
        flag_difference(job, 'partial', '对话中断后从检查点抢救，未完成全流程')
    job.pop('error', None)
    log(job, '对话中断（%s），已从 out/ 抢救产物：%s' % (reason, ', '.join(item['name'] for item in models)))
    return {'ok': True, 'recovered': True, 'products': produced}


def _attach_and_forget(task):
    """uvicorn keeps the loop alive; hold a reference so the task is not GC'd."""
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)


_RUNNING = set()


def _skill_text(skill_id, out_path):
    """作业手册：packs/blender-skills/<id>/SKILL.md（默认跟随人设 id）。

    人设管取舍方向（写进 game_role_presets 的 prompt），手册管具体手法与标杆脚本。
    目录缺失或读失败时退回内置的 NOTES + EXAMPLE，保证老预设也能跑。
    """
    return blender_skills.text(skill_id, out_path)


def _target_block(target, edit):
    """目标面数是硬约束：模型自己算比例，减完必须报前后面数。"""
    if target <= 0:
        return ''
    head = ('\n## 本次面数目标（硬约束，优先于人设与手册里的任何面数表述）\n'
            '- 目标 %s 三角面，允许 ±10%% 误差；超过上限视为未完成。\n' % format(target, ','))
    if edit:
        return head + (
            '- 面数是硬预算：最终产物必须落在目标内。当前模型超预算时按下面的减面流程处理，'
            '不要靠删部件、删细节或重做造型来凑面数。\n'
            '- 先打印基准模型的三角面总数，按 ratio = %s / 当前面数 算出减面比例，'
            '用 DECIMATE 修改器 apply，不要凭感觉设 ratio。\n' % format(target, ',') +
            '- 硬表面先用 DISSOLVE（角度约 5°）删共面细分再 COLLAPSE；有机体只用 COLLAPSE。\n'
            '- 必须保留 UV、材质槽与贴图、朝向与底面贴地、对象命名。\n'
            '- 减完打印 before_tris / after_tris / drop_pct 三行；仍超目标就再算一次比例追减，'
            '最多两轮，仍不达标就如实报告实际面数。\n'
        )
    return head + (
        '- 建模阶段就按这个预算分配面数，主轮廓优先，细节量力而行；'
        '导出前打印最终三角面数，超预算先减面再导出。\n'
        '- 减面用 DECIMATE 修改器并 apply（export_apply 不会替你做减面决策）。\n'
    )


def _record_tris(job, models):
    """把产物真实面数写回作业：AI 说减到 5k 不算数，读 accessor 才算。"""
    if not models:
        return None
    stats = glb_stats.inspect_file(models[0]['path'])
    if not stats:
        return None
    job['tris'] = stats['triangles']
    job['glb'] = stats
    target = int(job.get('targetTris') or 0)
    line = '产物面数：' + glb_stats.describe(stats)
    if target > 0:
        delta = (stats['triangles'] - target) / float(target) * 100.0
        line += ' · 目标 %s（%+.1f%%）' % (format(target, ','), delta)
        job['trisDelta'] = round(delta, 1)
        if abs(delta) > 10:
            flag_difference(job, 'tris_out_of_budget',
                            '产物三角面 %s，相对目标 %s 偏差 %+.1f%%（允许 ±10%%）'
                            % (format(stats['triangles'], ','), format(target, ','), delta))
    log(job, line)
    return stats


def flag_difference(job, code, text):
    """机器判定的未解决差异。不许把失败项写成「遗留问题」后默认完成。

    只记录后端能实测的结论（UV、面数、阶段状态、对话中断）；AI 自述的差异仍留在 reply。
    """
    items = job.setdefault('openDifferences', [])
    if any(item.get('code') == code and not item.get('resolved') for item in items):
        return
    items.append({'code': code, 'text': text,
                  'at': int(time.time() * 1000), 'resolved': False})


def resolve_difference(job, code):
    for item in job.get('openDifferences') or []:
        if item.get('code') == code:
            item['resolved'] = True


def _record_uv(job, models):
    """从最终 GLB 实测 UV 覆盖率，和 _record_tris 一样不采信 AI 自述。

    色卡低模模式例外：UV 本来就收成点，展开覆盖率不适用，按色槽验收。
    """
    if not models:
        return None
    report = glb_stats.inspect_uv_file(models[0]['path'])
    if not report:
        return None
    job['uvReport'] = report
    if job.get('presetId') == PALETTE_PRESET:
        job['uvMode'] = 'palette'
        job.pop('uvCoverage', None)
        resolve_difference(job, 'uv_missing')
        resolve_difference(job, 'uv_coverage_below_target')
        log(job, '色卡模式：UV 按色槽收点，跳过展开覆盖率验收')
        return report
    job['uvCoverage'] = report.get('coverage')
    log(job, glb_stats.describe_uv(report, UV_COVERAGE_TARGET))
    if not report.get('hasUv'):
        flag_difference(job, 'uv_missing', '产物不含 TEXCOORD_0，UV / 贴图流程未验证')
    elif report['coverage'] < UV_COVERAGE_TARGET:
        flag_difference(job, 'uv_coverage_below_target',
                        'UV 有效去重覆盖 %.2f%% 低于 %.0f%% 预设，需人工定缝或重排'
                        % (report['coverage'] * 100, UV_COVERAGE_TARGET * 100))
    else:
        resolve_difference(job, 'uv_coverage_below_target')
        resolve_difference(job, 'uv_missing')
    return report


def start(job_id, prompt, base, headers, model, preset=None, skill_id='', target_tris=0):
    """Fire the build in the background; the HTTP call returns immediately."""
    task = asyncio.create_task(build(job_id, prompt, base, headers, model, preset,
                                     skill_id=skill_id, target_tris=target_tris))
    _attach_and_forget(task)
    return task


async def build(job_id, prompt, base, headers, model, preset=None, skill_id='', target_tris=0):

    job = dcc_bridge.load(job_id)
    work = Path(job['dir'])
    out_dir = work / 'out'
    out_path = out_dir / 'model.glb'
    out_dir.mkdir(parents=True, exist_ok=True)
    # 断点续跑时 router 会把 pipelineStage 置为 refine，这里不覆盖
    if job.get('pipelineStage') != 'refine':
        job['pipelineStage'] = 'blockout' if job.get('blockoutOnly') else 'full'

    preset = preset or {}
    preset_id = str(preset.get('id') or 'default')
    persona = str(preset.get('prompt') or '').strip()
    # 人设与同名手册绑定，忽略旧节点保存的独立手册选择。
    skill_id = preset_id
    skill, skill_src = _skill_text(skill_id, out_path)
    palette = preset_id == PALETTE_PRESET
    target = max(0, int(target_tris or 0))

    job['status'] = STATUS_BUILDING
    job['stage'] = '建模中'
    job['presetId'] = preset_id
    job['presetName'] = str(preset.get('name') or '通用助手')
    job['skillId'] = skill_src
    job['skillName'] = blender_skills.name_of(skill_src)
    job['skill'] = 'packs/blender-skills/%s' % skill_src if skill_src != 'builtin' else '内置'
    job['targetTris'] = target
    log(job, '开始建模：' + prompt[:120])
    log(job, '人设：%s · skill：%s' % (job['presetName'], job['skill']))
    if target:
        log(job, '面数目标：%s 三角面' % format(target, ','))
    head = ('# 你的角色\n%s\n\n' % persona) if persona else ''

    base_model = str(job.get('baseModel') or '')
    if base_model:
        base_path = work / 'in' / base_model
        job['mode'] = 'edit'
        job['stage'] = '改造中'
        log(job, '改造模式：基准模型 %s（%s）' % (base_model, job.get('baseModelLabel') or '模型资产'))
        text = head + (EDIT_BRIEF.format(prompt=prompt.strip(),
                                         materials=_materials_block(work / 'in', exclude=(base_model,)),
                                         base_path=base_path, import_code=_import_hint(base_path),
                                         out_path=out_path)
                       + skill)
    elif palette:
        text = head + (PALETTE_BRIEF.format(prompt=prompt.strip(),
                                            materials=_materials_block(work / 'in'),
                                            out_path=out_path, out_dir=out_dir)
                       + skill)
    else:
        text = head + (BRIEF.format(prompt=prompt.strip(), materials=_materials_block(work / 'in'),
                                    out_path=out_path, out_dir=out_dir)
                       + skill)
    text += _quality_brief(work, bool(job.get('blockoutOnly')),
                           job.get('pipelineStage') == 'refine')
    text += PALETTE_NOTE if palette else SHAPE_BRIEF
    # 面数目标放最后：人设和手册里都有面数表述，结尾这条要盖过它们
    text += _target_block(target, bool(job.get('baseModel')))
    refs = _ref_images(work / 'in')
    if refs:
        log(job, '参考图 %d 张随请求发送' % len(refs))

    async def emit(item):
        kind = (item or {}).get('type')
        if kind == 'tool':
            name = item.get('name') or item.get('tool') or ''
            state = item.get('status') or ''
            log(job, ('%s %s' % (name, state)).strip())
        elif kind == 'toolProgress':
            log(job, '%s %s' % (item.get('name', ''), item.get('message', '')))
        elif kind == 'progress':
            log(job, item.get('message', ''))

    async def approve(request):
        # Anything outside ALLOWED reaches this callback; refusing here stops the
        # call from ever touching Blender, and tells the model why.
        return {'granted': False}

    from core.canvas_agent import run_agent

    try:
        result = await asyncio.wait_for(run_agent(
            base, headers, model, text, {'nodes': [], 'connections': []}, ['blender'],
            emit=emit, approve=approve, preapproved=set(ALLOWED), include_media=True,
            media=refs, max_rounds=BUILD_ROUNDS,
        ), timeout=900)
    except asyncio.TimeoutError:
        saved = _salvage(job, '超时')
        if saved:
            return saved
        job.update({'status': STATUS_FAILED, 'stage': '超时', 'error': '建模超过 15 分钟，已放弃'})
        log(job, '超时：建模超过 15 分钟')
        return {'ok': False, 'error': '建模超时'}
    except Exception as exc:
        message = str(exc) or exc.__class__.__name__
        saved = _salvage(job, message[:120])
        if saved:
            return saved
        job.update({'status': STATUS_FAILED, 'stage': '失败', 'error': message[:400]})
        log(job, '失败：' + message[:200])
        return {'ok': False, 'error': message}

    reply = ''
    if isinstance(result, dict):
        reply = str(result.get('text') or result.get('reply') or '')

    produced = dcc_bridge.refresh(job)
    models = [item for item in produced if item['kind'] == 'model']
    if not models:
        saved = _salvage(job, '未完成最终导出')
        if saved:
            return saved
        job.update({'status': STATUS_FAILED, 'stage': '无产物',
                    'error': 'Blender 没有导出模型文件'})
        log(job, '结束：out/ 里没有模型文件')
        job['reply'] = reply[:2000]
        dcc_bridge.save(job)
        return {'ok': False, 'error': 'Blender 没有导出模型文件', 'reply': reply}

    awaiting = job.get('pipelineStage') == 'blockout'
    job.update({'status': STATUS_AWAITING if awaiting else STATUS_DONE,
                'stage': '灰模待审核' if awaiting else '已出模型',
                'reply': reply[:2000]})
    _record_tris(job, models)
    _record_uv(job, models)
    if awaiting:
        flag_difference(job, 'stage0_pending',
                        '灰模阶段产物待人工审核，未进入结构 / 材质细化；'
                        '放行后从同一作业的检查点续跑')
    else:
        resolve_difference(job, 'stage0_pending')
        resolve_difference(job, 'partial')
    log(job, ('灰模完成，停等人工放行：' if awaiting else '完成：')
        + ', '.join(item['name'] for item in models))
    return {'ok': True, 'reply': reply, 'products': produced,
            'awaitingApproval': awaiting}
