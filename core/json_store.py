"""Atomic JSON writes shared by runtime stores."""
import json
import os
import tempfile
from contextlib import suppress


def atomic_write_json(path, data, encoding="utf-8", **json_kwargs):
    """原子化 JSON 落盘：同目录临时文件写入 + fsync + os.replace 原地替换。

    旧写法直接 open(path, 'w')，一旦进程在写入中途崩溃/断电，原文件已被
    截断成半截 JSON（数据全丢）。本函数保证任何时刻磁盘上要么是旧完整
    文件、要么是新完整文件。json_kwargs 透传给 json.dump，默认
    ensure_ascii=False, indent=2（与既有落盘格式一致）。
    """
    json_kwargs.setdefault("ensure_ascii", False)
    json_kwargs.setdefault("indent", 2)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            json.dump(data, f, **json_kwargs)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp_path)
        raise

