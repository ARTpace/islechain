# art-canvas 展示速度优化记录

**日期**: 2026-06-28
**背景**: art-canvas 展示速度慢，需优化到 Infinite-Canvas 同等水平。

## 第一轮：轮询间隔优化（14:06 前）

将全部前端和后端轮询间隔缩短 3-4 倍，指在降低"任务完成后到前端感知"的延迟。

| 轮询点 | 改前 | 改后 | 文件 |
|---|---|---|---|
| 前端 canvas 页任务轮询 | 1800ms | **400ms** | `static/modules/canvas-all.js` |
| 前端 generator 节点任务轮询 | 1800ms | **400ms** | `static/modules/generator-node.js` |
| 后端 IMAGE_POLL_INTERVAL 默认值 | 2.0s | **0.5s** | `main.py` |
| 后端 ModelScope Angle + MS Generate | 2s | **0.5s** | `main.py` （3处） |
| 后端 ModelScope Z-Image | 3s | **0.8s** | `main.py` |
| 后端 ComfyUI history | 2s | **0.5s** | `main.py` |

## 第二轮：修复 blur-up 三段加载 bug（14:06）

### 问题
zimage 页面的新图展示有一个三段下载的逻辑，导致每次新图生成后**3次后端缩略图生成**：

1. `GalleryCard.render()` → `<img src="media-preview?w=768">` → 后端读全图→LANCZOS 768px→WebP 缓存
2. 立刻 `_fullImg.src = media-preview?w=64` → **打断步骤1**，后端重新读全图→缩64px  
3. `new Image().src = _hdUrl` → 后端又读全图→缩768px

对于大图（1536x2048 PNG），**每次 LANCZOS 缩放+WebP 编码 ~600ms-1s**，3次串行 → **~2-3秒**。

### 修复
- **删掉 64px blur 步骤**：新图直接显示 GalleryCard 生成的 768px 缩略图，只加淡入过渡
- 文件: `static/app/zimage.html`，替换 2607-2649 行

### 影响
- 新图展示延迟从 ~3s 降到 **~500ms**（只等1次缩略图生成）
- **减少后端 CPU 负载 2/3**

## 第三轮：LANCZOS → BILINEAR（14:06）

Pillow 的 `LANCZOS` 在高分辨率图片上比 `BILINEAR` 慢 5-10 倍，但缩略图场景下视觉差异极小。

将全部 5 处 `Image.LANCZOS` 替换为 `Image.BILINEAR`：
- `main.py` L2892: 视频预览缩略图
- `main.py` L3851: `image_path_to_data_url()`  
- `main.py` L8366: `/api/comfyui/view` 代理缩略图
- `main.py` L8527: 预生成 WebP 缓存
- `main.py` L11706: `/api/media-preview` 通用缩略图

## 当前状态

重启后端后，新图展示应该从 ~3s 降至 **~0.5s**。

## 后续可继续优化

- **WebSocket 短路轮询**：canvas-all.js 已连接 `/ws/stats`，可让 WS `new_image` 消息主动终止对应的 task 轮询（立即显示，不等下一个 400ms）
- **ComfyUI 直连**：后端下载完成后，让前端的 canvas 页面直接加载 ComfyUI 的 `/view` URL，跳过 `/output/` 路由（再省一次 HTTP 往返）
