# 可复用内容卡片

先加载 `/static/modules/content-preview.css`、`/static/js/canvas-agent-markdown.js`，再加载 `/static/modules/content-preview.js`。无需框架，应用页面、画布节点的 DOM 容器均可使用。

```js
// 聊天回复：自动识别 fenced code blocks 和纯 JSON。
StudioContentPreview.render(container, replyText);

// 文件、工具输出、画布节点：直接指定语言。
StudioContentPreview.render(container, source, {
  language: 'mermaid',
  title: '处理流程'
});

// 流式更新仍调用同一接口；源码/预览状态和内部滚动位置会保留。
StudioContentPreview.render(container, latestText);
```

- Markdown / JSON：文档预览、对象折叠；JSON 接收中可预览已到达内容。
- 常见代码语言：本地 Highlight.js 高亮、行号；未知语言安全显示原文。
- HTML / SVG：隔离 iframe，禁用脚本、表单、父页面访问及外部资源加载。HTML 内联 CSS 可预览；单独 CSS 文件按代码展示。
- Mermaid：流程图、时序图等，由 Mermaid 渲染后在隔离 iframe 展示。
- CSV / TSV：表格预览，支持引号、转义引号与单元格换行。
- YAML / XML：可展开的层级树。无效或未完成内容回退源码。
- Diff / Patch：增删行着色。
- LaTeX / TeX / Math：KaTeX 数学公式（不编译完整 TeX 文档）。

每张卡片均可直接切换源码/预览、复制原始内容。正文默认最高 300px，超出滚动；沿用 `--ui-panel`、`--ui-text`、`--ui-line`、`--ui-muted`、`--ui-accent`、`--ui-r` 主题变量。主题类 `body.studio-theme-dark` 或祖先 `data-theme="dark"` 控制代码配色，HTML/SVG/Mermaid 随页面主题切换重新预览。容器宽度不足时自动收缩。

依赖仅在需要时从 `static/vendor/content-preview/` 加载：Highlight.js 11.11.1（BSD-3-Clause）、Mermaid 10.9.3（MIT）、KaTeX 0.16.22（MIT，含本地字体）、js-yaml 4.1.1（MIT）。许可证同目录保存。Python/JS 等程序代码不执行。

可在 `/static/content-preview-demo.html` 查看全部格式并切换主题；该页面使用相同组件，可作为其他应用或画布接入示例。
