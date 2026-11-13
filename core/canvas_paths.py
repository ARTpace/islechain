"""Stable physical locations behind the existing /assets and /output addresses."""
import hashlib
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from fastapi import HTTPException

from core.game_projects import safe_path as _safe_path


def owner_directory(owner):
    # Same stable mapping as main.safe_user_id, without importing/starting the app.
    value = (owner or '').strip()
    if not value:
        return ''
    if value.isascii():
        return re.sub(r'[^a-zA-Z0-9_.-]', '-', value)[:80].strip('.-') or 'anonymous'
    prefix = re.sub(r'[^a-zA-Z0-9]', '', value)[:12].lower()
    return (prefix + '-' if prefix else 'u-') + hashlib.sha1(value.encode()).hexdigest()[:10]


def safe_path(root, relative):
    try:
        return _safe_path(root, relative)
    except ValueError as error:
        raise HTTPException(422, '不安全的素材路径') from error


def rewrite_media_urls(value, rewrite):
    if isinstance(value, str):
        return rewrite(value)
    if isinstance(value, list):
        return [rewrite_media_urls(item, rewrite) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_media_urls(item, rewrite) for key, item in value.items()}
    return value


def media_url_parts(value):
    # Prompts and other arbitrary strings also pass through recursive URL walkers.
    try:
        return urlsplit(value)
    except ValueError:
        return None


def rewrite_prefix(url, mappings):
    parts = media_url_parts(url)
    if parts is None or parts.scheme or parts.netloc:
        return url
    for old, new in sorted(mappings.items(), key=lambda item: -len(item[0])):
        if parts.path.startswith(old.rstrip('/') + '/'):
            return urlunsplit(('', '', new.rstrip('/') + parts.path[len(old.rstrip('/')):], parts.query, parts.fragment))
    return url


class CanvasPaths:
    def __init__(self, store, output=None, assets=None, authorize=None):
        self.store = store
        self.output = Path(output) if output else store.home / 'output'
        self.assets = Path(assets) if assets else store.home / 'input'
        self.authorize = authorize

    def media_root(self, canvas, kind, owner_dir=''):
        if self.store.published(canvas['id']):
            snapshot = self.store._envelope(canvas['id'])
            if snapshot.get('purgedAt'):
                raise HTTPException(404, '画布已永久删除')
            if self.authorize:
                self.authorize(snapshot['canvas'])
            return self.store.directory(canvas['id']) / ('assets' if kind == 'input' else 'outputs')
        root = self.assets if kind == 'input' else self.output
        parts = [part for part in (owner_dir, canvas.get('output_folder', '')) if part]
        return safe_path(root, '/'.join(parts)) if parts else root

    def resolve_write_path(self, relative, kind, write=True):
        # Validate before matching, including drive/UNC paths and symlink escape.
        fallback_root = self.assets if kind == 'input' else self.output
        safe_path(fallback_root, relative)
        segments = relative.split('/')
        matches = []
        # The authoritative snapshots are small; never trust a stale index after a crash.
        for directory in self.store.root.glob('*'):
            if not directory.is_dir() or directory.name.startswith('.'):
                continue
            snapshot = self.store._envelope(directory.name)
            for alias in snapshot.get('legacyAliases', []):
                prefix = [part for part in (alias['owner'], alias['folder']) if part]
                if segments[:len(prefix)] == prefix and len(segments) > len(prefix):
                    matches.append((snapshot, '/'.join(segments[len(prefix):])))
        if len(matches) > 1:
            raise HTTPException(409, '画布地址别名冲突')
        if not matches:
            return None
        snapshot, remainder = matches[0]
        if self.authorize:
            self.authorize(snapshot['canvas'])
        if write and snapshot.get('purgedAt'):
            raise HTTPException(404, '画布已永久删除')
        root = self.store.directory(snapshot['canvas']['id']) / ('assets' if kind == 'input' else 'outputs')
        return safe_path(root, remainder)

    def resolve_media(self, url):
        parsed = media_url_parts(url)
        if parsed is None or parsed.scheme or parsed.netloc:
            return None
        path = unquote(parsed.path)
        if path.startswith('/assets/'):
            kind, relative = 'input', path[len('/assets/'):]
        elif path.startswith('/output/'):
            kind, relative = 'output', path[len('/output/'):]
        else:
            return None
        return self.resolve_write_path(relative, kind, write=False)

    def url_for_path(self, path):
        path = Path(path).resolve()
        for directory in self.store.root.glob('*'):
            if not directory.is_dir() or directory.name.startswith('.'):
                continue
            snapshot = self.store._envelope(directory.name)
            aliases = snapshot.get('legacyAliases', [])
            if not aliases:
                continue
            alias = aliases[0]
            for physical, url in (('assets', '/assets/'), ('outputs', '/output/')):
                root = (directory / physical).resolve()
                if path.is_relative_to(root):
                    if self.authorize:
                        self.authorize(snapshot['canvas'])
                    prefix = '/'.join(part for part in (alias['owner'], alias['folder']) if part)
                    return quote(url + prefix + '/' + path.relative_to(root).as_posix(), safe='/')
        return None
