# 生图页面共用组件

新增工具页面优先复用以下实现，不复制已有页面整段代码：

| 公共资源 | 职责 | 页面保留的职责 |
|---|---|---|
| `static/css/studio-ui.css` | 主题变量、基础按钮与表单 | 专属页面布局 |
| `static/css/generation-ui.css` | 上传区外观、拖拽状态、进度条 | 上传区尺寸、遮罩定位、移动端布局 |
| `static/modules/upload-zone.js` | 单图文件选择、拖拽、粘贴事件 | 文件校验、上传接口、预览及业务状态 |
| `static/modules/comfyui-utils.js` | 将 ComfyUI 图片归档到用户目录 | 功能目录名、是否携带登录令牌 |

单图上传使用 `UploadZone.bind(uploadZone, fileInput, handleFileUpload)`，每个区域只绑定一次。多图、遮罩和多槽位上传继续使用对应业务实现，不强行套用单图组件。

图片归档调用 `saveToUserOutput(url, featureName)`；需要查询参数登录令牌的页面调用 `ComfyOutput.save(url, featureName, true)`。归档失败保留原始图片 URL，避免生成结果丢失。

页面内联脚本会直接调用这些模块，因此应在内联脚本之前同步加载。更新共享资源后，同时更新接入页面和 `static/index.html` 的缓存版本。

检查命令：`node tests/test_generation_shared.cjs`。覆盖归档参数、登录令牌、失败回退、上传事件、接入页面内联脚本语法与专用布局保留。
