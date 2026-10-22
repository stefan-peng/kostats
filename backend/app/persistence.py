"""Atomic index replacement and cross-process serialization of index mutations."""
from __future__ import annotations

import json
import os
import tempfile
from functools import wraps
from pathlib import Path

from filelock import FileLock


def index_lock(path: Path) -> FileLock:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Reuse the object for nested calls in one thread; other threads/processes
    # must acquire the OS lock independently. Never delete the lock file.
    return FileLock(str(path) + '.lock', mode=0o600, thread_local=True, is_singleton=True)


def serialized(path_attribute: str):
    def decorate(function):
        @wraps(function)
        def wrapped(self, *args, **kwargs):
            with index_lock(getattr(self, path_attribute)):
                return function(self, *args, **kwargs)
        return wrapped
    return decorate


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=f'.{path.name}-', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
