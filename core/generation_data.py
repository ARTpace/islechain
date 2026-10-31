"""Durable generation accounting, independent of the removable gallery history."""
import contextvars
from contextlib import contextmanager
import functools
import inspect
import json
import re
import sqlite3
import time
import uuid
from pathlib import Path

from .user_paths import user_data_dir

_active = contextvars.ContextVar('generation_record', default=None)
_identity = contextvars.ContextVar('generation_identity', default='')
_secret = re.compile(r'api.?key|token|password|authorization|cookie|secret', re.I)


def sanitize(value):
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items() if not _secret.search(str(k))}
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        if value.startswith('data:') or len(value) > 100000:
            return '[图片或大段数据省略]'
        value = re.sub(r'(?i)(Bearer\s+)\S+', r'\1[隐藏]', value)
        value = re.sub(r'''(?i)((?:api[_-]?key|token|secret|password|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s,"'&}]+''', r'\1[隐藏]', value)
        return re.sub(r'(?i)((?:api[_-]?key|token|secret|password)=)[^\s&]+', r'\1[隐藏]', value)
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return str(value)


class GenerationStore:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS generations (
                id TEXT PRIMARY KEY, user TEXT NOT NULL, kind TEXT, provider TEXT, model TEXT,
                status TEXT, started REAL, finished REAL, elapsed_ms INTEGER,
                output_count INTEGER DEFAULT 0, params TEXT, error TEXT DEFAULT '')''')
            db.execute('CREATE INDEX IF NOT EXISTS gen_user_time ON generations(user, started)')
            db.execute('CREATE INDEX IF NOT EXISTS gen_time ON generations(started)')
            # A previous process cannot confirm the outcome of its unfinished work.
            db.execute("UPDATE generations SET status='interrupted', error='服务重启，最终结果未知' WHERE status='running'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self, user, kind, params):
        record_id = uuid.uuid4().hex
        params = sanitize(params)
        with self.connect() as db:
            db.execute('INSERT INTO generations(id,user,kind,provider,model,status,started,params) VALUES(?,?,?,?,?,?,?,?)',
                       (record_id, user or '匿名用户', kind, str(params.get('provider_id') or params.get('provider') or ('ComfyUI' if kind == 'comfy' else '')),
                        str(params.get('model') or (params.get('params') or {}).get('model') or params.get('workflow_json') or params.get('workflow') or params.get('workflow_name') or ''), 'running', time.time(), json.dumps(params, ensure_ascii=False)))
        return record_id

    def finish(self, record_id, result=None, error=None):
        result = result if isinstance(result, dict) else {}
        error = error or result.get('error') or (result.get('detail') if result.get('success') is False else None)
        status = 'failed' if error or result.get('success') is False else 'succeeded'
        if not error and str(result.get('status') or '').lower() in ('timeout', 'pending', 'unknown', 'queued', 'running'):
            status = 'interrupted'
            error = '接口尚未确认最终结果：' + str(result['status'])
        count = sum(len(result.get(k) or []) for k in ('images', 'videos', 'audio') if isinstance(result.get(k), list))
        if not count and (result.get('value') or result.get('url') or result.get('audio_url') or result.get('video_url')):
            count = 1
        now = time.time()
        with self.connect() as db:
            existing = db.execute('SELECT params FROM generations WHERE id=?', (record_id,)).fetchone()
            params = json.loads(existing['params']) if existing else {}
            resolved = {k: result[k] for k in ('params', 'model', 'provider_id', 'seed', 'prompt_id') if result.get(k) is not None}
            if resolved:
                params['resolved'] = sanitize(resolved)
            actual_model = str(result.get('model') or (result.get('params') or {}).get('model') or '')
            actual_provider = str(result.get('provider_id') or '')
            db.execute('''UPDATE generations SET status=?,finished=?,elapsed_ms=CAST((?-started)*1000 AS INTEGER),
                       output_count=?,error=?,params=?,model=CASE WHEN ?='' THEN model ELSE ? END,
                       provider=CASE WHEN ?='' THEN provider ELSE ? END WHERE id=? AND status='running' ''',
                       (status, now, now, count, str(sanitize(str(error or '')))[:4000], json.dumps(params, ensure_ascii=False),
                        actual_model, actual_model, actual_provider, actual_provider, record_id))

    def query(self, user=None, filters=None, page=1, page_size=25):
        filters = filters or {}
        clauses, args = [], []
        if user is not None:
            clauses.append('user=?'); args.append(user)
        for key in ('user', 'kind', 'provider', 'model', 'status'):
            if filters.get(key):
                clauses.append(f'{key}=?'); args.append(filters[key])
        for key, op in (('start', '>='), ('end', '<')):
            if filters.get(key) is not None:
                clauses.append(f'started{op}?'); args.append(filters[key])
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        with self.connect() as db:
            summary = dict(db.execute('''SELECT COUNT(*) total,
                COALESCE(SUM(status='succeeded'),0) succeeded, COALESCE(SUM(status='failed'),0) failed,
                COALESCE(SUM(status='running'),0) running, COALESCE(SUM(status='interrupted'),0) interrupted,
                COALESCE(SUM(output_count),0) outputs, COUNT(DISTINCT user) users,
                AVG(CASE WHEN status='succeeded' THEN elapsed_ms END) avg_ms FROM generations''' + where, args).fetchone())
            trend = [dict(r) for r in db.execute("SELECT date(started,'unixepoch','+8 hours') day, COUNT(*) total, SUM(status='succeeded') succeeded, SUM(status='failed') failed FROM generations" + where + ' GROUP BY day ORDER BY day', args)]
            groups = {}
            for key in ('model', 'user', 'kind'):
                groups[key] = [dict(r) for r in db.execute(f"SELECT {key} name,COUNT(*) total,SUM(status='succeeded') succeeded,SUM(status='failed') failed,SUM(output_count) outputs FROM generations" + where + f' GROUP BY {key} ORDER BY total DESC LIMIT 20', args)]
            options_where, options_args = (' WHERE user=?', [user]) if user is not None else ('', [])
            options = {k: [r[0] for r in db.execute(f'SELECT DISTINCT {k} FROM generations' + options_where + f' ORDER BY {k}', options_args) if r[0]] for k in ('user', 'kind', 'provider', 'model')}
            rows = [dict(r) for r in db.execute('SELECT * FROM generations' + where + ' ORDER BY started DESC LIMIT ? OFFSET ?', [*args, page_size, (page-1)*page_size])]
        for row in rows:
            row['params'] = json.loads(row['params'])
        terminal = summary['succeeded'] + summary['failed']
        summary['success_rate'] = round(summary['succeeded'] * 100 / terminal, 1) if terminal else None
        return dict(summary=summary, trend=trend, groups=groups, options=options, records=rows, page=page, page_size=page_size)


_store = None


def store():
    global _store
    if _store is None:
        _store = GenerationStore(Path(user_data_dir()) / 'generation-data.sqlite3')
    return _store


def tracked(kind):
    """Wrap the actual execution, never a submission/polling endpoint."""
    def decorate(fn):
        signature = inspect.signature(fn)

        def begin(args, kwargs, extra=None):
            import main
            bound = signature.bind_partial(*args, **kwargs).arguments
            payload = bound.get('payload', bound.get('req'))
            params = payload.model_dump() if hasattr(payload, 'model_dump') else (payload.dict() if hasattr(payload, 'dict') else extra or {})
            user = bound.get('username') or main.get_username_by_token(bound.get('token') or params.get('token') or _identity.get())
            return store().start(user, kind, params)

        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def wrapper(*args, **kwargs):
                if _active.get():
                    return await fn(*args, **kwargs)
                bound = signature.bind_partial(*args, **kwargs).arguments
                request = bound.get('request', bound.get('req'))
                extra = None
                if request is not None and hasattr(request, 'headers'):
                    if 'application/json' in request.headers.get('content-type', ''):
                        extra = await request.json()
                    elif 'form' in request.headers.get('content-type', ''):
                        form = await request.form()
                        extra = {k: v if isinstance(v, str) else {'filename': v.filename} for k, v in form.multi_items()}
                rid = begin(args, kwargs, extra)
                context = _active.set(rid)
                try:
                    result = await fn(*args, **kwargs)
                    store().finish(rid, result)
                    return result
                except BaseException as exc:
                    store().finish(rid, error=getattr(exc, 'detail', None) or str(exc) or type(exc).__name__)
                    raise
                finally:
                    _active.reset(context)
        else:
            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                if _active.get():
                    return fn(*args, **kwargs)
                rid = begin(args, kwargs)
                context = _active.set(rid)
                try:
                    result = fn(*args, **kwargs)
                    store().finish(rid, result)
                    return result
                except BaseException as exc:
                    store().finish(rid, error=getattr(exc, 'detail', None) or str(exc))
                    raise
                finally:
                    _active.reset(context)
        return wrapper
    return decorate


def install(app):
    """Reuse existing route signatures and execution semantics."""
    import main
    from routers.generation_dashboard import router
    store()
    main._run_comfy_generate_sync = tracked('comfy')(main._run_comfy_generate_sync)
    main.build_online_image_result = tracked('image')(main.build_online_image_result)
    paths = {'/api/online-video': 'video', '/api/canvas-video': 'video',
             '/generate': 'image', '/api/ms/generate': 'image',
             '/api/smart-tts': 'audio', '/api/tts/generate': 'audio',
             '/api/angle/generate': 'image',
             '/api/ideogram4/generate-json': 'image', '/api/poster/generate': 'image'}
    for route in app.routes:
        if getattr(route, 'path', '') in paths and 'POST' in (getattr(route, 'methods', None) or []):
            route.dependant.call = tracked(paths[route.path])(route.dependant.call)
    app.include_router(router)

    @app.middleware('http')
    async def identify(request, call_next):
        context = _identity.set(main.request_auth_token(request, request.query_params.get('token', '')))
        try:
            return await call_next(request)
        finally:
            _identity.reset(context)
