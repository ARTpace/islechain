"""GLB 转其他格式（由 Blender 无头模式调用）。

用法：
    blender -b --factory-startup --python scripts/glb_convert.py -- <src.glb> <dst> <fmt>

fmt 支持 stl / obj / fbx / usdz / gltf。
"""

import os
import sys

import bpy


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) < 3:
        print("CONVERT_FAIL 参数不足")
        sys.exit(2)
    src, dst, fmt = argv[0], argv[1], argv[2]
    fmt = fmt.lower()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    if fmt == "stl":
        bpy.ops.wm.stl_export(filepath=dst, apply_modifiers=True)
    elif fmt == "obj":
        bpy.ops.wm.obj_export(filepath=dst, export_materials=False, apply_modifiers=True)
    elif fmt == "fbx":
        bpy.ops.export_scene.fbx(filepath=dst, embed_textures=False, mesh_smooth_type="FACE")
    elif fmt == "usdz":
        bpy.ops.wm.usd_export(filepath=dst, export_materials=False, export_textures=False)
    elif fmt == "gltf":
        bpy.ops.export_scene.gltf(filepath=dst, export_format="GLTF_SEPARATE")
    else:
        print("CONVERT_FAIL 不支持的格式 " + fmt)
        sys.exit(2)

    if not os.path.isfile(dst):
        print("CONVERT_FAIL 未生成文件")
        sys.exit(3)
    print("CONVERT_OK " + str(os.path.getsize(dst)))


main()
