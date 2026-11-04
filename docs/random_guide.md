# 随机提示词功能使用指南

## 概述

随机提示词功能支持方案管理，可创建、编辑、删除随机方案，从方案中随机组合角色、画师、预设。

## 使用方式

### 1. 在文生图界面使用

1. 打开文生图界面
2. 在提示词输入框旁边找到 🎲 按钮
3. 点击按钮打开方案管理面板
4. 创建或选择一个方案
5. 点击"应用此方案"或"快速随机"

### 2. 测试组件

访问：`http://127.0.0.1:7000/static/test-random-prompt.html`

## 方案管理

### 创建方案

1. 点击"新建方案"
2. 输入方案名称
3. 点击"+ 添加"按钮选择角色、画师、预设
4. 点击"保存方案"

### 编辑方案

1. 在方案列表中点击"编辑"按钮
2. 增减角色、画师、预设
3. 点击"保存方案"

### 删除方案

1. 在方案列表中点击"删除"按钮
2. 确认删除

### 应用方案

1. 在方案列表中点击"应用此方案"
2. 从方案中随机选择并填充到提示词框

### 快速随机

点击"快速随机"按钮，从所有方案中随机选择一个并应用

## 在其他应用中集成

### 引入组件

```html
<script src="/static/modules/random-prompt.js"></script>
```

### 创建容器

```html
<div id="randomPromptContainer"></div>
```

### 初始化

```javascript
RandomPrompt.init('randomPromptContainer', {
    onApply: function(result) {
        // result.positive - 正向提示词
        // result.negative - 负向提示词
        // result.raw - 原始随机结果

        // 应用到提示词框
        document.getElementById('prompt').value = result.positive;
    }
});
```

## API 接口

### 根据配置随机选择所有源
```
POST /api/random/all
Content-Type: application/json

{
  "character": {"enabled": true, "category": "女性"},
  "artist": {"enabled": true, "count": 2},
  "preset": {"enabled": true}
}
```

### 根据方案配置随机选择
```
POST /api/random/apply-plan
Content-Type: application/json

{
  "character": {"enabled": true, "names": ["纳西妲", "甘雨"]},
  "artist": {"enabled": true, "names": ["画师A", "画师B"]},
  "preset": {"enabled": true, "names": ["高质量"]}
}
```

## 扩展指南

### 新增随机源

创建新的 RandomSource 子类：

```python
from random_source import RandomSource, get_manager

class BackgroundSource(RandomSource):
    def __init__(self):
        super().__init__("background", "背景", "🌄")

    def load(self):
        self.items = [...]
        self.categories = ["室内", "室外", "幻想"]

get_manager().register(BackgroundSource())
```

## 文件结构

```
art-canvas/
├── random_source.py                    # 后端核心模块
├── main.py                             # API 入口
├── docs/random_guide.md                # 使用指南
├── static/
│   ├── modules/
│   │   └── random-prompt.js            # 前端组件
│   ├── test-random-prompt.html         # 测试页面
│   └── app/
│       └── zimage.html                 # 文生图界面（已集成）
└── static/app/
    ├── character_data_full.js          # 角色数据
    └── artist_data.js                  # 画师数据
```
