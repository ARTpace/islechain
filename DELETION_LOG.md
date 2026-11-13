
## 2026-11-01：移除旧独立抠图工作流

用户确认整合后删除旧文件；所有抠图入口已使用 `workflows/cutout/matting.json`。

- `workflows/一键抠图.json`
- `workflows/一键抠图.config.json`
- `workflows/文字抠图.json`
- `workflows/文字抠图.config.json`
- `workflows/SDmatte-1.json`
- `workflows/SDmatte-1.config.json`
- `workflows/cutout/lucida.json`
- `workflows/cutout/lucida.config.json`
- `workflows/cutout/birefnet-general.json`
- `workflows/cutout/birefnet-general.config.json`
- `workflows/cutout/birefnet-hr-matting.json`
- `workflows/cutout/birefnet-hr-matting.config.json`
- `workflows/cutout/birefnet-toonout.json`
- `workflows/cutout/birefnet-toonout.config.json`
- `workflows/cutout/fey-no-bg.json`
- `workflows/cutout/fey-no-bg.config.json`
- `workflows/cutout/sam3.json`
- `workflows/cutout/sam3.config.json`

同步移除用户工作流目录中内容一致的旧副本；保留内容有修改的副本。相关回归检查见 tests/test_image_cutout.py。


## 2026-11-01 Duplicate model consolidation

- Z-Image-Enhance uses qwen_image_vae.safetensors; removed identical models/vae/ae.safetensors.
- Rembg branch uses BiRefNet-general.safetensors via ComfyUI extra_model_paths.yaml; removed identical models/BiRefNet/General.safetensors.
- Retained canonical weights under models/RMBG/BiRefNet and models/vae. Original workflows backed up at H:\AI-Tools\ComfyUI_TE\model-dedup-backup-20261101-021943.
- Validation: 18 cutout tests passed, full SHA-256 equality and startup path resolution checked. No inference run. Restart ComfyUI to load new search path.

## 2026-11-05 移除旧版 3D 预览节点

- 删除 static/nodes/model3d/index.js 及页面加载、初始化和独立渲染入口，统一使用模型资产节点。
- 旧 model3d 数据打开时原地迁移，保留 ID、坐标、模型文件和连线；迁移失败保留原数据并提供重试。
- 避免迁移项目时自动补出整套游戏工作流节点。
- 备份分支：backup/clean-20261105-legacy-model3d；旧模块工作区备份：.backups/legacy-model3d-20261105/index.js。
- 验证：模型资产及材质复用专项测试通过，三个受影响 JS 文件语法检查通过，独立旧模块引用搜索无残留。未运行全量测试或真实页面视觉验收。
