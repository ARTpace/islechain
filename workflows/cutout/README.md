# 抠图工作流

包含 Lucida、BiRefNet-general、BiRefNet-HR-matting、BiRefNet_toonout、FeyNoBg、SAM3 六种 API 格式工作流，配置文件供工具的工作流列表读取。

- 输入节点 `3` 替换为上传后的原图名称，输出节点为 `5`。
- SAM3 的节点 `1.prompt` 是要保留的目标描述，推荐英文，例如 `person`、`cat`、`logo`。使用本机已有的 `sam3.1_multiplex_fp16` 权重。
- Lucida、BiRefNet 系列使用 ComfyUI-RMBG 的 `BiRefNetRMBG`；SAM3 使用 `SAM3Segment`。
- FeyNoBg 使用 `art-canvas-fey` 的 `ArtCanvasFeyNoBg` 节点，通过独立进程运行 Transformers 5，避免替换 ComfyUI 的 Transformers 4。

权重安装：使用 Python 运行 `tools/install_cutout_models.py --comfyui <ComfyUI目录>`。文件保存到 ComfyUI 的 `models`，支持续传并校验新下载的权重，不进入工具仓库。

FeyNoBg 独立依赖：使用 ComfyUI 自带 Python 执行 `-m pip install --target <整合包目录>/cutout-fey-runtime --no-deps -r tools/cutout-fey-requirements.txt`，安装脚本会将推理入口放入此目录。独立进程会重新加载模型，首次处理耗时较长。

新增节点安装后需重启 ComfyUI；工具后端重启后会重新发现这些工作流。各模型许可遵循其原始项目。
