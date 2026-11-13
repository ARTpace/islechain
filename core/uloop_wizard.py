"""把「图形化向导」参数编译成 uloop execute-dynamic-code 的 C# 片段。

设计目标：新手拖出节点后一个字都不用填，点运行即可完成
「连编辑器 → 读当前场景 → 找参考对象 → 建输出目录 → DryRun 预检 → 正式生成 → 汇总结果」。
所有运行时才知道的值（场景路径、参考层级路径、根节点名、输出目录）都在 C# 里自动求出，
Python 侧只负责把表单数值安全地编译进代码，不拼接任何用户字符串到 C# 逻辑里。
"""
from __future__ import annotations

import json
import math

MODES = ('generate', 'inspect', 'scan', 'custom')
SHAPES = ('rect', 'circle', 'custom')


def _num(value, default: float, low: float, high: float) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(n):
        return default
    return min(max(n, low), high)


def _int(value, default: int, low: int, high: int) -> int:
    return int(_num(value, default, low, high))


def _cs(value: str) -> str:
    """生成 C# 逐字字符串字面量：路径里的反斜杠无需转义，只需双写引号。"""
    text = str(value or '').replace('"', '""').replace('\r', '').replace('\n', '')
    return '@"' + text + '"'


def _points(values: dict) -> list[tuple[float, float]]:
    """形状 → 世界 XZ 点列。数值全部由 Python 生成，避免把用户文本拼进 C#。"""
    shape = str(values.get('shape') or 'rect')
    cx = _num(values.get('center_x'), 0.0, -1e5, 1e5)
    cz = _num(values.get('center_z'), 0.0, -1e5, 1e5)
    if shape == 'custom':
        raw = str(values.get('points_json') or '').strip()
        parsed = []
        try:
            data = json.loads(raw)
            for item in data:
                if isinstance(item, dict):
                    parsed.append((float(item['x']), float(item['y'])))
                else:
                    parsed.append((float(item[0]), float(item[1])))
        except Exception:
            for chunk in raw.replace('\n', ';').split(';'):
                bits = [b.strip() for b in chunk.split(',')]
                if len(bits) == 2:
                    try:
                        parsed.append((float(bits[0]), float(bits[1])))
                    except ValueError:
                        continue
        if len(parsed) < 3:
            parsed = []
        return [(_num(x, 0, -1e5, 1e5), _num(y, 0, -1e5, 1e5)) for x, y in parsed[:256]]
    sx = _num(values.get('size_x'), 20.0, 0.1, 10000.0)
    sz = _num(values.get('size_z'), 20.0, 0.1, 10000.0)
    if shape == 'circle':
        r = min(sx, sz) / 2.0
        steps = _int(values.get('circle_segments'), 32, 8, 128)
        return [(cx + r * math.cos(i * 2 * math.pi / steps),
                 cz + r * math.sin(i * 2 * math.pi / steps)) for i in range(steps)]
    hx, hz = sx / 2.0, sz / 2.0
    return [(cx - hx, cz - hz), (cx + hx, cz - hz),
            (cx + hx, cz + hz), (cx - hx, cz + hz)]


# C# 公共前缀：所有运行时值都在这里求，字符串用 Q/B 常量拼 JSON，规避转义地狱。
_PREFIX = r'''
var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
if (string.IsNullOrEmpty(scene.path)) throw new System.Exception("当前场景还没保存：请先在 Unity 里保存场景（Ctrl+S），再点运行。");
if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode || UnityEditor.EditorApplication.isCompiling)
    throw new System.Exception("Unity 正忙（播放模式或编译中）：请停止播放、等编译完成再运行。");
string Q = ((char)34).ToString(), B = ((char)92).ToString();
System.Func<string,string> E = s => (s ?? "").Replace(B, B + B).Replace(Q, B + Q);
System.Func<string,string> S = s => Q + E(s) + Q;
System.Func<UnityEngine.Transform,string> FullPath = t => { var p = t.name; var q = t.parent; while (q != null) { p = q.name + "/" + p; q = q.parent; } return p; };
var candidates = new System.Collections.Generic.List<string>();
foreach (var go in UnityEngine.Resources.FindObjectsOfTypeAll<UnityEngine.GameObject>()) {
    if (go.scene != scene) continue;
    if (go.GetComponent("MeshColor") == null) continue;
    if (go.GetComponent<UnityEngine.MeshRenderer>() == null) continue;
    if (go.GetComponent<UnityEngine.MeshFilter>() == null) continue;
    candidates.Add(FullPath(go.transform));
}
var report = new System.Text.StringBuilder();
report.AppendLine("Unity 编辑器：已连接");
report.AppendLine("当前场景：" + scene.path);
report.AppendLine("可用参考对象：" + (candidates.Count == 0 ? "无（场景里需要有 MeshColor + MeshRenderer + MeshFilter 的对象）" : string.Join(" | ", candidates)));
'''

_INSPECT = r'''
if (candidates.Count == 0) return report.ToString();
report.AppendLine("--- 第一个参考对象的材质 / 配色 / 可用色档 ---");
try { report.AppendLine(PlaneGeneratorAutomation.DescribeReferenceJson(candidates[0])); }
catch (System.Exception ex) { report.AppendLine("读取参考失败：" + ex.Message); }
return report.ToString();
'''

_SCAN = r'''
int lines = 0;
System.Action<UnityEngine.Transform,int> walk = null;
walk = (t, depth) => {
    if (lines >= 400) return;
    report.AppendLine(new string(' ', depth * 2) + t.name + (t.gameObject.activeSelf ? "" : "  [停用]"));
    lines++;
    foreach (UnityEngine.Transform child in t) walk(child, depth + 1);
};
foreach (var root in scene.GetRootGameObjects()) walk(root.transform, 0);
if (lines >= 400) report.AppendLine("… 已截断（最多 400 行）");
return report.ToString();
'''

_GENERATE = r'''
string refPath = __REF__;
if (string.IsNullOrEmpty(refPath)) {
    if (candidates.Count == 0) throw new System.Exception("没找到可用参考对象：请在场景里放一个带 MeshColor / MeshRenderer / MeshFilter 的参考对象，或在「可选微调」里填它的层级路径。");
    refPath = candidates[0];
}
string matched = null;
foreach (var c in candidates) {
    if (c != refPath && !c.EndsWith("/" + refPath)) continue;
    if (matched != null) throw new System.Exception("参考对象不唯一：" + refPath + "。请在「可选微调」里填完整层级路径，例如 " + candidates[0]);
    matched = c;
}
if (matched == null) throw new System.Exception("参考对象不存在或不是可用参考：" + refPath + "。可填的完整路径：" + string.Join(" | ", candidates));
refPath = matched;
string folder = __FOLDER__;
if (string.IsNullOrEmpty(folder)) folder = "Assets/PlaneGeneratorOutput";
if (!folder.StartsWith("Assets/")) throw new System.Exception("输出目录必须以 Assets/ 开头：" + folder);
if (!UnityEditor.AssetDatabase.IsValidFolder(folder)) {
    var parts = folder.Split('/'); string cur = parts[0];
    for (int i = 1; i < parts.Length; i++) {
        string next = cur + "/" + parts[i];
        if (!UnityEditor.AssetDatabase.IsValidFolder(next)) UnityEditor.AssetDatabase.CreateFolder(cur, parts[i]);
        cur = next;
    }
}
if (!UnityEditor.AssetDatabase.IsValidFolder(folder)) throw new System.Exception("输出目录创建失败：" + folder);
string root = __ROOT__;
if (string.IsNullOrEmpty(root)) root = "Ground_Auto_" + System.DateTime.Now.ToString("yyyyMMdd_HHmmss");
foreach (var g in scene.GetRootGameObjects()) if (g.name == root) { root = root + "_" + System.DateTime.Now.ToString("fff"); break; }
System.Func<float,string> F = v => v.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
System.Func<float,float,string> P = (x,y) => "{" + Q + "x" + Q + ":" + F(x) + "," + Q + "y" + Q + ":" + F(y) + "}";
var regs = new System.Collections.Generic.List<string>();
__REGIONS__
System.Func<bool,string> Build = isDry =>
    "{" + Q + "ScenePath" + Q + ":" + S(scene.path)
    + "," + Q + "ReferencePath" + Q + ":" + S(refPath)
    + "," + Q + "RootName" + Q + ":" + S(root)
    + "," + Q + "OutputFolder" + Q + ":" + S(folder)
    + "," + Q + "DryRun" + Q + ":" + (isDry ? "true" : "false")
    + "," + Q + "SaveScene" + Q + ":" + __SAVE__
    + "," + Q + "Regions" + Q + ":[" + string.Join(",", regs) + "]}";
report.AppendLine("参考对象：" + refPath);
report.AppendLine("根节点名：" + root);
report.AppendLine("输出目录：" + folder);
try { report.AppendLine("--- 参考信息 ---"); report.AppendLine(PlaneGeneratorAutomation.DescribeReferenceJson(refPath)); }
catch (System.Exception ex) { report.AppendLine("读取参考信息失败（不中断）：" + ex.Message); }
string dry = PlaneGeneratorAutomation.ExecuteJson(Build(true));
report.AppendLine("--- 自动预检 DryRun ---"); report.AppendLine(dry);
if (!dry.Replace(" ", "").Contains(Q + "Success" + Q + ":true")) {
    report.AppendLine("预检未通过，已停止，不会生成任何对象。请按上方 Error 修正后重试。");
    return report.ToString();
}
report.AppendLine("预检通过，自动正式生成…");
report.AppendLine("--- 正式生成 ---");
report.AppendLine(PlaneGeneratorAutomation.ExecuteJson(Build(false)));
report.AppendLine("完成：请回到 Unity 场景查看 " + root + "；生成成功不等于视觉验收通过。");
return report.ToString();
'''


def _pt(value) -> tuple[float, float]:
    if isinstance(value, dict):
        x, y = value.get('x'), value.get('y')
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        x, y = value
    else:
        raise ValueError('轮廓点必须是 [x, z] 或 {"x":..,"y":..}')
    return (_num(x, 0.0, -1e5, 1e5), _num(y, 0.0, -1e5, 1e5))


def _regions_code(values: dict) -> str:
    """图层 → C# 代码。AI 工具传 regions 数组；节点表单走默认的单图层路径。"""
    raw = values.get('regions')
    if isinstance(raw, list) and raw:
        groups = []
        for item in raw[:12]:
            if not isinstance(item, dict):
                raise ValueError('每个图层必须是对象')
            pts = [_pt(p) for p in (item.get('points') or [])][:256]
            if len(pts) < 3:
                raise ValueError('每个轮廓至少需要 3 个不重复点')
            groups.append((_int(item.get('slot'), 5, 0, 11),
                           _num(item.get('height'), 0.03, -1000.0, 1000.0), pts))
    else:
        groups = [(_int(values.get('slot'), 5, 0, 11),
                   _num(values.get('height'), 0.03, -1000.0, 1000.0), _points(values))]
    blocks = []
    for i, (slot, height, pts) in enumerate(groups):
        if len(pts) < 3:
            pts = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
        lines = ['var pts%d = new System.Collections.Generic.List<string>();' % i]
        lines += ['pts%d.Add(P(%sf, %sf));' % (i, repr(x), repr(y)) for x, y in pts]
        lines.append('regs.Add("{" + Q + "Slot" + Q + ":" + %d + "," + Q + "Height" + Q + ":" + F(%sf)'
                     ' + "," + Q + "Points" + Q + ":[" + string.Join(",", pts%d) + "]}");'
                     % (slot, repr(height), i))
        blocks.append('\n'.join(lines))
    return '\n'.join(blocks)


def build_code(values: dict) -> str | None:
    """向导模式返回 C# 代码；custom / 旧版节点返回 None，让 uloop_cli 走原逻辑。"""
    mode = str(values.get('mode') or '').strip()
    if mode not in MODES:
        return None
    if mode == 'custom':
        return None
    body = {'inspect': _INSPECT, 'scan': _SCAN}.get(mode, _GENERATE)
    if mode == 'generate':
        body = (body
                .replace('__REF__', _cs(values.get('reference')))
                .replace('__FOLDER__', _cs(values.get('output_folder')))
                .replace('__ROOT__', _cs(values.get('root_name')))
                .replace('__REGIONS__', _regions_code(values))
                .replace('__SAVE__', 'true' if values.get('save_scene') else 'false'))
    return _PREFIX + body
