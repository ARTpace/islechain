# OhMyGame 源码经验与本项目落地清单

> 分析日期：2026-11-02。
> 基准：WhiteTowerAI/ohmygame，提交 c30bfabda86c27084128deca5bc4bd0d4e9983eb。
> 本地只读参考副本：H:/AI-Tools/ref/ohmygame。未安装依赖、未启动上游、未执行其测试；以下测试证据指已阅读用例，不表示用例在本机通过。
> 本文是制作需求的补充。吸收行为和边界，不直接移植 Electron/TypeScript 架构，不据此宣称本项目已具备对应能力。

## 1. 生成前先保存依赖，不读半新半旧内容

源码：src/renderer/canvas-board-storage.ts；test/canvas-board-storage.test.ts 中 waits for pending document edits、does not generate when linked documents cannot be saved 用例。

事实：生成适配器等待关联文档保存，再调用生成；保存冲突时不发起生成。存储会话将保存与刷新串行化，避免 revision 更新竞态。

本项目采用：生成前提交相关文档、策划、资产参数，确认 revision 后冻结输入；失败即停止生成。UI 显示“输入保存失败”，不能继续付费生成旧参数。工程构建也必须等待相关文件保存。

验收：修改文档后立即点生成，输出请求使用新版本；文档冲突时生成调用次数为零。

## 2. 重复请求不等于另一次付费生成

源码：src/daemon/canvas-workspace.ts 的 start/generateNode；src/daemon/agent-tools.ts 的 generate_canvas_media。

事实：同节点进行中任务可以被 Agent 跟随；prepare 后的实际请求计算 inputRevision，同设置且当前输出仍匹配时可复用成功结果。regenerate 明确表示另生成一个变体。Agent 默认请求复用，普通生成按钮不等同于这个策略。

本项目采用：分开“复用/继续”和“再生成一个”；稳定资产绑定不能代替任务去重。指纹基于解析后的提示词、模型、参数和参考图内容版本，而非只用 assetId。运行中输入已经变化时提示当前任务版本，不让用户误以为新参数已执行。

验收：双击、断线重试和 Agent 跟随不重复扣费；显式再生成确实创建新任务；参考文件内容变化会使指纹改变。

## 3. 取消需要区分任务所有者和等待者

源码：src/daemon/agent-tools.ts 的 abort 处理；canvas-workspace.ts 的 cancel/retry/#loadJobs。

事实：Agent 自己创建的任务随其取消；只是跟随已有任务时，仅停止等待。某些 3D 任务明确提示仅停止本地等待，上游可能仍运行。持久历史重载后不会把旧 running 当成功。

本项目采用：记录创建者、跟随关系、本地状态和 providerTaskId（通道实际提供时）。重连先核对已有任务；不能取消上游时显示真实状态，不盲目重放付费请求。

验收：停止 Agent 不取消用户从界面启动的任务；服务重启不自动再次付费；取消后晚到结果只进入候选，不替换选用。

## 4. 保存、刷新、冲突选择必须在同一串行会话

源码：src/renderer/canvas-board-storage.ts；test/canvas-board-storage.test.ts。

事实：保存、后台刷新、冲突处理共享操作队列；有 base/local/remote 三方合并和本地恢复草稿。独立编辑可以合并，冲突保留草稿；首次读取失败可以重试，后台读取失败保留有效画布。用例还覆盖恢复后的迟到保存/生成被拒绝。

本项目采用：首条链路先采用 revision 冲突和人工选择，不必立刻复制三方合并；但保存/刷新/版本选择需串行，恢复草稿按项目、资源和 workspaceEpoch 隔离。恢复快照后旧会话写请求必须失效。

验收：保存未完成时刷新不回退 revision；冲突后继续编辑不丢草稿；恢复后迟到回调不能写回旧状态。

## 5. 文件落地与注册分开，缺失文件不能拖垮项目

源码：src/daemon/canvas-assets.ts 的 ensureCanvasAssets/inspectCanvasAssets/canvasLibraryAsset；projects.ts 的 materializeLibraryAsset。

事实：Library 资产物化到项目后才进入 manifest；已有且可读取的项目文件可复用。检查将缺失和不可用资源独立报告。工作区文件通过内容摘要核对原 Library 资源，改变后不继续假定为原内容。

本项目采用：区分候选源文件、项目选用副本和导出文件；逐项诊断缺失。未被当前操作使用的坏资源不阻止项目打开或无关任务；正式导出只对必需项与实际引用进行阻断检查。

验收：删除无关候选仍可编辑项目；必需选用文件缺失阻止正式包；文件内容改变能被 hash 检出。

## 6. 不能直接复制它的结果回写语义

源码：src/daemon/canvas-workspace.ts 的 #execute。

事实：生成完成会将物化输出的 assetId 回写到仍存在且类型匹配的节点；所读路径不是以本项目“用户选用 selection”作为采用门槛。

本项目差异：节点显示最新候选不等于替换已选文件。采用首期明确的 candidate/selection 分离，资产修订变化、节点删除重建或任务晚到均校验来源身份与版本。

验收：新结果到达不会自动切换游戏素材；删除后重建的同名节点不被旧任务误写。

## 7. 试玩是带会话和能力声明的工具

源码：src/daemon/playtest-tools.ts；src/daemon/owned-playtest.ts；test/owned-playtest.test.ts。

事实：game_use 提供 open/inspect/act/capture/close，动作有数量、时长和尺寸上限，按适配器能力开放。open/act 已返回新状态；可批量相邻输入，避免重复观察。可选 bridge 支持 reset/setSeed/step，但不是每种游戏都具备。会话归属限制为当前调用方，清理等待进行中的 open 后仅关闭自己的窗口。

本项目采用：先一个 Web 试玩适配器，不先做全引擎抽象；明确 sessionId、运行版本、能力清单、输入上限和独立清理。模板可实现只在测试构建启用的确定性 bridge，实际不支持时标记 unavailable，不伪造测试通过。

验收：构建成功后仍需真实操作；两个会话互不操作/关闭；取消期间新开的窗口也被正确回收；Canvas/WebGL 画面结合截图检查。

## 8. 预览独立来源，不等于宿主命令已安全隔离

源码：src/daemon/preview-proxy.ts；src/desktop/playtest-driver.ts。

事实：代理创建独立 loopback 来源，处理资源和热更新；bridge POST 检查来源。桌面试玩窗口配置 sandbox/contextIsolation，关闭 nodeIntegration，并使用独立 partition。

本项目采用：借鉴来源和会话隔离，保留资源路径、HMR、路由跳转和错误关联。Electron 配置不能原样套进普通 iframe；跨来源预览也不能替代构建/Agent 命令的操作系统级权限控制。

验收：跨来源消息拒绝、历史路由与资源正常；预览不能拿到宿主凭据；执行器隔离需另测，不能凭预览隔离宣称安全。

## 9. 停服务要管进程树，不能只停父进程

源码：src/daemon/process-lifecycle.ts；project-process.ts。

事实：登记自己启动的进程；Windows 按 PID 使用 taskkill /t，其他平台操作进程组；先结束再强制清理，并考虑父进程已退出但后代仍活着的情况。

本项目采用：记录拥有关系、启动标识和进程树，避免 PID 复用导致误杀；超时清理、端口释放、崩溃恢复分别验收。不能按进程名批量杀 node/python。

验收：停止一个游戏不影响其他项目和开发服务；启动失败、父进程先退出、超时取消都不遗留后代。

## 10. 恢复不是把旧目录复制回来

源码：src/daemon/checkpoints.ts/checkpoint-objects.ts；test/checkpoint-safety.test.ts；test/agent-checkpoints.test.ts。

事实：使用工作区外独立 Git 对象存储，不使用工程自身 .git；有项目串行队列。忽略规则、不可读路径、对象损坏与中断恢复有明确处理。测试覆盖恢复失败时保留原始恢复目标、未完成恢复阻止其他写操作、恢复文件与会话元数据失败时回退。

本项目采用：首条链路可继续选择文件快照，不必复制整套对象库，但必须列出哪些文件不在快照内；不可读不能当不存在。恢复前后有日志/标记和 workspaceEpoch，未完成恢复时阻止新写入、生成、构建。恢复文件不应让 Agent 继续使用旧上下文，应补充恢复通知并重读当前版本。

验收：对象/文件损坏、写失败和重启后仍能诊断恢复；排除文件不被删除；恢复后旧会话不继续按旧路径写。

## 11. 落地优先级

| 开发阶段 | 必须吸收 |
|---|---|
| 首期 B/C | 串行保存与刷新、草稿保护、来源版本检查 |
| 首期 D/E | 保存后再生成、请求指纹、任务所有权、候选与选用分离 |
| 首期 F | 按当前操作检查依赖，不让无关缺失资产全局阻断 |
| 后续 G/H | schema 迁移、版本 epoch、可恢复文件操作 |
| 后续 J/K | 进程树、执行与预览分别隔离、任务恢复避免重放 |
| 后续 L | 有界试玩会话、能力检查、确定性测试入口、证据关联 |
| 后续 M | 未完成恢复阻止写入、排除清单、上下文失效 |

不直接照搬：多运行时适配器、完整三方合并、Git 对象存储、Electron 窗口管理及全部媒体类型。先保留这些机制解决的问题，再选择符合现有 Python/原生前端架构的最小实现。

## 12. 证据范围与尚未核实

已阅读上述关键函数、调用点及代表性测试用例；没有执行上游应用或测试，没有审核全部 Agent 引擎、安全边界、发布服务及引擎插件，不声称 OhMyGame 已完整解决这些问题。

后续文档中的内容配置编辑器、玩家存档、模板技术栈与具体权限方案，仍属于本项目设计，并非从上述源码验证出的现成功能。若实际移植源码，应另检查具体文件的 Apache-2.0 许可、NOTICE 和第三方依赖义务，本次未复制业务代码。
