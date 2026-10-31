# art-canvas AI — 领域术语表

## 核心概念

### 无限画布 (Canvas)
用户创作的无限大虚拟空间，支持节点编辑、连接管理、视口缩放/平移。数据以 JSON 格式存储在 `data/canvases/` 目录。

### 节点 (Node)
画布上的基本组成单元，包含 14 种类型：`image`（图像节点）、`text`（文本节点）、`prompt`（提示词节点）、`llm`（LLM 节点）、`generator`（API 生成器节点）、`msgen`（ModelScope 生成器节点）、`comfy`（ComfyUI 工作流节点）、`output`（输出节点）、`loop`（循环节点）、`video`（视频节点）、`ltxDirector`（LTX Director 多段视频导演台节点，依赖工作流 `LTXDirectorv2-API.json`，需要 ComfyUI 装 [WhatDreamsCost/WhatDreamsCost-ComfyUI](https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI) 自定义节点）、`ps`（Photoshop 节点）、`group`（图像组节点）、`promptGroup`（提示词组节点）。LTX Director 集成细节见 `LTXDirector集成方案.md`。

### 输出文件夹 (Output Folder)
每个画布在 `output/` 目录下拥有的专属子文件夹，命名规则为 `画布标题_画布ID前8位`。画布生成的所有文件存入该文件夹，实现多用户文件隔离。

### 资产库 (Asset Library)
画布的附属功能，为每个画布在 `input/` 目录下创建专属资产文件夹。支持上传图片、从画布拖入图片、管理资产文件。预留了保存工作流和保存画布的未来扩展点。
在线生图等独立页面可通过 `POST /api/user/assets/save-from-url` 将图片保存到用户级资产目录 `input/{safe_username}/`。
画布的资产库列表会自动合并用户级资产目录中的文件，实现跨页面资产互通。

### 资产文件夹 (Asset Folder)
每个画布在 `input/` 目录下的专属文件夹，命名规则为 `画布标题_画布ID前8位`。与输出文件夹采用相同的命名策略。
在线生图页面等无画布场景使用用户级资产目录 `input/{safe_username}/`，通过 `get_user_input_dir(username)` 自动创建。

### 资产文件 (Asset File)
存放在资产文件夹中的用户资产文件，包括图片、工作流文件、画布快照等。目前支持图片资产，预留工作流和画布资产类型。

## 文件存储

### 生成物落盘目录（统一入口 `media_paths.resolve_media_dir`）

所有图片/视频/音频的落盘都必须走 `media_paths.resolve_media_dir()`，禁止在业务代码里手拼路径。
唯一例外是画布内出图：它按 `output/{owner}/{画布标题}_{ID前8位}/` 归属（同一画布的产物聚在一起，便于画布资产浏览），不再切类型层。

```
output/{owner}/{type}/{feature}/{YYYY-MM-DD}/{filename}
```

| 段 | 取值 | 说明 |
|----|------|------|
| `owner` | `safe_user_id(username)` | 空串表示不分用户，此时该层省略 |
| `type` | `image` / `video` / `audio` | 见下方类型判定优先级 |
| `feature` | 注册表 `folder`，否则 feature id | 模型/功能标识，如 `zimage`、`cutout` |
| `date` | `YYYY-MM-DD` | 落盘当天，便于按日清理 |

**类型判定优先级**（`media_paths.type_of`）：
1. 人工登记（`auto: false`）—— 权威，不被调用方覆盖
2. 调用方显式传入的 `kind`
3. 自动登记（`auto: true`）—— 首次落盘猜的，允许被显式 `kind` 纠正
4. 文件扩展名（`.mp4`→video、`.wav`→audio、`.png`→image）
5. 默认 `image`

第 2 条排在第 3 条之前，是为了让「同一模型既出图又出视频」能正确分流到两个类型目录。

**注册表**（`data/media-folders.json`）：
- 随包只读基线 + `%APPDATA%\art-canvas\data\media-folders.json` 用户覆盖层（升级不丢）
- 未登记的 feature **首次落盘时自动登记**（带 `auto: true`、`first_seen`、`sample`），零配置即可用
- 想改中文展示名 / 分组 / latin 目录名，只改覆盖层，不动代码

**新增模型/工作流要做什么**：
- 什么都不做也能跑：落盘自动规范、自动登记、画廊自动发现（`/api/media-registry`）
- 可选：在 `static/modules/model-features.js` 的 `MAP` 里加一行，指定画廊排序优先级与别名
- 可选：在覆盖层注册表里补 `label` / `group` / `folder`（中文名建议给 latin folder）

### 用户输入/资产目录

```
input/{owner}/                       # 与 output 同级，跟随静态路由根（ASSETS_DIR = INPUT_DIR）
├── {画布标题}_{画布ID前8位}/          # 画布资产文件夹
├── asset_xxx.png                    # 在线生图/独立页面保存的资产
└── ai_ref_xxx.png                   # AI 参考图上传
```

### 用户文件夹命名

用户文件夹名通过 `safe_user_id(username)` 函数生成：
- 只保留字母、数字、`_`、`.`、`-`
- 非 ASCII 字符（如中文）转为 `-`
- 截断到 80 字符
- 例如：`admin`、`xingyue`、`---`（中文"魔搭"）

## 文件隔离机制

### 用户级文件隔离
- 所有生成/上传的文件按用户存储在各自的子目录中
- 用户 A 无法看到用户 B 的任何文件
- 设计决策记录详见 `docs/adr/`

### 历史记录用户隔离
- 所有历史记录（`history.json`）按用户隔离，每条记录包含 `user` 字段
- **在线生图、GPT 对话、ComfyUI 代理模式**：后端调用 `save_to_history()` 时自动写入 `user` 字段
- **直连模式独立应用**：前端通过 `/api/history/save` 保存，`auth-token.js` 自动携带 token，后端提取用户名并写入 `user` 字段
- **历史查询**：`/api/history` 根据 token 按用户过滤，仅返回当前用户的历史记录
- **历史删除**：`/api/history/delete` 验证记录归属，仅允许删除自己的记录
- **直连模式图片下载**：`/api/history/save` 自动识别 `http://127.0.0.1:8188/view` 的直连图片，下载到 `output/{safe_username}/` 目录后替换 URL

### 预留功能
资产库面板底部预留了"保存工作流"和"保存画布"按钮入口，以灰色禁用状态展示，点击提示"即将推出"。

---

## 账号与认证

### 用户 (User)
系统的使用者，通过用户名和密码注册/登录。用户数据存储在 `data/users.json`。

### 超级管理员 (Super Admin)
用户名固定为 `admin` 的用户，拥有系统最高权限。超级管理员可以打开左下角设置面板，配置 API Key、管理 ComfyUI 工作流等。普通用户可以看到设置按钮但无法点击。

### 认证令牌 (Token)
用户登录后由后端生成的 UUID 令牌，前端存储在 `localStorage`。每次页面刷新时通过 `/api/auth/me` 验证令牌有效性并获取用户角色信息。

### 登录态 (Login State)
前端维护的用户认证状态，包含：是否已登录、当前用户名、是否为超级管理员。登录态用于控制 UI 元素的可用性（如设置按钮仅超管可点击）。
