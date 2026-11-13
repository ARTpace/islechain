"""画布「Unity 编辑器脚本（uloop）」节点的执行层。

固定调用 ``uloop --project-path <工程> execute-dynamic-code --code-file <.cs>``，
由**已打开的 Unity Editor 主线程**执行 C#，可直接调用 PlaneGenerator 等工程插件的公开
API。与 core/unity_cli.py（batchmode 另起 Unity 进程）互补：这里不抢工程锁、不另开场景、
不做静态无参方法限制。

不经 shell、不接受任意子命令；代码写入本机用户数据目录的临时 .cs 再交给 uloop，
避免多行 C# 被参数解析改写。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from core import unity_cli  # 复用 Windows 下 kill 整棵进程树的逻辑
from core.user_paths import user_data_dir

MAX_CODE_CHARS = 16000
MAX_OUTPUT_CHARS = 12000
MIN_TIMEOUT, MAX_TIMEOUT = 10, 1800
DEFAULT_TIMEOUT = 600
CLI_GRACE_SECONDS = 20
SCRIPT_SUFFIXES = ('.cmd', '.bat', '.ps1')


class ULoopCliError(ValueError):
    """前置校验错误，由 400 带回画布节点。"""


def resolve_cli(values: dict) -> str:
    raw = str(values.get('cli') or '').strip()
    if raw:
        path = Path(raw)
        if not path.is_absolute() or not path.is_file() or path.suffix.lower() in SCRIPT_SUFFIXES:
            raise ULoopCliError('uloop CLI 路径必须是绝对路径的可执行文件（非 .cmd/.bat/.ps1）')
        return str(path)
    candidates = [shutil.which('uloop'), shutil.which('uloop.exe')]
    local = os.environ.get('LOCALAPPDATA')
    if local:
        candidates.append(str(Path(local) / 'Programs' / 'uloop' / 'bin' / 'uloop.exe'))
    found = next((p for p in candidates if p and Path(p).is_file()), None)
    if not found:
        raise ULoopCliError('未找到 uloop CLI：请在 Unity 编辑器里安装 Unity CLI Loop，或填写其绝对路径')
    return str(Path(found).resolve())


def _project(values: dict) -> tuple[str, bool]:
    raw = str(values.get('project') or '').strip()
    if not raw:
        from core import unity_projects
        return unity_projects.best(), True
    path = Path(raw)
    if not path.is_absolute() or not (path / 'ProjectSettings' / 'ProjectVersion.txt').is_file():
        raise ULoopCliError('不是有效的 Unity 工程目录（需含 ProjectSettings/ProjectVersion.txt）')
    return str(path), False


def _apply_feature(values: dict) -> dict:
    """极简节点只给 feature，后端补齐向导需要的 mode；AI 工具带 mode 的原样放行。"""
    feature = str(values.get('feature') or '').strip()
    if not feature:
        return values
    resolved = dict(values)
    resolved['mode'] = {
        'inspect': 'inspect', 'scan': 'scan', 'custom': 'custom',
    }.get(feature, 'generate')
    return resolved


def timeout_of(values: dict) -> int:
    try:
        return min(max(int(values.get('timeout') or DEFAULT_TIMEOUT), MIN_TIMEOUT), MAX_TIMEOUT)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT


def _code_file(values: dict, inputs: list, run_id: str, log_dir: Path) -> Path:
    # 图形化向导：Python 侧把表单编译成完整 C#，用户无需写代码。
    from core import uloop_wizard
    wizard_code = uloop_wizard.build_code(values)
    if wizard_code is not None:
        if len(wizard_code) > MAX_CODE_CHARS:
            raise ULoopCliError('向导生成的代码过长，请减少自定义轮廓点数量')
        path = log_dir / f'{run_id}.cs'
        path.write_text(wizard_code, encoding='utf-8')
        return path
    raw = str(values.get('code_file') or '').strip()
    if raw:
        path = Path(raw)
        if not path.is_absolute() or not path.is_file() or path.suffix.lower() != '.cs':
            raise ULoopCliError('代码文件必须是存在的绝对路径 .cs 文件')
        return path
    code = str(values.get('code') or '')
    if not code.strip() and inputs:
        code = '\n'.join(str(item) for item in inputs[:1])
    if not code.strip():
        raise ULoopCliError('请填写 C# 代码、代码文件路径，或从上游节点连入代码文本')
    if len(code) > MAX_CODE_CHARS:
        raise ULoopCliError(f'C# 代码超过 {MAX_CODE_CHARS} 字符，请改用代码文件')
    path = log_dir / f'{run_id}.cs'
    path.write_text(code, encoding='utf-8')
    return path


def build_argv(values: dict, code_path: Path) -> list[str]:
    project, _ = _project(values)
    return [resolve_cli(values), '--project-path', project,
            'execute-dynamic-code', '--code-file', str(code_path)]


def run(values: dict, cancel_event=None, inputs=None) -> str:
    values = _apply_feature(dict(values))
    project, auto_project = _project(values)
    timeout = timeout_of(values)
    log_dir = Path(user_data_dir()) / 'uloop-cli-logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex[:16]
    out_path = log_dir / f'{run_id}.out.log'
    code_path = _code_file(values, inputs or [], run_id, log_dir)
    argv = build_argv(values, code_path)
    started = time.monotonic()
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    out_handle = open(out_path, 'w', encoding='utf-8', errors='replace')
    try:
        proc = subprocess.Popen(argv, stdout=out_handle, stderr=subprocess.STDOUT,
                                shell=False, creationflags=flags)
    except OSError as exc:
        out_handle.close()
        raise ULoopCliError(f'无法启动 uloop CLI：{exc}') from exc
    outcome = '完成'
    try:
        while proc.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                unity_cli._terminate_tree(proc)
                outcome = '已取消'
                break
            if time.monotonic() - started > timeout + CLI_GRACE_SECONDS:
                unity_cli._terminate_tree(proc)
                outcome = f'超时（{timeout}s）'
                break
            time.sleep(0.25)
        if proc.poll() is None:
            proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            unity_cli._terminate_tree(proc)
            proc.wait(timeout=5)
        out_handle.close()
    output = ''
    if out_path.is_file():
        output = out_path.read_text(encoding='utf-8', errors='replace')[-MAX_OUTPUT_CHARS:]
    hint = ''
    if 'UNKNOWN_COMMAND' in output or 'uloop sync' in output:
        hint = '\n提示：Unity 编辑器可能未打开或工具列表已过期，请先在工程里执行 `uloop sync`。'
    return (f'Unity 编辑器脚本（uloop） · {outcome}\n'
            f'工程：{project}' + ('（自动发现）\n' if auto_project else '\n') +
            f'代码：{code_path}\n'
            f'退出码：{proc.returncode}    耗时：{time.monotonic() - started:.1f}s\n'
            f'--- uloop 输出 ---\n' + (output or '（无输出）') + hint +
            '\n注意：以输出里的 Success / return 值为准，退出码为 0 不代表场景生成成功。')
