# 优化回归测试记录

日期：2026-11-19  
代码基线：`057b75d`，分支 `refactor/project-modularization`。

## 结果

主要聊天与画布往返流程已实测通过；整体尚未全绿，两个已记录的测试替身问题仍失败，并观察到窄窗口画布工具栏排版问题。本轮仅测试及记录，未修改业务实现。

| 检查 | 结果 |
| --- | --- |
| CI 的 Node 检查入口，包含资源版本检查 | 21 项，20 通过、1 失败 |
| 平台上游、平台配置、原子存储、网关 Python 回归 | 18 通过、1 失败，另有 6 个子测试通过 |
| 平台配置/目录/契约/上游、原子存储及新增上游测试的 ruff | 通过 |
| 内容版本清单 | 无过期项 |

## 实际浏览器验收

目标：`http://127.0.0.1:7000/static/index.html`。用户手动登录后执行，不读取密码。

- 历史会话恢复，Markdown 段落及列表正常展示。
- “复制到对话栏”一次点击将原用户消息放入输入栏。
- 切换画布管理页，24 张画布卡片加载完成；双击已有“画布 09:29”进入编辑器，返回后仍显示管理列表。
- 画布返回聊天后输入栏内容保留；测试输入已通过清空按钮移除。
- 历史列表可打开并切换到多轮会话，等待载入后内容与选择匹配。
- 上翻聊天后可点击“跳到最新对话”；平滑滚动结束后按钮自动隐藏。
- 测试结束恢复原“1只猪”会话，未发送消息、发起生成或删除数据。
- 本轮页面控制台未捕获 error 级别记录；不等同于后台全部日志无错误。

## 未通过项

1. `tests/test_chat_reply_text.cjs`：局部执行确认生成函数时，测试上下文缺少 `conversationLoader`，报 ReferenceError。渲染部分断言通过，但整个检查失败；不能按首行成功日志算通过。
2. `tests/test_webai_gateway.py::WebaiGatewayTests::test_canvas_task_persists_reported_progress`：SimpleNamespace 未提供 `finish_chat_generation`。本轮仍复现先前记录的 AttributeError。
3. 画布编辑器在本轮约 723 像素宽的浏览器截图中，“用选中素材做游戏”文字出现纵向挤压并侵入上方标题区域。画布进入/退出可用，窄窗口工具栏布局需要单独修复；未据此推断宽窗口也存在同样问题。

## 验证边界

- Node、Python 为本轮重构相关范围，不代表全仓测试、全仓 lint 或 mypy 全部通过。
- 未重启运行中的后端，不能确认当前进程已加载最新 Python 拆分模块。
- 未执行付费生成、真实生成取消/恢复、录音、完整安装包构建或内存/性能采样。
- 本轮未测试真实消息删除、重发和平台 Key 变更；对应逻辑仅有自动化替身测试覆盖。

## 自动检查入口

- `.github/workflows/ci.yml` 的 Chat presentation job 中全部 Node 命令。
- `py -3.13 -m pytest tests/test_provider_upstream.py tests/test_provider_config.py tests/test_json_store.py tests/test_webai_gateway.py -q`
- `py -3.13 -m ruff check providers/config.py providers/catalog.py providers/schemas.py providers/upstream.py core/json_store.py tests/test_provider_upstream.py`
