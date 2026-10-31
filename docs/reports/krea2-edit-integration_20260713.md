# 任务笔记 - Krea2 Edit 模式调试 (2026-07-13 第二轮)

## 现状
- ✅ 工作流成功跑通(不报错)
- ✅ 后端返回了图
- ❌ **输出的图没变化**(用户: "编辑不生效")

## 可能根因(从最可能到最不可能)

### 1. 跨实例图同步缺失 ⭐⭐⭐ (最可能)
**症状**: 单实例 ComfyUI 场景下也会"图没变"?
**解释**: 后端提交时 `required_images` 从 `req.params.image` 收集,前端 Krea2 模式**没传 params**(只传了 `extra_pnginfo`),所以 `required_images=[]`,**后端不知道有图要同步到目标实例**。
**单实例场景**: 图片已经上传到 ComfyUI input 目录,理论上能读到 — 不应该是这个问题。

### 2. GJJ 节点读到图但 LoRA 应用问题 ⭐⭐
**症状**: 编辑很弱,跟原图差别小
**解释**: 节点 99 `GJJ_ModelBundleLoader` 加载 `Krea-2\Krea2-realism-V1.safetensors`(美学 LoRA),节点 101 加载 `krea2_identity_edit_v1_1.safetensors`(identity edit LoRA) — 两个 LoRA 都在,应该 OK
**变体**: 用户给的 JSON 里的 LoRA 路径不存在(用户 ComfyUI 缺 LoRA 文件) — 节点会 raise RuntimeError

### 3. extra_pnginfo 实际没生效
**症状**: GJJ 节点 fallback 用 raw_value `"[]"` → 空 selected → 节点 101 拿到 None image → 应该 raise RuntimeError,但**用户没看到报错**
**可能**: 错误被吞了,后端兜底返回空图

### 4. selected_images 解析失败(路径/格式问题)
**症状**: parse_selected_images 返回空,图找不到

## 已加的 GJJ 节点日志指引

让用户先做**最小诊断**:
1. 打开 ComfyUI 原生界面 (http://localhost:8000)
2. 打开 KREA2_WORKFLOW 跑一遍,看 console 有没有 [GJJ_MultiImageLoader] 跳过无法读取的图片:xxx 错误
3. 同样工作流用 API 提交一次,看 ComfyUI console 有没有 `GJJ` 节点日志

## 后端日志关键位置

`H:\AI-Tools\art-canvas\main.py:7289` 遍历 history_data['outputs'] 收图 — 用户说图能拿到,说明 ComfyUI 至少输出了图。
但 GJJ 节点要 raise 才会卡 → 说明图加载没问题。

## 修复策略(待用户确认根因)

**最可能解**: 加个前端 console.log,把 `workflowData["101"]["inputs"]` 和 `buildKrea2ExtraPngInfo()` 输出打印出来,让用户复制给我看。
**或者**: 在前端加个"显示后端完整错误"的能力,把 `data.error` 的 JSON 解码,看到底是哪个节点失败。

## 文件清单
- `H:\AI-Tools\art-canvas\static\app\klein.html` (待改)
- `H:\AI-Tools\art-canvas\workflows\image-edit\krea2-image-edit.json` (待确认)
- `H:\AI-Tools\art-canvas\main.py` (无需改)
