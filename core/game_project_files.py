"""Read project-owned file attachments after size and hash validation."""
from fastapi import HTTPException
from core.game_projects import safe_path,digest


def file_content(repository,project,file):
    path=safe_path(repository.directory(project.id),file.relativePath)
    if not path.is_file() or path.stat().st_size!=file.sizeBytes:raise HTTPException(409,'项目文件丢失或大小不符')
    raw=path.read_bytes()
    if digest(raw)!=file.contentHash:raise HTTPException(409,'项目文件校验失败')
    return raw
