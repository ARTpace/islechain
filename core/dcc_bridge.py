"""DCC 桥：把画布资产投递到外部软件的工作目录，再把产物收回画布。

只搬文件，不启动、不驱动任何外部程序。真正的桥接（socket / 任务队列 / CLI）
由各能力包自己负责，本模块只保证「进」和「出」两端的路径、清单、状态一致。

目录结构（每个 job 一个，可追溯、可重跑）：

    <user_data>/dcc-jobs/<job_id>/
        job.json          状态与来源
        in/               投递给外部软件的文件
        out/              外部软件产出的文件
        INSTRUCTIONS.txt  给人和 AI 看的下一步
"""

import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from core.user_paths import user_data_dir

JOB_ID = re.compile(r'^[0-9a-f]{12}$')

KIND_BY_EXT = {}
for _ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.exr'):
    KIND_BY_EXT[_ext] = 'image'
for _ext in ('.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'):
    KIND_BY_EXT[_ext] = 'video'
for _ext in ('.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'):
    KIND_BY_EXT[_ext] = 'audio'
for _ext in ('.glb', '.gltf', '.fbx', '.obj', '.blend', '.usd', '.usdz', '.stl', '.abc', '.ply'):
    KIND_BY_EXT[_ext] = 'model'

# 目标只声明「能收什么、能出什么、下一步怎么做」。不声明可执行文件、不负责启动。
TARGETS = {
    'blender': {
        'label': 'Blender',
        'accepts': ('image', 'video', 'model'),
        'produces': ('model', 'image'),
        'instruction': '文件 → 导入 打开 in/ 里的素材；改完把 GLB / FBX / 渲染图导出到 out/。',
    },
    'photoshop': {
        'label': 'Photoshop',
        'accepts': ('image',),
        'produces': ('image',),
        'instruction': '打开 in/ 里的图片，改完导出 PNG 到 out/。',
    },
    'substance': {
        'label': 'Substance Designer',
        'accepts': ('image',),
        'produces': ('image',),
        'instruction': '用 in/ 里的图作为输入或参考，贴图导出到 out/。',
    },
    'generic': {
        'label': '其他软件',
        'accepts': ('image', 'video', 'audio', 'model'),
        'produces': ('image', 'video', 'audio', 'model'),
        'instruction': '改好的文件放回 out/，然后回画布点「回收产物」。',
    },
}

MAX_IN_FILES = 32
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024


def kind_of(name):
    return KIND_BY_EXT.get(os.path.splitext(str(name or ''))[1].lower(), '')


def jobs_root():
    root = Path(user_data_dir()) / 'dcc-jobs'
    root.mkdir(parents=True, exist_ok=True)
    return root


def job_dir(job_id):
    clean = str(job_id or '').strip()
    if not JOB_ID.match(clean):
        raise ValueError('无效的作业 ID')
    return jobs_root() / clean


def _job_path(job_id):
    return job_dir(job_id) / 'job.json'


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, path)


def load(job_id):
    path = _job_path(job_id)
    if not path.is_file():
        raise ValueError('作业不存在')
    return json.loads(path.read_text(encoding='utf-8'))


def save(job):
    job['updatedAt'] = now_ms()
    write_json(_job_path(job['id']), job)
    return job


def now_ms():
    return int(time.time() * 1000)


def target_spec(target):
    return TARGETS.get(target) or TARGETS['generic']


def create(canvas_id, owner, target, note=''):
    """建一个投递作业。文件名与目录都在这个函数里定下来，后续只追加。"""
    spec = target_spec(target)
    job_id = uuid.uuid4().hex[:12]
    directory = job_dir(job_id)
    (directory / 'in').mkdir(parents=True, exist_ok=True)
    (directory / 'out').mkdir(parents=True, exist_ok=True)
    job = {
        'id': job_id,
        'canvasId': canvas_id,
        'owner': owner or '',
        'target': target if target in TARGETS else 'generic',
        'label': spec['label'],
        'note': str(note or '')[:500],
        'status': 'staged',
        'createdAt': now_ms(),
        'updatedAt': now_ms(),
        'files': [],
        'products': [],
        'imported': [],
        'dir': str(directory),
    }
    save(job)
    _write_instructions(job)
    return job


def _write_instructions(job):
    spec = target_spec(job['target'])
    lines = [
        f"目标：{spec['label']}",
        f"作业：{job['id']}",
        '',
        spec['instruction'],
        '',
        f"输入目录：{os.path.join(job['dir'], 'in')}",
        f"输出目录：{os.path.join(job['dir'], 'out')}",
        '',
        f"可接收：{'、'.join(spec['accepts'])}",
        f"期望产物：{'、'.join(spec['produces'])}",
    ]
    if job.get('note'):
        lines += ['', f"备注：{job['note']}"]
    try:
        Path(job['dir'], 'INSTRUCTIONS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    except OSError:
        pass


def stage(job, sources):
    """把本地文件复制进 in/。sources 是 [(绝对路径, 显示名)]，超过上限的静默截断。"""
    placed = []
    seen = set()
    for path, name in list(sources)[:MAX_IN_FILES]:
        source = Path(path)
        if not source.is_file():
            continue
        try:
            size = source.stat().st_size
        except OSError:
            continue
        if size <= 0 or size > MAX_FILE_BYTES:
            continue
        stem = re.sub(r'[^0-9A-Za-z一-鿿._-]+', '_', os.path.splitext(name or source.name)[0]).strip('_') or 'asset'
        ext = os.path.splitext(source.name)[1].lower()
        filename = f'{stem[:60]}{ext}'
        counter = 1
        while filename in seen:
            counter += 1
            filename = f'{stem[:56]}_{counter}{ext}'
        seen.add(filename)
        destination = Path(job['dir'], 'in', filename)
        try:
            shutil.copy2(source, destination)
        except OSError:
            continue
        placed.append({'name': filename, 'kind': kind_of(filename), 'size': size,
                       'origin': str(source), 'path': str(destination)})
    job['files'] = job.get('files', []) + placed
    job['status'] = 'staged' if job['files'] else job['status']
    save(job)
    return placed


def scan_out(job):
    """扫 out/，返回产物清单。不移动、不改名，导入由调用方决定。"""
    folder = Path(job['dir'], 'out')
    products = []
    if folder.is_dir():
        for entry in sorted(folder.iterdir(), key=lambda item: item.name.lower()):
            if not entry.is_file() or entry.name.startswith('.'):
                continue
            try:
                size = entry.stat().st_size
            except OSError:
                continue
            if size <= 0:
                continue
            products.append({'name': entry.name, 'kind': kind_of(entry.name),
                             'size': size, 'path': str(entry)})
    return products


def scan_checkpoints(job):
    """扫 checkpoints/，给节点审阅阶段产物。不移动、不改名，也不写进 products。"""
    folder = Path(job['dir'], 'checkpoints')
    items = []
    if folder.is_dir():
        for entry in sorted(folder.iterdir(), key=lambda item: item.name.lower()):
            if not entry.is_file() or entry.name.startswith('.'):
                continue
            try:
                size = entry.stat().st_size
            except OSError:
                continue
            if size <= 0:
                continue
            items.append({'name': entry.name, 'kind': kind_of(entry.name),
                          'size': size, 'path': str(entry)})
    return items


def _backfill_uv(job):
    """旧作业没有实测字段时，从已有 model.glb 补算一次并落盘，不重跑建模。"""
    if job.get('uvReport') or job.get('uvCoverage') is not None:
        return False
    path = Path(job['dir'], 'out', 'model.glb')
    if not path.is_file():
        return False
    try:
        from core import glb_stats
        report = glb_stats.inspect_uv_file(str(path))
    except Exception:
        return False
    if not report:
        return False
    job['uvReport'] = report
    job['uvCoverage'] = report.get('coverage')
    diffs = job.setdefault('openDifferences', [])
    codes = {item.get('code') for item in diffs if isinstance(item, dict)}
    if not report.get('hasUv'):
        if 'uv_missing' not in codes:
            diffs.append({'code': 'uv_missing',
                          'text': '产物不含 TEXCOORD_0，UV / 贴图流程未验证',
                          'resolved': False})
    elif report['coverage'] < 0.8:
        if 'uv_coverage_below_target' not in codes:
            diffs.append({'code': 'uv_coverage_below_target',
                          'text': 'UV 有效去重覆盖 %.2f%%，低于 80%% 预设' % (report['coverage'] * 100),
                          'resolved': False})
    return True


def refresh(job):
    """读一次 out/，把新产物记进 job。状态机：staged → produced → imported。"""
    products = scan_out(job)
    known = {item['name'] for item in job.get('products', [])}
    changed = False
    for item in products:
        if item['name'] not in known:
            job.setdefault('products', []).append(item)
            changed = True
    if products and job.get('status') == 'staged':
        job['status'] = 'produced'
        changed = True
    if _backfill_uv(job):
        changed = True
    if changed:
        save(job)
    return products


def list_jobs(canvas_id=None, owner=None, limit=50):
    root = jobs_root()
    records = []
    for entry in root.iterdir():
        if not entry.is_dir() or not JOB_ID.match(entry.name):
            continue
        try:
            job = load(entry.name)
        except (ValueError, OSError, json.JSONDecodeError):
            continue
        if canvas_id and job.get('canvasId') != canvas_id:
            continue
        if owner and job.get('owner') != owner:
            continue
        records.append(job)
    records.sort(key=lambda item: item.get('createdAt') or 0, reverse=True)
    return records[:limit]


def public(job, include_paths=False):
    """给前端/AI 看的形态。默认不回传绝对路径，避免把本机目录写进对话。"""
    keys = ('id', 'canvasId', 'target', 'label', 'note', 'status', 'stage', 'error', 'reply',
            'mode', 'baseModel', 'baseModelLabel', 'partial', 'blockoutOnly', 'createdAt', 'updatedAt', 'imported',
            'tris', 'trisDelta', 'targetTris', 'presetId', 'presetName', 'skillId', 'skillName',
            'uvCoverage', 'uvReport', 'openDifferences', 'pipelineStage', 'approvedStage')
    data = {key: job.get(key) for key in keys}
    data['logs'] = (job.get('logs') or [])[-20:]
    data['files'] = [{key: item.get(key) for key in ('name', 'kind', 'size')} for item in job.get('files', [])]
    data['products'] = [{key: item.get(key) for key in ('name', 'kind', 'size')} for item in job.get('products', [])]
    data['checkpoints'] = [{key: item.get(key) for key in ('name', 'kind', 'size')}
                           for item in scan_checkpoints(job)]
    if include_paths:
        data['dir'] = job.get('dir')
        data['inDir'] = os.path.join(job.get('dir', ''), 'in')
        data['outDir'] = os.path.join(job.get('dir', ''), 'out')
    return data
