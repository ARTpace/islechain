# 游戏运行资产

美术资产节点或游戏开发节点的“游戏资产”入口打开独立管理窗口，可导入、替换、停用素材并填写用途。替换保留资产 ID，递增版本；已有候选与运行验证需重新执行。导入素材不代表 AI 已实际使用，应检查生成结果与试玩。

- 图片：PNG、JPEG、WebP，单帧，最大边 8192。
- 音频：WAV、MP3、OGG；播放需要用户点击或按键。
- 模型：自包含 GLB 2.0；不支持外部文件引用及 Draco、Meshopt、KTX2 压缩扩展。
- 模型单文件最多 100 MiB，图片/音频最多 32 MiB；项目当前素材合计最多 256 MiB。

AI 上下文只包含 ID、用途和元信息，不包含音频/模型二进制。维护工具 `inspect_asset` 可按需发送图片缩略图，要求渠道支持视觉；音频和模型检查只提供元信息。模型不支持视觉时会报告渠道错误，不自动重复请求。

生成代码使用 `GameAssets.loadImage(id)`、`GameAssets.createAudio(id, options)`、`GameAssets.loadModel(id)`。启用模型后内置 Three.js 0.180.0，模型返回 scene 和 animations；不需要运行时 CDN。安装 3D 起步场景会保存恢复点并替换入口，可用 WASD / 方向键移动。

试玩和候选回归在隔离页面临时内嵌资源，因此大素材会增加预览传输与内存占用。源码包、Web 包、正式包及项目资产包携带独立资源文件；导出后通过静态 HTTP 服务运行，GLB 在 file:// 下可能受浏览器限制。正式发布仍需填写素材许可证信息。

离线引擎源文件为 `templates/game-web-3d/runtime-entry.js`，使用 Three.js 0.180.0 和 esbuild 0.25.11：

```sh
esbuild templates/game-web-3d/runtime-entry.js --bundle --minify --format=iife --legal-comments=inline --outfile=templates/game-web-3d/three-runtime.js
```

重建需本地安装上述固定版本，保留 `three-LICENSE.txt`；该许可证随包含模型引擎的导出包交付。
