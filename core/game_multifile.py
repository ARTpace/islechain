"""原生 Web 多文件加载契约；源文件保留独立，冻结包按声明顺序内联。"""
import json
import re

from pydantic import Field, model_validator

from core.game_project_models import Contract, relative_path

MANIFEST = 'game-project.json'


def source_path(name):
    relative_path(name)
    if not re.fullmatch(r'[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\.(?:js|css)', name):
        raise ValueError('模块路径仅允许安全相对路径 .js / .css')
    return name


class EngineeringFile(Contract):
    path: str = Field(max_length=180)
    purpose: str = Field(min_length=1, max_length=1200)
    interface: str = Field(min_length=1, max_length=3000)
    dependsOn: list[str] = Field(default_factory=list, max_length=15)


class EngineeringPlan(Contract):
    summary: str = Field(min_length=1, max_length=2000)
    entry: str = Field(max_length=180)
    files: list[EngineeringFile] = Field(min_length=3, max_length=16)

    @model_validator(mode='after')
    def ordered_files(self):
        seen = set()
        for item in self.files:
            source_path(item.path)
            if item.path.casefold() in {name.casefold() for name in seen}:
                raise ValueError('工程路径重复或存在大小写冲突')
            if len(item.dependsOn) != len(set(item.dependsOn)) or any(name not in seen for name in item.dependsOn):
                raise ValueError('依赖必须在当前文件之前声明，不能循环或引用未知文件')
            seen.add(item.path)
        scripts = [f.path for f in self.files if f.path.endswith('.js')]
        if len(scripts) < 2 or self.entry != scripts[-1]:
            raise ValueError('至少两个 JavaScript 模块，入口必须是最后一个脚本')
        if not any(f.path.endswith('.css') for f in self.files):
            raise ValueError('工程必须包含样式文件')
        return self

    def manifest(self):
        return dict(schemaVersion=1, runtime='native-canvas-multifile-v1', entry=self.entry,
                    scripts=[f.path for f in self.files if f.path.endswith('.js')],
                    styles=[f.path for f in self.files if f.path.endswith('.css')])


def project_sources(files):
    """兼容旧工程；只打包清单列出的模块，不执行安装或构建命令。"""
    if MANIFEST not in files:
        return ['game.js'], ['style.css']
    manifest = json.loads(files[MANIFEST])
    if (set(manifest) != {'schemaVersion', 'runtime', 'entry', 'scripts', 'styles'}
            or manifest['schemaVersion'] != 1 or manifest['runtime'] != 'native-canvas-multifile-v1'):
        raise ValueError('未知多文件工程清单')
    scripts, styles = manifest['scripts'], manifest['styles']
    if not isinstance(scripts, list) or not isinstance(styles, list) or not 1 <= len(scripts) <= 16 or not 1 <= len(styles) <= 16:
        raise ValueError('工程脚本或样式清单不完整')
    paths = scripts + styles
    if len({p.casefold() for p in paths}) != len(paths) or manifest['entry'] != scripts[-1]:
        raise ValueError('工程路径重复或入口顺序错误')
    for name in paths:
        source_path(name)
        if name not in files:
            raise ValueError('工程模块缺失：' + name)
    if any(not p.endswith('.js') for p in scripts) or any(not p.endswith('.css') for p in styles):
        raise ValueError('脚本或样式扩展名错误')
    return scripts, styles
