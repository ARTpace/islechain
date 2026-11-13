"""画布「Unity CLI」节点的执行层：调用官方 Unity CLI 的 ``unity run``。

官方 CLI 是 Unity 发布的独立二进制（本机随 Hub 装在
``%LOCALAPPDATA%\\Unity\\bin\\unity.exe``）。它托管 ``-batchmode/-quit/-projectPath``、
按 ``ProjectVersion.txt`` 自动匹配编辑器版本、``--timeout`` 收尾子进程、``--format json``
结构化输出。节点只负责：找到 CLI、校验工程目录、白名单方法名与额外参数、
拼 ``unity run <project> -- -logFile <path> -executeMethod <method>``、回显日志与 CLI 输出。

与旧实现的区别：不再直接 spawn ``Unity.exe``，也不再自己拼 batchmode 参数。
无 shell、无自由命令拼接；不启用 ``--allow-install``（自动下载编辑器需用户显式同意）。
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import HTTPException

from core import game_engine_plugins
from core.user_paths import user_data_dir

# 方法名必须是 Namespace.Class.Method 形式；不允许引号、空格、分号等可注入字符。
METHOD = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){1,8}$')
ARG_KEY = re.compile(r'^-[A-Za-z][A-Za-z0-9-]{0,40}$')
ARG_VALUE = re.compile(r'^[A-Za-z0-9_.:/\\=+\-]{1,240}$')
# 官方 CLI 的保留转发参数：-batchmode/-quit/-projectPath/-useHub/-hubIPC；
# -logFile 与 -executeMethod 由本节点固定，同样不允许额外参数覆盖。
RESERVED = {'-projectpath', '-executemethod', '-logfile', '-batchmode', '-quit',
            '-usehub', '-hubipc'}
MAX_LOG_CHARS = 12000
MAX_CLI_CHARS = 4000
MIN_TIMEOUT, MAX_TIMEOUT = 10, 1800
DEFAULT_TIMEOUT = 600
# 官方 CLI 的 --timeout 会先收尾自己派生的 Unity 进程；Python 侧留宽限期，
# 避免抢先杀掉 CLI 后留下占着工程锁的 Unity 子进程。
CLI_GRACE_SECONDS = 20
SCRIPT_SUFFIXES = ('.cmd', '.bat', '.ps1')


class UnityCliError(ValueError):
    """把失败原因（含 Unity 日志）原样带回画布节点。"""


def _executable_path(raw: str, label: str) -> str:
    path = Path(raw)
    if not path.is_absolute() or not path.is_file() or path.suffix.lower() in SCRIPT_SUFFIXES:
        raise UnityCliError(f'{label}必须是绝对路径的可执行文件（非 .cmd/.bat/.ps1）')
    return str(path)


def resolve_cli(values: dict) -> str:
    """优先用节点里显式填的 CLI 路径，否则在 PATH 里找官方 unity。"""
    raw = str(values.get('cli') or '').strip()
    if raw:
        return _executable_path(raw, '官方 unity CLI 路径')
    # 后端进程的 PATH 未必带 Unity bin（GUI/服务方式启动时常见），补 Hub 默认安装位置。
    candidates = [shutil.which('unity'), shutil.which('unity.exe')]
    local = os.environ.get('LOCALAPPDATA')
    if local:
        candidates.append(str(Path(local) / 'Unity' / 'bin' / 'unity.exe'))
    found = next((p for p in candidates if p and Path(p).is_file()), None)
    if not found:
        raise UnityCliError('未找到官方 Unity CLI：请安装 Unity Hub 附带的 unity CLI，或填写其绝对路径')
    return str(Path(found).resolve())


def timeout_of(values: dict) -> int:
    try:
        return min(max(int(values.get('timeout') or DEFAULT_TIMEOUT), MIN_TIMEOUT), MAX_TIMEOUT)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT


def build_argv(values: dict, log_path: Path | None = None) -> list[str]:
    cli = resolve_cli(values)
    project = str(values.get('project') or '').strip()
    try:
        # 复用工程目录校验（绝对路径 + ProjectSettings/ProjectVersion.txt）。
        # validate() 里的 tool_path 只检查可执行文件真实存在，传 CLI 路径同样成立。
        checked = game_engine_plugins.validate('unity', cli, project)
    except HTTPException as exc:
        raise UnityCliError(str(exc.detail)) from exc
    method = str(values.get('method') or '').strip()
    if not METHOD.match(method):
        raise UnityCliError('方法名格式应为 Namespace.Class.Method（静态无参方法）')
    # 全局选项放在子命令之前（commander 的标准位置）；--format json 让 stdout 结构化。
    argv = [cli, '--format', 'json', '--no-banner', '--no-pager', '--non-interactive',
            'run', checked['project'], '--timeout', str(timeout_of(values))]
    # 可选：手动指定编辑器二进制；留空则由 CLI 按 ProjectVersion.txt 自动匹配。
    editor = str(values.get('executable') or '').strip()
    if editor:
        argv += ['-e', _executable_path(editor, 'Unity 编辑器路径')]
    # 本版 unity run 没有 --log-file；按官方示例在 -- 之后转发 -logFile。
    argv += ['--', '-logFile', str(log_path or Path('unity-cli.log')), '-executeMethod', method]
    extra = str(values.get('args') or '').strip()
    if extra:
        tokens = extra.split()
        if len(tokens) % 2 or len(tokens) > 24:
            raise UnityCliError('额外参数必须成对传入：-Key Value（最多 12 对）')
        for key, value in zip(tokens[::2], tokens[1::2]):
            if not ARG_KEY.match(key) or not ARG_VALUE.match(value):
                raise UnityCliError(f'额外参数含非法字符：{key} {value}')
            if key.lower() in RESERVED:
                raise UnityCliError(f'{key} 由官方 CLI 或节点固定，不能覆盖')
            argv += [key, value]
    return argv


def _terminate_tree(proc: subprocess.Popen):
    """Windows 下杀整棵进程树：只 terminate CLI 会留下占着工程锁的 Unity 子进程。"""
    if os.name == 'nt':
        try:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=10,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return
        except (OSError, subprocess.TimeoutExpired):
            pass
    proc.terminate()


def run(values: dict, cancel_event=None) -> str:
    values = dict(values)
    auto_project = False
    if not str(values.get('project') or '').strip():
        # 延迟导入：unity_projects 顶层依赖本模块的 resolve_cli，避免循环导入。
        from core import unity_projects
        values['project'] = unity_projects.best()
        auto_project = True
    timeout = timeout_of(values)
    log_dir = Path(user_data_dir()) / 'unity-cli-logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex[:16]
    log_path = log_dir / f'{run_id}.log'
    out_path = log_dir / f'{run_id}.out.log'
    argv = build_argv(values, log_path)
    started = time.monotonic()
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    # stdout 走文件而不是 PIPE：Unity 日志可能很长，PIPE 不读会死锁。
    out_handle = open(out_path, 'w', encoding='utf-8', errors='replace')
    try:
        proc = subprocess.Popen(argv, stdout=out_handle, stderr=subprocess.STDOUT,
                                shell=False, creationflags=flags)
    except OSError as exc:
        out_handle.close()
        raise UnityCliError(f'无法启动官方 Unity CLI：{exc}') from exc
    outcome = '完成'
    try:
        while proc.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                _terminate_tree(proc)
                outcome = '已取消'
                break
            if time.monotonic() - started > timeout + CLI_GRACE_SECONDS:
                _terminate_tree(proc)
                outcome = f'超时（{timeout}s）'
                break
            time.sleep(0.25)
        if proc.poll() is None:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _terminate_tree(proc)
                proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            _terminate_tree(proc)
            proc.wait(timeout=5)
        out_handle.close()
    log = ''
    if log_path.is_file():
        log = log_path.read_text(encoding='utf-8', errors='replace')[-MAX_LOG_CHARS:]
    cli_out = ''
    if out_path.is_file():
        cli_out = out_path.read_text(encoding='utf-8', errors='replace')[-MAX_CLI_CHARS:]
    code = proc.returncode
    text = (f'Unity CLI（官方） · {outcome}\n'
            f'CLI：{argv[0]}\n'
            f'方法：{values.get("method", "")}\n'
            f'工程：{values.get("project", "")}' + ('（自动发现）\n' if auto_project else '\n') +
            f'退出码：{code}    耗时：{time.monotonic() - started:.1f}s\n'
            f'日志：{log_path}\n'
            f'--- 日志尾部 ---\n' + (log or '（无日志输出）') +
            f'\n--- CLI 输出尾部（--format json） ---\n' + (cli_out or '（无）'))
    # 运行失败（非零退出码 / 超时 / 取消）也回传完整日志：node-run 的错误分支
    # 会把消息截断到 500 字符（routers/mcp_tools.py:131），抛异常会丢掉日志尾部。
    # 参数校验 / 无法启动这类前置错误仍抛 UnityCliError，由 400 带回短提示。
    return text
