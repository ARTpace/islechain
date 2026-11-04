"""只管理本次启动的进程树；Windows Job 在父进程退出后仍拥有子进程。"""
import os
import signal


class ProcessTree:
    def __init__(self, pid):
        self.pid = pid
        self.closed = False
        self.job = None
        if os.name != 'nt':
            return
        import ctypes as c
        from ctypes import wintypes as w
        class Basic(c.Structure):
            _fields_ = [('processTime', c.c_int64), ('jobTime', c.c_int64), ('flags', w.DWORD),
                        ('minWorking', c.c_size_t), ('maxWorking', c.c_size_t), ('active', w.DWORD),
                        ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IO(c.Structure):
            _fields_ = [(name, c.c_ulonglong) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
        class Extended(c.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('processMemory', c.c_size_t), ('jobMemory', c.c_size_t),
                        ('peakProcess', c.c_size_t), ('peakJob', c.c_size_t)]
        kernel = c.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
        kernel.CreateJobObjectW.restype = w.HANDLE
        kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        kernel.OpenProcess.restype = w.HANDLE
        kernel.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        kernel.CloseHandle.argtypes = [w.HANDLE]
        self.kernel = kernel
        job = kernel.CreateJobObjectW(None, None)
        if not job:
            raise OSError(c.get_last_error(), '无法创建所属进程Job')
        process = None
        try:
            limits = Extended()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)):
                raise OSError(c.get_last_error(), '无法配置进程树回收')
            process = kernel.OpenProcess(0x0100 | 0x0001, False, pid)
            if not process or not kernel.AssignProcessToJobObject(job, process):
                raise OSError(c.get_last_error(), '无法登记所属进程树')
            self.job = job
        except BaseException:
            kernel.CloseHandle(job)
            raise
        finally:
            if process:
                kernel.CloseHandle(process)

    def close(self):
        if self.closed:
            return
        self.closed = True
        if os.name == 'nt':
            if self.job:
                self.kernel.CloseHandle(self.job)
                self.job = None
        else:
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
