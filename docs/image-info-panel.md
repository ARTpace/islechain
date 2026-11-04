# 图片信息面板接入约定

缩略图、灯箱和对话图片统一使用 `PromptPanel`，不要在模型页面另写信息面板。

调用 `PromptPanel.open({cn, negative, genParams, recordMeta, anchor})`：

- `cn`：正向提示词；`negative`：负面提示词。
- `genParams.model_name`：真实模型名，不要填写 ZIMAGE 等页面标识。
- `genParams.engine`：`local` 或 `cloud`；`provider_name`：API 服务商名称。
- `genParams.mode`：`text2image` 或 `image-edit`；新模式使用明确可读的名称。
- 通用参数：`width`、`height`、`seed`、`steps`、`cfg`、`sampler`、`scheduler`、`denoise`、`batchCount`。
- `workflow`：工作流路径；`loras`：包含 `name`、`strength` 的数组。

仅记录真实使用的参数；API 未提供的参数不要补默认值。旧记录的别名在共用的 `buildMetaDict` 归一化，未知标量自动进入折叠的“其他参数”。如需增加常用字段，只在该函数扩充别名和固定顺序。

修改 `static/modules/gallery/prompt-panel.js` 后，须同步 `bundle.js` 中对应片段，并更新页面的资源缓存版本。运行 `node tests/test_prompt_panel.cjs` 检查。
