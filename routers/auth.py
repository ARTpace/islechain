from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import bcrypt
import hashlib
import os
import time
import uuid

router = APIRouter()

# --- 认证相关配置 ---
SUPER_ADMIN_USERNAME = "admin"
from user_paths import user_data_dir
USERS_FILE = os.path.join(user_data_dir(), "users.json")


# --- Pydantic 模型 ---
class AuthRegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=100)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=100)


class TokenRequest(BaseModel):
    token: str


class AdminResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1)
    username: str = Field(min_length=1, max_length=40)
    new_password: str = Field(min_length=1, max_length=100)


class AdminDeleteUserRequest(BaseModel):
    token: str = Field(min_length=1)
    username: str = Field(min_length=1, max_length=40)


# --- 辅助函数 ---
# bcrypt 只支持最多 72 字节的密码；中文等宽字符超过此长度会抛 ValueError。
# 方案：对超长密码先做 sha256 预哈希（固定 64 hex = 64 字节），再用 bcrypt 哈希。
# 格式: "v2:<64hex>" = 预哈希后 bcrypt，"v3:<完整bcrypt>" = 原生 bcrypt。
# verify_password 自动检测并兼容所有格式。

_BCRYPT_ROUNDS = 12
_BCRYPT_MAX_PASS_LEN = 72  # bcrypt 明文密码字节上限


def _is_prehashed_hmac(value: str) -> bool:
    """判断是否是 v2 格式的预哈希密码（sha256 预哈希 + bcrypt）"""
    return value.startswith("v2:") and len(value) == 3 + 64  # v2: + 64 hex


def _is_versioned_bcrypt(value: str) -> bool:
    """判断是否是 v3 格式的原生 bcrypt（非预哈希）"""
    return value.startswith("v3:") and len(value) == 3 + 60  # v3: + 60 bcrypt chars


def _is_legacy_bcrypt(value: str) -> bool:
    """判断是否是裸 bcrypt（$2a$/$2b$/$2y$ 无前缀）"""
    if not value or value.startswith("v"):
        return False
    return value[:4] in ("$2a$", "$2b$", "$2y$")


def _is_legacy_pbkdf2(value: str) -> bool:
    """判断是否是旧 PBKDF2 格式：hex_salt$hex_hash"""
    if not value or "$" not in value or value.startswith("$2"):
        return False
    parts = value.split("$", 1)
    if len(parts) != 2:
        return False
    salt_hex, hash_hex = parts
    try:
        bytes.fromhex(salt_hex)
        bytes.fromhex(hash_hex)
        return True
    except ValueError:
        return False


def _is_legacy_sha256(value: str) -> bool:
    """判断是否是旧裸 sha256 哈希（64 位 hex，无前缀）"""
    if not value or "$" in value:
        return False
    return len(value) == 64


def hash_password(password: str) -> str:
    """返回可存入 users.json 的密码哈希。
    - 短密码（≤72 字节）：原生 bcrypt（v3 格式）
    - 长密码（>72 字节）：先 sha256 预哈希再 bcrypt（v2 格式）
    """
    pwd_bytes = password.encode("utf-8")
    if len(pwd_bytes) > _BCRYPT_MAX_PASS_LEN:
        # 超长密码：sha256 预哈希（64 hex = 64 字节）后再 bcrypt
        prehashed = hashlib.sha256(pwd_bytes).hexdigest()
        return "v2:" + bcrypt.hashpw(
            prehashed.encode("utf-8"),
            bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
        ).decode("utf-8")
    else:
        return "v3:" + bcrypt.hashpw(
            pwd_bytes,
            bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
        ).decode("utf-8")


def verify_password(stored: str, password: str) -> bool:
    """校验密码；兼容所有格式，空值一律返回 False。
    支持格式：
      - v2:<64hex>         预哈希后 bcrypt（长密码）
      - v3:<完整bcrypt>    原生 bcrypt（短密码）
      - $2a$/$2b$/$2y$...   裸 bcrypt（历史数据，无版本前缀）
      - hex_salt$hex_hash   旧 PBKDF2
      - 64-hex              旧裸 sha256
    """
    if not stored or not isinstance(stored, str) or not password:
        return False
    stored = stored.strip()
    pwd_bytes = password.encode("utf-8")

    # v2: 预哈希 + bcrypt
    if _is_prehashed_hmac(stored):
        prehashed = hashlib.sha256(pwd_bytes).hexdigest()
        try:
            return bcrypt.checkpw(
                prehashed.encode("utf-8"),
                stored[3:].encode("utf-8")  # strip "v2:"
            )
        except Exception:
            return False

    # v3: 原生 bcrypt
    if _is_versioned_bcrypt(stored):
        try:
            return bcrypt.checkpw(pwd_bytes, stored[3:].encode("utf-8"))  # strip "v3:"
        except Exception:
            return False

    # $2a$/$2b$/$2y$ 裸 bcrypt（向后兼容旧数据）
    if _is_legacy_bcrypt(stored):
        try:
            return bcrypt.checkpw(pwd_bytes, stored.encode("utf-8"))
        except Exception:
            return False

    # 旧 PBKDF2 格式：hex_salt$hex_hash
    if _is_legacy_pbkdf2(stored):
        salt_hex, hash_hex = stored.split("$", 1)
        try:
            return hash_hex == hashlib.pbkdf2_hmac(
                "sha256", pwd_bytes, bytes.fromhex(salt_hex), 200000
            ).hex()
        except (ValueError, TypeError):
            return False

    # 旧裸 sha256（64 hex）
    if _is_legacy_sha256(stored):
        return stored == hashlib.sha256(pwd_bytes).hexdigest()

    return False


def load_users():
    """委托 main.load_users（2026-10-22 统一用户存储）。

    历史上本文件自带一份与 main.py 逐字相同的实现；用户表加进程内缓存后
    双实现会 diverge（一边写磁盘一边读缓存），故收敛为单实现委托。
    本模块的 USERS_FILE 常量仅为兼容保留，实际以 main.USERS_FILE 为准。
    """
    import main as _m
    return _m.load_users()


def save_users(users):
    import main as _m
    return _m.save_users(users)


def find_user_by_token(token):
    import main as _m
    return _m.find_user_by_token(token)


def get_username_by_token(token):
    """根据 token 获取用户名,返回 None 表示未登录"""
    if not token:
        return None
    username, user = find_user_by_token(token)
    return username


def is_admin_by_token(token):
    """根据 token 判断是否为管理员"""
    if not token:
        return False
    _, user = find_user_by_token(token)
    return bool(user and user.get("is_admin", False))


# --- 认证路由 ---
@router.post("/api/auth/register")
async def auth_register(payload: AuthRegisterRequest):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    users = load_users()
    if username in users:
        raise HTTPException(status_code=400, detail="该用户名已存在,请直接登录")
    is_admin = (username == SUPER_ADMIN_USERNAME)
    token = str(uuid.uuid4())
    users[username] = {
        "password": hash_password(payload.password),
        "is_admin": is_admin,
        "token": token,
        "created_at": time.time(),
    }
    save_users(users)
    return {"ok": True, "username": username, "is_admin": is_admin, "token": token}


@router.post("/api/auth/login")
async def auth_login(payload: AuthLoginRequest):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    users = load_users()
    user = users.get(username)
    if not user:
        raise HTTPException(status_code=400, detail="用户不存在,请先注册")
    if not verify_password(user["password"], payload.password):
        raise HTTPException(status_code=400, detail="密码错误")
    token = str(uuid.uuid4())
    users[username]["token"] = token
    save_users(users)
    return {"ok": True, "username": username, "is_admin": user["is_admin"], "token": token}


@router.get("/api/auth/me")
async def auth_me(token: str = ""):
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    return {"ok": True, "username": username, "is_admin": user["is_admin"]}


@router.post("/api/auth/logout")
async def auth_logout(payload: Optional[TokenRequest] = None):
    token = payload.token if payload else ""
    if not token:
        return {"ok": True}
    username, user = find_user_by_token(token)
    if user:
        users = load_users()
        if username in users:
            users[username]["token"] = ""
            save_users(users)
    return {"ok": True}


@router.get("/api/auth/admin/users")
async def admin_list_users(token: str = ""):
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    usernames = sorted(users.keys(), key=lambda x: (x != "admin", x))
    return {"users": [{"username": u, "is_admin": users[u].get("is_admin", False)} for u in usernames]}


@router.post("/api/auth/admin/reset-password")
async def admin_reset_password(payload: AdminResetPasswordRequest):
    if not payload.token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(payload.token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    if payload.username not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    users[payload.username]["password"] = hash_password(payload.new_password)
    save_users(users)
    return {"ok": True}


@router.post("/api/auth/admin/delete-user")
async def admin_delete_user(payload: AdminDeleteUserRequest):
    if not payload.token:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    username, user = find_user_by_token(payload.token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效")
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    users = load_users()
    if payload.username not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    if payload.username == SUPER_ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="不能删除管理员账号")
    del users[payload.username]
    save_users(users)
    return {"ok": True}