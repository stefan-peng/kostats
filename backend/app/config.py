from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_KOBO_VOLUME = Path("/Volumes/KOBOeReader")
KOBO_VOLUME_LABEL = "KOBOeReader"


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


def kobo_volume_candidates() -> list[Path]:
    configured = os.environ.get("KOSTATS_KOBO_VOLUME")
    if configured:
        return [Path(configured).expanduser()]

    if sys.platform != "win32":
        return [DEFAULT_KOBO_VOLUME]

    roots = [root for root in windows_drive_roots() if windows_drive_exists(root)]
    labeled = [root for root in roots if windows_volume_label(root) == KOBO_VOLUME_LABEL]
    remaining = [root for root in roots if root not in labeled]
    return labeled + remaining


def kobo_volume_is_configured() -> bool:
    return bool(os.environ.get("KOSTATS_KOBO_VOLUME"))


def kobo_volume_is_default_mount_path(root: Path) -> bool:
    return sys.platform != "win32" and root == DEFAULT_KOBO_VOLUME


def is_labeled_kobo_volume(root: Path) -> bool:
    return windows_volume_label(root) == KOBO_VOLUME_LABEL

