"""Fixed-destination JSON nodes; account credentials never enter plugin definitions."""
import hashlib
import json
import re
import time
from pathlib import Path
from threading import RLock
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.user_paths import user_data_dir
from core.node_credentials import protect, unprotect

_LOCK = RLock()


class HTTPPolling(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(max_length=2048)
    jobIdPath: list[str] = Field(min_length=1, max_length=12)
    statusPath: list[str] = Field(default_factory=lambda: ['status'], min_length=1, max_length=12)
    success: list[str] = Field(default_factory=lambda: ['succeeded'], min_length=1, max_length=8)
    failure: list[str] = Field(default_factory=lambda: ['failed', 'cancelled'], min_length=1, max_length=8)
    intervalSeconds: int = Field(default=2, ge=1, le=30)
    maxPolls: int = Field(default=30, ge=1, le=100)


class HTTPExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['host.http']
    textField: str = Field(pattern=r'^[a-z][a-z0-9_.-]{0,79}$')
    url: str = Field(max_length=2048)
    credentialRef: str = Field(pattern=r'^[a-z][a-z0-9_.-]{0,79}$')
    bodyFields: dict[str, str] = Field(min_length=1, max_length=20)
    responsePath: list[str] = Field(default_factory=lambda: ['text'], max_length=12)
    timeoutSeconds: int = Field(default=15, ge=1, le=30)
    polling: HTTPPolling | None = None

    @model_validator(mode='after')
    def valid(self):
        address = urlsplit(self.url)
        if (address.scheme != 'https' or not address.hostname or address.username or address.password
                or address.fragment or address.query or re.search(r'[\s\x00-\x1f]', self.url)):
            raise ValueError('API地址必须为无查询参数、无凭据的固定HTTPS地址')
        if any(not key or len(key) > 80 for key in self.bodyFields) or any(len(key) > 80 for key in self.responsePath):
            raise ValueError('API字段路径过长或为空')
        if self.polling:
            polling = urlsplit(self.polling.url.replace('{jobId}', 'job'))
            if (self.polling.url.count('{jobId}') != 1 or polling.scheme != 'https'
                    or (polling.hostname, polling.port) != (address.hostname, address.port)
                    or polling.username or polling.password or polling.query or polling.fragment
                    or '{jobId}' not in urlsplit(self.polling.url).path):
                raise ValueError('轮询URL须为同源HTTPS路径且只包含一个{jobId}占位符')
            if set(self.polling.success) & set(self.polling.failure):
                raise ValueError('轮询成功和失败状态不可重叠')
        return self


def credential_path(owner, definition_hash):
    if not isinstance(owner, str) or not owner or not re.fullmatch(r'[a-f0-9]{64}', definition_hash):
        raise ValueError('API凭据需要当前账号和固定节点版本')
    account = hashlib.sha256(owner.encode()).hexdigest()
    return Path(user_data_dir()) / 'node-plugins' / 'credentials' / account / (definition_hash + '.json')


def save_credential(owner, item, token):
    from core.node_catalog import definition, digest
    from core.comfy_workflow_builds import write_json
    item = definition(item)
    if item['execution']['kind'] != 'host.http':
        raise ValueError('当前节点不是外部API节点')
    path = credential_path(owner, digest(item))
    if not isinstance(token, str) or len(token) > 8192 or re.search(r'[\s\x00-\x1f\x7f]', token):
        raise ValueError('Bearer凭据格式无效')
    with _LOCK:
        if token:
            write_json(path, protect(token, owner + ':' + digest(item)))
            path.chmod(0o600)
        else:
            path.unlink(missing_ok=True)


def has_credential(owner, definition_hash):
    return credential_path(owner, definition_hash).is_file()


def extract_text(binding, data):
    try:
        for key in binding.responsePath:
            data = data[key]
    except (KeyError, TypeError):
        raise ValueError('API响应缺少声明的文本路径') from None
    if not isinstance(data, str) or len(data) > 16000:
        raise ValueError('API响应必须为16000字符以内的文本')
    return data


def execute_http(binding, values, text, owner, definition_hash, fixture=None, *, run_id=None, cancel=None):
    if fixture is not None:
        return extract_text(binding, fixture)
    path = credential_path(owner, definition_hash)
    with _LOCK:
        if not path.is_file():
            raise ValueError('请先为当前节点版本绑定API凭据并授权目标地址')
        record = json.loads(path.read_text(encoding='utf-8'))
        context = owner + ':' + definition_hash
        if 'token' in record:
            # ponytail: migrate the old binding atomically before any request uses it.
            from core.comfy_workflow_builds import write_json
            token = record['token']
            if not isinstance(token, str) or not token:
                raise ValueError('旧凭据无效，请重新绑定')
            write_json(path, protect(token, context))
        else:
            token = unprotect(record, context)
    values = {**values, binding.textField: text}
    body = {key: values[field] for key, field in binding.bodyFields.items()}
    journal, state = None, None
    from core.comfy_workflow_builds import write_json
    if run_id is not None:
        if not isinstance(run_id, str) or not re.fullmatch(r'[a-f0-9-]{1,50}', run_id):
            raise ValueError('API运行ID无效')
        journal = path.parent / 'runs' / definition_hash / (run_id + '.json')
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if journal.is_file():
            state = json.loads(journal.read_text(encoding='utf-8'))
            if state['fingerprint'] != fingerprint:
                raise ValueError('原API任务的参数已变化；请显式开始新请求，不会重复提交旧任务')
            if state['status'] == 'succeeded':
                return state['text']
            if state['status'] != 'polling':
                raise ValueError('原API请求结果不明确或已失败；请核对远端后显式开始新请求')
        else:
            state = {'fingerprint': fingerprint, 'status': 'submitting', 'createdAt': time.time(), 'polls': 0}
            write_json(journal, state)
    elif binding.polling:
        raise ValueError('异步API需要持久运行ID')

    def select(data, keys):
        try:
            for key in keys:
                data = data[key]
            return data
        except (KeyError, TypeError):
            raise ValueError('异步API响应缺少任务ID或状态路径') from None

    def request(client, method, url, **kwargs):
        if cancel is not None and cancel.is_set():
            raise ValueError('已停止等待；远端任务不会自动取消')
        deadline = time.monotonic() + binding.timeoutSeconds
        with client.stream(method, url, headers={'Authorization': 'Bearer ' + token,
                **({'Idempotency-Key': run_id} if run_id and method == 'POST' else {})}, **kwargs) as response:
            if not 200 <= response.status_code < 300:
                raise ValueError(f'API返回HTTP {response.status_code}；未自动重试')
            content = bytearray()
            for chunk in response.iter_bytes(chunk_size=65536):
                if time.monotonic() > deadline:
                    raise ValueError('API请求超时；远端可能已执行，未自动重试')
                content.extend(chunk)
                if len(content) > 1024 * 1024:
                    raise ValueError('API响应超过1MiB')
        return json.loads(content)
    # ponytail: no retries or redirects; a failed paid POST must not be resubmitted silently.
    try:
        with httpx.Client(timeout=binding.timeoutSeconds, follow_redirects=False, trust_env=False) as client:
            if state is None or state['status'] == 'submitting':
                data = request(client, 'POST', binding.url, json=body)
                if binding.polling:
                    job = select(data, binding.polling.jobIdPath)
                    if not isinstance(job, (str, int)) or isinstance(job, bool) or not 1 <= len(str(job)) <= 200 or token in str(job):
                        raise ValueError('API任务ID无效')
                    state.update(status='polling', jobId=str(job))
                    write_json(journal, state)
            if binding.polling:
                polling = binding.polling
                while state['polls'] < polling.maxPolls:
                    state['polls'] += 1
                    write_json(journal, state)
                    data = request(client, 'GET', polling.url.replace('{jobId}', quote(state['jobId'], safe='')))
                    status = select(data, polling.statusPath)
                    if status in polling.failure:
                        state['status'] = 'failed'; write_json(journal, state)
                        raise ValueError('远端API任务失败或取消；未自动重新提交')
                    if status in polling.success:
                        break
                    if cancel is not None:
                        if cancel.wait(polling.intervalSeconds):
                            raise ValueError('已停止等待；可用原任务继续轮询')
                    else:
                        time.sleep(polling.intervalSeconds)
                else:
                    raise ValueError('API轮询次数预算已用完；请核对远端任务，不自动重新提交')
        result = extract_text(binding, data)
        # Never publish an upstream echo of the injected credential to the canvas or model.
        if token in result:
            raise ValueError('API响应包含凭据，结果未发布')
        if journal:
            state.update(status='succeeded', text=result, completedAt=time.time())
            write_json(journal, state)
        return result
    except httpx.HTTPError:
        raise ValueError('API连接失败或超时；远端可能已执行，未自动重试') from None
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError('API没有返回有效JSON') from None
