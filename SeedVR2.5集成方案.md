# SeedVR2.5 接入 F2K 高清修复页 — 实施计划

## 目标
在 `gaoqingxiufu.html` 新增 **SeedVR2.5 超分** 模式,与现有 F2K 风格修复并列。
- 同一页 Tab 切换
- 2K / 4K 切换(纯超分,不需要 prompt)
- 默认 2K,4K 手动点
- 替换现有 1K/1.5K/2K/3K/4K/×2/×3/×4 按钮为 2K/4K(因为 SeedVR2 内部已按长边 resize)

## 工作流结构分析(SeedVR2.5_image enlargement.json)

**两个超分输出预览节点:**
- 节点 65 = 2K 单遍预览(`PreviewImage`, 来源 node 4)
- 节点 60 = 4K 路径预览(`PreviewImage`, 来源 node 52)
  - 4K 路径:11→66→4→41→48(分块 3×3)→57(缩 0.5)→50(再升)→52(拼回)→60

**输入参数覆盖点(前端可改):**
| 节点 | inputs | 说明 |
|------|--------|------|
| 11 | image | LoadImage 文件名(必传) |
| 7 | value=2048 | 2K 目标长边(可让前端覆盖) |
| 4 | seed, resolution, max_resolution, batch_size | 2K 升频器 |
| 50 | seed, resolution=1024, max_resolution | 4K 升频器 |
| 59 | width_factor=3, height_factor=3, overlap_rate=0.1 | 4K 分块倍率 |
| 41 | width, height, interpolation, method | resize 控制(输入是 node 4) |

**关键: 通过选择 2K/4K,决定"哪条路径产生预览图"=通过修改节点 60 / 65 哪个 disable / mute,或前端仅在拿到结果时按 mode 选 url.**

## 现有 模式切换参考
- `zimage.html` 顶部 dropdown + `currentWorkflow` + `/api/workflows/builtin` 动态加载 + 缓存到 `_wfCache`
- `litevideo.html` 独立页,工作流 dropdown 选 LTX23 等
- `image-edit/*` 系列多 ref 工作流,每工作流独立 config.json

## 数据/历史
- 现有 gaoqingxiufu 历史: `/output/gaoqingxiufu/` 目录 + history.json 中 `type: "gaoqingxiufu"`
- SeedVR2.5 输出也存到同一目录(共用 `type: "gaoqingxiufu"`,但加个 `mode: "seedvr2" | "f2k"` 字段区分即可)
- gallery list.js 按 type 拉历史 → 同 type 就会一起显示,自动支持

## 实施步骤
1. **新建** `workflows/SeedVR2.5-2K-4K.json` — 精简版(删调试节点 53/54/55/56 + Image Comparer 12/45)
   - 保留 11/66/4/7/65/2/6/41/47/48/57/50/49/46/52/60/63
2. **新建** `workflows/SeedVR2.5-2K-4K.config.json` — config schema
   ```json
   {
     "title": "SeedVR2.5 超分(2K/4K)",
     "fields": [
       {"node":"11","param":"image","label":"输入图像","type":"upload","required":true},
       {"node":"4","param":"seed","label":"随机种子(2K)","type":"number"},
       {"node":"50","param":"seed","label":"随机种子(4K)","type":"number"},
       {"node":"59","param":"width_factor","label":"4K 分块倍率","type":"number","min":2,"max":4,"step":1}
     ]
   }
   ```
3. **改造** `gaoqingxiufu.html`:
   - 顶部加 mode Tab(默认 F2K)
   - 切换 mode → 切换 WORKFLOW_CONFIG(从 /api/workflows/builtin 加载 + 缓存)
   - 缩放按钮组改为 2K/4K(只在 seedvr 模式显示)
   - 提示词 textarea 隐藏(纯超分不用)
   - 降噪/seed 等参数按 mode 显隐
   - nodeMappings 动态从 config.json 生成
4. **后端**:无需大改;generate 端点已经支持任意 workflow_data
5. **测试**:上传图 → 2K 模式出图 → 切 4K 出图 → 切 F2K 走原路径

## 文件改动清单
- 新建 `workflows/SeedVR2.5-2K-4K.json`
- 新建 `workflows/SeedVR2.5-2K-4K.config.json`
- 改 `static/app/gaoqingxiufu.html`(主要工作)
- 备份原文件:`gaoqingxiufu.html` → `gaoqingxiufu.html.bak.20260725-...`

## 风险点
1. SeedVR2 4K 路径显存占用大,前端需要显存预估(参考 litevideo 写法)
2. 工作流加载要异步,首屏需 loading 态
3. 2K 节点 4 和 4K 节点 50 都需要 seed,前端切换 mode 时要分别更新两个 seed
4. 4K 模式会跑两次 SeedVR2 upscaler(node 4 + node 50),时间较长,进度条要分段
