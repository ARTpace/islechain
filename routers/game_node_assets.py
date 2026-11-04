"""Private general files and playable scene graph."""
import base64
import importlib
import io
import json
import zipfile
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field, field_validator
from core.game_project_models import Contract, Identifier, ProjectFile, Document, PlayableGraph, relative_path
from core.game_projects import atomic_write, digest, json_bytes, safe_path, uid
from core.game_project_files import file_content
projects=importlib.import_module('routers.game_projects')
router=APIRouter(prefix='/api/game-projects/{project_id}/node-assets',tags=['game-node-assets'])

class FileInput(Contract):
    path: str = Field(min_length=1,max_length=240)
    contentBase64: str = Field(max_length=45*1024*1024)
    @field_validator('path')
    @classmethod
    def safe(cls,v):return relative_path(v)

class ImportFiles(Contract):
    baseRevision: int = Field(ge=1)
    files: list[FileInput] = Field(min_length=1,max_length=200)

class GraphWrite(Contract):
    baseRevision: int = Field(ge=1)
    graph: PlayableGraph | None

@router.post('/files')
def import_files(project_id:Identifier,request:ImportFiles,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),request.baseRevision,writable=True)
        if len(project.projectFiles)+len(request.files)>200:raise HTTPException(413,'项目文件最多200项')
        if sum(len(item.contentBase64) for item in request.files)>358*1024*1024:raise HTTPException(413,'本次导入超过项目文件容量')
        known={f.path.casefold() for f in project.projectFiles};pending=[];total=sum(f.sizeBytes for f in project.projectFiles)
        for item in request.files:
            if any(p in ('.git','node_modules','__pycache__') or p=='.env' or p.startswith('.env.') for p in item.path.split('/')):raise HTTPException(422,'不能导入依赖目录或凭据文件')
            if item.path.casefold() in known:raise HTTPException(409,'文件路径重复：'+item.path)
            known.add(item.path.casefold())
            try:raw=base64.b64decode(item.contentBase64,validate=True)
            except ValueError as exc:raise HTTPException(422,'文件编码无效') from exc
            total+=len(raw)
            if len(raw)>32*1024*1024 or total>256*1024*1024:raise HTTPException(413,'单文件32MiB、项目文件256MiB上限')
            file_id=uid('file');relative=f'assets/files/{file_id}/content.bin'
            file=ProjectFile(id=file_id,path=item.path,relativePath=relative,sizeBytes=len(raw),contentHash=digest(raw))
            # Text documents reuse the existing planning/document pipeline; binaries stay download-only.
            if Path(item.path).suffix.lower() in ('.txt','.md','.json','.csv','.yaml','.yml','.js','.ts','.html','.css','.py','.glsl') and len(raw)<=32768 and len(project.documents)<100:
                try:text=raw.decode('utf-8-sig')
                except UnicodeDecodeError:text=None
                if text is not None and '\x00' not in text:
                    doc=Document(id=uid('doc'),title=item.path[:200],revision=1,contentHash=digest(text.encode()),lastSavedContent=text)
                    project.documents.append(doc);file.documentId=doc.id
            project.projectFiles.append(file);pending.append((file,raw))
        for file,raw in pending:atomic_write(safe_path(repository.directory(project.id),file.relativePath),raw)
        project=repository.save(project)
        for file,_ in pending:
            if file.documentId:repository.write_document_file(project,next(d for d in project.documents if d.id==file.documentId))
        return {**projects.payload(project,repository),'fileIds':[f.id for f,_ in pending]}

@router.get('/files/{file_id}')
def download_file(project_id:Identifier,file_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token));file=next((f for f in project.projectFiles if f.id==file_id),None)
        if not file:raise HTTPException(404,'文件不存在')
        return Response(file_content(repository,project,file),media_type='application/octet-stream',headers={'Content-Disposition':'attachment','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'})

@router.get('/folder')
def download_folder(project_id:Identifier,ids:str='',token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token));wanted=set(ids.split(','));files=[f for f in project.projectFiles if f.id in wanted]
        if not files:raise HTTPException(404,'文件夹为空')
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
            for file in files:archive.writestr(file.path,file_content(repository,project,file))
        return Response(stream.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="project-files.zip"','Cache-Control':'private, no-store'})

@router.put('/graph')
def save_graph(project_id:Identifier,request:GraphWrite,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),request.baseRevision,writable=True)
        from core.game_scenes import validate_sources
        if request.graph:validate_sources(request.graph)
        project.playableGraph=request.graph;project=repository.save(project)
        return projects.payload(project,repository)

@router.get('/graph/preview')
def preview_graph(project_id:Identifier,entry:str='',token:str='',embedded:bool=False):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token))
        if not project.playableGraph:raise HTTPException(409,'请先保存场景连线')
        from core.game_media_assets import runtime_resources,inline_resources
        from core.game_scenes import graph_page
        resources,urls,info=runtime_resources(repository,project)
        for asset in project.assets:
            if asset.usage=='runtime' and asset.selected:
                raw=repository.selected_content(project,asset)
                urls[asset.id]='data:image/'+asset.spec.format+';base64,'+base64.b64encode(raw).decode()
                info[asset.id]=dict(kind='image',name=asset.name,purpose=asset.purpose)
        graph=project.playableGraph.model_dump()
        if entry:
            if not any(n['id']==entry for n in graph['nodes']):raise HTTPException(404,'入口场景不存在')
            graph['entryNodeId']=entry
        page=inline_resources(graph_page(project.title,graph,{'embedded':embedded,'projectId':project.id,'assets':urls,'assetInfo':info,'engine':'three' if any(a.enabled and a.kind=='model' for a in project.mediaAssets) else 'canvas'}),resources)
        return Response(page,media_type='text/html',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
