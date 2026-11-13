"""Read-only detection of locally installed DCC software.

Nothing here installs, downloads, or executes application code: it only stats
known paths, reads the Windows uninstall registry, and reads PE version
resources. Ports are probed with one short HTTP GET.

Pattern adapted from AssetVault ``server/software-detection.mjs``: three
candidate sources (flat Program Files scan, vendor roots, uninstall registry),
dedupe by resolved path, read the real version from the executable instead of
guessing it from the directory name, cache the whole answer for a day.
"""

import json
import os
import re
import sys
import threading
import time
from pathlib import Path

CACHE_TTL = 24 * 60 * 60
# Bump when the discovery logic changes so stale 24h caches get discarded.
SCHEMA = 2

# Relative executable paths under an install root.
EXECUTABLES = {
    'blender': ['blender.exe'],
    'maya': ['bin/maya.exe'],
    '3dsmax': ['3dsmax.exe'],
    'houdini': ['bin/houdini.exe', 'bin/houdinifx.exe'],
    'c4d': ['Cinema 4D.exe', 'Cinema4D.exe'],
    'unity': ['Editor/Unity.exe'],
    'unreal': ['Engine/Binaries/Win64/UnrealEditor.exe'],
    'godot': ['Godot.exe', 'godot.exe'],
}

# Vendor folders directly under Program Files.
VENDORS = {
    'blender': ['Blender Foundation'],
    'maya': ['Autodesk'],
    '3dsmax': ['Autodesk'],
    'houdini': ['Side Effects Software'],
    'c4d': ['Maxon'],
    'unity': ['Unity/Hub/Editor'],
    'unreal': ['Epic Games'],
    'godot': ['Godot'],
}

# DisplayName patterns for the uninstall registry.
MATCHES = {
    'blender': re.compile(r'\bBlender\b', re.I),
    'maya': re.compile(r'\bMaya\b', re.I),
    '3dsmax': re.compile(r'3ds\s*Max', re.I),
    'houdini': re.compile(r'Houdini\s*\d', re.I),
    'c4d': re.compile(r'Cinema\s*4D', re.I),
    'unity': re.compile(r'Unity\s*\d|^20\d\d\.\d', re.I),
    'unreal': re.compile(r'Unreal|^UE_\d', re.I),
    'godot': re.compile(r'Godot', re.I),
}

VERSION_IN_PATH = re.compile(r'(20\d\d(?:\.\d+)*|(?:Houdini[ -]*|UE_)\d+(?:\.\d+)*)', re.I)


def _program_files():
    return [value for value in (
        os.environ.get('ProgramW6432'),
        os.environ.get('ProgramFiles'),
        os.environ.get('ProgramFiles(x86)'),
        'C:/Program Files',
    ) if value]


def _subdirs(root):
    try:
        return [entry for entry in Path(root).iterdir() if entry.is_dir()]
    except OSError:
        return []


def _uninstall_rows():
    """Read the three uninstall hives once; no subprocess, no full-disk scan."""
    if sys.platform != 'win32':
        return []
    try:
        import winreg
    except ImportError:
        return []
    roots = (
        (winreg.HKEY_LOCAL_MACHINE, r'Software\Microsoft\Windows\CurrentVersion\Uninstall'),
        (winreg.HKEY_LOCAL_MACHINE, r'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'),
        (winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Uninstall'),
    )
    rows = []
    for hive, subkey in roots:
        try:
            key = winreg.OpenKey(hive, subkey)
        except OSError:
            continue
        with key:
            index = 0
            while True:
                try:
                    name = winreg.EnumKey(key, index)
                except OSError:
                    break
                index += 1
                try:
                    with winreg.OpenKey(key, name) as entry:
                        display = _reg_value(entry, 'DisplayName')
                        location = _reg_value(entry, 'InstallLocation')
                        if display and location:
                            rows.append({'display': display, 'location': location})
                except OSError:
                    continue
    return rows


def _reg_value(key, name):
    try:
        value, _ = __import__('winreg').QueryValueEx(key, name)
        return value if isinstance(value, str) else ''
    except OSError:
        return ''


def _pe_version(path):
    """Read ProductVersion from the PE resource; empty string when unavailable."""
    if sys.platform != 'win32':
        return ''
    try:
        import ctypes
        from ctypes import wintypes
    except ImportError:
        return ''

    class FixedFileInfo(ctypes.Structure):
        _fields_ = [
            ('dwSignature', wintypes.DWORD), ('dwStrucVersion', wintypes.DWORD),
            ('dwFileVersionMS', wintypes.DWORD), ('dwFileVersionLS', wintypes.DWORD),
            ('dwProductVersionMS', wintypes.DWORD), ('dwProductVersionLS', wintypes.DWORD),
            ('dwFileFlagsMask', wintypes.DWORD), ('dwFileFlags', wintypes.DWORD),
            ('dwFileOS', wintypes.DWORD), ('dwFileType', wintypes.DWORD),
            ('dwFileSubtype', wintypes.DWORD), ('dwFileDateMS', wintypes.DWORD),
            ('dwFileDateLS', wintypes.DWORD),
        ]

    try:
        version = ctypes.WinDLL('version')
        target = str(path)
        size = version.GetFileVersionInfoSizeW(target, None)
        if not size:
            return ''
        buffer = ctypes.create_string_buffer(size)
        if not version.GetFileVersionInfoW(target, 0, size, buffer):
            return ''
        pointer = ctypes.c_void_p()
        length = wintypes.UINT()
        if not version.VerQueryValueW(buffer, '\\', ctypes.byref(pointer), ctypes.byref(length)):
            return ''
        info = ctypes.cast(pointer, ctypes.POINTER(FixedFileInfo)).contents
        return '%d.%d.%d' % (info.dwProductVersionMS >> 16, info.dwProductVersionMS & 0xFFFF,
                             info.dwProductVersionLS >> 16)
    except Exception:
        return ''


def _running_paths(names):
    """Full exe paths of running processes. A portable install (unzipped anywhere,
    absent from Program Files and the registry) is only discoverable this way."""
    if sys.platform != 'win32':
        return []
    import ctypes
    from ctypes import wintypes
    wanted = {name.lower() for name in names}
    paths = []
    try:
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]

        class Entry(ctypes.Structure):
            _fields_ = [
                ('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
                ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
                ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', ctypes.c_long),
                ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260),
            ]

        snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0)
        if not snapshot or snapshot == wintypes.HANDLE(-1).value:
            return []
        try:
            entry = Entry()
            entry.dwSize = ctypes.sizeof(Entry)
            ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                if (entry.szExeFile or '').lower() in wanted:
                    handle = kernel32.OpenProcess(0x1000, False, entry.th32ProcessID)
                    if handle:
                        buffer = ctypes.create_unicode_buffer(1024)
                        size = wintypes.DWORD(1024)
                        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                            paths.append(buffer.value)
                        kernel32.CloseHandle(handle)
                ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(snapshot)
    except Exception:
        return paths
    return paths


def _version_label(relative, path):
    match = VERSION_IN_PATH.search(str(relative))
    if match:
        return re.sub(r'^(Houdini[ -]*|UE_)', '', match.group(0), flags=re.I).strip()
    return ''


def detect(target, refresh=False):
    """Return ``{'installed': bool, 'installations': [...]}`` for one target."""
    exes = EXECUTABLES.get(target)
    if not exes:
        raise ValueError('不支持的目标：%s' % target)
    candidates, seen_paths = [], set()

    def add(path):
        key = str(path).lower()
        if key not in seen_paths:
            seen_paths.add(key)
            candidates.append(Path(path))

    for root in _program_files():
        for vendor in VENDORS.get(target, []):
            vendor_root = Path(root) / vendor
            add(vendor_root)
            for entry in _subdirs(vendor_root):
                add(entry)
        for entry in _subdirs(root):
            if MATCHES.get(target) and MATCHES[target].search(entry.name):
                add(entry)

    for row in _uninstall_rows():
        if MATCHES.get(target) and MATCHES[target].search(row['display']):
            add(row['location'])

    override = os.environ.get('ART_CANVAS_%s_EXE' % target.upper())
    files = [Path(override)] if override else []
    for running in _running_paths(exes):
        files.append(Path(running))
    for directory in candidates:
        for relative in exes:
            files.append(directory / relative)

    installations, seen_exe = [], set()
    for file in files:
        try:
            if not file.is_file():
                continue
            executable = file.resolve()
        except OSError:
            continue
        key = str(executable).lower()
        if key in seen_exe:
            continue
        seen_exe.add(key)
        installations.append({
            'executable': str(executable),
            'pathVersion': _version_label(Path(file).parent.name, file),
            'version': _pe_version(executable),
        })

    for item in installations:
        item['version'] = item['version'] or item['pathVersion']
        item.pop('pathVersion', None)

    # Keep the highest version per resolved directory (houdini ships two exes).
    unique = {}
    for item in installations:
        folder = str(Path(item['executable']).parent).lower()
        if folder not in unique:
            unique[folder] = item
    result = sorted(unique.values(), key=lambda item: item['version'], reverse=True)
    return {'target': target, 'installed': bool(result), 'installations': result}


def _files(folder, suffix=''):
    try:
        return [entry for entry in Path(folder).iterdir() if entry.is_file()
                and entry.name.lower().endswith(suffix)]
    except OSError:
        return []


def blender_versions():
    """Map executable versions to user config dirs; report config-only leftovers."""
    appdata = os.environ.get('APPDATA') or ''
    root = Path(appdata) / 'Blender Foundation' / 'Blender' if appdata else None
    configs = {}
    if root and root.is_dir():
        for entry in _subdirs(root):
            if not re.fullmatch(r'\d+\.\d+', entry.name):
                continue
            addons = sorted(item.name for item in _files(entry / 'scripts' / 'addons', '.py'))
            extensions = sorted(item.name for item in _subdirs(entry / 'extensions' / 'user_default'))
            configs[entry.name] = {
                'version': entry.name,
                'configDir': str(entry),
                'addonsDir': str(entry / 'scripts' / 'addons'),
                'extensionsDir': str(entry / 'extensions' / 'user_default'),
                'addons': addons,
                'mcpAddon': any('blender-mcp' in name.lower() or 'mcp' in name.lower() for name in addons),
                'addonCount': len(addons) + len(extensions),
            }

    installs = []
    for item in discover('blender')['installations']:
        executable = Path(item['executable'])
        minor = '.'.join(item['version'].split('.')[:2]) if item['version'] else ''
        config = configs.get(minor)
        portable = (executable.parent / 'portable').is_dir()
        installs.append({
            **item,
            'minor': minor,
            'configDir': config['configDir'] if config else '',
            'addonsDir': config['addonsDir'] if config else '',
            'mcpAddon': bool(config and config['mcpAddon']),
            'portable': portable,
        })

    with_exe = {item['minor'] for item in installs if item['minor']}
    orphans = [value for key, value in sorted(configs.items()) if key not in with_exe]
    # One recommendation: prefer the highest version that actually has an exe.
    usable = sorted([item for item in installs if item['minor']], key=lambda item: item['minor'], reverse=True)
    return {
        'installs': installs,
        'orphanConfigs': orphans,
        'recommended': usable[0] if usable else None,
        'needsManualPath': not usable,
    }


def comfyui_instance(base='http://127.0.0.1:8188', timeout=2):
    """Probe a running instance. Proxy is bypassed on purpose: a system proxy
    hijacks loopback requests and returns stale or empty bodies."""
    import urllib.error
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(base.rstrip('/') + '/system_stats', timeout=timeout) as response:
            payload = json.loads(response.read(64 * 1024).decode('utf-8', 'replace'))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {'running': False, 'base': base, 'reason': type(exc).__name__}
    system = payload.get('system') if isinstance(payload, dict) else None
    if not isinstance(system, dict):
        return {'running': False, 'base': base, 'reason': '响应格式无效'}
    return {'running': True, 'base': base, 'version': system.get('comfyui_version', ''),
            'python': system.get('python_version', ''),
            'device': (payload.get('devices') or [{}])[0].get('name', '')}


# --- cached discovery ---------------------------------------------------------

_LOCK = threading.Lock()
_CACHE = {}
_INFLIGHT = {}


def cache_dir():
    from core.user_paths import user_data_dir
    return Path(user_data_dir()) / 'software-detection'


def discover(target, refresh=False, cache=True):
    if not cache:
        return detect(target, refresh=True)
    path = cache_dir() / (target + '.json')
    if not refresh:
        try:
            cached = json.loads(path.read_text(encoding='utf-8'))
            if cached.get('schema') == SCHEMA and time.time() - cached.get('at', 0) < CACHE_TTL:
                return cached['result']
        except (OSError, ValueError):
            pass
    with _LOCK:
        pending = _INFLIGHT.get(target)
        if pending is None:
            pending = threading.Event()
            _INFLIGHT[target] = pending
            owner = True
        else:
            owner = False
    if not owner:
        pending.wait(timeout=30)
        return discover(target, refresh=False, cache=cache)
    try:
        result = detect(target, refresh=True)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'schema': SCHEMA, 'at': time.time(), 'result': result},
                                       ensure_ascii=False), encoding='utf-8')
        except OSError:
            pass
        return result
    finally:
        with _LOCK:
            _INFLIGHT.pop(target, None)
        pending.set()
