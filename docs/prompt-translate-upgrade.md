# 提示词翻译功能升级方案

## 一、目标

将提示词翻译从「每次全量 API 调用」升级为「字典优先 + 缓存复用 + API 兜底」的三级策略，大幅降低 API 消耗。

## 二、现有资源

| 资源 | 文件 | 说明 |
|---|---|---|
| 系统字典 | `data/preset-i18n.json` | 英文 key → 中文名，约 10000+ 条 |
| 双向映射 | `/api/preset-bidir` | 预设名 ↔ 预设 ID |
| 翻译函数 | `app/zimage.html` | `translatePromptToCn()` / `translatePromptToEn()` 已实现逐条查字典 |
| API 翻译 | `/api/translate` | 百度翻译 / AI 模型，支持中↔英 |

**问题**：智能画布（smart-canvas）的翻译按钮没有接入字典机制，直接走 API。

## 三、功能需求

### 3.1 按钮整合

**现状**：翻译按钮（左键翻译）+ 方向切换（右键切方向）分别在不同位置。

**目标**：合并为一个按钮，放在提示词输入框右下角。

```
┌─────────────────────────────┐
│  提示词输入框                │
│                             │
│                             │
│                    [🌐 中→英] │  ← 左键点击切换方向
└─────────────────────────────┘
```

**交互**：
- 左键点击：切换翻译方向（中→英 ↔ 英→中）
- 翻译由提示词输入框的「发送/运行」或 Enter 键自动触发
- 方向状态持久化到 localStorage

### 3.2 三级翻译策略

#### 第 1 级：本地字典查询

将文本按逗号拆分为词条，逐条查字典：

```
输入: "masterpiece, 1girl, pink hair, 赛博朋克"
       ↓ 拆分
["masterpiece", "1girl", "pink hair", "赛博朋克"]
       ↓ 逐条查字典
① "masterpiece" → 系统字典命中 → "杰作"
② "1girl"       → 系统字典命中 → "1个女孩"
③ "pink hair"   → 未命中
④ "赛博朋克"     → 用户字典命中 → "cyberpunk"
       ↓
全部命中 → 翻译完成，0 API 消耗
部分命中 → 只把未命中的发给 API（第 3 级）
```

**字典查询优先级**：
1. 用户字典（`user-prompt-dict.json`）— 可覆盖系统翻译
2. 系统字典（`preset-i18n.json`）— 只读

**字典匹配规则**：
- 英文 token 归一化：`toLowerCase()` + 空格/特殊字符转 `_`
- 中文 token 精确匹配
- 大小写不敏感

#### 第 2 级：双缓存复用

在 prompt 节点数据结构中增加缓存字段：

```javascript
node.text              // 当前显示的文本
node.textOriginal      // 原始语言版本（用户手写/最后确认的版本）
node.textTranslated    // 翻译后的语言版本（缓存）
```

**切换方向时**：
- 有缓存 → 直接从缓存取，0 API
- 无缓存 → 走第 1 级或第 3 级

**缓存失效条件**：
- 用户手动编辑了文本内容
- 翻译方向改变后首次翻译

#### 第 3 级：API 兜底

当第 1、2 级都无法满足时，调用 `/api/translate`：

```
未命中词条 → 整段发给 API 翻译
          → 结果拆词写入用户字典（自动学习）
          → 同时写入双缓存
```

### 3.3 用户字典（自动学习）

**文件**：`data/user-prompt-dict.json`

**格式**：
```json
{
  "zh2en": {
    "粉色头发": "pink hair",
    "夕阳下": "at sunset",
    "微笑": "smiling"
  },
  "en2zh": {
    "masterpiece": "杰作",
    "best quality": "最佳质量"
  }
}
```

**自动学习流程**：

```
API 翻译返回: "a girl with pink hair smiling at sunset"
原始输入:     "粉色头发的女孩在夕阳下微笑"
              ↓ 按逗号/空格拆分为词条对
              ↓ 模糊对齐（英文词序 vs 中文词序）
              ↓ 匹配成功的词条对写入 user-prompt-dict.json
```

**写入规则**：
- 不覆盖已有词条（用户手动设置的优先）
- 同一词条不重复写入
- 单次翻译最多写入 20 条（防止噪音）

### 3.4 持久化存储

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 翻译方向 | localStorage `translate_dir` | `zh2en` / `en2zh` |
| 双缓存 | 节点数据 `node.textOriginal` / `node.textTranslated` | 随画布保存 |
| 用户字典 | `data/user-prompt-dict.json` | 服务端文件 |

## 四、涉及文件

### 后端
| 文件 | 改动 |
|---|---|
| `main.py` | 新增 `/api/prompt-dict` 接口（读写用户字典） |
| `main.py` | 新增 `/api/prompt-dict/learn` 接口（自动学习写入） |

### 前端
| 文件 | 改动 |
|---|---|
| `static/js/smart-canvas.js` | 合并翻译按钮，接入三级策略 |
| `static/js/smart-canvas.js` | prompt 节点增加 `textOriginal` / `textTranslated` 字段 |
| `static/css/smart-canvas.css` | 按钮样式调整 |

### 数据
| 文件 | 改动 |
|---|---|
| `data/user-prompt-dict.json` | 新建，用户自动学习词条 |
| `data/preset-i18n.json` | 只读，系统字典 |

## 五、接口设计

### GET /api/prompt-dict

返回用户字典：

```json
{
  "success": true,
  "dict": {
    "zh2en": { "粉色头发": "pink hair" },
    "en2zh": { "masterpiece": "杰作" }
  }
}
```

### POST /api/prompt-dict/learn

自动学习，写入词条：

```json
// 请求
{
  "zh2en": {
    "赛博朋克都市": "cyberpunk cityscape",
    "霓虹灯": "neon lights"
  }
}

// 响应
{
  "success": true,
  "added": 2,
  "skipped": 0
}
```

### POST /api/translate（现有，无需改动）

## 六、前端逻辑伪代码

```javascript
async function translatePromptSmart(text, direction) {
  // 1. 查双缓存
  const cacheKey = direction === 'zh2en' ? 'textTranslated' : 'textOriginal';
  if (node[cacheKey] && !textChangedSinceLastTranslate) {
    return node[cacheKey];  // 0 API
  }

  // 2. 查字典（逐条）
  const tokens = text.split(',').map(t => t.trim()).filter(Boolean);
  const dict = await getUserDict();
  const results = tokens.map(token => {
    const translated = lookupDict(token, direction, dict);
    return translated || { token, unresolved: true };
  });

  // 3. 全部命中 → 直接返回
  const unresolved = results.filter(r => r.unresolved);
  if (unresolved.length === 0) {
    const result = results.map(r => r.token).join(', ');
    updateCache(node, text, result, direction);
    return result;  // 0 API
  }

  // 4. 部分未命中 → API 翻译整段
  const apiResult = await callTranslateAPI(text, direction);

  // 5. 自动学习：拆词写入用户字典
  const learned = extractTokenMappings(text, apiResult, direction);
  await saveToUserDict(learned);

  // 6. 更新缓存
  updateCache(node, text, apiResult, direction);
  return apiResult;
}
```

## 七、验证标准

| 场景 | 预期行为 | API 消耗 |
|---|---|---|
| 首次翻译已知词条 | 字典命中，直接返回 | 0 |
| 反复切换方向 | 缓存命中，直接返回 | 0 |
| 新词条首次翻译 | API 翻译 + 自动学习 | 1 次 |
| 新词条第二次翻译 | 字典命中（已学习） | 0 |
| 混合新旧词条 | API 翻译未命中部分 | 1 次 |
| 用户手动编辑后 | 缓存失效，重新翻译 | 视字典命中率 |
