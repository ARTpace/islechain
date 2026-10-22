# 用户凭据文件：data/users.json

> **此文件已被 `.gitignore` 排除在版本库之外（2026-10-21 P0 止血）。**
> 历史提交中仍存在该文件的镜像，若需彻底清除凭据，须手动运行 `BFG Repo-Cleaner` 或 `git filter-repo`（见文末说明）。

## 为何被 gitignore

`data/users.json` 存储了所有注册用户的**密码哈希与认证 token**。这类凭据一旦进入 git 历史，就会被所有克隆仓库、任何有访问权限的协作者、以及任意 GitHub/GitLab 历史浏览器所继承，**不可撤销**。即便之后加入 .gitignore 或执行 `git rm`，历史提交仍包含原文，必须通过重写历史才能删除。

当前仓库策略：
- 工作区保留该文件，便于用户后续重建 / 迁移；
- 不再通过 git 追踪，避免意外 push 带入 CI / 仓库服务器日志。

## 文件中存了什么

每个用户名下包含 4 个字段：

| 字段 | 含义 |
|------|------|
| `password` | 用户密码的哈希值（当前为裸 SHA-256 hex，见下方迁移建议） |
| `is_admin` | 是否为管理员 |
| `token` | 登录会话认证 token（UUID 格式） |
| `created_at` | 注册 unix 时间戳 |

当前版本：3 个用户（`admin`、`ARTpace`、`test_1784627309917`），密码均为 64 位十六进制 SHA-256。

## 如何重建合法用户数据

**短期**：删除现有 `data/users.json`，后端按需重新注册即可。

**推荐迁移方向**（最小改动）：

1. **密码哈希升级**：将当前裸 SHA-256 替换为 `bcrypt`（`pip install bcrypt`）或 `argon2-cffi`。bcrypt 自带 salt，推荐 cost factor ≥ 12。
   ```python
   import bcrypt
   hash_pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12))
   ```
2. **存储后端迁移到 SQLite**：把内存/JSON 用户表切换到 SQLite 更利于并发、备份和审计。参考文件 `main.py` 中现有的 `hash_password` / `verify_password` 接口，将 hash 算法与存储层解耦。
3. **token 机制**：当前 token 为明文 UUID，建议改用 JWT（`python-jose`）或至少混入密钥派生（HMAC-based），避免直接复用旧 uuid。
4. **重置历史**：迁移完成后，所有老 token 失效，强制用户重登。

具体示例可见同项目正在推进的 task-4（`main.py` 的 `hash_password` 升级），完成后此文件可直接废弃或被 SQLite 替代。

## 历史凭据清除提示

本文件已被从 git 索引移除，但**之前提交**仍持有旧内容。如需彻底消除历史记录中的风险：

```bash
# 方案 A：BFG Repo-Cleaner（推荐，简单）
bfg --delete-files users.json --replace-text passwords.txt
# 其中 passwords.txt 格式：<SHA-256 hex>\n （每行一条）

# 方案 B：git filter-repo（功能更强）
git filter-repo --invert-paths --path data/users.json
```

执行后强制推送前请与仓库维护者协调，这会改写所有人历史。

> 本提示由 P0 仓库卫生止血（task-6）于 2026-10-21 自动生成。
