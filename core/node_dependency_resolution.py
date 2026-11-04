"""Bounded metadata-only resolution to the existing explicit wheel dependency format."""
import json
import time
from urllib.parse import quote

from core.node_python_env import _check, _fetch, inspect_package, packaging


def resolve_dependencies(dependencies, cancel=None):
    from core.node_catalog import PythonDependency
    if not isinstance(dependencies, list) or not 1 <= len(dependencies) <= 16:
        raise ValueError('需要1—16项固定版本的直接依赖')
    roots = [PythonDependency.model_validate(item) for item in dependencies]
    if len({item.name for item in roots}) != len(roots):
        raise ValueError('直接依赖名称重复')
    markers, requirements, _, utils, versions = packaging()
    environment = markers.default_environment(); environment['extra'] = ''
    deadline, reads = time.monotonic() + 60, 0
    cache, choices = {}, {}

    def count():
        nonlocal reads
        _check(cancel, deadline)
        reads += 1
        if reads > 64:
            raise ValueError('依赖解析超过64次元数据预算；请减少包或显式固定更多版本')

    def candidates(name, specs):
        if name not in choices:
            count()
            raw, _, _ = _fetch('https://pypi.org/pypi/' + quote(name, safe='') + '/json', 2 * 1024**2, cancel, deadline)
            data = json.loads(raw)
            supported = []
            for text, files in data['releases'].items():
                try:
                    version = versions.Version(text)
                except versions.InvalidVersion:
                    continue
                if not version.is_prerelease and not version.is_devrelease and any(
                        file.get('packagetype') == 'bdist_wheel' and not file.get('yanked') for file in files):
                    supported.append(version)
            choices[name] = sorted(supported, reverse=True)
        return [str(version) for version in choices[name] if all(spec.contains(version) for spec in specs)][:20]

    def inspect(name, version):
        if (name, version) not in cache:
            count()
            cache[name, version] = inspect_package(name, version, cancel=cancel, deadline=deadline)
        return cache[name, version]

    pins = {item.name: item.version for item in roots}

    def solve(selected, constraints):
        _check(cancel, deadline)
        if len(constraints) > 16:
            return None
        for name, info in selected.items():
            if any(not spec.contains(info['package']['version'], prereleases=True) for spec in constraints[name]):
                return None
        missing = next((name for name in constraints if name not in selected), None)
        if missing is None:
            return selected
        options = [pins[missing]] if missing in pins else candidates(missing, constraints[missing])
        for version in options:
            if not all(spec.contains(version, prereleases=True) for spec in constraints[missing]):
                continue
            try:
                info = inspect(missing, version)
            except ValueError as error:
                if '兼容当前' in str(error):
                    continue
                raise
            updated = {name: list(specs) for name, specs in constraints.items()}
            valid = True
            for raw in info['requiresDist']:
                requirement = requirements.Requirement(raw)
                if requirement.marker and not requirement.marker.evaluate(environment):
                    continue
                if requirement.url or requirement.extras:
                    raise ValueError('自动解析不支持URL依赖或extras：' + raw[:150])
                name = utils.canonicalize_name(requirement.name)
                updated.setdefault(name, []).append(requirement.specifier)
                if name in selected and not requirement.specifier.contains(selected[name]['package']['version'], prereleases=True):
                    valid = False; break
            if valid:
                result = solve({**selected, missing: info}, updated)
                if result is not None:
                    return result
        return None

    constraints = {name: [requirements.Requirement(f'{name}=={version}').specifier] for name, version in pins.items()}
    result = solve({}, constraints)
    if result is None:
        raise ValueError('在16包、每包20个候选及当前Python平台限制内无法找到兼容依赖；请调整直接版本')
    packages = [info['package'] for _, info in sorted(result.items())]
    if sum(package['bytes'] for package in packages) > 128 * 1024**2:
        raise ValueError('解析出的wheel总量超过128MiB安装预算')
    return {'dependencies': [{'name': package['name'], 'version': package['version']} for package in packages],
            'packages': packages, 'metadataReads': reads,
            'scope': '只读PyPI解析结果；未下载wheel或执行安装。安装仍验证实际wheel元数据、哈希和测试。'}
