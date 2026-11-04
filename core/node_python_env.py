"""Explicit, pinned wheel environments, separate from the host and ComfyUI Python."""

import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import sysconfig
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from email.parser import BytesParser
from pathlib import Path

from core.game_process_tree import ProcessTree
from core.user_paths import user_data_dir

MAX_DOWNLOAD = 128 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
TIMEOUT = 180


def packaging():
    try:
        from pip._vendor.packaging import markers, requirements, tags, utils, version
    except ImportError:
        raise ValueError('应用 Python 缺少随附 pip，请修复桌面运行时；不会借用系统 pip') from None
    return markers, requirements, tags, utils, version


def _allowed_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in ('pypi.org', 'files.pythonhosted.org')
            or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment):
        raise ValueError('Python 依赖只允许 PyPI 官方 HTTPS 来源')


class _Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        _allowed_url(new_url)
        return super().redirect_request(request, fp, code, message, headers, new_url)


def _check(cancel, deadline):
    if cancel is not None and cancel.is_set():
        raise ValueError('节点依赖安装已取消')
    if time.monotonic() >= deadline:
        raise ValueError('节点依赖安装超过180秒预算')


def _fetch(url, limit, cancel, deadline, destination=None):
    _allowed_url(url)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _Redirects())
    size, chunks, digest = 0, [], hashlib.sha256()
    try:
        _check(cancel, deadline)
        with opener.open(url, timeout=min(10, max(0.1, deadline - time.monotonic()))) as response:
            _allowed_url(response.geturl())
            length = response.headers.get('Content-Length')
            if length and int(length) > limit:
                raise ValueError('Python 依赖下载超过字节预算')
            while True:
                _check(cancel, deadline)
                chunk = response.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise ValueError('Python 依赖下载超过字节预算')
                digest.update(chunk)
                if destination is None:
                    chunks.append(chunk)
                else:
                    destination.write(chunk)
    except (OSError, urllib.error.URLError) as exc:
        raise ValueError('PyPI 读取失败：' + str(exc)[:250]) from None
    return b''.join(chunks), size, digest.hexdigest()


def inspect_package(name, version='', cancel=None, deadline=None):
    from core.node_catalog import PythonDependency
    pin = PythonDependency(name=name, version=version or '0')
    deadline = deadline or time.monotonic() + 30
    url = 'https://pypi.org/pypi/' + urllib.parse.quote(pin.name, safe='')
    url += ('/' + urllib.parse.quote(pin.version, safe='') if version else '') + '/json'
    raw, _, _ = _fetch(url, 2 * 1024 * 1024, cancel, deadline)
    try:
        data = json.loads(raw)
        info = data['info']
        _, _, tags, utils, versions = packaging()
        selected_version = versions.Version(pin.version if version else info['version'])
        canonical_name = utils.canonicalize_name(info['name'])
        if canonical_name != pin.name or versions.Version(info['version']) != selected_version:
            raise ValueError('PyPI 返回的包身份或版本与请求不一致')
        ranks = {tag: index for index, tag in enumerate(tags.sys_tags())}
        wheels = []
        for file in data['urls']:
            if file.get('packagetype') != 'bdist_wheel' or file.get('yanked') or not 0 < file.get('size', 0) <= MAX_DOWNLOAD:
                continue
            filename = file['filename']
            if not isinstance(filename, str) or '/' in filename or '\\' in filename or ':' in filename or len(filename) > 200:
                continue
            wheel_name, wheel_version, _, wheel_tags = utils.parse_wheel_filename(filename)
            matching = [ranks[tag] for tag in wheel_tags if tag in ranks]
            if wheel_name != pin.name or wheel_version != selected_version or not matching:
                continue
            _allowed_url(file['url'])
            sha256 = file['digests']['sha256']
            if len(sha256) != 64 or any(char not in '0123456789abcdef' for char in sha256):
                raise ValueError('PyPI 未返回有效的 wheel SHA256')
            wheels.append({'name': pin.name, 'version': str(selected_version), 'filename': filename,
                           'url': file['url'], 'sha256': sha256, 'bytes': file['size'], 'rank': min(matching)})
        if not wheels:
            raise ValueError('该版本没有兼容当前 Python/系统的非撤回 wheel，不安装源码包')
        wheel = min(wheels, key=lambda item: (item['rank'], item['filename']))
        wheel.pop('rank')
        requires = info.get('requires_dist') or []
        return {'package': wheel, 'requiresDist': [str(item)[:500] for item in requires[:80]],
                'requiresPython': info.get('requires_python') or '',
                'scope': '只读 PyPI 元数据；requiresDist 供完善显式依赖清单，尚未安装或测试'}
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError('PyPI 元数据格式无效') from exc


def _verify_wheel(path, package, pins):
    markers, requirements, _, utils, versions = packaging()
    environment = markers.default_environment()
    environment['extra'] = ''
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 20000:
                raise ValueError('wheel 文件数量超过上限')
            names, expanded, metadata = set(), 0, []
            for entry in entries:
                parts = entry.filename.split('/')
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if (not entry.filename or entry.filename in names or any(part in ('.', '..') for part in parts)
                        or any(not part for part in (parts[:-1] if entry.is_dir() else parts))
                        or entry.filename.startswith('/') or '\\' in entry.filename or ':' in entry.filename
                        or mode not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1):
                    raise ValueError('wheel 包含越界路径、链接、加密或重复条目')
                names.add(entry.filename)
                expanded += entry.file_size
                if expanded > MAX_EXPANDED:
                    raise ValueError('wheel 解压大小超过512MiB预算')
                if len(parts) == 2 and parts[0].endswith('.dist-info') and parts[1] == 'METADATA':
                    if entry.file_size > 2 * 1024 * 1024:
                        raise ValueError('wheel 元数据过大')
                    metadata.append(BytesParser().parsebytes(archive.read(entry)))
            if len(metadata) != 1:
                raise ValueError('wheel 必须具有唯一的发行元数据')
            info = metadata[0]
            if utils.canonicalize_name(info['Name']) != package['name'] or versions.Version(info['Version']) != versions.Version(package['version']):
                raise ValueError('wheel 内部身份或版本与 PyPI 清单不一致')
            python = info.get('Requires-Python')
            if python:
                from pip._vendor.packaging.specifiers import SpecifierSet
                if not SpecifierSet(python).contains(platform.python_version(), prereleases=True):
                    raise ValueError('依赖不支持当前应用 Python 版本')
            for raw in info.get_all('Requires-Dist', []):
                requirement = requirements.Requirement(raw)
                if requirement.marker and not requirement.marker.evaluate(environment):
                    continue
                name = utils.canonicalize_name(requirement.name)
                if requirement.url or requirement.extras:
                    raise ValueError(f'{package["name"]} 的依赖 {name} 包含URL或extras，当前不支持')
                if name not in pins or not requirement.specifier.contains(pins[name], prereleases=True):
                    raise ValueError(f'显式依赖清单缺少或不兼容：{raw[:200]}；请创建新候选补齐固定版本')
            return expanded
    except (zipfile.BadZipFile, KeyError, TypeError) as exc:
        raise ValueError('wheel 文件或元数据无效') from exc


def _install(wheels, target, log, cancel, deadline):
    environment = {key: value for key, value in os.environ.items() if key.upper() in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP')}
    environment.update(PYTHONIOENCODING='utf-8', PIP_CONFIG_FILE=os.devnull)
    temporary = log.parent / 'pip-tmp'
    temporary.mkdir()
    environment.update(TEMP=str(temporary), TMP=str(temporary), TMPDIR=str(temporary))
    command = [sys.executable, '-I', '-B', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install',
               '--no-index', '--no-deps', '--no-compile', '--no-cache-dir', '--no-warn-script-location',
               '--target', str(target), *map(str, wheels)]
    process, tree = None, None
    try:
        with log.open('wb') as output:
            process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                cwd=target.parent, env=environment, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                start_new_session=os.name != 'nt')
            tree = ProcessTree(process.pid)
            while process.poll() is None:
                _check(cancel, deadline)
                if log.stat().st_size > 1024 * 1024:
                    raise ValueError('依赖安装日志超过1MiB')
                time.sleep(0.05)
        _check(cancel, deadline)
        if log.stat().st_size > 1024 * 1024:
            raise ValueError('依赖安装日志超过1MiB')
        if process.returncode:
            raise ValueError('独立目录安装失败：' + log.read_text(encoding='utf-8', errors='replace')[-1200:])
    finally:
        if tree is not None:
            tree.close()
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)


class PythonEnvironment:
    def __init__(self, owner, definition):
        if not isinstance(owner, str) or not owner:
            raise ValueError('独立依赖环境需要账号上下文')
        from core.node_catalog import definition as normalize
        from core.node_catalog import digest
        self.definition = normalize(definition)
        self.pins = self.definition['execution'].get('dependencies', [])
        self.definition_hash = digest(self.definition)
        self.python = {'executable': str(Path(sys.executable).resolve()), 'version': platform.python_version(),
                       'platform': sys.platform, 'machine': platform.machine(), 'cacheTag': sys.implementation.cache_tag}
        identity = digest({'definitionHash': self.definition_hash, 'python': self.python})
        self.root = Path(user_data_dir()) / 'node-plugins' / 'environments' / hashlib.sha256(owner.encode()).hexdigest()
        self.path = self.root / identity
        self.lock = self.root / (identity + '.lock')
        self.status_path = self.root / (identity + '.json')

    def status(self):
        if not self.pins:
            return {'status': 'bundled', 'packages': [], 'scope': '未声明额外依赖，沿用随附运行时'}
        marker = self.path / 'environment.json'
        if marker.is_file():
            value = json.loads(marker.read_text(encoding='utf-8'))
            if (value.get('definitionHash') != self.definition_hash or value.get('python') != self.python
                    or value.get('dependencies') != self.pins or not (self.path / 'site').is_dir()):
                return {'status': 'damaged', 'error': '独立环境不完整；不覆盖旧目录，请核对用户数据后创建新候选'}
            return {key: val for key, val in value.items() if key != 'python'}
        if self.lock.exists():
            return {'status': 'busy', 'error': '此节点环境正在安装或上次安装中断，请核对原任务；不会并发重装'}
        return json.loads(self.status_path.read_text(encoding='utf-8')) if self.status_path.is_file() else {'status': 'missing'}

    def ready(self):
        if self.status().get('status') != 'ready':
            raise ValueError('节点独立依赖环境未就绪，请在当前账号重新测试候选以准备环境')
        return self.path / 'site'

    def _state(self, status, **fields):
        from core.comfy_workflow_builds import write_json
        write_json(self.status_path, {'status': status, 'definitionHash': self.definition_hash,
                                     'updatedAt': time.time(), **fields})

    def ensure(self, cancel=None):
        if not self.pins or self.status().get('status') == 'ready':
            return self.status()
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            lease = self.lock.open('x', encoding='utf-8')
        except FileExistsError:
            raise ValueError('此节点环境正在安装或上次任务中断，不重复安装') from None
        try:
            with lease:
                lease.write(json.dumps({'pid': os.getpid(), 'startedAt': time.time()}))
            if self.status().get('status') == 'ready':
                return self.status()
            if self.path.exists():
                raise ValueError('环境目录已存在但不完整，不覆盖已有文件')
            deadline = time.monotonic() + TIMEOUT
            _check(cancel, deadline)
            self._state('resolving')
            packages = [inspect_package(pin['name'], pin['version'], cancel, deadline)['package'] for pin in self.pins]
            if sum(item['bytes'] for item in packages) > MAX_DOWNLOAD:
                raise ValueError('依赖总下载量超过128MiB预算')
            if shutil.disk_usage(self.root).free < 2 * MAX_EXPANDED + MAX_DOWNLOAD:
                raise ValueError('独立依赖环境至少需要1152MiB可用磁盘空间（含pip暂存）')
            with tempfile.TemporaryDirectory(prefix='stage-', dir=self.root) as directory:
                stage = Path(directory)
                wheels, expanded = [], 0
                pin_map = {pin['name']: pin['version'] for pin in self.pins}
                self._state('downloading', packages=packages)
                for package in packages:
                    wheel = stage / package['filename']
                    with wheel.open('wb') as output:
                        _, size, actual = _fetch(package['url'], package['bytes'], cancel, deadline, output)
                    if size != package['bytes'] or actual != package['sha256']:
                        raise ValueError('wheel 下载大小或SHA256与固定清单不符')
                    expanded += _verify_wheel(wheel, package, pin_map)
                    if expanded > MAX_EXPANDED:
                        raise ValueError('依赖总解压量超过512MiB预算')
                    wheels.append(wheel)
                self._state('installing', packages=packages)
                installed = stage / 'environment'
                installed.mkdir()
                _install(wheels, installed / 'site', stage / 'pip.log', cancel, deadline)
                _check(cancel, deadline)
                manifest = {'status': 'ready', 'definitionHash': self.definition_hash, 'python': self.python,
                            'dependencies': self.pins, 'packages': packages, 'createdAt': time.time(),
                            'scope': 'wheel安装完成；尚需候选真实执行测试，不代表语义质量通过'}
                (installed / 'environment.json').write_text(json.dumps(manifest), encoding='utf-8')
                installed.rename(self.path)
            return self.status()
        except (ValueError, OSError) as exc:
            self._state('cancelled' if cancel is not None and cancel.is_set() else 'failed', error=str(exc)[:1500])
            raise ValueError(str(exc)[:1500]) from None
        finally:
            self.lock.unlink(missing_ok=True)


def isolated_command(site, script):
    """-S plus an explicit path list also strips the desktop embedded ._pth app entry."""
    prefix = Path(sys.base_prefix)
    candidates = [prefix / f'python{sys.version_info.major}{sys.version_info.minor}.zip',
                  Path(sysconfig.get_path('stdlib')), Path(sysconfig.get_path('platstdlib')),
                  Path(sysconfig.get_path('stdlib')) / 'lib-dynload', prefix / 'DLLs', prefix]
    paths = list(dict.fromkeys(str(path.resolve()) for path in candidates if path.exists()))
    paths.append(str(Path(site).resolve()))
    bootstrap = 'import sys,json,runpy;sys.path[:]=json.loads(sys.argv[1]);p=sys.argv[2];sys.argv=[p];runpy.run_path(p,run_name="__main__")'
    return [sys.executable, '-I', '-S', '-B', '-X', 'utf8', '-c', bootstrap, json.dumps(paths), str(script)]
