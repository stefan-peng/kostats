from __future__ import annotations

import sqlite3
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import kobo_volume
from .errors import ImportError
from .storage import SnapshotStore, copy_sqlite_database, hash_file


KOBO_DB_CANDIDATES = [
    ".adds/koreader/settings/statistics.sqlite3",
    ".adds/koreader/settings/statistics.sqlite",
    ".adds/koreader/statistics.sqlite3",
    "koreader/settings/statistics.sqlite3",
]
AUTO_IMPORT_LOCK = threading.Lock()


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


def auto_import_from_kobo(store: SnapshotStore, volume: Path | None = None) -> dict[str, Any]:
    status = device_status(volume)
    latest = store.latest()
    latest_payload = latest.__dict__ if latest else None
    result = {
        "imported": False,
        "reason": "not_mounted",
        "snapshot": latest_payload,
        "device": status,
    }

    if not status["mounted"]:
        return result
    if not status["selected_path"]:
        result["reason"] = "access_blocked" if status["permission_error"] else "database_missing"
        return result

    source = Path(status["selected_path"])
    with tempfile.TemporaryDirectory(prefix="kostats-auto-import-") as tmp_dir:
        prepared = Path(tmp_dir) / "statistics.sqlite3"
        try:
            copy_sqlite_database(source, prepared)
        except sqlite3.DatabaseError as exc:
            raise ImportError(f"Selected file is not a readable SQLite database: {source}") from exc

        prepared_hash = hash_file(prepared)
        with AUTO_IMPORT_LOCK:
            latest = store.latest()
            latest_hash = store.snapshot_content_hash(latest)
            if latest_hash == prepared_hash:
                result["reason"] = "unchanged"
                result["snapshot"] = latest.__dict__ if latest else None
                return result

            meta = store.import_snapshot_copy(
                prepared,
                source_kind="kobo-auto",
                source_path=status["selected_path"],
                content_hash=prepared_hash,
            )

    return {
        "imported": True,
        "reason": "changed",
        "snapshot": meta.__dict__,
        "device": status,
    }
