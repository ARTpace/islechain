# 3D 生成（Hyper3D / 混元图生低模与拓扑）

页面：`/static/app/rodin3d.html`，入口在左侧栏「ComfyUI 应用 → 3D 生成」。
前端不直连外部服务，全部请求经 `routers/rodin3d.py` 转发到本机 webai2api。

## 混元图生低模

平台选择「混元 3D」→「生成」，上传、粘贴或沿用当前参考图；输入目标面数并选择三角面或四边面。
来源切换和参数均直接可达，不经过管理菜单。图片要求 PNG/JPEG/WebP、最大 10MiB、宽高至少 128 像素。
目标面数 100～60,000，默认 20,000；图生低模没有自适应开关。
可先点击「免费预检（不生成）」；「生成低模（消耗额度）」才正式提交。
成功后复用现有模型预览、资产历史和下载，不提供 Hyper3D 专属重做或提示词。

接口 `POST /api/rodin3d/generate`：

```json
{
  "provider": "hunyuan",
  "image": "<dataURL、现有图片路径或图片 URL>",
  "topology": "quad",
  "face_count": 20000,
  "dry_run": true,
  "idempotency_key": "<每次操作的唯一键>"
}
```

混元默认免费预检；明确传 `dry_run: false` 才生成。转发模型为 `hunyuan_3d/image-to-low-poly`。
未传 `provider` 的旧调用保持 Hyper3D 行为。混元请求不自动重试，连接中断先检查网站资产记录。
更新后需重启 art-canvas 和 webai2api，再刷新页面；沿用现有混元 Worker 和登录会话。

## 混元低模拓扑

平台选择「混元 3D」→「拓扑」，上传 OBJ / GLB / FBX，或一键使用已载入的当前模型。
输入最大 24MiB；超过限制的当前模型会禁用复用按钮，需要先在建模软件中简化。
选择四边面（默认）或三角面后，可直接「免费预检（不生成）」或「开始拓扑（消耗额度）」。
默认使用自适应面数；关闭「自适应面数」后可直接输入目标面数（100～60,000，初始值 20,000）。
预检与正式提交都会传递设置；实际输出面数以网站结果为准。这是模型拓扑处理，不是图片生成模型。

前提：webai2api 已配置 `hunyuan_3d/low-poly`，并完成混元网站登录。
登录流程参见 `../webai2api/docs/hunyuan-3d.md`；与 Hyper3D 共用本页的 webai2api 地址和凭据。
成功后共用现有 GLB 预览、历史资产和格式下载；不会调用 Hyper3D 的免费重做接口。
免费预检不进入资产列表。提交只发送一次；连接中断或 `needs_review` 时先检查混元网站记录，勿直接重复提交。

接口 `POST /api/rodin3d/topology`：

```json
{
  "filename": "prop.glb",
  "base64": "<标准 base64，不含 dataURL 前缀>",
  "topology": "quad",
  "dry_run": true,
  "idempotency_key": "<每次操作的唯一键>"
}
```

使用当前模型时，用 `"source_task_id": "<已完成的本地任务号>"` 替代 `filename` 和 `base64`。
指定面数时增加 `"face_count": 20000`，省略或设为 `null` 表示自适应。
服务端默认 `dry_run: true`；只有显式设为 `false` 才真实提交并消耗网站额度。
请求转发到 webai2api `POST /v1/3d/tasks`，使用模型 `hunyuan_3d/low-poly` 和 `params.topology`。
状态与文件仍通过 `/api/rodin3d/task/{id}`、`/api/rodin3d/task/{id}/file` 获取。
混元产物使用 `hunyuan3d` 存储分类，历史项携带 `provider: "hunyuan"`；旧任务默认 `hyper3d`。

## 为什么这样接

Rodin 网页在**未确认模型**时就会下发带签名的预览网格（`.drc`），确认那一步才扣积分。
webai2api 负责开浏览器、提交、抓详情、把 `.drc` 解码成 `.glb`；art-canvas 只做调用方和落盘方，
不重复实现浏览器自动化，也不依赖 Hyper3D 官方 API Key。

代价：预览网格只有裸几何，没有 UV 和材质。要做贴图得确认模型（花积分）或自己重拓扑。

## 数据流

```
前端选图 → POST /api/rodin3d/generate
        → webai2api POST /v1/3d/tasks        （异步，立刻返回任务号）
前端轮询 → GET  /api/rodin3d/task/{id}
        → webai2api GET  /v1/3d/tasks/{id}   （status=progress）
        → succeeded 时取 /file 落盘到 output，回填 file_url
前端预览 → GET  /api/rodin3d/task/{id}/file  （GLB 直出，不需要账号鉴权）
```

产物落在 `<用户数据目录>/output/image/rodin3d/<日期>/rodin3d_<任务前8位>_<时间戳>.glb`。

## 配置

`data/rodin3d.json`，页面上「连接设置」可改：

```json
{ "base_url": "http://127.0.0.1:3005", "api_key": "sk-..." }
```

未写 `api_key` 时自动读同父目录 `../webai2api/data/config.yaml` 的 `server.auth`，
所以两个项目并排放时不需要手动填。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/rodin3d/config` | 返回 base_url、凭据是否就绪、服务是否可达 |
| POST | `/api/rodin3d/config` | 保存 base_url / api_key |
| POST | `/api/rodin3d/generate` | `{image, effort, prompt?, resume_url?}`，image 支持 `/output`、`/assets` 路径、http 地址、dataURL |
| POST | `/api/rodin3d/topology` | 混元低模拓扑：上传模型或 source_task_id；默认免费预检 |
| GET | `/api/rodin3d/task/{id}` | 任务状态；succeeded 时自动落盘并返回 `file_url` |
| GET | `/api/rodin3d/task/{id}/file` | 下载 GLB（`model/gltf-binary`） |
| GET | `/api/rodin3d/history` | 已落盘的历史产物 |

`effort`：`low` / `medium` / `high`，默认 medium（100 万面左右，约 46MB）。
`resume_url` 填 `https://hyper3d.ai/workspace/rodin/{uuid}` 可直接取已算好的任务，不重新生成。

## 前端实现要点

- 布局：左侧浮层面板（参考图 / 精细度 / 提示词 / 生成 / 进度 / 结果 / 高级），右侧固定「资产」栏，中间全屏 3D 预览。
- 资产栏是历史任务网格（`/api/rodin3d/history`，3 列缩略图），点卡片即载入该任务的模型。
- 缩略图来源：模型在预览器里加载完成后，父页向 iframe 发 `capture-model-reference`，
  取回一帧 PNG，压到 240×240 JPEG 存在 localStorage（`rodin3d_thumbs_v1`，按任务 id）；
  没截过图的历史项显示立方体占位，点开一次就会补上。
- 预览复用共享预览器：`<iframe src="/api/model3d/viewer">`，与「贴图重绘」同一个组件，
  网格地面、右上角工具条、相机全部共用。父页把 GLB 取成 ArrayBuffer 后
  `postMessage({type:'load-model', buffer}, '*', [buffer])` 传进去，模型加载完回 `model-loaded`。
- 父页主动 `postMessage({type:'query-ready'})` 探活，收到 `model-ready` 才算就绪，最长等 20 秒。
- 页面支持 `?task=<id>` 直达，便于分享或刷新后回到刚才的模型。
- 预览区右边缘留出 304px 给右栏，工具栏与设置弹层都在自己的区域内，不再被面板压住。
- 右栏自上而下：资产数量 / 模型面数·顶点数·文件大小 / 地面网格开关 / 缩略图网格。
- 地面网格由预览器画：父页发 `{type:'set-grid', visible}`，预览器在模型包围盒底面铺一张
  `GridHelper`（12×r 略收敛到 7×r、56 格），默认关闭，只有本页会打开，其他页面观感不变。

## 已知限制

- Hyper3D 免费预览输出是裸几何：无 UV、无材质、无法线贴图；混元输出以网站结果为准。
- `/output/` 路径需要账号鉴权，所以页面统一用 `/api/rodin3d/task/{id}/file` 读文件。
- 大模型（100 万面）首次解析约 2–4 秒，低端机器可能更久。

## Tripo API 通道

参考图下方的「优化参考图」打开风格预设卡片：清晰建模参考、3D 风格化、低多边形、T 姿势、角色补全、照片转手办、雕塑白模、游戏资产。选择预设、图像编辑模型，可补充要求，点击「生成优化效果」预览。左侧可切换原图与当前版本，大图下方缩略图记录本次调整历史；选择任意版本后可继续优化。点击「确认采用当前版本」才替换外面的参考图，关闭窗口不采用。历史暂存在当前页面，刷新后清空。没有导入参考图时不可操作，不提供独立文生图或拆件入口。

共用工具在线模型及已接入参考图编辑的本地工作流，仅显示已知支持参考图的模型；未知能力或纯文生图模型不显示。结果先保留在优化窗口，确认后替换导入框的参考图，不加入右侧资产栏，不自动提交 3D 生成。任务提交一次后保存任务号，断线后再次点击仅查询已受理任务，避免重复生成。模型及密钥继续在工具原有设置中维护。

统一使用平台选择器切换 Rodin、混元 3D、Tripo。Tripo 的网页/API 通道通过标题栏插头图标一次点击切换，悬停显示当前通道；上传、功能图标、面数和生成按钮共用，按真实能力显示参数。项目与任务移到右侧资产栏。API 通道复用 Tripo Studio 的项目、任务、上传、加密凭据与付费提交接口；原 Tripo Studio 入口仍可使用。

Tripo 网页通道使用 `tripo_3d/h3.1`，提供免费预检和积分上限。现有适配器只支持提交，无法自动导出 GLB：提交后停止轮询并提供官网链接，不能当作已下载模型。新增网页通道需重启 art-canvas 后端。

- 模型操作入口：图生 3D、多视图、重拓扑、格式转换，按平台支持情况显示；图像编辑集中在参考图旁的优化按钮。
- 模型版本、几何/贴图质量、四边面、智能低模与面数范围按现有 Studio 契约联动。常用参数直接显示，面数使用滑条；低频导出朝向放在「其他参数」。
- 项目选择后，右侧资产栏仅显示该项目的模型资产与模型任务；点 GLB 直接预览。任务行提供下载、保存产出与后续处理入口；非 GLB 格式可下载或转换。项目原有图片不删除，仍可在导入框中选择。
- 「连接设置」配置站点及密钥，可用现有 Windows 用户加密机制保存；密钥不进入浏览器本地存储。国内/国际站账户独立，切站不会自动重试生成。
- 主按钮先创建免费待提交记录，确认积分提交后才调用付费接口；取消会丢弃本地待提交记录。提交状态不明时仅关联已存在的云任务，不自动重投。
- 切换通道一次点击，功能入口一次点击，连接设置一次点击；付费生成保留一次必要确认。

前端代码：`static/app/rodin3d-tripo.js`、`static/app/rodin3d-tripo.css`。共享模块通过 Tripo Studio 本机桥接的静态白名单提供，修改该白名单后需重启其 Node 子进程；普通前端修改刷新页面即可。
