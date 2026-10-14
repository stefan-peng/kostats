"""File identity for bounded caches of device metadata, never document payloads."""
from pathlib import Path


def file_fingerprint(path: Path) -> tuple[int, int, int, int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns
