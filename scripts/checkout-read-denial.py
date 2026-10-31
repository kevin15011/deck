"""Linux qualification launcher: inherited Landlock read/execute allowlist excluding checkout."""
import ctypes
import os
import sys

root = os.path.realpath(sys.argv[1])
if root == '/':
    raise RuntimeError('Cannot exclude filesystem root')
libc = ctypes.CDLL(None, use_errno=True)
# Landlock syscall numbers are shared by supported Linux x64 and arm64.
class Ruleset(ctypes.Structure):
    _fields_ = [('handled_access_fs', ctypes.c_uint64)]
class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int32)]

def checked(value):
    if value < 0:
        raise OSError(ctypes.get_errno(), os.strerror(ctypes.get_errno()))
    return value

rights = 1 | 4  # execute and file content reads; traversal/metadata and writes remain allowed
ruleset = checked(libc.syscall(444, ctypes.byref(Ruleset(rights)), 8, 0))
try:
    parent = '/'
    for component in root.strip('/').split('/'):
        for entry in os.scandir(parent):
            if entry.name == component or entry.is_symlink():
                continue
            fd = os.open(entry.path, os.O_PATH | os.O_CLOEXEC)
            try:
                allowed = rights if entry.is_dir(follow_symlinks=False) else 1 | 4
                checked(libc.syscall(445, ruleset, 1, ctypes.byref(PathRule(allowed, fd)), 0))
            finally:
                os.close(fd)
        parent = os.path.join(parent, component)
    checked(libc.prctl(38, 1, 0, 0, 0))  # no_new_privs
    checked(libc.syscall(446, ruleset, 0))
finally:
    os.close(ruleset)
os.execvp(sys.argv[2], sys.argv[2:])
