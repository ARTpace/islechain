# 游戏节点角色预设

参考项目：[WhiteTowerAI/ohmygame](https://github.com/WhiteTowerAI/ohmygame)，参考版本 `c30bfabda86c27084128deca5bc4bd0d4e9983eb`（2026-11-02），Apache-2.0，许可证副本见 [ohmygame-LICENSE.txt](ohmygame-LICENSE.txt)。

本项目按自身 JSON 契约和静态 2D 图片能力，用中文重新编写角色提示词；并非安装或执行 ohmygame 的工具、插件或引擎代码。

| 本地角色 | 参考 Skill 与取舍 |
|---|---|
| 游戏制作人 | [Game Studio](https://github.com/WhiteTowerAI/ohmygame/blob/c30bfabda86c27084128deca5bc4bd0d4e9983eb/plugins/game-studio/skills/game-studio/SKILL.md)：核心循环、玩家体验、首个可玩范围与统一视觉方向 |
| 玩法系统策划 | [Game Foundations](https://github.com/WhiteTowerAI/ohmygame/blob/c30bfabda86c27084128deca5bc4bd0d4e9983eb/plugins/game-studio/skills/game-foundations/SKILL.md)：操作、反馈、状态与范围边界，不要求生成引擎代码 |
| 游戏美术总监 | Game Studio：区分定调概念图与真实运行时素材，规划规格、用途、依赖与导出路径 |
| 角色设定师、2D 素材规划师 | [Sprite Pipeline](https://github.com/WhiteTowerAI/ohmygame/blob/c30bfabda86c27084128deca5bc4bd0d4e9983eb/plugins/web-game-studio/skills/sprite-pipeline/SKILL.md)：身份、配色、尺度、锚点、透明与可读性；不承诺当前管线尚未支持的动画和引擎集成 |

`core/game_role_presets.py` 是预设唯一来源，`GET /api/game-projects/presets` 返回名称、用途和适用阶段。生成请求携带 `presetId`，后端校验阶段后将对应提示词放入系统消息；候选保存预设 ID 和版本。旧节点、旧候选兼容通用助手。节点菜单位于聊天模型旁，选择随画布保存，改变预设后旧候选需要重新核对。

验证：`python -m pytest tests/test_game_workflow_app.py tests/test_game_project_models.py tests/test_game_projects.py -q` 退出 0，43 项通过；`node --check static/js/game-workflow.js` 与 `node tests/test_game_workflow.cjs` 均退出 0。隔离浏览器实际选择策划“游戏制作人”、拆解“角色设定师”，用模拟 LLM 生成策划后刷新，两个预设均恢复。未调用真实付费渠道，未重启生产服务。
