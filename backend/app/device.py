from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import kobo_volume
from .errors import ImportError
from .storage import SnapshotStore


KOBO_DB_CANDIDATES = [
    ".adds/koreader/settings/statistics.sqlite3",
    ".adds/koreader/settings/statistics.sqlite",
    ".adds/koreader/statistics.sqlite3",
    "koreader/settings/statistics.sqlite3",
]


@dataclass(frozen=True)
class CandidateStatus:
    path: str
    exists: bool
    readable: bool
    error: str | None = None


def inspect_candidate(path: Path) -> CandidateStatus:
    try:
        exists = path.exists()
        readable = exists and path.is_file()
        if readable:
            with path.open("rb") as handle:
                handle.read(16)
        return CandidateStatus(str(path), exists, readable)
    except PermissionError as exc:
        return CandidateStatus(str(path), True, False, str(exc))
    except OSError as exc:
        return CandidateStatus(str(path), False, False, str(exc))


def device_status(volume: Path | None = None) -> dict[str, Any]:
    root = volume or kobo_volume()
    mounted = root.exists()
    candidates = [inspect_candidate(root / candidate) for candidate in KOBO_DB_CANDIDATES]
    readable = next((candidate for candidate in candidates if candidate.readable), None)
    permission_error = next((candidate.error for candidate in candidates if candidate.error), None)
    return {
        "mount_path": str(root),
        "mounted": mounted,
        "database_found": readable is not None,
        "selected_path": readable.path if readable else None,
        "permission_error": permission_error,
        "candidates": [candidate.__dict__ for candidate in candidates],
    }


def import_from_kobo(store: SnapshotStore, volume: Path | None = None) -> dict[str, Any]:
    status = device_status(volume)
    if not status["mounted"]:
        raise ImportError(f"Kobo is not mounted at {status['mount_path']}")
    if not status["selected_path"]:
        if status["permission_error"]:
            raise ImportError(
                "Kobo is mounted, but macOS denied access to the KOReader database. "
                "Use manual upload or grant this app permission to read the Kobo volume."
            )
        raise ImportError("Kobo is mounted, but no KOReader statistics.sqlite3 file was found.")

    meta = store.import_file(
        Path(status["selected_path"]),
        source_kind="kobo",
        source_path=status["selected_path"],
    )
    return {"snapshot": meta.__dict__, "device": status}

