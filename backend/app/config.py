from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_KOBO_VOLUME = Path("/Volumes/KOBOeReader")


def data_dir() -> Path:
    return Path(os.environ.get("KOSTATS_DATA_DIR", DEFAULT_DATA_DIR)).expanduser()


def kobo_volume() -> Path:
    return Path(os.environ.get("KOSTATS_KOBO_VOLUME", DEFAULT_KOBO_VOLUME)).expanduser()

