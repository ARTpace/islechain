# OpenNana 提示词增量更新工具

从 [opennana.com](https://opennana.com/awesome-prompt-gallery) 抓取 AI 图片提示词，转换为 art-canvas 风格预设格式。

## 使用方法

```bash
python tools/opennana-import/import.py
```

## 功能

- 从 OpenNana API 批量获取提示词（slug 列表 + 详情）
- 自动提取中英文 prompt，优先使用中文
- 自动分类（摄影、电影感、动漫、绘画、3D、商业等）
- 自动添加 `{subject}` 占位符
- 先按 ID 跳过已有记录，未导入项优先复用缓存
- 默认 12 线程，可通过 `--workers 1-24` 调整
- HTTPS 复用证书上下文，网络失败重试，缓存损坏时重新抓取
- 写入前自动备份；单文件原子替换；没有新增时不重写数据

## 目录结构

```
opennana-import/
├── import.py    # 主脚本
├── cache/       # API 详情缓存
├── last-update-report.json # 最近一次运行报告（包括预览）
└── README.md
```

## 输出

- `data/style-presets.json` — 合并后的风格预设数据
- `data/style-i18n.json` — 中文名映射

## 追加导入

OpenNana 新增提示词后，再跑一次脚本即可自动追加（已缓存的跳过）。

## 预览与离线检查

```powershell
# 联网预览，可以更新缓存，但不写风格库和名称映射
python tools/opennana-import/import.py --dry-run
# 不联网，只检查现有缓存
python tools/opennana-import/import.py --offline --dry-run
# 从缓存补充新条目
python tools/opennana-import/import.py --offline
```

只追加新 ID，不覆盖现有提示词、名称或分类；不自动同步原站对旧条目的修改。图片保留在线地址，不下载缩略图。

备份保存在 `artifacts/opennana-backup-<时间>-<唯一编号>/`。风格库与名称映射分别原子替换，不是跨文件事务；异常时可从同一备份目录恢复。请勿并行运行多个导入进程或在更新期间手动保存风格库。

`last-update-report.json` 包含新增数、空/短提示词跳过数、失败 slug；下次运行会覆盖。单条抓取失败不会阻止其他成功条目合并，存在失败时退出码为 1；离线遇到损坏缓存也会报告失败。

界面整理规则保存在 `static/app/preset-picker.js`，原始 ID 和分类不变，后续新增内容自动应用规则。联网耗时取决于列表分页与未缓存详情数量，离线预览耗时不能代表联网更新耗时。
