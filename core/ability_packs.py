"""Ability packs: declarative bundles that give the agent new tools.

A pack declares what to install, how to reach it, and which commands it may
run. The host executes; a pack carries no executable logic of its own. Design
rationale, red lines, and the format contract live in docs/ability-packs.md.
"""

import json
import re
import shutil
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SEMVER = re.compile(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')
PACK_ID = re.compile(r'^[a-z0-9][a-z0-9_.-]{1,63}$')
SUBCOMMAND = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
SHELL_META = re.compile(r'[;&|`$<>]')
KINDS = ('cli', 'stdio', 'http', 'skill')


class PackError(ValueError):
    pass


def _relative(value, field):
    """Package paths stay inside the package; bare command names are allowed."""
    if not value or value in ('-', '.'):
        return value
    normalized = value.replace('\\', '/')
    # Placeholders are resolved by the installer, which re-checks containment.
    if normalized.startswith('{') or normalized.startswith('./'):
        return value
    if '/' not in normalized:
        return value  # bare executable resolved through PATH
    raise ValueError('%s 必须是包内相对路径（./ 开头）或 {venv}/{pack} 占位符：%s' % (field, value))


class InstallStep(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,31}$')
    type: str
    python: str = ''
    package: str = ''
    version: str = ''
    argv: list[str] = Field(default_factory=list, max_length=32)
    expect: str = ''

    @model_validator(mode='after')
    def validate_step(self):
        if self.type not in ('venv', 'pip', 'probe', 'exec'):
            raise ValueError('步骤类型仅支持 venv、pip、probe、exec')
        if self.type == 'pip':
            if not self.package:
                raise ValueError('pip 步骤需要 package')
            if not SEMVER.match(self.version or ''):
                raise ValueError('pip 版本必须钉死为具体 SemVer，例如 1.5.2（不接受 latest 或区间）')
        if self.type in ('probe', 'exec'):
            if not self.argv:
                raise ValueError('probe / exec 步骤需要 argv')
            for item in self.argv:
                if '\n' in item or '\r' in item:
                    raise ValueError('argv 不得包含换行')
                if SHELL_META.search(item):
                    raise ValueError('argv 含 shell 元字符：%s' % item)
        return self


class InstallPlan(BaseModel):
    model_config = ConfigDict(extra='forbid')
    steps: list[InstallStep] = Field(default_factory=list, max_length=16)
    uninstall: list[InstallStep] = Field(default_factory=list, max_length=8)


class CliSpec(BaseModel):
    model_config = ConfigDict(extra='forbid')
    executable: str
    probe: list[str] = Field(default_factory=list, max_length=8)
    allow: list[str] = Field(min_length=1, max_length=64)
    deny: list[str] = Field(default_factory=list, max_length=64)
    cwd: str = ''
    timeout: int = Field(default=120, ge=5, le=1800)

    @model_validator(mode='after')
    def validate_cli(self):
        for name in self.allow + self.deny:
            if not SUBCOMMAND.match(name):
                raise ValueError('allow / deny 只能是裸子命令名：%s' % name)
        _relative(self.executable, 'cli.executable')
        _relative(self.cwd, 'cli.cwd')
        return self

    def permits(self, subcommand):
        if subcommand in self.deny:
            return False
        return subcommand in self.allow


class ConnectSpec(BaseModel):
    model_config = ConfigDict(extra='forbid')
    transport: str
    command: str = ''
    args: list[str] = Field(default_factory=list, max_length=32)
    cwd: str = ''
    url: str = ''
    env: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode='after')
    def validate_connect(self):
        if self.transport not in ('stdio', 'sse', 'http'):
            raise ValueError('connect.transport 仅支持 stdio、sse、http')
        if self.transport == 'stdio':
            if not self.command:
                raise ValueError('stdio 需要 command')
            _relative(self.command, 'connect.command')
            _relative(self.cwd, 'connect.cwd')
        else:
            if not self.url.startswith(('http://', 'https://')):
                raise ValueError('http / sse 需要完整的 http(s) 地址')
        for name in self.env:
            if not re.match(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$', name):
                raise ValueError('connect.env 只能声明变量名，不能写值：%s' % name)
        return self


class Requirements(BaseModel):
    model_config = ConfigDict(extra='forbid')
    commands: list[str] = Field(default_factory=list, max_length=16)
    platforms: list[str] = Field(default_factory=list, max_length=5)


class Pack(BaseModel):
    model_config = ConfigDict(extra='forbid')
    formatVersion: int = 1
    id: str
    version: str
    displayName: str = Field(max_length=64)
    description: str = Field(default='', max_length=400)
    kind: str
    icon: str = ''
    install: InstallPlan | None = None
    cli: CliSpec | None = None
    connect: ConnectSpec | None = None
    requires: Requirements | None = None
    skills: str = ''
    manual: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def validate_pack(self):
        if self.formatVersion != 1:
            raise ValueError('不支持的 formatVersion：%s，请升级宿主' % self.formatVersion)
        if not PACK_ID.match(self.id):
            raise ValueError('id 必须匹配 ^[a-z0-9][a-z0-9_.-]{1,63}$')
        if not SEMVER.match(self.version):
            raise ValueError('version 必须是 SemVer，例如 1.0.0')
        if self.kind not in KINDS:
            raise ValueError('kind 仅支持 %s' % '、'.join(KINDS))
        if self.kind == 'cli' and self.cli is None:
            raise ValueError('kind 为 cli 时必须声明 cli 段')
        if self.kind in ('stdio', 'http'):
            if self.connect is None:
                raise ValueError('kind 为 %s 时必须声明 connect 段' % self.kind)
            if self.connect.transport != self.kind:
                raise ValueError('kind 与 connect.transport 不一致')
        _relative(self.icon, 'icon')
        _relative(self.skills, 'skills')
        return self

    def context(self, folder):
        base = Path(folder).resolve()
        return {'{pack}': base.as_posix(), '{venv}': (base / 'venv').as_posix(),
                '{python}': sys.executable}


def _expand(value, context):
    for token, replacement in (context or {}).items():
        value = value.replace(token, replacement)
    return value


def _host_tokens():
    """Resolve host-software tokens such as ``{blender.addons}``.

    Only the recommended install is considered: the one with an executable whose
    config directory exists. A miss returns nothing, so the token stays visible
    in ``unresolved`` instead of silently expanding to an empty path.
    """
    try:
        from core import software_detect
        blender = software_detect.blender_versions()
    except Exception:
        return {}
    chosen = blender.get('recommended') or {}
    addons = chosen.get('addonsDir') or ''
    return {'{blender.addons}': addons} if addons else {}


def read_manifest(folder):
    """Return (Pack, None) or (None, human-readable reason)."""
    path = Path(folder) / 'pack.json'
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None, '缺少 pack.json'
    except json.JSONDecodeError as exc:
        return None, 'JSON 语法错误（第 %s 行）：%s' % (exc.lineno, exc.msg)
    except OSError as exc:
        return None, '无法读取 pack.json：%s' % exc.strerror
    try:
        return Pack.model_validate(payload), None
    except ValidationError as exc:
        return None, _first_error(exc)


def _first_error(exc):
    for item in exc.errors():
        location = '.'.join(str(part) for part in item.get('loc', ())) or 'pack'
        return '%s: %s' % (location, item.get('msg', '校验失败'))
    return '校验失败'


def repo_packs_dir():
    return Path(__file__).resolve().parent.parent / 'packs'


def installed_dir():
    from core.user_paths import user_data_dir
    return Path(user_data_dir()) / 'packs'


def catalog():
    """Installed packs first; the bundled catalog fills in what is not installed."""
    entries, seen = [], set()
    for folder, origin in ((installed_dir(), 'installed'), (repo_packs_dir(), 'catalog')):
        if not folder.is_dir():
            continue
        for entry in sorted(folder.iterdir()):
            if not (entry / 'pack.json').is_file():
                continue
            pack, reason = read_manifest(entry)
            key = pack.id if pack else entry.name
            if key in seen:
                continue
            seen.add(key)
            entries.append({
                'id': key,
                'dir': str(entry),
                'origin': origin,
                'installed': origin == 'installed',
                'pack': pack.model_dump() if pack else None,
                'error': reason,
            })
    return entries


def check_requirements(pack):
    """Read PATH only. Never runs the declared commands."""
    checks = []
    for command in (pack.requires.commands if pack.requires else []):
        found = shutil.which(command)
        checks.append({'kind': 'command', 'name': command, 'ok': bool(found), 'path': found or ''})
    platforms = pack.requires.platforms if pack.requires else []
    if platforms:
        checks.append({'kind': 'platform', 'name': sys.platform,
                       'ok': sys.platform in platforms, 'path': ''})
    return checks


def _state_of(entry):
    if entry['error']:
        return 'invalid'
    if entry['installed']:
        return 'installed'
    checks = check_requirements(entry['pack'] and Pack.model_validate(entry['pack']))
    return 'installable' if all(item['ok'] for item in checks) else 'blocked'


def summary(entry):
    """One catalogue row: no secrets, no install activity."""
    pack = entry['pack']
    data = {
        'id': entry['id'],
        'dir': entry['dir'],
        'origin': entry['origin'],
        'installed': entry['installed'],
        'status': _state_of(entry),
        'error': entry['error'],
    }
    if not pack:
        return data
    data.update({
        'version': pack['version'],
        'displayName': pack['displayName'],
        'description': pack['description'],
        'kind': pack['kind'],
        'skills': bool(pack['skills']),
        'steps': len((pack['install'] or {}).get('steps') or []),
        'requires': check_requirements(Pack.model_validate(pack)),
        'manual': pack['manual'],
    })
    return data


def software_snapshot():
    """Local readiness for every target the packs care about."""
    from core import software_detect
    blender = software_detect.blender_versions()
    return {
        'blender': {
            'installed': bool(blender['installs']),
            'recommended': blender['recommended'],
            'installs': blender['installs'],
            'orphanConfigs': blender['orphanConfigs'],
            'needsManualPath': blender['needsManualPath'],
        },
        'comfyui': software_detect.comfyui_instance(),
        'unity': software_detect.discover('unity'),
        'unreal': software_detect.discover('unreal'),
        'maya': software_detect.discover('maya'),
        'houdini': software_detect.discover('houdini'),
        'mcpServers': _mcp_summary(),
    }


def _mcp_summary():
    from core.mcp_tools import servers
    try:
        return [{'id': item.id, 'transport': item.transport, 'enabled': item.enabled}
                for item in servers()]
    except Exception:
        return []


def discover():
    rows = [summary(entry) for entry in catalog()]
    return {
        'software': software_snapshot(),
        'packs': rows,
        'counts': {
            'installed': sum(1 for row in rows if row['status'] == 'installed'),
            'installable': sum(1 for row in rows if row['status'] == 'installable'),
            'blocked': sum(1 for row in rows if row['status'] == 'blocked'),
            'invalid': sum(1 for row in rows if row['status'] == 'invalid'),
        },
    }


def validate_folder(folder):
    """Dry validation for third-party authors: nothing is executed."""
    pack, reason = read_manifest(folder)
    if pack is None:
        return {'ok': False, 'error': reason}
    context = pack.context(folder)
    context.update(_host_tokens())
    steps, unresolved = [], set()
    for step in (pack.install or InstallPlan()).steps:
        argv = [_expand(item, context) for item in step.argv]
        unresolved.update(token for item in argv
                          for token in re.findall(r'\{[a-z][a-z0-9_.]*\}', item))
        steps.append({'id': step.id, 'type': step.type, 'argv': argv,
                      'package': step.package, 'version': step.version})
    return {
        'ok': True,
        'id': pack.id,
        'displayName': pack.displayName,
        'kind': pack.kind,
        'steps': steps,
        'unresolved': sorted(unresolved),
        'plan': list(pack.manual or []),
        'requires': check_requirements(pack),
        'executesNothing': True,
    }
