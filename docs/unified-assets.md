# 统一素材资产

素材库管理中的“图片资产”和“本地素材”合并为“素材资产”。同一界面支持图片、视频、音频，保留库/分组、搜索、智能分类、反推提示词、提示词编辑保存、批量下载、移动、复制到画布与整理检查。

## 存储与迁移

- 索引继续使用用户数据目录内的 `accounts/<账号>/asset_library.json`，不新增第二套业务索引。
- 新上传通过 `/api/asset-library/upload` 直接写入 `input/library/<账号>/<分组>/`，避免先上传再登记产生两份文件。
- 旧素材索引中引用的本机 input/output 文件会复制归档到 `input/library/<账号>/`，ID、名称和已有分类等元数据保留。源文件保留，已有画布链接继续有效。
- 旧 `input/uploads/` 在首次启动时复制到 `input/library/_local/`，连同 TXT 提示词和分类 JSON 一起迁移；原目录作为备份保留。旧全局本地素材只并入原管理员的索引。
- 首次更新非空索引前保留 `asset_library.json.before-unified-assets.bak`。迁移标记位于 `input/library/_local/.legacy-imported`，避免重复复制与覆盖后续编辑。
- 旧 `/assets/uploads/...` 地址解析到新目录；旧本地素材接口继续服务画布兼容调用，改名、移动和删除会同步统一索引。
- 已归档到 library 的素材不会重复复制；缺失源文件和外部远程 URL 保留原记录，不以空文件替代。
- 新增和更新的提示词同时存于统一索引及图片同目录 TXT 文件。

## 外部素材仓库

在「素材资产 → 接入仓库」填写公开 GitHub 仓库地址，可接入 RuiC-PoseAtlas 格式的姿势、衣装、人像三个索引。支持仓库首页（默认 main）与 `tree/<分支>/<目录>` 地址，格式解析复用风格仓库；暂不支持私有仓库或任意结构的图片仓库。

连接时只读取 `data/poses.json`、`data/costumes.json`、`data/faces.json`，不下载图片。列表与右侧详情显示源仓库提供的缩略图，经本机按需缓存到 `media_previews/asset_repository/`；最多并发下载四张缩略图，失败不回退到高清图。放大预览、下载或使用到画布时才请求原图，人像使用索引内的 `full_remote` 来源。

选择已接入的库后可点击「更新仓库索引」。重复接入不重复建项，保留用户改名、提示词、移动和删除；更新已有图片地址并补充新增项，不自动删除上游移除的条目。姿势的每个角度为独立素材，名称标明角度，并保存共同的 `pose_id`。索引及来源信息随账号保存，缩略图缓存可重建，不随应用分发源图片。

对应检查：`python -m unittest discover -s tests -p "test_asset_repository.py"`。

## 本地存储检查

`python -m unittest discover -s tests -p "test_unified_asset_*.py"`

覆盖迁移重入与冲突保护、元数据保留、避免重复/删除后复活、旧接口改名删除、账号命名空间、直接归档上传、逐项反推结果和提示词侧写保存。测试中的视觉模型调用为模拟，不发起付费推理。
