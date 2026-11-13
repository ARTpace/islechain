# 画布持久化改造开发文档

> 范围：**A 项目目录化** + **B JSON Schema 校验**
> 状态：设计稿，未实施
> 修订：2026-11-06；设计稿，本文不代表功能已实施或存量已验证。
> 适用版本：实施前以实际工作区为准；路由数量、调用点数量、42 个画布及依赖版本均为初次盘点快照，不能作为迁移脚本的固定假设。

---

## 0. 结论先行

| 维度 | A 项目目录化 | B JSON Schema |
| --- | --- | --- |
| 解决的痛点 | 画布 JSON / 产出 / 素材三处分散，靠文件夹名字符串软关联；无法整包搬运 | 节点是自由 dict，无版本无校验，扩展节点与 Agent 写入的结构漂移只能靠前端容错 |
| 现值 | 中（等"要导出/分享/协作"才兑现） | 高（立刻减少静默坏数据） |
| 成本 | 高（31 处写入点 + 迁移 42 个画布） | 中低（结构校验 + 图语义检查 + 写入口接入） |
| 风险 | 中高（搬文件、断链、同步工具冲突） | 中低（告警不阻止有效旧数据，仍须验证兼容性） |
| 建议 | **分 3 期做，M2 前不迁移存量** | **先做，按错误覆盖率与兼容测试决定 enforce** |

**推荐落地顺序：B(M1) → A-存储层(M2) → A-迁移(M3) → A-导出(M4)。** B 不依赖 A，先独立上线服务端告警模式；A 的每一步都必须保持"旧数据照常可读"。

### 关键前提（务必先读）

1. **现在的持久化已经是磁盘 JSON，不是服务端状态。** 每个画布一个文件：`<USER_DATA_DIR>/canvases/<id>.json`（`routers/canvases.py:23,150`），写入走 `atomic_write_json` + 进程内 `CANVAS_LOCK`（`:156`)。所以 A 的实质不是"从状态转文件"，而是**把散在三处的文件收进一个项目目录，并让路径解析可重定位**。
2. **`core/game_projects.py` 已经是这套模式的样板**：`ProjectStore`（`:139`）+ `project.json` + `revision` 乐观锁（`:201`）+ `atomic_write`（`:42`）+ `safe_path`（`:60`）+ 导出 zip 带 `manifest.schemaVersion`（`:365`）。画布改造复用原子写、路径校验等已有函数；存储事务和每项目锁须单独设计，不能将现有实现视为已满足。
3. **新路由不能加在 `main.py` 顶层。** `tests/test_game_pipeline_app.py:85` 会拿 `git show HEAD:main.py` 比对路由清单，未提交的新路由直接失败。所有新端点必须放 `routers/`。

---

## 1. 现状盘点

### 1.1 存储布局

```
<USER_DATA_DIR>/                     # Windows: %APPDATA%/art-canvas
├── canvases/<canvas_id>.json        # 画布图（nodes/connections/viewport/logs）
├── output/<owner>/<folder>/…        # 所有生成产出（图片/视频/音频）
├── input/<owner>/<folder>/…         # 画布素材（上传/参考图），/assets 也映射到这里
├── canvas-projects.json             # 项目元数据（纯标签，不参与路径解析）
└── thumbnails/, media_previews/, …
```

- `<folder>` = `sanitize_folder_name(title, canvas_id)` = `标题前60字_<id前8位>`（`routers/canvases.py:94`），**创建后不再随标题变化**。
- `owner` = `get_user_dirname(canvas["owner"])`，未登录时为空串。
- **三处之间的唯一连接键是 `canvas.output_folder` 这个字符串**，没有索引、没有反向引用。

### 1.2 路径生成与解析（改动面）

| 位置 | 作用 | 备注 |
| --- | --- | --- |
| `routers/canvases.py:101/117` | `get_canvas_output_dir` / `get_canvas_asset_dir` | 按 owner+folder 拼物理路径 |
| `routers/canvases.py:133` | `build_asset_url` | 生成 `/assets/<owner>/<folder>/<file>` |
| `main.py:1270-1296` | 同名的两个函数副本 | **重复实现**，通过 `_get_main_deps()` 反注给 router |
| `main.py:1298/1312` | `build_output_url` / `build_asset_url` | 生成 `/output/…`、`/assets/…` |
| `main.py:4555/4560` | `output_path_for` / `output_url_for` | 按 `category` 选 OUTPUT_DIR / INPUT_DIR |
| `main.py:1957/2013` | `serve_output_file` / `serve_asset_file` | 两个 `{path:path}` 路由，做 `..` 与 `assert_account_media` 检查 |
| `main.py:6420` | `local_media_path_from_url` | URL → 物理路径，删除/引用检查都靠它 |
| `routers/canvases.py:281` | `collect_local_media_urls` | 递归收集 JSON 里的 `/assets/`、`/output/` 字符串 |

- 写入点：`output_path_for(` / `build_output_url(` 共 **31 处调用，落在 7 个文件**（`main.py`、`routers/angle.py`、`media_ops.py`、`modelscope.py`、`ms_generate.py`、`output_ops.py`、`tools/preview_game_pipeline.py`）。
- 前端直接拼 `/output/` 的文件只有 **4 个 JS**，改动面比想象小。

### 1.3 现存缺陷（A 要解决的真实问题）

| 缺陷 | 表现 |
| --- | --- |
| 拷贝项目不成立 | 复制 `canvases/x.json` 到另一台机器，图片全断（产出目录没跟过来） |
| 删除留孤儿 | `delete_canvas` → `purge_canvas` 按 folder 删两个目录；文件夹名被改过或迁移过就漏删 |
| 同标题冲突 | 两个同名画布只有 id 后缀区分，用户看不出哪个是哪个目录 |
| 无法整体备份 | 用户要备份"某个项目"，实际要手工拼三处 |
| 路径不可重定位 | 同一布局整体换盘通常不影响根相对 URL；跨账户导入、单独搬运或 owner/目录名改变时需要映射或重写 |

### 1.4 现存缺陷（B 要解决的真实问题）

- `CanvasSaveRequest.nodes: List[Dict[str, Any]]`（`routers/canvases.py:51`）——服务端对只有容器类型等基础校验，缺少节点字段及图语义校验。
- `canvas_agent.py` 的 `canvas_propose_workflow` 有自己的 `PROPOSAL_SCHEMA`（`:26`），与前端 `canConnectNodes`、扩展节点 definition 三方各写一份，没有共同真相源。
- 扩展节点（`type:'extension'`）由 `CanvasNodeCatalog` 动态定义，结构错误只会在渲染时炸在控制台。

---

## 2. 目标与非目标

### 目标

1. 一个画布 = 一个自包含目录，目录内包含图、素材、产出、历史；在本机同布局下可整体备份；跨机器/账户迁移必须经导入流程重建归属和 URL 映射，不能承诺复制目录即可被识别。
2. 所有画布相关路径解析**收口到一个模块**，不再有 `main.py` / `routers/canvases.py` 两份副本。
3. 画布 JSON 有 `schema_version`，节点结构有可被前后端与 Agent 共用的 Schema。
4. 实施时盘点的存量画布完整迁移；启用前可验证撤销，启用后回退须保留最新写入。迁移前后兼容旧前端的既有读写契约。

### 非目标（本期不做）

- 不做数据库、不做多进程部署、不做云端同步。
- 不做多人实时协作。只有携带 `base_revision` 的客户端才能防并发覆盖；旧客户端维持 last-write-wins。
- 不把节点 URL 改成完全相对路径（留到 A4，见 3.2 决策）。
- 不动 `desktop/src-tauri/sidecar-server/`（构建产物副本，改造完成后重新打包即可）。
- 不重构生成链路本身，只加路径解析适配。

---

## 3. 方案 A：项目目录化

### 3.1 目录布局与稳定标识

```text
<USER_DATA_DIR>/projects/
├── index.json                    # 可重建索引：canvas_id 与旧 (owner, folder) 映射
├── <canvas_id>/                  # 完整不可变 ID，不使用标题/slug 作为物理主键
│   ├── project.json             # 元数据 + canvas 图 + revision，唯一权威快照
│   ├── assets/
│   ├── outputs/
│   └── thumbnails/
├── .staging/<operation_id>/      # 未发布的迁移/导入目录
├── .locks/<canvas_id>.lock       # 锁在项目目录外，避免 Windows 移目录失败
└── .trash/<canvas_id>-<operation_id>/
```

首版不再同时维护 `canvas.json` 和 `project.json` 两个权威文件：`project.json` 内包含 `schemaVersion`、`revision`、`canvas`、`storageOrigin`（`new` / `migrated` / `imported`）和 `legacyAliases`。`canvas.id` 即目录 ID；`canvas` 保留现有 API 字段形状。索引、缩略图均为派生数据，不能成为恢复唯一依据。可选历史快照延后，不计入首版承诺。

标题允许修改，旧 `output_folder` 作为兼容地址保持不变。项目元数据中的 owner、canvas.id、revision 由服务端控制，不信任上传值。

### 3.2 URL 决策：U1 兼容地址，稳定 ID 决定物理位置

保留 `/output/<owner>/<folder>/<file>` 和 `/assets/<owner>/<folder>/<file>`，无 owner 的历史形态也保留。索引使用完整 `(owner, legacy_folder)`，不得仅凭 slug 猜测归属。

- 请求先完成账户鉴权，再匹配授权项目的完整别名；不能只对 URL 中的 owner 做检查而忽略项目实际 owner。
- 歧义别名必须报冲突，迁移暂停人工处理，不能追加 slug 后缀却保留原 URL。无 owner 的旧地址必须有明确兼容授权策略，不能因 slug 相同跳到其他账户。
- 已迁移项目命中但文件缺失时直接报缺失，不回退旧副本，否则会掩盖迁移缺件或复活已删素材。只有确认属于未迁移布局时才能回退。
- 同布局保留地址不等于跨账户可搬运；导入重写完整别名，并重新设置账户归属。物理目录不跟随标题改名。

### 3.3 路径模块、存储模块与提交语义

`core/canvas_paths.py` 收口现有路径 helper；不 import `main`，根目录来自 `core/user_paths.py`。复用 `safe_path`，同时保留账户和项目授权；目录 containment 只能阻止路径逃逸，不能替代权限检查。

```python
def project_dir(canvas_id) -> Path: ...
def media_root(canvas_id, kind) -> Path: ...
def resolve_media(url, access_context) -> Path | None: ...
def resolve_write_path(relative, kind, access_context) -> Path | None: ...
def build_media_url(canvas, filename, kind) -> str: ...
def legacy_paths(canvas) -> tuple[Path, Path]: ...
```

`access_context` 由后端认证上下文提供，不从请求 JSON 接受。现有 helper 签名可保持，内部补充已验证的画布/用户上下文；无法唯一归属的写入必须报错，不能猜测项目。明确只有未迁移地址返回 `None` 走旧布局。

`core/canvas_store.py` 提供 `read/save/create/list/trash/restore/purge/export_zip/import_zip`，返回现有 API 形状。实现约束：

1. 项目保存：持项目锁，读权威快照，检查 `base_revision`，构造完整新快照并递增 revision，最后一次 `atomic_write(project.json, ...)` 发布。失败后只允许看到完整旧版或完整新版。
2. 不更新项目索引的普通保存仅持该项目锁。新建、迁移发布、恢复、最终删除涉及共享索引时，固定先拿索引锁、再拿项目锁；不能在持项目锁时反向申请索引锁。
3. 现有 `ProjectStore.locked()` 同时包含全局 `_LOCK`，不能照抄来宣称每项目并行。首版单进程可用按完整 canvas_id 管理的进程内锁；若使用文件锁，则锁文件放 `.locks/`，并定义锁超时。
4. index 是缓存：启动或显式恢复时从已发布项目和回收站重建；发现重复 ID/别名必须拒绝冲突，不覆盖。更新索引采用原子替换并使内存缓存失效，不能只依赖 mtime。索引损坏时停止相关路由并触发重建，不能静默读取陈旧旧布局。
5. 文件先通过临时文件原子落盘，再发布引用它的画布快照。进程崩溃可留下未引用文件，但不允许快照引用半写文件；未引用文件以后另做保守清理。
6. `base_revision=None` 保持旧客户端 last-write-wins；真正防覆盖需要新客户端发送 revision 并处理 409。read-modify-write 的读取、版本检查、写入必须在同一锁范围。
7. 所有读写入口都接入 store，包括 Agent、日志删除、标题修改、上传素材、素材扫描及删除、直接调用目录 helper 的路由。旧布局保留原实现，列表按 canvas_id 去重，不能将旧副本显示为第二个画布。

### 3.4 写入链路改造（31 处调用点）

不改调用点签名，改**被调用函数内部**：

```python
# main.py:4555
def output_path_for(filename, category="output"):
    path = canvas_paths.resolve_write_path(filename, category, access_context=current_access_context())
    # current_access_context 为示意：实施时复用现有认证上下文，不新增第二套身份来源。
    if path is not None:
        return str(path)
    return os.path.join(INPUT_DIR if category == "input" else OUTPUT_DIR, filename)
```

`resolve_write_path` 按已验证的画布上下文和完整旧别名匹配，支持带 owner 与无 owner 的地址。不能用“先匹配 slug、再看 owner”的启发式；歧义要显式报错。上传/扫描等直接使用目录 helper 的入口也必须改为相同路径源，不能只统计 `output_path_for` 调用点。

实施前重新搜索全部媒体落盘、扫描和删除调用，覆盖 `open`、`write_bytes`、复制、静态文件路由和 URL→路径解析；31 处调用是盘点线索，不是完整性证明。

### 3.5 读取链路改造

| 函数 | 改法 |
| --- | --- |
| `main.py:1957 serve_output_file` | `resolve_media("/output/"+path, access_context)` 定位，保留现有 `..` / `assert_account_media` 检查 |
| `main.py:2013 serve_asset_file` | 同上；`library/`、`uploads/` 前缀逻辑保持原样（这部分不属于画布项目） |
| `main.py:6420 local_media_path_from_url` | 改为调用 `resolve_media`，删除/去重/引用检查自动受益 |
| `routers/canvases.py:281 collect_local_media_urls` | 不改（只收集 URL） |
| 新增 `rewrite_media_urls(value, fn)` | 递归改写嵌套 JSON 里的媒体 URL，供导入与改名使用（与 `collect_local_media_urls` 同遍历） |

**安全**：`resolve_media` 必须先校验实际项目 owner 与访问者权限，再对解析后的真实路径检查 `is_relative_to(root)`；拒绝越界及链接逃逸，不能只用路径包含关系声称已防跨账户读取（这是新增的攻击面：slug 来自 URL）。

### 3.6 迁移与恢复

脚本 `scripts/migrate_canvases_to_projects.py` 首版只支持 copy，不提供 `--move`。

```text
默认 dry-run           盘点路径、引用依赖、冲突、体积与剩余空间，不落盘
--apply --canvas <id>  先试迁一个画布；批量执行必须显式指定范围
--verify              校验权威快照、文件 hash、别名与引用；禁止旧路径回退掩盖缺失
--rollback <log>      只撤销尚未接收新写入、且校验未变的已发布迁移
--resume <log>        按持久操作日志恢复中断；重复执行不得重复发布或覆盖
```

执行前：停止相关画布保存、上传、生成任务并等待在途写入结束，暂停覆盖这些数据的同步工具；只暂停同步不足以获得一致副本。检测冲突文件、ID/别名重复、越界路径及磁盘空间，不满足则退出。同步工具及现存画布数量须现场确认，文档不宣称当前机器必有某同步进程。

单画布流程：

1. 持锁读取源画布并建立迁移清单：文件相对路径、大小、hash、原始 JSON hash、操作 ID；共享或跨画布引用必须单列。
2. 复制到同卷 `.staging/<operation_id>/`，构建包含完整 canvas 的 `project.json`；旧画布没有 output_folder 时，先确认引用来源，不能随便补名后假定资源齐全。
3. 校验目标清单及引用，不能通过旧布局回退算成功。外部 URL、全局库和跨画布依赖分别标记；依赖未处理时不能宣称项目自包含。
4. 将状态 `prepared` 日志持久化；在约定锁顺序下，将 staging 原子重命名到 `<canvas_id>`。目标存在时校验是否同一次迁移，禁止覆盖。
5. 发布目录是可恢复的提交点；原子更新索引，日志记 `published`。若目录已发布但索引/日志尚未更新，重启扫描已发布快照完成恢复，不把 staging 当项目。
6. 源副本只作为迁移时点备份；记录写入开放时间和首个新 revision。启用后新写仅进入项目，禁止新旧双写。

**回滚分两类**：

- 启用前撤销：冻结写入并核对 revision/hash 与迁移清单一致；将目标移入隔离备份、恢复旧布局解析及索引。不要直接删除唯一恢复证据。
- 启用后回退旧存储/旧程序：旧副本已过期，不能删新目录了事。首版脚本拒绝自动回滚，保留新数据；如确需回退，另行制定在停写窗口内将最新图和新增/修改媒体回迁、处理删除与同名冲突并做 hash 验证的方案。旧备份不构成无损回滚保证。

中断测试必须覆盖复制、校验、发布目录、更新索引、完成日志各阶段；校验未完成的目录不能被正常读写。迁移日志位于受保护的服务端目录，不记录令牌或素材内容。

### 3.7 删除与回收站

保持现有 API 语义：DELETE 仍写 `deleted_at`，restore 清除此字段；不要换成含义不同的 `archived`。首版 purge 仍意味着不可恢复的逻辑删除，物理目录可暂存 `.trash` 作为运维隔离，但不再通过普通 restore 复活。

普通软删画布保留在原目录，列表规则沿用现有行为。清理按显式 `deleted_at` / `purgedAt` 和保留策略判断，不能按目录 mtime 推断删除时间。最终删除与索引、旧布局备份和共享文件引用检查一起处理；有跨画布引用的媒体不得误删。清理旧副本前确认可恢复的新副本和迁移状态，防止回退读取使已删画布复活。

### 3.8 导出、导入及素材边界

导出只做快照，不包含凭据、锁、回收站或服务端本地绝对路径：

```text
manifest.json    # schemaVersion、源 canvasId、引用映射、文件 path/size/SHA-256
canvas.json      # 从 project.json 导出的画布图；不是运行时第二份权威文件
assets/...
outputs/...
```

导出必须基于固定 revision，读取期间防止媒体被修改/删除，或复制快照后重新核验 hash。先收集 nodes/logs 中的依赖，再按来源处理：项目内文件正常打包；跨画布/共享库素材须在授权后复制进包并重写引用；外链仅标记依赖，首版不自动下载。不能声称只有项目输出目录里的被引用文件就足以自包含。含缺失或外部依赖的包必须明确标为非自包含，严格自包含导出则拒绝。

导入顺序：检查归档清单与配额 → 受控暂存 → hash 与版本校验 → 生成新完整 ID 和目标账户别名 → 递归改写媒体 URL → 结构及图语义校验 → 原子发布项目与重建索引。owner、revision、路径均由服务端重建，忽略来源包的授权身份。

导入边界必须实现并测试：

- 逐项校验成员名，拒绝绝对路径、`..`、Windows 盘符/UNC、反斜杠绕过、大小写碰撞、重复成员及软硬链接；不得直接 `extractall`。
- 首版可配置上限默认：压缩包 512 MiB、解压总量 2 GiB、单文件 512 MiB、文件数 10,000；流式计数实际展开字节，不能只信 ZIP 头。合法大项目超限时明确报错，不偷偷跳过文件。
- 清单与实际成员一一对应，验证大小及 SHA-256；失败保留原项目不变，清理未发布 staging。
- URL 按解析后的完整路径前缀匹配并编码，保留 query/fragment；不能简单字符串替换误伤相似目录。测试 owner 为空、Unicode、百分号编码、嵌套字段和共享引用。

### 3.9 前端改动（尽量为零）


| 文件 | 改动 |
| --- | --- |
| `static/js/canvas.js` | 无（保存契约不变） |
| `static/js/canvas-list.js` | 可选：卡片加「导出」菜单项，调 `/api/canvases/:id/export` |
| `static/js/canvas.js`（可选） | 保存时带 `base_revision`，接 409 后提示"已在别处修改" |
| 缓存戳 | `canvas.html` / `index.html` / `canvas-list.js` 的 `?v=` 统一 bump |

### 3.10 A 的验收标准

- [ ] 新建画布 → 落在 `projects/<canvas_id>/`，`outputs/` 内有产出，`project.json.canvas` 可读。
- [ ] 原 `/output/<owner>/<folder>/<file>` 仍返回 200（U1 保 URL）。
- [ ] 老画布（未迁移）照常打开、保存、生成、删除。
- [ ] 实施时盘点的存量画布 `--apply` 后 `--verify` 全绿，媒体引用零断链。
- [ ] 启用前撤销后有效旧数据与原清单 hash 一致；启用后有新写入时脚本拒绝破坏性回滚。
- [ ] 跨项目读取被拒：构造 `../<其他canvas_id>/outputs/secret.png` → 404。
- [ ] 不同项目保存不受同一全局锁串行化；同项目版本冲突正确；索引并发创建不丢项。
- [ ] 导出 zip → 删除该画布 → 跨账户导入 → 图片全部可见、节点位置不变；恶意归档、缺件、超限被拒。
- [ ] 各发布阶段模拟崩溃后能恢复；索引删除/损坏能重建，迁移目录缺件不得回退旧文件掩盖。
- [ ] 跨账户使用合法其他项目 ID/别名也被拒；同账户跨画布共享按既有授权策略处理。

---

## 4. 方案 B：JSON Schema

### 4.1 单一真相源

```
static/schemas/
├── canvas.schema.json     # 画布根 + 节点基类 + 各类型节点
└── port-rules.json        # 端口/连线兼容矩阵（从 canvas.js canConnectNodes 抽出）
```

后端与前端**读同一份文件**：后端 `json.load(STATIC_DIR/schemas/canvas.schema.json)`（实施时检查实际运行环境；使用 `jsonschema` 时在 `requirements.txt` 显式声明兼容版本，不能依赖传递安装），前端 `fetch('/static/schemas/canvas.schema.json')`。避免又出现"三份 schema 各写一遍"。

### 4.2 `canvas.schema.json` 骨架

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://art-canvas/schemas/canvas.schema.json",
  "title": "Canvas",
  "type": "object",
  "required": ["schema_version", "id", "nodes", "connections"],
  "properties": {
    "schema_version": { "type": "integer", "minimum": 1 },
    "id": { "type": "string", "pattern": "^[a-f0-9]{32}$" },
    "title": { "type": "string", "maxLength": 80 },
    "icon": { "type": "string", "maxLength": 32 },
    "owner": { "type": ["string", "null"] },
    "project": { "type": "string" },
    "kind": { "enum": ["classic", "smart"] },
    "revision": { "type": "integer", "minimum": 0 },
    "viewport": {
      "type": "object",
      "properties": { "x": {"type":"number"}, "y": {"type":"number"}, "scale": {"type":"number","exclusiveMinimum":0} }
    },
    "nodes": { "type": "array", "items": { "$ref": "#/$defs/node" } },
    "connections": { "type": "array", "items": { "$ref": "#/$defs/connection" } },
    "logs": { "type": "array", "maxItems": 500 },
    "created_at": { "type": "integer" },
    "updated_at": { "type": "integer" },
    "deleted_at": { "type": "integer" }
  },
  "additionalProperties": true,

  "$defs": {
    "node": {
      "type": "object",
      "required": ["id", "type", "x", "y"],
      "properties": {
        "id": { "type": "string", "minLength": 1, "maxLength": 64 },
        "type": { "enum": [
          "image", "prompt", "group", "promptGroup", "output", "loop",
          "imageGen", "generator", "blenderGen", "comfy", "msgen", "rh", "minimax",
          "llm", "video", "ltxDirector", "webapp", "materialPbr", "model3d",
          "extension", "document",
          "gameIdea", "gamePlan", "gameAssets", "gameTable", "gameDevelop",
          "gamePlay", "gameTest", "gameRelease", "gameModelAsset", "gameModel3d",
          "gameAnimate3d", "gameSpeech", "gameSoundEffect", "gameMusic",
          "gameAudioScene", "gameFile", "gameFolder", "gameScene"
        ] },
        "x": { "type": "number" }, "y": { "type": "number" },
        "w": { "type": "number", "exclusiveMinimum": 0 },
        "h": { "type": "number", "exclusiveMinimum": 0 },
        "outputText": { "type": "string" }
      },
      "additionalProperties": true,
      "allOf": [
        { "if": { "properties": { "type": { "const": "prompt" } }, "required": ["type"] },
          "then": { "required": ["text"] } },
        { "if": { "properties": { "type": { "const": "webapp" } }, "required": ["type"] },
          "then": { "required": ["webMode"],
                    "properties": { "webMode": { "enum": ["url", "html"] } },
                    "anyOf": [
                      { "required": ["webUrl"], "properties": { "webMode": {"const":"url"},  "webUrl":  {"type":"string","minLength":1} } },
                      { "required": ["webHtml"], "properties": { "webMode": {"const":"html"}, "webHtml": {"type":"string","minLength":1} } }
                    ] } },
        { "if": { "properties": { "type": { "const": "llm" } }, "required": ["type"] },
          "then": { "properties": { "model": { "type": "string" } } } },
        { "if": { "properties": { "type": { "const": "image" } }, "required": ["type"] },
          "then": { "properties": {
              "url": { "type": "string" },
              "imageVersions": { "type": "array", "items": { "type":"object", "required":["url"],
                                 "properties": { "url": {"type":"string"} }, "additionalProperties": true } }
          } } },
        { "if": { "properties": { "type": { "const": "video" } }, "required": ["type"] },
          "then": { "properties": { "url": { "type": "string" } } } },
        { "if": { "properties": { "type": { "const": "extension" } }, "required": ["type"] },
          "then": { "properties": { "nodeDefinition": { "type": ["object","string"] } } } }
      ]
    },

    "connection": {
      "type": "object",
      "required": ["from", "to"],
      "properties": {
        "id": { "type": "string" },
        "from": { "type": "string", "minLength": 1 },
        "to":   { "type": "string", "minLength": 1 }
      },
      "additionalProperties": true
    }
  }
}
```

**v1 故意宽松**：`additionalProperties: true`、类型枚举用 `enum` 而非 `oneOf` 分支、必填字段只取"渲染必需"。目的是**先抓住结构级错误**（类型拼错、id 缺失、webapp 没内容），而不是把现有 42 个画布判成非法。收紧留到 v2。

### 4.3 图语义与端口规则（端口抽离延后）

`validate_canvas` 除 JSON Schema 结构检查外，必须调用服务端图语义检查：节点 ID 唯一、连线端点存在、自环/重复边符合现有契约、坐标及尺寸为有限数。语义检查不能只留在前端；Schema 的 `number` 不足以保证运行时 NaN/Infinity 被一致拒绝。合法平行端口连线不能误判重复，去重键应包含实际端口信息。

下述端口数据化是后续独立任务，不纳入 M1：现有规则可能依赖节点字段、扩展定义和端口模式，不能将完整 `canConnectNodes` 简化成类型邻接表。抽离前建立现有行为用例，保留动态规则执行器。

从 `static/js/canvas.js` 的 `canConnectNodes`（约 12615 行起）抽出为数据：

```json
{
  "version": 1,
  "inputs": {
    "llm": ["prompt","promptGroup","loop","llm","image","webapp","group","output"],
    "imageGen": ["prompt","promptGroup","image","llm","webapp"],
    "loop": ["prompt","llm","webapp"]
  },
  "rules": [
    { "from": "image", "to": "imageGen", "mode": "reference" },
    { "from": "webapp", "to": "llm", "mode": "text" }
  ]
}
```

JS 侧改成读这个文件（保留现有函数签名），Python 侧 `canvas_agent.py` 用它校验 Agent 提案的连线。**这是把三份重复规则收成一份的关键动作**，但要等 B 的 schema 稳定后再做（避免一次性动 Agent）。

### 4.4 版本与迁移

- 画布根加 `schema_version`（当前 `1`），由 `save_canvas` 补齐缺失值。
- `migrations = {1: migrate_v0_to_v1}`：`v0`（无字段）→ `v1` 只做"补默认值 + 类型白名单校验"，不改结构。
- 未来结构变更优先向后兼容；确需修改/删除时提升版本并实现显式迁移，不要求永久**只加不改**：新增字段给默认值；删除字段先写 `deprecated` 注释并让读取端容错两个版本。
- 版本不认识（`> CURRENT`）→ 拒绝所有写入口覆盖该画布（422），包括省略版本的旧客户端；读取应提示只读/不兼容。服务端须检查磁盘已存版本，不能把缺失请求版本补为 1 后降级覆盖。当前 CanvasSaveRequest 未声明 schema_version/base_revision，接入时必须新增字段并明确服务端控制字段，不能假定额外字段会自动进入持久化对象。

### 4.5 后端接入（warn 优先）

```python
# core/canvas_schema.py
def validate_canvas(canvas) -> list[str]      # 返回错误路径列表，不抛异常
def enforce_enabled(canvas) -> bool          # 按配置及独立校验策略分组，不依赖 A 的 project.json
```

在持久化前、构造好服务端控制字段和版本后的候选快照上检查；覆盖公共保存入口及批处理，禁止先写后校验。伪代码：

```python
warnings = canvas_schema.validate_canvas(canvas)
if warnings:
    if canvas_schema.enforce_enabled(canvas):
        raise HTTPException(422, {"message": "画布结构校验失败", "errors": warnings[:20]})
    # 警告仅附加到响应副本，不写进 canvas/project.json
    log_schema_warning(canvas["id"], warnings[:20])  # 有界、轮转日志；仅错误代码/路径，不记节点正文
```

**灰度与失败策略**：

1. 首版只记录有界结构化警告，不修改候选数据，不向最终文件写 `_schema_warnings`。未来版本保护和既有授权/体积限制不因 warn 放行。
2. 使用固定存量样本和各节点创建默认值检查误报；缺少 w/h 等可选字段不应成为错误。空占位节点是否允许必须按真实创建行为确定，不能强制所有草稿立即有内容。
3. 根据错误分类、兼容测试与实际告警决定收紧，不以“过一周”自动切换。B 的策略标记/配置独立于 A，不能用尚不存在的 `project.json.legacy` 判定新旧画布。
4. enforce 验证失败不落盘，前端保留草稿并显示字段路径。服务端日志轮转、限制错误数量，不记录 prompt、正文、Key 或素材内容。

### 4.6 前端接入

```js
// static/js/canvas-schema.js
CanvasSchema.load()                       // 拉 /static/schemas/canvas.schema.json（带缓存戳）
CanvasSchema.validateNode(node) -> string[]   // 用 Ajv？→ 否，见下
CanvasSchema.validateCanvas(canvas) -> string[]
```

**不引入 ajv**（避免新增构建依赖）。前端只做**从共享定义读取的轻量提示**：
- 必填字段检查（id/type/x/y）
- 类型白名单
- `webapp` 必须 `webUrl` 或 `webHtml`
- 连线自环 / 重复 / 端口兼容

真正的权威校验在服务端。前端的作用是"保存前给提示"，而不是第二套完整实现——公共属性和类型从 Schema/现有 catalog 读取，不再硬编码第二份枚举；复杂语义由服务端决定。

### 4.7 Agent 复用

`core/canvas_agent.py`：
- 保留 `PROPOSAL_SCHEMA` 输入契约：提案属性在 `fields` 中，x/y 可缺省，不能直接当持久化节点套 `$defs/node`。
- 先做提案授权与字段白名单检查，再补默认坐标、展开 fields、合并当前画布生成候选最终图；对最终图执行结构与语义检查，提交时在同一锁下复核 revision。独立编译节点子 Schema 时需保留根 `$defs` 引用上下文。
- 非法提案直接返回结构化错误给模型（让它自己重试），不落库；
- 顺带把 `canvas_list_components` 返回的节点定义 schema 与 `$defs/node` 对齐（同一 `id/type/x/y` 基类）。

### 4.8 B 的验收标准

- [ ] `canvas.schema.json` 通过 `jsonschema.Draft202012Validator.check_schema()`。
- [ ] 实际存量样本全部通过 v1 校验（0 硬错误），或错误清单被明确接受。
- [ ] 构造 6 类坏数据（缺 id / 类型拼错 / webapp 空 / 连接指向不存在节点 / 自环 / 坐标 NaN）→ warn 模式只记日志不拒绝；enforce 模式返回 422 且含字段路径。
- [ ] `_schema_warnings` 仅附在保存响应副本，磁盘文件及 GET 响应均不包含该字段。
- [ ] Agent 规范化后的非法最终图被拒，画布无变化；合法 fields 提案及缺省坐标不误拒。
- [ ] 旧前端保存当前支持版本成功；省略版本也不能覆盖磁盘上的未来版本。
- [ ] 校验耗时：1000 节点画布 < 30ms（`jsonschema` 是纯 Python，先缓存已构建的 Draft202012Validator 并定位开销；替换库前验证 Draft 2020-12/条件分支兼容性，不能直接假定等价）。

---

## 5. 里程碑与改动清单

| 里程碑 | 内容 | 触及文件 | 可独立上线 |
| --- | --- | --- | --- |
| **M1** B-schema | schema + 服务端图语义告警 + 有界日志 + 测试 | `core/canvas_schema.py`(新)、`static/schemas/*`(新)、`routers/canvases.py`、`core/canvas_agent.py` | ✅ 不拒绝兼容旧数据；未来版本写保护单列 |
| **M2** A-存储层 | `canvas_paths.py` / `canvas_store.py`；新画布走项目目录；旧布局双读 | 上述两个新模块 + `routers/canvases.py`(new_canvas/save/load/purge) + `main.py`(路径函数改内部) + `routers/media_ops.py`(新增 `/p` 如需) | ✅ 存量不受影响 |
| **M3** A-迁移 | 迁移脚本 + dry-run + 校验 + 回滚 + 经重新盘点的存量执行 | `scripts/migrate_canvases_to_projects.py`(新)、迁移与恢复测试 | ✅ 启用前可撤销；启用后回退另行设计 |
| **M4** A-导出 | export/import + URL 重写 + 前端菜单 | `routers/canvases.py`、`static/js/canvas-list.js` | ✅ |
| M5（后续） | 相对路径 / 项目改名 / 发布社区 | 全域 | 触发条件驱动 |

**测试新增**：
- `tests/test_canvas_paths.py`：完整别名、跨账户越权、歧义拒绝、仅未迁移地址回退。
- `tests/test_canvas_store.py`：revision 冲突、锁、trash/restore/purge、双读兼容。
- `tests/test_canvas_schema.py`：schema 自检、6 类坏数据、enforce 开关。
- `tests/test_canvas_migration.py`：dry-run 不落盘、apply 后校验、中断恢复幂等、启用后拒绝破坏性 rollback。
- 既有 `test_existing_route_contract_is_unchanged` **不需要改**（前提：新路由全在 `routers/`）。

---

## 6. 风险与回滚

| 风险 | 概率 | 影响 | 处置 |
| --- | --- | --- | --- |
| 迁移期间微力同步产生 `.sync-conflict-*` | 高 | 文件重复/覆盖 | 确认同步范围并停写、暂停相关同步；脚本检测冲突文件时拒绝继续 |
| slug 与 owner 段歧义导致读错目录 | 中 | 图片 404 | 稳定 ID + 完整账户别名；歧义失败，授权后解析，已迁移缺件不回退 |
| 导出/导入 URL 重写漏字段 | 中 | 导入后图片断 | 复用同一个递归遍历（`collect_local_media_urls` 的同款实现）做改写，并断言"改写后无旧前缀残留" |
| 保存路径改动引入循环 import（`main` ↔ `core`） | 中 | 启动失败 | `canvas_paths` 只依赖 `core/user_paths`，不 import `main`；`main` 反向调用 |
| `jsonschema` 校验拖慢保存 | 低 | 保存变慢 | 先测 1000 节点耗时；缓存 validator、测量瓶颈；更换实现先验证方言兼容 |
| sidecar 副本未同步导致桌面端行为不一致 | 高 | 桌面端旧逻辑 | 改造完成后跑一次 sidecar 打包（`desktop/` 是构建产物，不手工改） |

**回滚总原则**：旧 copy 仅是迁移时点备份，不是实时副本。A 按 3.6 区分启用前撤销和启用后数据回迁，禁止已迁移项目静默回退旧文件。B 关闭 enforce 只能恢复告警策略，不能撤销已发生的数据迁移，也不能关闭未来版本写保护。

---

## 7. 已定边界与上线前待确认

- 已定：U1 兼容 URL + 完整不可变 ID 物理目录；首版只 copy；B 独立告警先行，端口规则抽离延后。
- 待实施时确认：实际存量、媒体体积/空间、共享依赖、账户兼容策略、同步范围及可用停写窗口。
- 待上线前确认：占位节点允许状态、告警分类与 enforce 覆盖范围。不能用固定天数替代验收。
- 本文是设计说明，不作为执行迁移、清理备份或真实数据回退的操作授权；本次修订不执行上述操作。

---

## 附录 A：与 `core/game_projects.py` 的对照

| 能力 | game_projects（已有） | 画布改造（复用） |
| --- | --- | --- |
| 项目目录 | `<root>/<project_id>/project.json` | `<projects>/<canvas_id>/project.json`（含 canvas） |
| Schema | Pydantic `Project.model_validate_json` | JSON Schema + `jsonschema`（需前后端共用，故用 JSON 而非 Pydantic） |
| 原子写 | `atomic_write`（`:42`） | 直接复用同一函数 |
| 路径安全 | `safe_path`（`:60`） | 直接复用 |
| 并发 | `ProjectStore.locked()`（`:144`）文件锁 | 借鉴超时与平台锁处理；每项目锁与索引锁分开设计 |
| 乐观锁 | `revision` + 409（`:193`） | 画布 `revision` + `base_revision` |
| 版本历史 | `history/<kind>/<id>/<rev>.json`（`:212`，保留 30 版） | 后续按需求增加，首版不承诺 |
| 导出 | zip + `manifest.schemaVersion`（`:365`） | 同形态 |
| 迁移 | 无（绿地） | 需分阶段复制、校验、发布、中断恢复及受限撤销 |

复用已有工具函数与测试模式，不将游戏项目存储的全局锁、多文件写入或业务模型直接推广为画布存储；新承诺必须由本方案对应测试验证。

## 实现状态与启用边界（2026-11-06）

- 已落地共享 Schema、后端语义校验及前端非阻断提示。默认 `ART_CANVAS_SCHEMA_MODE=warn`；显式设为 `enforce` 才阻断普通保存中的格式问题。未来版本保护始终生效。
- 新建和导入画布使用 `projects/<canvas_id>/project.json`；现有画布继续原位置读写，不在启动或保存时自动迁移。元数据、媒体读写、日志清理及游戏引用已接入同一存储和权限解析。
- 画布列表支持 ZIP 导入和带素材导出，保留原 JSON 导出。导出缺失或无权读取的依赖会标记为非自包含，不自动下载远程文件。清空回收站保守保留素材，避免破坏其他画布引用；物理素材回收未在本次启用。
- 离线迁移入口为 `scripts/migrate_canvases_to_projects.py`：不带动作参数只生成计划；实际复制须指定 `--apply --canvas <id> --writers-stopped`。`--verify <日志>` 校验迁移快照，`--resume <日志>` 恢复中断；`--rollback <日志>` 仅允许源文件、快照及素材均未变化时隔离撤销。后两项也要求 `--writers-stopped`。工具不会替操作者停止服务或同步。
- 本次没有迁移或删除真实用户数据。迁移、故障恢复、撤销、ZIP 安全与跨账户权限均在临时目录测试；真实 API 回归覆盖上传、保存、版本冲突、恢复、日志删除、共享素材、游戏引用与导入导出。
- 相关 Python 回归和修改的 JS 语法检查通过；现有前端位置同步测试中，拖拽用例因其测试上下文缺少 `alignGuides` 失败，其余三项通过，未扩展修改既有对齐功能。未进行浏览器视觉验收或付费生成调用；桌面仅装配服务资源，未构建安装包。
