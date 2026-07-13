# 图像编辑工作流文件化 - 集成笔记 (完成)

## 状态
✅ 全部完成

## 改动总结
- **4 个 JSON** 在 `H:\AI-Tools\art-canvas\workflows\image-edit\`
  - `klein-image-edit.json` (FLUX2 Klein 9B 双参考, 25 节点)
  - `qwen-image-edit-2511.json` (Qwen Image Edit 2511, 17 节点)
  - `boogu-image-edit.json` (Boogu 单图编辑, 12 节点)
  - `krea2-image-edit.json` (Krea2-Turbo 双参考, 6 节点)
  - JSON 字段: `_comment` / `name` / `type` / `apiEndpoint` / `workflow`
  - `workflow` 字段名跟后端 `/api/workflows/{name}` 响应一致

- **klein.html 改动** (约 130 行):
  - 删除: 4 个 `const *_WORKFLOW` JS 常量 + 原 `getWorkflowForModel` 函数
  - 新增: `WORKFLOW_BASE` `/` `WORKFLOW_FILES` 常量、`NODE_MAPPINGS` UI 映射字典、`WORKFLOWS` 容器、`loadImageEditWorkflows()` 异步函数
  - 改动: `getWorkflowForModel` 改读 `WORKFLOWS[model]`, `buildWorkflowForModel` 读 `.workflow` 字段, `window.onload` 链头加 `await loadImageEditWorkflows()`
  - 兼容: 旧 `WORKFLOW_CONFIG` 改为注释

- **归档**: `workflows/_archived/Krea2_Edit 图片编辑.json` (老版无 SaveImage)

## URL 路径
- 前端 fetch: `GET /api/workflows/image-edit/klein-image-edit.json` 等
- 后端路由: `main.py:9032 @app.get("/api/workflows/{name:path}")`
- 安全: `WORKFLOW_NAME_RE` (line 7932) 允许子目录 + 路径遍历防护

## nodeMappings 保留在 JS 的原因
- UI 绑定是前端逻辑 (`param`, `label`, `type`, `node`, `key`, `slot`)
- Krea2 的 `102_main` / `102_ref` 复合 key 含前端 slot 映射信息
- 改为 JSON 会污染工作流语义(后端不应关心)

## JS 兼容性验证
- ✅ `node --check` 通过
- ✅ 4 个 JSON `JSON.parse` 通过
- ✅ 后端端点 regex 允许 `image-edit/klein-image-edit.json` 路径
- ⚠️ 未在浏览器实测(后端服务未启动)

## 风险
- 全失败 throw 阻断 onload(预期行为,UI 提示)
- partial 失败 warning + 部分 model 不可用(用户得刷新)
- 后端 7 节点 7 unet_name 前缀逻辑(`qwen-image\\`)在 submitWorkflow JS 强制加,不在 JSON
- Krea2 节点 102 GJJ_MultiImageLoader 需要 GJJ 自定义节点包,用户 ComfyUI 未装会报"节点未注册"
