"""Windows current-user DPAPI protection, bound to an account and node definition."""
import base64
import ctypes
import os
from ctypes import wintypes


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def _crypt(data, context, decrypt=False):
    if os.name != 'nt':
        raise ValueError('当前平台尚未配置系统凭据加密，无法绑定API凭据')
    incoming = ctypes.create_string_buffer(data)
    entropy = ctypes.create_string_buffer(context.encode('utf-8'))
    source = Blob(len(data), ctypes.cast(incoming, ctypes.POINTER(ctypes.c_ubyte)))
    extra = Blob(len(context.encode('utf-8')), ctypes.cast(entropy, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    # Current-user scope, with UI forbidden; never fall back to plaintext on failure.
    if not function(ctypes.byref(source), None, ctypes.byref(extra), None, None, 1, ctypes.byref(output)):
        raise ValueError('系统凭据加解密失败，请在原系统用户下重新绑定')
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def protect(token, context):
    return {'storage': 'windows-dpapi-v1', 'ciphertext': base64.b64encode(_crypt(token.encode('utf-8'), context)).decode('ascii')}


def unprotect(record, context):
    try:
        if record.get('storage') != 'windows-dpapi-v1':
            raise ValueError('unknown storage')
        return _crypt(base64.b64decode(record['ciphertext'], validate=True), context, decrypt=True).decode('utf-8')
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise ValueError('系统凭据无法读取，请在原系统用户下重新绑定') from None
