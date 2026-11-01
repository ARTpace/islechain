# 抠图工作流

`matting.json`（抠图合集 · 多模型）是工具当前使用的统一工作流，可直接拖入 ComfyUI 编辑。

- 一键抠图、文字抠图、画布抠图/半透明抠图及图片卡片抠图均从此文件提取所需分支。
- 工具按分支输出节点追溯依赖，只提交所选分支，不受编辑器静音状态影响。
- RMBG 的 BEN、BEN2、INSPYRENET 共用 BEN2 分支结构，RMBG-2.0 有独立分组。当前安装的 RMBG 不支持 RMBG-1.4，旧画布中的该选项兼容映射至 RMBG-2.0。
- 文字抠图使用 SAM3Segment 的 prompt 参数，不再通过 CheckpointLoaderSimple 加载 SAM3 模型。
- Qwen-Image-2.1 已加入第 11 组，保留原工作流的两处加密核心节点，默认关闭。该组登记在 `extra.cutout.pending_branches`，未加入可调用分支及模型菜单；本机缺少 RHHiddenNodes、原版 BF16 主模型和文本编码器，需要解密密码及节点或未加密版本后继续验证。现有量化模型未自动替换。不能仅凭“透明背景”提示词认定输出带 Alpha 通道。
- ComfyUI 手动运行时默认仅启用 BEN2，其他分支用 Mode → Always / Never 切换。
- SDMatte 需要遮罩，输出沿用原流程的裁切尺寸；画布未提供独立遮罩时沿用原有图像 MASK 输入。

维护时修改此文件的节点参数、连线和说明。保留 `extra.cutout.branches` 中的分支名称及旧节点 ID 映射；节点 `properties.widget_names` 与 `widgets_values` 按顺序对应。新增或替换节点时同步更新映射和字段名。界面上传的图片、模型选择及用户设置在调用时覆盖文件默认值。

升级 ComfyUI 插件后，应对照 `/object_info/节点类型` 校验控件顺序；例如 RMBG 和 BiRefNet 的 `unload_model` 位于 `background` 前，缺项会导致 ComfyUI 导入时参数错位。

## 非视频补充方案（第 12—20 组）

来源：用户提供的《抠图多方案工作流多方案合集_附指引及模型介绍》。九种非视频方案均已接入一键抠图、画布及图片卡片菜单；保留原来的默认模型。ComfyUI 编辑器中新增分组默认关闭，共用原图。

| 分组 | 状态 |
| --- | --- |
| TransparentBackgroundUltra | 已安装，实际推理成功，输出带有效 Alpha |
| SegmentAnything Ultra V2 / V3 | 节点及模型已安装，实际推理成功，输出带有效 Alpha |
| 自动分割 → SDMatte | 模型已安装，实际推理成功，输出带有效 Alpha |
| 透明材质 → SDMatte Plus | 模型已安装，实际推理成功，输出带有效 Alpha |
| BiRefNet Ultra V2 + VITMatte | 已安装，实际推理成功，输出带有效 Alpha |
| BiRefNet Hugo + 遮罩微调 | 已安装，实际推理成功，输出带有效 Alpha |
| BiRefNet Zho | 已安装，实际推理成功，输出带有效 Alpha |
| RembgByBiRefNet | 已安装，实际推理成功，输出带有效 Alpha |

语义方案需要填写英文目标，例如 person、cat、product；无需云端翻译。这批精修方案只输出透明背景，不接受普通 RMBG 的背景颜色与高级参数。菜单根据 ComfyUI 当前节点和参数兼容性动态显示。未加入视频，也未重复加入已有普通 SAM3 / INSPYRENET。

### 本机新增依赖

- `custom_nodes/ComfyUI-BiRefNet-Hugo`：MoonHugo/ComfyUI-BiRefNet-Hugo。
- `custom_nodes/ComfyUI_BiRefNet_ll`：lldacing/ComfyUI_BiRefNet_ll。
- `custom_nodes/ComfyUI-BiRefNet-ZHO`：ZHO-ZHO-ZHO/ComfyUI-BiRefNet-ZHO。已将插件内部绝对导入改为相对导入，解决与 ComfyUI 的 utils/models 模块冲突；升级插件可能覆盖这些兼容补丁。
- `models/transparent-background/InSPyReNet_SwinB_Plus_Ultra.pth`：LayerStyle Advance 作者提供的权重。
- `models/BiRefNet/Hugo-General/`：ZhengPeng7/BiRefNet 的完整本地模型及配置，Hugo 分支已设置本地加载。
- Zho 与 Rembg 分别复用已有 `BiRefNet-ep480.pth`、`RMBG/BiRefNet/BiRefNet-general.safetensors`（通过 `extra_model_paths.yaml` 的 `birefnet` 搜索路径共享）。
- 语义模型采用原合集指定的 SAM ViT-H 与 GroundingDINO SwinT；BERT 使用 google-bert/bert-base-uncased，已下载至 models 下各自目录。
- `models/SDMatte/SDMatte.safetensors` 与 `SDMatte_plus.safetensors`：1038lab/SDMatte（ModelScope 镜像续传，与 Hugging Face 原版 SHA-256 一致）；各约 5.2 GB，配套 SD 2.1 配置保留于 diffusers/stable-diffusion-2-1-base。

九种新增方案均已使用本机 ComfyUI 实际推理，并检查输出为 RGBA、Alpha 具有透明与不透明像素。

推理记录：`artifacts/cutout-new-method-verification.json`。执行成功与 Alpha 通道检查不代表已验证所有复杂材质的视觉效果。

旧的独立抠图 JSON 及配套配置已移除，统一维护本文件。修改后刷新页面即可，工作流每次调用重新读取；更新程序代码需重启工具。
