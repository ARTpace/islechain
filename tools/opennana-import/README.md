# OpenNana 提示词导入工具

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
- 增量导入：已缓存的不会重复抓取
- 并发抓取（12 线程），全量约 8 分钟

## 目录结构

```
opennana-import/
├── import.py    # 主脚本
├── cache/       # API 响应缓存（9961 个文件）
└── README.md
```

## 输出

- `data/style-presets.json` — 合并后的风格预设数据
- `data/style-i18n.json` — 中文名映射

## 追加导入

OpenNana 新增提示词后，再跑一次脚本即可自动追加（已缓存的跳过）。
