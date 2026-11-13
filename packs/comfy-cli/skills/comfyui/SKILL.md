---
name: comfyui-cli
description: 用 comfy-cli 查官方工作流模板、校验工作流定义、定位参数槽位、读实例环境。当需要一份"官方确认能跑"的工作流作起点，或排查参数该填哪个槽位时用它。
---

# ComfyUI 命令行

## 什么时候用

| 场景 | 用法 |
|---|---|
| 要从零搭一个工作流，想找个可靠起点 | `comfy templates` 列官方模板，取一份当基线 |
| 不确定工作流能不能跑 | `comfy validate <文件>` 先校验，再去提交推理 |
| 前端格式的json里不知道该改哪个字段 | `comfy workflow slots <文件>` 看槽位，`set-slot` 改值 |
| 想知道目标实例认哪些模型 | `comfy model list` / `comfy node list` |
| 确认实例地址和环境是否对 | `comfy env` |

## 什么时候不用

- **提交推理**：直接用画布内的 ComfyUI 工具（`comfy_start_test` 那一套），不要绕 CLI，那条链有校验、失败证据和重试预算。
- **装节点、下载模型**：走 `comfy_prepare_install` / `comfy_prepare_verified_model`，CLI 这条路被禁了。
- **启停实例**：走画布的实例管理，CLI 的 launch/stop 被禁了。

## 命令形态

```bash
comfy --host 127.0.0.1 --port 8188 <子命令> [参数]
```

常用子命令：`templates` / `validate` / `workflow` / `node` / `model` / `env` / `which` / `run`

## 硬边界

以下子命令**永远会被拒绝**，不是参数写错：

```
install  update  launch  stop  set-default
```

原因是它们会改动 ComfyUI 本体的 Python 环境。这台机器上的 ComfyUI 是 TE 整合包（cu13.0 / torch 2.10 特定构建），一旦被 comfy-cli 覆盖就再也回不去。

## 失败时怎么处理

1. `comfy --version` 先确认装好了、版本是 1.5.2
2. 报"连不上"就检查端口，实例没跑就告诉用户去启动
3. 报"工作流不合法"就把 `validate` 的原文贴给用户，不要自己改图
4. 任何安装/更新提示，直接说"这个包不允许"，不要尝试绕过
