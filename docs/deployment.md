# Art Canvas 部署指南（部分实测）

> **2026-10-22 实测更新**：以下事实已经运行验证，可放心引用：
> - 启动端口为 **7000**（main.py 末尾 `uvicorn.run(..., port=7000)` 硬编码，非 8000）
> - 运行环境为**系统 Python 3.13**（`%LOCALAPPDATA%\Programs\Python\Python313`），本地启动用 `启动.bat`（根目录）或 `scripts\launcher\start.bat`
> - **不可多 worker**：JSON 文件存储 + 进程内队列/锁（RUNNINGHUB_WORKFLOW_LOCK 等）不支持，必须 `workers=1`
>
> **仍未验收**：embeddable Python 手动搭建路径、systemd/Nginx 生产段、SQLite 片段为未完成示意，不可操作真实数据。以 [文档入口](README.md) 的验收规则为准。

> 历史勘误（2026-10-21）：Windows embeddable Python 通常不带 ensurepip；环境变量名须逐项对照实现；Nginx 静态 location 必须配置正确根目录或代理，不应仅设 expires；无内容哈希的资源不可统一长期 immutable 缓存；CORS 不是认证或 IP 白名单。

> 更新日期：2026-10-22
> 适用环境：Windows 10/11

---

## 1. 环境要求

| 组件 | 版本要求 | 说明 |
|---|---|---|
| Python | 3.13.x | 实测用系统安装版（本机 Python313）；embeddable 手动路径未验证 |
| Node.js | 18+ | 仅用于 esbuild 构建 |
| ComfyUI | 最新 | 可选，本地 AI 生成 |
| Git | 最新版 | 版本管理 |

---

## 2. 本地开发环境搭建

### 2.1 首次克隆

```powershell
# 1. 克隆仓库
git clone <repo-url>
cd art-canvas

# 2. 运行 bootstrap 脚本（自动下载 Python + 安装依赖）
.\scripts\launcher\bootstrap-python.ps1

# 3. 验证环境
.\scripts\launcher\python-env.bat version
```

### 2.2 手动搭建（如 bootstrap 失败）

```powershell
# 1. 下载 Python 3.11.9 embeddable
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" `
    -OutFile "python.zip"
Expand-Archive -Path "python.zip" -DestinationPath "." -Force

# 2. 启用 site 模块
echo "import site" >> python\python311._pth

# 3. 安装依赖
.\python\python.exe -m pip install -r requirements.txt

# 4. 启动服务
.\python\python.exe main.py
```

### 2.3 验证安装

```powershell
# 检查 Python 环境
.\scripts\launcher\python-env.bat python --version
# 期望输出：Python 3.11.9

# 检查依赖
.\scripts\launcher\python-env.bat python -c "import fastapi, httpx, bcrypt; print('OK')"
# 期望输出：OK

# 启动服务
.\scripts\launcher\python-env.bat python main.py
# 期望输出：Uvicorn running on http://127.0.0.1:7000
```

---

## 3. 生产部署

### 3.1 使用 systemd（Linux）

```bash
# 创建服务文件
sudo tee /etc/systemd/system/art-canvas.service << 'EOF'
[Unit]
Description=Art Canvas AI Studio
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/art-canvas
ExecStart=/opt/art-canvas/python/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 启用并启动
sudo systemctl enable art-canvas
sudo systemctl start art-canvas

# 查看状态
sudo systemctl status art-canvas
```

### 3.2 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3.3 环境变量配置

在 `main.py` 同目录创建 `.env` 文件：

```env
# ComfyUI 实例（逗号分隔）
COMFYUI_INSTANCES=127.0.0.1:8188

# 即梦 CLI 路径（WSL）
JIMENG_CLI_PATH=/mnt/c/Users/xxx/AppData/Local/Jimeng/jimeng-cli.exe

# RunningHub API Key
RH_API_KEY=your_key_here

# ModelScope API Key
MS_API_KEY=your_key_here

# 管理员 Token（用于 admin 接口）
ADMIN_TOKEN=your_secure_token
```

---

## 4. 故障排查

### 4.1 Python 环境无法启动

**症状**：`ERROR: Python not found: H:\...\python\python.exe`

**解决**：
```powershell
# 运行 bootstrap 脚本
.\scripts\launcher\bootstrap-python.ps1

# 或手动下载
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip" -OutFile "python.zip"
Expand-Archive "python.zip" -Force
echo "import site" >> python\python311._pth
```

### 4.2 依赖安装失败

**症状**：`ModuleNotFoundError: No module named 'fastapi'`

**解决**：
```powershell
.\python\python.exe -m pip install --upgrade pip
.\python\python.exe -m pip install -r requirements.txt
```

### 4.3 bcrypt 导入失败

**症状**：`ModuleNotFoundError: No module named 'bcrypt'`

**解决**：
```powershell
.\python\python.exe -m pip install bcrypt
```

### 4.4 ComfyUI 连接失败

**症状**：`Backend unreachable: ...`

**排查**：
```powershell
# 检查 ComfyUI 是否运行
Invoke-WebRequest -Uri "http://127.0.0.1:8188/queue" -TimeoutSec 5

# 检查端口占用
netstat -ano | findstr :8188

# 启动 ComfyUI
cd comfyui
python main.py --listen
```

### 4.5 浏览器缓存问题

**症状**：修改代码后浏览器不生效

**解决**：
```powershell
# 强制刷新
Ctrl + Shift + R

# 或清除缓存后访问
# 添加版本号到 URL: ?v=20261021002
```

---

## 5. 监控与日志

### 5.1 启动诊断日志

```powershell
# 服务启动时自动写入
Get-Content data\startup_env.log
```

包含：
- 代理配置（HTTP_PROXY, NO_PROXY）
- Python 路径
- 平台信息
- httpx 版本

### 5.2 运行时日志

```powershell
# 标准输出（控制台）
python main.py

# 生产环境重定向
python main.py > logs\app.log 2>&1
```

### 5.3 ComfyUI 日志

```powershell
# 查看最近 100 行
Get-Content data\comfyui.log -Tail 100

# 清空日志（API）
Invoke-RestMethod -Uri "http://127.0.0.1:7000/api/comfyui/log-clear" -Method POST
```

---

## 6. 备份与恢复

### 6.1 需要备份的数据

```
data/
├── canvases/          # 画布数据（JSON）
├── conversations/     # 对话记录
├── users.json         # 用户数据（已 gitignore）
└── api_providers.json # 提供商配置
```

### 6.2 备份脚本

```powershell
# 创建备份
$backupDir = "backups\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force
Copy-Item "data\canvases" -Destination $backupDir -Recurse -Force
Copy-Item "data\conversations" -Destination $backupDir -Recurse -Force
Copy-Item "data\users.json" -Destination $backupDir -Force
Compress-Archive -Path $backupDir -DestinationPath "backups\backup-$(Get-Date -Format 'yyyyMMdd').zip" -Force
```

### 6.3 恢复步骤

```powershell
# 解压备份
Expand-Archive -Path "backups\backup-20261021.zip" -DestinationPath "." -Force

# 恢复数据
Copy-Item "backups\data\canvases\*" "data\canvases\" -Recurse -Force
Copy-Item "backups\data\conversations\*" "data\conversations\" -Recurse -Force
Copy-Item "backups\data\users.json" "data\" -Force

# 重启服务
python main.py
```

---

## 7. 性能调优

### 7.1 uvicorn 配置

```python
# main.py 启动参数（2026-10-22 按实际代码校正）
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,                # 实际传 app 对象而非 "main:app" 字符串
        host="0.0.0.0",
        port=7000,
        # 严禁 workers>1：JSON 文件存储 + 进程内队列/锁不支持多进程
        workers=1,
        log_level="info",
    )
```

### 7.2 静态文件缓存

```python
# main.py - 禁用缓存（开发）
app.mount("/static", NoCacheStaticFiles(directory="static"), name="static")

# 生产环境改为标准 StaticFiles
# app.mount("/static", StaticFiles(directory="static"), name="static")
```

### 7.3 数据库迁移建议

当前使用 JSON 文件存储，数据量大时性能下降。建议迁移到 SQLite：

```python
# 迁移脚本示例
import sqlite3
import json

conn = sqlite3.connect('data/artcanvas.db')
c = conn.cursor()

# 创建表
c.execute('''CREATE TABLE canvases (
    id TEXT PRIMARY KEY,
    title TEXT,
    data TEXT,
    owner TEXT,
    created_at INTEGER,
    updated_at INTEGER
)''')

# 导入数据
with open('data/canvases/canvas.json') as f:
    data = json.load(f)
    c.execute('INSERT INTO canvases VALUES (?, ?, ?, ?, ?, ?)', 
              (data['id'], data['title'], json.dumps(data), ...))

conn.commit()
conn.close()
```

---

## 8. 安全加固

### 8.1 修改默认端口

```python
# main.py
uvicorn.run("main:app", port=8888)  # 避免与 ComfyUI 冲突
```

### 8.2 启用 HTTPS

```powershell
# 生成自签名证书（开发环境）
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 启动服务
uvicorn main:app --ssl-keyfile=key.pem --ssl-certfile=cert.pem
```

### 8.3 限制 API 访问

```python
# main.py - CORS 已收窄（P0 修复）
origins = ["http://localhost:3080", "http://127.0.0.1:3080"]

# 生产环境添加 IP 白名单
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 9. 常见问题 FAQ

**Q: 为什么 Python 环境会丢失？**
A: `python/` 目录被 .gitignore 排除，新克隆需运行 `scripts\launcher\bootstrap-python.ps1`。

**Q: 如何切换 ComfyUI 实例？**
A: 修改 `data/api_providers.json` 或调用 `/api/comfyui/instances` API。

**Q: 如何清理构建缓存？**
A: 删除 `static/dist/` 和 `static/manifest.json`，重新运行 `npx esbuild --config=esbuild.config.js`。

**Q: 如何回滚到旧版本？**
A: 使用 `git revert` 或从备份恢复 `data/` 目录。

---

*文档由 Agnes AI Agent Team 维护*