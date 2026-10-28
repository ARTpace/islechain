# 元宝风格批量导出

无需逐项点击。浏览器脚本复用元宝自己的登录会话和模板 API，按分类分页读取、按模板 ID 去重，并补查缺少提示词的详情。它不发送生图请求，也不读取或导出 Cookie、令牌和聊天记录。

## 1. 导出完整数据

在可以打开开发者工具的浏览器中登录 https://yuanbao.tencent.com/chat/ai-creation ，确保风格卡片已经出现。按 F12 打开 Console，把 `browser-export.js` 的完整内容粘贴执行一次。完成后浏览器下载 `yuanbao-export.json`。

如果浏览器提示不允许粘贴，先阅读并确认脚本内容，再按浏览器自身提示操作。不要把账号凭证粘贴到脚本中。

脚本使用的模块号和接口结构已对照 2026-10-27 的公开页面代码，尚未在真实会话中完成端到端 API 导出。平台升级可能使模块号失效；出现“启动失败”时不要修改登录信息，保留控制台报错用于定位。

## 2. 下载封面和参考图

使用 Node.js 22 或更高版本执行：

```powershell
node H:/AI-Tools/art-canvas/tools/yuanbao-export/download.mjs "C:/Users/zhengyuliang/Downloads/yuanbao-export.json" "H:/AI-Tools/art-canvas/artifacts/yuanbao-styles-20261027/full"
```

输出 `styles.json`、`report.json` 和 `images/`。封面、原始参考图分别记录本地相对路径，保留远程地址、完整提示词、分类、上传张数限制及来源元数据。图片按接口提供的地址下载，不擅自去掉缩图参数。部分平台“风格”实际需要参考图，应保留上传要求。

下载并发为 6，每张失败重试一次，可重复运行复用已有图片。查看 `report.json` 的 `complete`、`extractionErrors`、`missingPrompts` 和 `failures` 判断完整性；仅当全部成功时 `complete` 才为 true。

不会自动合并或覆盖 `data/style-presets.json`。整个数据包是独立备份。

## 3. 接入 art-canvas

下载报告 `complete` 为 true 后运行：

```powershell
python H:/AI-Tools/art-canvas/tools/import_yuanbao_styles.py "H:/AI-Tools/art-canvas/artifacts/yuanbao-styles-20261027/full"
```

导入器先备份原风格库，再新增或更新“腾讯元宝”分类。图片复制到 `user_paths.py` 指定的用户数据目录，复用现有 `/api/thumbnails/` 接口；重复导入不会重复增加分类。可用 `--home` 明确指定运行服务的 `ART_CANVAS_HOME`。

每个模板保留完整提示词、来源分类、图生图/文生图类型、参考图和上传张数限制。一个模板只进入一个主分类，避免在现有选择器中重复显示。刷新风格库或重新打开页面即可读取；无需重启后端。需要参考图的模板仍需自行上传素材，不会自动把示例参考图用于生成。

在导入命令末尾添加 `--online` 可使用元宝原始在线封面和参考图地址，不再复制图片。已有本地图片和下载备份不会删除；图片加载依赖元宝服务，缓存由浏览器及图片服务器的 HTTP 缓存策略控制。
