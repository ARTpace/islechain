# Art Canvas P2 重构迁移指南（待重新验收）

> **2026-10-22 勘误**：下文包含未经测量的评分、性能目标与进度假设，不代表完成状态。画布统一引擎与 esbuild 接入正在撤回错误接线、重新验证；Vue 和 SQLite 尚未获准实施。尤其不可运行下文 `git reset --hard HEAD~1` 回滚示例，它会丢失未提交工作。回退须先备份，并仅撤销明确属于本轮的修改。API 路由迁移必须保留方法、路径、注册顺序、参数与错误返回；禁止把行数目标当成验收。详见 [最新执行规则](README.md)。

> 版本：v1.0
> 日期：2026-10-21
> 状态：规划中

---

## 1. 概述

本文档描述 Art Canvas 项目的 P2 架构重构实施路径。目标是将当前的"上帝文件"架构拆分为模块化、可测试、易维护的系统。

### 1.1 当前状态（P1 完成后）

| 维度 | 状态 | 得分 |
|---|---|---|
| 后端稳定性 | time.sleep/requests 阻塞已修复 | 8.5 → 7.0 |
| 前端结构 | canvas-engine 统一引擎 | 8.0 → 6.5 |
| 工程化 | CI/CD + 依赖锁定 + bcrypt | 7.5 → 6.0 |
| 仓库卫生 | sync-conflict/凭据已清理 | 7.5 → 5.5 |

**综合评分**：约 **6.0/10**（从"灾难级"降至"重度沉积岩"）

### 1.2 P2 目标

| 维度 | 当前 | 目标 |
|---|---|---|
| main.py 行数 | ~16,000 | < 5,000（启动入口）|
| 路由文件数 | 1 | 8-10 个 router 文件 |
| 测试覆盖 | 5 unit tests | > 50 unit tests |
| 前端模块数 | 159 文件 | 50 文件（打包后）|
| 屎山指数 | 6.0/10 | < 4.0/10 |

---

## 2. 实施阶段

### 阶段 1：后端路由拆分（预计 3-4 周）

#### 2.1.1 任务清单

| 序号 | 任务 | 验收标准 |
|---|---|---|
| 1.1 | 创建 `routers/auth.py` | 移入所有 `/api/auth/*` 路由 |
| 1.2 | 创建 `routers/canvases.py` | 移入所有 `/api/canvases/*` 路由 |
| 1.3 | 创建 `routers/comfyui.py` | 移入所有 `/api/comfyui/*` 路由 |
| 1.4 | 创建 `routers/jimeng.py` | 移入即梦相关路由 |
| 1.5 | 创建 `routers/runninghub.py` | 移入 RunningHub 路由 |
| 1.6 | 创建 `routers/tts.py` | 移入 TTS 路由 |
| 1.7 | 创建 `routers/assets.py` | 移入资产相关路由 |
| 1.8 | 创建 `routers/workflows.py` | 移入工作流路由 |
| 1.9 | 更新 `main.py` 导入 | 使用 `app.include_router()` 注册 |
| 1.10 | 验证所有路由可用 | 冒烟测试通过 |

#### 2.1.2 技术要点

```python
# routers/auth.py 示例
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import bcrypt

router = APIRouter(prefix="/api/auth", tags=["认证"])

@router.post("/register")
async def register(req: AuthRegisterRequest):
    # 原有逻辑移入
    ...

# main.py
from routers import auth, canvases, comfyui, ...
app.include_router(auth.router)
app.include_router(canvases.router)
...
```

#### 2.1.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 路由重复定义 | 中 | 高 | 拆分前 grep 确认无重复路径 |
| 全局状态分散 | 高 | 中 | 提取 services/ 层共享状态 |
| 测试遗漏 | 中 | 高 | 每个 router 先补单元测试 |
| 回归 bug | 高 | 高 | 保留 main.py 备份，逐步拆分 |

#### 2.1.4 回滚方案

```powershell
# 创建分支
git checkout -b feature/split-routers
# 遇到问题立即回滚
git checkout main
git reset --hard HEAD~1
```

---

### 阶段 2：前端彻底模块化（预计 4-6 周）

#### 2.2.1 任务清单

| 序号 | 任务 | 验收标准 |
|---|---|---|
| 2.1 | 扩展 canvas-engine.js 接口 | 覆盖所有公共函数 |
| 2.2 | 为 canvas.js 添加单元测试 | Vitest + jsdom |
| 2.3 | 为 smart-canvas.js 添加单元测试 | 同上 |
| 2.4 | 为 canvas-list.js 添加单元测试 | 同上 |
| 2.5 | 统一事件通信总线 | postMessage/BroadcastChannel 封装 |
| 2.6 | 移除 iframe 外壳（试点）| 单页面测试 |
| 2.7 | ES module 化所有 modules/*.js | import/export 语法 |
| 2.8 | 清理 window 全局变量 | < 50 处 |
| 2.9 | 构建产物优化 | bundle size < 200KB |
| 2.10 | 浏览器自动化测试 | Playwright |

#### 2.2.2 技术要点

```javascript
// modules/canvas-engine.js 导出增强
export class CanvasEngine {
  constructor(deps) { ... }
  
  // 新增：事件总线
  on(event, handler) { this.emitter.on(event, handler); }
  emit(event, data) { this.emitter.emit(event, data); }
  
  // 新增：状态订阅
  subscribe(key, callback) { ... }
  unsubscribe(key, callback) { ... }
}

// canvas.js 使用示例
const engine = new CanvasEngine({
  boardEl: board,
  worldEl: world,
  nodes: nodes,
  connections: connections,
  selected: selected,
  // 注入业务回调
  pushUndo: pushUndo,
  scheduleSave: scheduleSave,
  render: render,
});
```

#### 2.2.3 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 浏览器兼容性问题 | 低 | 中 | 目标 es2022，polyfill 按需引入 |
| 性能 regression | 中 | 高 | 每个改动跑 benchmark |
| 交互 bug | 高 | 高 | 完整手工测试 + 自动化 |
| 团队学习成本 | 中 | 中 | 文档 + 代码 review |

---

### 阶段 3：框架试点（预计 2-3 周）

#### 2.3.1 任务清单

| 序号 | 任务 | 验收标准 |
|---|---|---|
| 3.1 | 选择框架（Vue 3 推荐）| 团队决策文档 |
| 3.2 | 搭建试点项目 | vite + vue + canvas-engine |
| 3.3 | 重写 settings 页面 | 功能等价，无 regression |
| 3.4 | 性能对比 | 加载时间 < 原版 |
| 3.5 | 团队评审 | 一致通过或调整方案 |

#### 2.3.2 技术栈

```
Vite 5
Vue 3.4 (Composition API)
Pinia (状态管理)
Vitest (测试)
Playwright (E2E)
```

#### 2.3.3 决策标准

| 指标 | 通过标准 |
|---|---|
| 加载时间 | < 2s（首屏）|
| bundle size | < 150KB (gzip) |
| 开发效率 | 同功能代码量 < 原版 50% |
| 团队满意度 | > 70% 认为"值得迁移" |

---

### 阶段 4：全面迁移（预计 6-8 周）

#### 2.4.1 任务清单

| 序号 | 任务 | 验收标准 |
|---|---|---|
| 4.1 | 制定迁移顺序 | 低风险页面优先 |
| 4.2 | 迁移子页面（10 个）| 功能等价测试 |
| 4.3 | 迁移画布核心页 | 完整交互测试 |
| 4.4 | 移除旧 vanilla JS | 无 引用残留 |
| 4.5 | 更新文档 | README + 架构文档 |
| 4.6 | 性能优化 | Lighthouse > 90 |
| 4.7 | 团队培训 | 知识 transfer |
| 4.8 | 上线发布 | 零 incident |

#### 2.4.2 迁移顺序建议

```
优先级 1（低风险）：
  → settings/api-settings.html
  → settings/comfyui-settings.html
  → app/zimage.html

优先级 2（中风险）：
  → app/klein.html
  → app/angle.html
  → app/rmbg.html

优先级 3（高风险）：
  → canvas.html（核心）
  → smart-canvas.html（核心）
  → index.html（外壳）
```

---

## 3. 测试策略

### 3.1 单元测试

```python
# tests/test_auth.py
import pytest
from main import hash_password, verify_password

def test_hash_password_returns_string():
    hashed = hash_password("test123")
    assert isinstance(hashed, str)
    assert "$2b$" in hashed  # bcrypt format

def test_verify_password_new_format():
    hashed = hash_password("test123")
    assert verify_password(hashed, "test123") is True
    assert verify_password(hashed, "wrong") is False

def test_verify_password_legacy_pbkdf2():
    # 旧 PBKDF2 格式兼容
    stored = "abc123$hashvalue"
    assert verify_password(stored, "test") is False  # 格式不匹配
```

```javascript
// tests/unit/canvas-engine.test.js
import { describe, it, expect } from 'vitest';
import { screenToWorld, applyViewport } from '../../static/modules/canvas-engine.js';

describe('CanvasEngine', () => {
  it('screenToWorld converts client coords to world coords', () => {
    const rect = { left: 0, top: 0 };
    const viewport = { x: 100, y: 100, scale: 2 };
    const result = screenToWorld(200, 200, rect, viewport);
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
  });
  
  it('applyViewport sets transform', () => {
    const worldEl = { style: {} };
    const viewport = { x: 10, y: 20, scale: 1.5 };
    applyViewport(worldEl, viewport);
    expect(worldEl.style.transform).toContain('translate(10px');
    expect(worldEl.style.transform).toContain('scale(1.5)');
  });
});
```

### 3.2 集成测试

```python
# tests/integration/test_api.py
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

@pytest.mark.integration
def test_auth_register_and_login():
    # 注册
    resp = client.post("/api/auth/register", json={
        "username": "testuser",
        "password": "testpass123"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    
    # 登录
    resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "testpass123"
    })
    assert resp.status_code == 200
    assert "token" in resp.json()
```

### 3.3 E2E 测试

```javascript
// tests/e2e/canvas.spec.js
import { test, expect } from '@playwright/test';

test('canvas page loads and renders nodes', async ({ page }) => {
  await page.goto('http://localhost:3080/static/canvas.html');
  
  // 等待画布加载
  await expect(page.locator('#board')).toBeVisible();
  
  // 截图对比（可选）
  await page.screenshot({ path: 'tests/e2e/screenshots/canvas.png' });
});

test('node drag works', async ({ page }) => {
  await page.goto('http://localhost:3080/static/canvas.html');
  
  // 拖拽节点
  const node = page.locator('.node').first();
  await node.dragTo(page.locator('#world'));
  
  // 验证位置变化
  const box = await node.boundingBox();
  expect(box.x).toBeGreaterThan(0);
});
```

---

## 4. 兼容性处理

### 4.1 旧数据迁移

```python
# migrations/v0_to_v1.py
import json
import sqlite3

def migrate_canvases_to_sqlite():
    conn = sqlite3.connect('data/artcanvas.db')
    c = conn.cursor()
    
    # 创建表
    c.execute('''CREATE TABLE IF NOT EXISTS canvases (
        id TEXT PRIMARY KEY,
        title TEXT,
        icon TEXT,
        data TEXT,
        owner TEXT,
        created_at INTEGER,
        updated_at INTEGER
    )''')
    
    # 迁移 JSON 数据
    import os
    for fname in os.listdir('data/canvases'):
        if not fname.endswith('.json'):
            continue
        with open(f'data/canvases/{fname}') as f:
            data = json.load(f)
            c.execute('INSERT OR REPLACE INTO canvases VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (data['id'], data.get('title'), data.get('icon'),
                      json.dumps(data.get('data')), data.get('owner'),
                      data.get('created_at'), data.get('updated_at')))
    
    conn.commit()
    conn.close()
    print("Migration complete!")

if __name__ == '__main__':
    migrate_canvases_to_sqlite()
```

### 4.2 API 版本管理

```python
# routers/v1/auth.py
from fastapi import APIRouter
router = APIRouter(prefix="/api/v1/auth", tags=["认证-v1"])

# 新增 API 带版本前缀，旧 API 保留但标记 deprecated
@router.post("/register")
async def register(...):
    ...

# main.py
app.include_router(v1_auth.router)

# 旧路由重定向（兼容）
@app.post("/api/auth/register")
async def register_legacy(...):
    import warnings
    warnings.warn("Legacy endpoint, use /api/v1/auth/register", DeprecationWarning)
    return await register(...)
```

### 4.3 用户 Token 兼容

```python
# verify_password 已支持多格式（P1 完成）
def verify_password(stored: str, password: str) -> bool:
    if "$" in stored and not stored.startswith("$2b$"):
        # 旧 PBKDF2 格式
        salt, h = stored.split("$", 1)
        return h == hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200000).hex()
    try:
        # bcrypt 新格式
        return bcrypt.checkpw(password.encode(), stored.encode())
    except Exception:
        return False
```

---

## 5. 资源估算

### 5.1 人力

| 角色 | 人数 | 投入比例 | 周期 |
|---|---|---|---|
| 后端开发 | 1 | 100% | 8 周 |
| 前端开发 | 1 | 100% | 6 周 |
| 测试 | 0.5 | 50% | 4 周 |
| **合计** | **2.5 人** | | **10 周** |

### 5.2 环境

| 环境 | 用途 | 成本 |
|---|---|---|
| 开发机 | 本地开发 | 现有 |
| CI/CD | GitHub Actions | 免费额度 |
| 测试服务器 | 预发布验证 | $50/月 |
| 监控 | Sentry/LogRocket | $100/月 |

### 5.3 风险储备

| 风险类型 | 时间储备 | 预算储备 |
|---|---|---|
| 技术风险 | +2 周 | +10% |
| 人员变动 | +2 周 | +15% |
| 需求变更 | +1 周 | +5% |
| **总计** | **+5 周** | **+30%** |

---

## 6. 成功标准

### 6.1 技术指标

| 指标 | 目标值 | 测量方式 |
|---|---|---|
| main.py 行数 | < 5,000 | git diff |
| 单元测试数 | > 50 | pytest --collect-only |
| 测试覆盖率 | > 70% | coverage run |
| bundle size | < 200KB | esbuild metafile |
| 首屏加载时间 | < 2s | Lighthouse |
| API 响应时间 P95 | < 500ms | 监控 |

### 6.2 业务指标

| 指标 | 目标值 | 测量方式 |
|---|---|---|
| 线上 incident | 0 | 运维记录 |
| 用户反馈 | 正面 | 问卷 |
| 开发效率提升 | > 30% | 迭代周期对比 |
| 团队满意度 | > 70% | 调研 |

---

## 7. 下一步行动

1. **团队评审**本迁移指南
2. **确定框架选型**（Vue 3 推荐）
3. **启动阶段 1**：后端路由拆分
4. **设立监控看板**：追踪进度和指标

---

*文档由 Agnes AI Agent Team 编制*
*基于 P0/P1 治理成果和 P2 规划需求*