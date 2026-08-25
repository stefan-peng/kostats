from __future__ import annotations

import ctypes
import os
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_KOBO_VOLUME = Path("/Volumes/KOBOeReader")
KOBO_VOLUME_LABEL = "KOBOeReader"
LINUX_REMOVABLE_MEDIA_ROOTS = (Path("/media"), Path("/run/media"), Path("/mnt"))


def data_dir() -> Path:
    return Path(os.environ.get("KOSTATS_DATA_DIR", DEFAULT_DATA_DIR)).expanduser()


def kobo_volume() -> Path:
    return Path(os.environ.get("KOSTATS_KOBO_VOLUME", DEFAULT_KOBO_VOLUME)).expanduser()


def windows_drive_roots() -> list[Path]:
    return [Path(f"{letter}:\\") for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]


def windows_volume_label(root: Path) -> str | None:
    if sys.platform != "win32":
        return None

    label = ctypes.create_unicode_buffer(261)
    try:
        ok = ctypes.windll.kernel32.GetVolumeInformationW(
            str(root),
            label,
            len(label),
            None,
            None,
            None,
            None,
            0,
        )
    except OSError:
        return None
    return label.value if ok else None


def windows_drive_exists(root: Path) -> bool:
    try:
        return root.exists()
    except OSError:
        return False


def decode_mount_path(value: str) -> str:
    """Decode the octal escapes used for paths in /proc/self/mountinfo."""
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), value)


def linux_mount_points(mountinfo_path: Path = Path("/proc/self/mountinfo")) -> list[Path]:
    """Return removable-media mount points visible to this process.

    Linux desktop environments do not share one mount location.  Reading
    mountinfo avoids guessing the current user name and only returns active
    mounts below the conventional removable-media roots.
    """
    try:
        lines = mountinfo_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    points: set[Path] = set()
    for line in lines:
        fields = line.split()
        # mountinfo has at least: id parent major:minor root mount-point options - ...
        if len(fields) < 7:
            continue
        point = Path(decode_mount_path(fields[4]))
        if any(point == root or root in point.parents for root in LINUX_REMOVABLE_MEDIA_ROOTS):
            points.add(point)
    return sorted(points, key=lambda point: str(point))


def linux_volume_candidates() -> list[Path]:
    return linux_mount_points()


def kobo_volume_candidates() -> list[Path]:
    configured = os.environ.get("KOSTATS_KOBO_VOLUME")
    if configured:
        return [Path(configured).expanduser()]

    if sys.platform == "darwin":
        return [DEFAULT_KOBO_VOLUME]

    if sys.platform.startswith("linux"):
        return linux_volume_candidates()

    if sys.platform != "win32":
        return [DEFAULT_KOBO_VOLUME]

    roots = [root for root in windows_drive_roots() if windows_drive_exists(root)]
    labeled = [root for root in roots if windows_volume_label(root) == KOBO_VOLUME_LABEL]
    remaining = [root for root in roots if root not in labeled]
    return labeled + remaining


def kobo_volume_is_configured() -> bool:
    return bool(os.environ.get("KOSTATS_KOBO_VOLUME"))


def kobo_volume_is_default_mount_path(root: Path) -> bool:
    if sys.platform == "darwin":
        return root == DEFAULT_KOBO_VOLUME
    if sys.platform.startswith("linux"):
        return root.name == KOBO_VOLUME_LABEL and root in linux_mount_points()
    return False


def is_labeled_kobo_volume(root: Path) -> bool:
    return windows_volume_label(root) == KOBO_VOLUME_LABEL
