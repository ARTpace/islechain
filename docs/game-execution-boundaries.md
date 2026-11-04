# 游戏工程执行边界

更新：2026-11-03。用户已选择按项目显式开启的本机信任模式，Docker/Podman 不再是此模式的前置条件。

受控工程继续使用 owner、相对路径、版本/hash、候选审阅、固定构建及隔离预览；不因新增本机模式自动扩大权限。

标准 Web 工程在工作台单独开启本机执行后，允许 npm 安装、build/dev/preview 和 Codex CLI。工程命令拥有当前宿主用户的本机权限；独立执行目录、过滤环境变量和 CLI workspace-write 不等同于容器或宿主 OS 隔离。npm 安装禁用生命周期脚本，工程 build/dev 则会运行项目代码。

API 验证 owner、loopback、同源及 X-Art-Runtime 请求头。执行副本的修改须显式采用，版本变化会拒绝陈旧会话。日志有界、运行限时，Windows 使用 JobObject 清理所属进程树，不按进程名结束其他任务。备份不传播执行授权和 CLI 会话。

Codex 沿用本机已有 CLI 登录，不复制凭据，不开启 bypass。已验证离线协议与本机工具链，尚未验证真实付费模型的完整开发链路；Claude Code/OpenCode 尚未接入。外部 CLI 尚未接通宿主素材生成与试玩工具，不能将候选工具链已有能力视为外部 CLI 已完成。

详见 [代码开发能力对齐](game-development-alignment.md)。
