# 能力包（Ability Packs）开发文档

> 目标读者：维护 art-canvas 的开发者、希望为 art-canvas 编写插件的第三方。
> 状态：设计定稿，P0 待实施。所有"实测"结论均来自 2026-11-04 的本机验证。

---

## 1. 需求定义

**一句话**：用户按需安装一个"能力包"，装完 AI 就多一套调用外部工具的能力和相应知识；不装则完全没有。

具体到首批场景：

| 用户想要 | 装的是什么 |
|---|---|
| AI 能调 ComfyUI 的命令行能力（templates / validate / workflow 槽位） | `comfy-cli` 装进隔离 venv |
| AI 能在 Blender 里建模、导出 glb | `mcp-for-blender` 的 addon + stdio MCP server |
| AI 能搜到网上的 3D 资产并送进 DCC | `AssetVault` 的 stdio MCP server（已接入，见 §13） |
| AI 能调 PS / Substance 做贴图 | 待定，先只做声明与探测 |

关键特征：**安装动作由用户发起、由宿主执行**，AI 只负责发起和失败诊断（§9）。

---

## 2. 非目标

明确不做的四件事，避免范围蔓延：

| 不做 | 原因 |
|---|---|
| 安装 ComfyUI 本体 | 要装 torch / CUDA，属于 `routers/comfyui.py` 的 launch/stop 职责，不是能力包 |
| 给 ComfyUI 装 custom_nodes / 模型 | 已有 `core/comfy_installs.py` 的 12 个工具处理，走另一条链路（§8.3） |
| 安装 DCC 软件本身 | 能力包只管"接上"，不管"装上" |
| 进程内代码插件 | 见 §8.1 红线第一条 |

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| **pack** | 一个能力包，一个目录 + 一份 `pack.json` |
| **probe** | 只读的存活检查，例如 `--version`、`GET /system_stats` |
| **allow / deny** | CLI 子命令白名单与黑名单，deny 优先 |
| **venv** | 包私有的 Python 环境，位于包目录内，与宿主解释器隔离 |
| **skill** | `SKILL.md`，教 AI 何时以及如何使用这个包 |
| **discover** | 扫描本机已安装软件的过程，见 §7 |
| **受管实例** | 由 art-canvas 自己启动并持有进程句柄的服务（ComfyUI） |

---

## 4. 架构与职责边界

```
┌──────────────────────────────────────────────────────────┐
│ 前端设置页                                                │
│   能力包列表 → 安装/卸载/配置/探活 → 展示每一步 argv      │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTP
┌───────────────────────▼──────────────────────────────────┐
│ 宿主（art-canvas 后端）                                   │
│  ┌────────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ 包发现与校验    │ │ 安装执行器    │ │ 软件识别       │  │
│  │ pack schema    │ │ probe/pip/exec│ │ software_detect│  │
│  └────────────────┘ └──────────────┘ └────────────────┘  │
│  ┌────────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ MCP 连接池     │ │ CLI 执行器    │ │ 安装锁/日志    │  │
│  │ mcp_tools.py   │ │ 白名单 argv   │ │ 每步可回滚     │  │
│  └────────────────┘ └──────────────┘ └────────────────┘  │
└───────────────────────┬──────────────────────────────────┘
                        │ 子进程 / HTTP
┌───────────────────────▼──────────────────────────────────┐
│ AI 获得的能力                                              │
│  MCP tools（stdio 子进程）  +  CLI tools（白名单 exec）   │
│  SKILL.md（按需读取，不注入每轮）                          │
└──────────────────────────────────────────────────────────┘
```

三层职责，不许越界：

| 层 | 拥有什么 | 绝不做 |
|---|---|---|
| **包** | 声明（要装什么、怎么探活、允许哪些命令） | 执行任意脚本、改宿主配置 |
| **宿主** | 执行、校验、加锁、记日志、回滚 | 猜测用户意图、自行决定装哪个版本 |
| **AI** | 发起安装、解释失败、帮人写新包 | 决定路径、执行安装细节、声称未验证的成功 |

---

## 5. 包格式规范

### 5.1 目录布局

```
%APPDATA%\art-canvas\packs\<id>\
  pack.json                 包声明（只读，来自包分发）
  venv\                     隔离环境（pip 安装产物）
  skills\<name>\SKILL.md    技能说明
  assets\                   图标等静态资源
  logs\install.log          每次安装的完整 argv + 退出码 + stderr
  state.json                宿主写入：安装状态、版本、探活结果
```

`pack.json` 是**包作者写的**，`state.json` 是**宿主写的**，两者不混。用户填的配置值和密钥另存 `%APPDATA%\art-canvas\pack-config.json`，按 `id` 键控，重装不丢。

### 5.2 完整 schema

```json
{
  "formatVersion": 1,
  "id": "comfy-cli",
  "version": "1.0.0",
  "displayName": "ComfyUI 命令行",
  "description": "让 AI 用 comfy-cli 查询模板、校验工作流、操作槽位。",
  "kind": "cli",
  "icon": "./assets/icon.svg",

  "install": {
    "steps": [
      {
        "id": "venv",
        "type": "venv",
        "python": ">=3.10"
      },
      {
        "id": "pkg",
        "type": "pip",
        "package": "comfy-cli",
        "version": "1.5.2"
      },
      {
        "id": "probe",
        "type": "probe",
        "argv": ["{venv}/Scripts/comfy.exe", "--version"],
        "expect": "1.5.2"
      }
    ]
  },

  "cli": {
    "executable": "{venv}/Scripts/comfy.exe",
    "probe": ["--version"],
    "allow": ["run", "validate", "templates", "workflow", "node", "model", "env", "which"],
    "deny": ["install", "update", "launch", "stop", "set-default"],
    "cwd": "{pack}",
    "timeout": 120
  },

  "requires": {
    "commands": [],
    "platforms": ["win32", "darwin", "linux"]
  },

  "skills": "./skills/"
}
```

### 5.3 字段约束（全部硬校验）

| 字段 | 约束 | 校验时机 |
|---|---|---|
| `formatVersion` | 必须为 `1`；缺失按 1 处理；大于 1 拒绝安装并提示升级宿主 | 发现时、安装前 |
| `id` | `^[a-z0-9][a-z0-9_.-]{1,63}$`，全局唯一，**一旦发布不可改** | 发现时 |
| `version` | SemVer | 发现时 |
| 所有路径 | 必须以 `./` 开头且解析后仍在包目录内 | 发现时 |
| `install.steps[].type` | 只能是 `venv` / `pip` / `probe` / `exec` | 发现时 |
| `install.steps[].argv` | 字符串数组，元素不得含 `;` `|` `&` `` ` `` `$` `>` `<` 换行 | 发现时 |
| `pip.version` | **必须固定**，禁止 `latest` / `*` / 区间 | 安装前 |
| `cli.allow` | 非空数组，每项为裸子命令名 | 安装后 |
| `cli.deny` | 与 allow 冲突时 deny 优先 | 每次调用 |
| `connect.env` | 只允许声明**变量名**，不得写值 | 发现时 |
| 配置里的 `secret` 字段 | 不得带默认值 | 保存时 |

### 5.4 两种 kind

**`kind: "cli"`** — 宿主提供执行器，AI 拿到三个工具：

| 工具 | 入参 | 风险等级 |
|---|---|---|
| `pack_cli_version` | `{packId}` | readonly |
| `pack_cli_help` | `{packId, subcommand?}` | readonly |
| `pack_cli_run` | `{packId, argv: string[]}` | mutating（每次审批） |

`pack_cli_run` 的 `argv` 是数组，宿主直接 `subprocess.run(argv, shell=False)`。**任何情况下不拼 shell 字符串。**

**`kind: "stdio"` / `"http"`** — 注册成 MCP 连接，直接复用现有 `core/mcp_tools.py`：

```json
"connect": {
  "transport": "stdio",
  "command": "{venv}/Scripts/mytool.exe",
  "args": ["--mcp"],
  "cwd": "{pack}",
  "env": ["MY_TOOL_HOST"]
}
```

`env` 是**变量名清单**，真实值来自 `pack-config.json`。这一点是修 §8.2 缺陷的前提。

---

## 6. 安装机制

### 6.1 四种原语

| type | 做什么 | 可否回滚 |
|---|---|---|
| `venv` | 在 `{pack}/venv` 建隔离环境 | 删目录 |
| `pip` | 往该 venv 装固定版本包 | 删目录 |
| `probe` | 跑一条只读命令验证结果 | 无需 |
| `exec` | 跑包声明的安装器（如 `uvx mcp-for-blender install-addon`） | 由包提供 `uninstall.argv` |

**只有这四种。** 不提供"跑 install.py"的原语——那是把整个安全模型交出去。

### 6.2 步骤状态机

```
pending → running → done
                  ↘ failed（保留现场，可重试或回滚）
```

每一步必须记录：

```json
{
  "stepId": "pkg",
  "type": "pip",
  "argv": ["...venv/Scripts/pip.exe", "install", "comfy-cli==1.5.2"],
  "startedAt": 1762300000.0,
  "durationMs": 18240,
  "exitCode": 0,
  "stdoutTail": "…",
  "stderrTail": "…"
}
```

前端**必须逐步展示完整 argv**。理由：让别人在自己的机器上跑安装，就得让他看见到底执行了什么。

### 6.3 三条铁律

1. **隔离**：所有 pip 安装进包内 venv，**永不碰宿主解释器**。本机 `H:\AI-Tools\ComfyUI_TE\python_embeded` 里的 comfy-cli 1.5.2 是 TE 整合包的一部分，动它等于毁掉 cu13.0/torch2.10 构建。
2. **版本钉死**：`pip install pkg==1.5.2`，永不 `-U`、永不 `latest`。升级 = 建新 venv 装新版本，探活通过才切换（失败保留旧环境）。
3. **幂等**：重复点"安装"不重复下载。已有 venv 且探活通过 → 直接返回 ready。

### 6.4 卸载与回滚

```
卸载 = 执行 uninstall.argv（若有）→ 删除 venv → 保留 pack.json 与用户配置
回滚 = 恢复到上一个成功版本的 venv 快照（P3 再做，P2 只支持"卸载重装"）
```

**卸载不清用户配置**，这是 ohmygame 那条"配置按 ID 独立存储"的实际价值：重装回来还是原来的密钥和路径。

---

## 7. 软件识别（discover）

已实现：`core/software_detect.py`（只读，不执行任何应用代码）。

### 7.1 三路候选源

| 来源 | 实现 | 覆盖场景 |
|---|---|---|
| Program Files 一级目录名正则 | `MATCHES[target]` | 扁平安装 |
| 厂商根目录 | `VENDORS[target]`，如 `Blender Foundation` / `Autodesk` / `Epic Games` | 嵌套安装 |
| **注册表 Uninstall 三处** | `winreg` 遍历 `HKLM` + `WOW6432Node` + `HKCU`，取 `DisplayName` / `InstallLocation` | 装在 D 盘、自定义目录 |
| 环境变量覆盖 | `ART_CANVAS_<TARGET>_EXE` | 便携版 / 绿色版 |

候选源合并后：`realpath` 去重（小写比较）→ 逐个 `is_file()` 验证 → 同目录只留一个。

### 7.2 版本号不靠猜

先用路径正则抠（`20\d\d`、`Houdini 20.5`、`UE_5.x`），再用 **PE 资源 `ProductVersion`** 覆盖：

```python
_pe_version(path)  # ctypes: GetFileVersionInfoW → VerQueryValueW → VS_FIXEDFILEINFO
```

这条是 `software-detection.mjs` 最关键的一处——**目录名会说谎，exe 的版本资源不会**。

### 7.3 Blender 特化：exe 与配置目录的对应

Blender 的 exe 和用户配置是分离的，必须显式匹配：

```
C:\Program Files\Blender Foundation\Blender 4.5\blender.exe   → 版本 4.5.2
%APPDATA%\Blender Foundation\Blender\4.5\scripts\addons\      → 配置目录
```

`blender_versions()` 返回：

```json
{
  "installs": [{ "executable": "...", "version": "4.5.2", "minor": "4.5",
                 "configDir": "...", "addonsDir": "...", "mcpAddon": false, "portable": false }],
  "orphanConfigs": [{ "version": "5.0", "addonCount": 43, "mcpAddon": true }],
  "recommended": { "...": "唯一有 exe 的版本" },
  "needsManualPath": false
}
```

`orphanConfigs` 是**有配置目录但没有对应 exe** 的版本。本机实测就有这个情况（§13），安装器必须把它显示出来，不能闷头往 `recommended` 装。

### 7.4 端口探测

```python
comfyui_instance()  # GET {base}/system_stats
```

**必须绕过系统代理**（`ProxyHandler({})`）。本机有系统代理 `127.0.0.1:2953`，会劫持 loopback 请求并返回空内容，伪装成服务不可用。

### 7.5 缓存

- 位置：`%APPDATA%\art-canvas\software-detection\<target>.json`
- TTL：24 小时，带 `schema` 版本号
- 强制刷新：`refresh=True`
- 并发去重：同目标同时只扫一次（`_INFLIGHT` Event）

实测：首扫 0.01s，缓存命中 <0.001s。

---

## 8. 安全设计

### 8.1 红线（不可协商）

| # | 红线 | 违反后果 |
|---|---|---|
| 1 | **不执行包内任意脚本**；只有 `venv`/`pip`/`probe`/`exec` 四种原语 | 白名单、隔离、审批全部失效 |
| 2 | **不改宿主解释器**；pip 只进包内 venv | TE 整合包的 torch/CUDA 构建被毁 |
| 3 | **不传 shell 字符串**；一律 argv 数组 + `shell=False` | 命令注入 |
| 4 | **不接受任意下载 URL**；下载必须有来源白名单 + sha256 | 供应链投毒 |
| 5 | **AI 不可直接触发安装**；必须经过宿主授权入口 | 用户失去最终决定权 |
| 6 | **密钥不进包文件、不回传 AI**；只存加密配置，API 只回 `hasKey` | 凭据泄漏进对话历史 |

### 8.2 现存缺陷（P0 必修）

`core/mcp_tools.py:101` 当前：

```python
stdio_client(StdioServerParameters(
    command=server.command, args=server.args, env=server.env or None, cwd=server.cwd))
```

**问题**：`env=None` 意味着子进程**继承宿主全部环境变量**，包含 `api.env` 里的密钥。第三方 MCP server 只要 `print(os.environ)` 就能全拿到。自己用无所谓，开放给第三方就是投毒通道。

**修法**：白名单。子进程只继承 `PATH` / `HOME` / `SYSTEMROOT` / `TEMP` 等必需项，加上 `connect.env` 声明的变量名从配置取的值。其余一律不传。

`core/mcp_tools.py:99` 当前：

```python
error_log = stack.enter_context(open(os.devnull, 'w'))
```

**问题**：stderr 全丢。但 stderr 是第三方**唯一的调试通道**，丢了他们就只能猜。

**修法**：写入 `%APPDATA%\art-canvas\packs\<id>\logs\stderr.log`，单文件上限 2MB，超出轮转一份。同时保留"只写 stderr 不污染 stdout"的协议要求提示。

### 8.3 与 ComfyUI 安装链路的关系

独立的另一条链，**不合并**。`core/comfy_installs.py:568` 的 12 个工具处理"给受管 ComfyUI 装 custom_nodes / 模型"，特征是：

- 只对 art-canvas 自己启动的实例生效（`core/comfy_model_download.py:21` 硬校验 `launch['process'] is comfyui._comfyui_process`）
- 有安装锁（`lease`/`acquire`/`release`）防止并发
- 下载强制 `sha256` + `max_bytes`
- AI 无法直接触发：`call()` 末尾 `raise ValueError('安装执行必须经过宿主授权入口')`

能力包接入 ComfyUI 时，**只装客户端工具**（comfy-cli），不碰节点和模型。两者共存，互不覆盖。

### 8.4 三道闸门

| 闸门 | 时机 | 做什么 | 是否执行代码 |
|---|---|---|---|
| 静态校验 | 发现包时 | schema、路径越界、argv 元字符、pip 版本钉死 | 否 |
| 依赖探测 | 安装前 | 扫 PATH 找 `requires.commands`，缺什么说缺什么 | 否，只读扫路径 |
| 连接测试 | 用户点"测试" | 起临时 session、`list_tools`、立即关闭，**不调业务工具** | 是，但仅子进程内 |

---

## 9. AI 的能力边界

### 9.1 能做

| 场景 | AI 做什么 |
|---|---|
| 用户说"帮我装 Blender 建模" | 调 `packs.discover()` 看候选，调 `packs.install(id)` 发起 |
| 安装失败 | 读 `logs/install.log` 的 stderr，给出人话诊断 |
| 用户想接新软件 | 从零生成 `pack.json` 草稿，交人确认 |
| 日常使用 | 按 SKILL.md 决定该调哪个工具、传什么参数 |

### 9.2 不能做

| 禁止 | 原因 |
|---|---|
| 自行决定安装路径 / 版本 | 会猜错（§13 有实例） |
| 直接执行安装命令 | 必须走宿主授权入口 |
| 未经探活宣称"装好了" | 虚假成功比失败更贵 |
| 修改 `pack.json` 之外的安全配置 | `allow/deny` 是包作者的契约 |

### 9.3 为什么不让 AI 主导识别

实测反例：本机 Blender 的情况是"能跑的 4.5 没有 addon，有 43 个 addon 的 5.0 没有 exe"。让模型判断，它会选 5.0（因为那里有它认识的文件名），然后用户打开 Blender 4.5 什么也看不到。**这类判断必须由确定性代码做，AI 只负责解释结果。**

---

## 10. UI 形态

设置页新增"能力包"一栏，每个包一张卡片：

```
┌ Blender 建模 ────────────────────────── ● 可安装 ┐
│ 检测到 Blender 4.5.2                              │
│   C:\Program Files\Blender Foundation\Blender 4.5 │
│ ⚠ 5.0 有配置目录和 43 个插件，但找不到可执行文件   │
│                                                   │
│ 将执行：                                          │
│   1. uvx mcp-for-blender@1.2.0 install-addon \    │
│        --addons-dir "...\4.5\scripts\addons"      │
│   2. 写入 MCP 连接配置                            │
│ 预计下载：约 12 MB（uv 缓存）                     │
│                                                   │
│ [ 安装 ]  [ 仅查看演练 ]  [ 指定其他 Blender 路径 ]│
└───────────────────────────────────────────────────┘
```

必需要素：

1. **逐条列出将执行的 argv**，不是"安装中…"
2. **显示总下载量与来源域名**
3. **"仅查看演练"**：只跑 `discover` 和静态校验，一行代码不执行
4. **异常显式呈现**：孤儿配置、版本不匹配、路径需手填，都要写在卡片上
5. 安装过程中逐步显示状态、耗时、退出码

---

## 11. 第三方开发指南

### 11.1 最小可用的三个示例

**例 1：纯技能包（零风险，最容易）**

```
my-pack/
  pack.json      { "formatVersion": 1, "id": "vendor.tip", "version": "0.1.0",
                   "displayName": "我的技巧", "kind": "cli",
                   "skills": "./skills/" }
  skills/tip/SKILL.md
```

没有 `install`，没有 `cli`，纯知识。安装 = 复制目录。

**例 2：CLI 包**

```json
{
  "formatVersion": 1, "id": "vendor.mytool", "version": "0.1.0",
  "displayName": "My Tool", "kind": "cli",
  "install": { "steps": [
    { "id": "venv", "type": "venv", "python": ">=3.10" },
    { "id": "pkg", "type": "pip", "package": "mytool", "version": "2.3.1" }
  ]},
  "cli": {
    "executable": "{venv}/Scripts/mytool.exe",
    "probe": ["--version"],
    "allow": ["build", "inspect"],
    "deny": ["install", "upgrade", "self-update"]
  },
  "skills": "./skills/"
}
```

**例 3：stdio MCP 包**

```json
{
  "formatVersion": 1, "id": "vendor.mcp", "version": "0.1.0",
  "displayName": "My MCP", "kind": "stdio",
  "install": { "steps": [
    { "id": "venv", "type": "venv", "python": ">=3.10" },
    { "id": "pkg", "type": "pip", "package": "my-mcp-server", "version": "1.0.0" }
  ]},
  "connect": {
    "transport": "stdio",
    "command": "{venv}/Scripts/my-mcp.exe",
    "args": [],
    "env": ["MY_API_HOST"]
  }
}
```

`env` 里写变量名即可，安装时 UI 会让你填值。

### 11.2 三条硬性要求

1. **路径全是 `./` 或 `{venv}` 占位符**，不许出现绝对路径、不许 `../`
2. **版本必须固定**，`latest` 会被拒绝
3. **stderr 只放日志，stdout 只放协议**（stdio MCP）；一个 `print` 就能断连

### 11.3 分发

| 方式 | 适用 | 实现 |
|---|---|---|
| 文件夹放进 `packs/` | 内部、调试 | 已有 |
| ZIP 导入 | 有版本号、可传阅 | P3 |
| Git URL | 开发者自己迭代 | P4（需处理私有仓库认证与更新冲突） |

市场（marketplace）不在路线图内。三个包以内，手写配置比做市场划算。

---

## 12. 分期与验收

| 期 | 内容 | 验收标准（可客观检验） |
|---|---|---|
| **P0** | env 白名单 + stderr 落文件 + `requires` 探测 | 起一个打印 `os.environ` 的测试 server，输出里看不到 `api.env` 中的任何密钥；stderr 能在 `logs/` 里找到 |
| **P1** | 包格式、发现、静态校验、`GET /api/packs/discover` | 本机返回 §13 那张表，误差为零；畸形包被拒绝并给出字段级原因 |
| **P2** | 安装执行器（四种原语）+ 逐步日志 + 回滚 | `comfy-cli` 装进 venv 且 `--version` 返回 1.5.2；重复点击不重复下载 |
| **P3** | CLI 工具（三个）+ SKILL 按需加载 + 设置页卡片 | AI 能执行 `comfy templates` 并把原文返回；非白名单子命令被拒 |
| **P4** | 第二个包（Blender MCP）验证通用性 + ZIP 分发 | 装完 `addonsDir` 里出现 `blender-mcp-addon.py`，MCP 连接列表多一条 |

**P0 必须先做完。** 在 env 继承和 stderr 全丢的状态下开放第三方包，等于给每个包发一把主密钥。

---

## 13. 实测基线（本机，2026-11-04）

作为 P1 的验收参照，也是"为什么不能让 AI 判断"的证据。

### 13.1 软件识别结果

| 目标 | 版本 | 状态 |
|---|---|---|
| Blender | 4.5.2 | ✅ 唯一有 exe（`C:\Program Files\Blender Foundation\Blender 4.5\blender.exe`） |
| Unity | 6000.3.0 / 2022.3.62 | ✅ |
| Unreal | 5.7.1 / 5.6.1 / 5.5.4 | ✅ |
| Maya / 3ds Max / Houdini / C4D / Godot | — | 未安装 |
| Adobe / Substance | — | 未安装 |
| ComfyUI | 0.43.0 | 运行中，`127.0.0.1:8188`，RTX 5080 / cuda:0 / Python 3.13.6 |

### 13.2 Blender 的不一致（关键案例）

```
installs:      Blender 4.5.2  → 配置 4.5，addon 0 个，无 blender-mcp
orphanConfigs: 4.2  → 0 个 addon
               5.0  → 43 个 addon，有 blender-mcp  ← 但没有可执行文件
               5.1  → 0 个 addon
```

**blender-mcp 装在 5.0，而 5.0 找不到 exe；能跑的是 4.5，它那边没有 MCP addon。**

待确认：5.0 是便携版（需手填路径）、已卸载的残留、还是装在非常规位置。答案决定 `install.steps` 里 `--addons-dir` 指向哪里。

### 13.3 已接入的能力包

| 包 | 形态 | 状态 |
|---|---|---|
| `assetvault` | stdio MCP（`node .../ai-mcp.mjs`） | ✅ 已接入，8 个工具握手通过，`get_capabilities` 实测可用 |

配置见 `%APPDATA%\art-canvas\mcp-servers.json`。

### 13.4 环境事实（影响实现）

| 事实 | 影响 |
|---|---|
| 系统代理 `127.0.0.1:2953` | 所有 loopback HTTP 必须显式绕过代理 |
| `blender` 不在 PATH | 识别不能依赖 PATH |
| `comfy-cli` 在 `python_embeded` 里但未暴露 | 不能复用，必须建独立 venv |
| 宿主 Python 为 `...\Python313\python.exe`（项目内无 venv） | 安装器要用宿主 Python 建 venv |

---

## 14. 待确认事项

| # | 问题 | 影响 |
|---|---|---|
| 1 | Blender 5.0 是便携版、残留、还是装在别处？ | 决定 `--addons-dir` 目标版本 |
| 2 | 是否支持非受管 ComfyUI 实例（用户自己的整合包）？ | 支持则必须补备份/回滚；不支持则只能用 art-canvas 启动的实例 |
| 3 | 首批要做的包：comfy-cli、Blender MCP，还是两者并行？ | 决定 P2 范围 |
| 4 | 是否接受"包索引目录"由宿主内置（写死在仓库）而非远程拉取？ | 影响分发方式，远程拉取需要签名机制 |
