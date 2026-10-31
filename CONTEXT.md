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

### 风格预设（风格包）

风格提示词不再是一个 41 MB 大文件，而是**可独立分发的包**。完整数据（22,248 条 / 45 MB）
**不进仓库、不进分发目录**，仓库和安装包只带精简种子包，其余按来源平台打成 zip 由用户自选安装：

```
data/style-packs/art-canvas-seed/             # 种子包（2026-10-31 起不进 git，随安装包；约 2.5 MB / 1,872 条）
├── pack.json                                 # 清单：包元信息 + 分类顺序，不存内容
├── painting.json                             # 一个分类一个文件，文件名恒等于分类 id
└── ...

data/style-packs-source/art-canvas-core/      # 完整源包（切料，不进 git、不进安装包）
data/style-packs-official/*.zip + catalog.json # 安装包内的可选平台包（进安装包，不进 git）
dist/style-packs/                             # 同上，开发机生成位置（不进 git）

%APPDATA%\art-canvas\style-packs/<packId>/    # 用户安装/导入的包（不进 git）
%APPDATA%\art-canvas\data\style-overlay.json  # 用户自己加/改/删的单条（几 KB，不进 git）
```

> **2026-10-31 起：所有内容资源外置。** 数据、预设、缩略图一律不进 git，
> 仓库只保留代码与配置（`character-features.json` / `style-packs-config.json`
> / `animadex-version.json` / `media-folders.json`）。
> 离线资源包：`H:\AI-Tools\art-canvas-resources\art-canvas-data.zip` 与
> `art-canvas-images.zip`，解压到项目根即恢复，程序按原路径读取，无需改配置。
> 缺失时全部降级为空且不报错（已实测），构建脚本也会只警告不阻断。

**命名规范**：文件名只表示「是什么」，恒等于分类 id；**排序只由 `pack.json` 的 `order` 决定**。
调顺序永远不用重命名、也不用改数据文件，命名与排序彻底解耦。

**order 约定**：内置分类从 100 起、步长 10（插队用 105 这类值）；用户包默认 500；overlay 新建分类固定排末尾。

**合并规则**（`style_packs.merged_categories()`）：
1. 包优先级：内置包 > 用户包（各自按 `order`，再按 `packId`）
2. 分类按 `order` 全局升序，同 id 只出现一次
3. 子分类按 id 合并，预设按 id 去重——后出现的覆盖字段、保留首次出现位置
4. overlay 最后应用：先删、再改、后加

**新增/修改风格的三条路**：

| 目的 | 改哪里 | 进 git |
|---|---|---|
| 自己用，改完立刻生效 | 界面或 `POST /api/style-presets/items` → 写 overlay | 否 |
| 想让新风格随包出厂 | 改 `data/style-packs/art-canvas-seed/<分类>.json` | 否（本地资源，已外置） |
| 整套分发 | 打成 zip 交用户导入，或放进 `%APPDATA%\art-canvas\style-packs\<packId>\` | 否 |

**按平台拆分分发**：`tools/style_pack_split.py split` 读 `data/style-packs-config.json`
（种子分类清单 + 平台匹配规则）生成种子包与平台包。新增来源平台只改配置里的 `platforms`，不用改代码。

| 包 | 条目 | zip 体积 |
|---|---|---|
| `art-canvas-seed`（随程序） | 1,872 | 2.5 MB |
| `platform-chatgpt` | 8,880 | 7.6 MB |
| `platform-nano-banana` | 8,065 | 4.9 MB |
| `platform-pia` | 2,150 | 1.5 MB |
| `platform-yuanbao` | 1,459 | 1.0 MB |
| `platform-other` | 1,694 | 0.4 MB |

装齐全部平台包 = 22,248 条全量（种子里的条目都在某个平台包内，按 id 去重不会重复计数）。

**接口**：`GET /api/style-packs`（已装列表）、`GET /api/style-packs/catalog`（可安装的官方包 + 安装状态）、
`POST /api/style-packs/install-official`（一键安装）、`POST /api/style-packs/import`（上传 zip）、
`GET /api/style-packs/{packId}/download`（导出 zip）、`DELETE /api/style-packs/{packId}`（卸载，内置包不可卸）、
`POST/PATCH/DELETE /api/style-presets/items`（单条扩展）。

**界面**：资产库 → 「风格包」标签页（左侧已装包、右侧官方可选包一键安装、右上角导入 zip）。

**迁移工具**：`python tools/style_pack_migrate.py split|merge|verify`（单文件 ⇄ 包，可逆）、
`python tools/style_pack_split.py split|verify`（种子包 + 平台包，校验条目零丢失）。

### 角色数据（角色包）

角色数据（36,492 条 / 21 MB）同样改成了可分发包，但**不能照抄风格包的合并模式**：
角色是「搜索 + 分页」型数据，全量下发不可行。因此拆成**索引层 + 详情层**：

```
data/character-packs/characters-seed/        # 种子包（2026-10-31 起不进 git，随安装包；1.3 MB / 2,215 条）
├── pack.json                                # 清单，files 里登记 index.json
├── index.json                               # 索引层：搜索/列表要用的轻字段
└── detail-<首字符>.json                     # 详情层：按 id 首字符分片，点开才加载

dist/character-packs/*.zip + catalog.json    # 官方包（不进 git，进安装包）
data/character-packs-official/               # 装配后的官方包位置
%APPDATA%\art-canvas\character-packs/<packId>/  # 用户安装/导入的包
static/app/characters.json                   # 老单文件：已不进 git、不进安装包，仅作拆料与回退
```

**索引字段**（`id/name/copyright/post_count/gender/hair/eye/trigger/feat`）—— 不含 tags、大图、出处。
`thumb_url` 由 `trigger` 推导（实测 36,492/36,492 条完全一致，规则见 `character_packs.paths.thumb_url_of`），
因此索引里不存 URL。`feat` 是拆包时按 `data/character-features.json` 预计算的中文特征，
所以索引层不保留完整 tags 也能做「双马尾 / 眼镜」这类特征分类。

**分档规则**（按 post_count，配置在 `tools/character_pack_split.py` 顶部）：

| 包 | 规则 | 条目 | 体积 |
|---|---|---|---|
| `characters-seed`（随程序） | ≥ 1000 | 2,215 | 1.3 MB |
| `characters-popular` | 100 ~ 999 | 13,115 | 7.2 MB → zip 1.2 MB |
| `characters-longtail` | < 100 | 21,162 | 10.9 MB → zip 1.9 MB |

**接口**：`GET /api/characters/index`（合并所有已装包的索引，带 ETag，二次请求 304）、
`GET /api/characters/detail?id=`（**用 query 传 id**，因为有 73 个 slug 含 `/`，路径参数会断）、
`POST /api/characters/details`（批量取详情，「全部」应用模式要用）、
`GET /api/characters/packs`（已装 + 可装状态）。
`/api/animadex/characters` 已改为走索引，不再整份加载 21 MB 单文件。

**前端**：`anima-character-picker.js` 拉索引后适配成原有结构（补 `slug` / `thumb_url` / 空 `tags`），
`tags` / 大图在打开详情面板时才异步补；卡片标签预览优先用 `tags`，没有时用 `feat` 兜底。

**工具**：`python tools/character_pack_split.py split|verify`（拆包 + 校验「三包装齐 = 全量且字段逐一还原」）。

### 画师数据（画师包）

画师数据（42,189 条）与前两个包又不同：**没有详情层**。

每个画师的全部信息只有 `id / tag / posts / img` 四个字段（几十字节），
拆成「索引 + 详情」只会在点开时白多一次请求，所以只有一个 `index.json`。
真正占体积的是**图片**（42,189 张 × 约 115 KB ≈ 4.8 GB），这部分不落本地、不进包：

```
data/artist-packs/artists-seed/              # 种子包（进 git、进安装包，47 KB / 533 条）
├── pack.json                                # 清单，files 里登记 index.json
└── index.json                               # {imageBase, imageExt, dataVersion, items:[...]}

dist/artist-packs/*.zip + catalog.json       # 官方包（不进 git，进安装包）
data/artist-packs-official/                  # 装配后的官方包位置
%APPDATA%\art-canvas\artist-packs/<packId>/  # 用户安装/导入的包
%APPDATA%\art-canvas\artist-thumbs/          # 图片兜底缓存（最多 800 个，约 90 MB，按访问时间淘汰）
data/artist-packs-source/<release>/          # 官方 release 原料（不进 git、不进安装包，仅拆料）
static/app/artist_data.js                    # 老单文件：已不进 git、不进安装包，仅作回退
```

**数据来源**：官方站点 `anima.mooshieblob.com`（Anima Style Explorer）。抓取路径：

```
站点首页 /assets/index-*.js  ->  manifest 地址（release 更新会自动跟随）
https://cdn.mooshieblob.com/<release>/indices/manifest.json     release / 图片前缀 / 分桶
https://cdn.mooshieblob.com/<release>/indices/search.json       全量索引（本工具只下这一个，5.7 MB）
https://cdn.mooshieblob.com/<release>/images/<imageId>.avif     图片（不用下，直连）
```

`python tools/artist_pack_fetch.py show|fetch`（自动发现 release 并下载到 source 目录）。

**画师提示词**就是 `tag` 字段，形如 `@dairi` / `@qp:flapper`，直接粘进提示词即可生效。

**图片地址**：`<imageBase><imageId><imageExt>`，`imageBase` 写在 `index.json` **顶层**而不是每条目里
（4 万条重复前缀会白白多出 3 MB）。前端 `img` 优先直连 CDN —— CDN 声明了
`cache-control: public, max-age=31536000, immutable`，浏览器缓存后二次访问零延迟；
`onerror` 才回退到 `/api/artists/thumb?slug=`，由后端代取并落盘缓存（断网/被墙也能看已看过的）。

**分档规则**（按投稿数，与前端 UI 的分类一致，配置在 `tools/artist_pack_split.py` 顶部）：

| 包 | 规则 | 条目 | 体积 |
|---|---|---|---|
| `artists-seed`（随程序） | ≥ 1000 | 533 | 47 KB |
| `artists-active` | 100 ~ 999 | 21,236 | zip 0.48 MB |
| `artists-rising` | < 100 | 20,420 | zip 0.46 MB |

**接口**：`GET /api/artists/index`（合并索引，带 ETag）、`GET /api/artists/detail?id=`、
`GET /api/artists/thumb?slug=`（图片兜底，命中本地缓存直接返回）、
`GET /api/artists/packs`、`POST /api/artists/packs/import`、`POST /api/artists/packs/install-official`、
`GET /api/artists/packs/{id}/download`、`DELETE /api/artists/packs/{id}`。
`/api/animadex/artist-thumb` 保留兼容，内部转调新实现。

**前端**：`anima-artist-picker.js` 拉索引后映射成原有结构（`name` = tag 去掉 `@`、`post_count` = posts），
渲染 / 排序 / 搜索 / 收藏 / 历史全部沿用原逻辑，只换数据来源。
图片两级回退：CDN 直连 → 本机代理 → 首字母头像。

**工具**：`python tools/artist_pack_fetch.py`（抓取）+ `python tools/artist_pack_split.py split|verify`
（拆包 + 校验「所有包装齐 = 全量且字段逐一还原」）。

**加一种新内容包类型**：通用机制在 `content_packs/`（清单校验、zip 导入导出、扫描、官方目录都不含内容语义），
各类型只写自己的 paths + schema + store，新增类型不用改通用层。
现有三种：`style_packs`（风格包）、`character_packs`（角色包）、`artist_packs`（画师包）。

**包管理路由**：角色包与画师包的「列表 / 导入 / 安装官方包 / 导出 / 卸载」完全同构，
抽在 `routers/content_pack_routes.py` 的 `register_pack_routes(router, module, prefix, 展示名)`，
两边各调一次即可，不用复制两份。

**界面**：资产库 → 「内容包」标签页（`static/modules/content-pack-manager.js`），
一个页面同时管角色包与画师包，由 `KINDS` 配置驱动 —— 再加一种内容包只需在 `KINDS` 里加一条。

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
