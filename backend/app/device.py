from __future__ import annotations

import sqlite3
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import (
    is_labeled_kobo_volume,
    kobo_volume_candidates,
    kobo_volume_is_configured,
    kobo_volume_is_default_mount_path,
)
from .errors import ImportError
from .storage import SnapshotStore, combined_content_hash, copy_sqlite_database, hash_file
from .sidecars import build_sidecar_snapshot, serialize_sidecar_snapshot, sidecar_snapshot_hash


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


def inspect_volume(root: Path) -> tuple[bool, list[CandidateStatus]]:
    mounted = root.exists()
    candidates = [inspect_candidate(root / candidate) for candidate in KOBO_DB_CANDIDATES]
    return mounted, candidates


def device_status(volume: Path | None = None) -> dict[str, Any]:
    roots = [volume] if volume is not None else kobo_volume_candidates()
    if not roots:
        roots = []

    explicit_root = volume is not None or kobo_volume_is_configured()
    inspected = [(root, *inspect_volume(root)) for root in roots]
    labeled_roots = {root for root, mounted, _ in inspected if mounted and is_labeled_kobo_volume(root)}
    selected = next(
        (
            (root, mounted, candidates, readable)
            for root, mounted, candidates in inspected
            if (readable := next((candidate for candidate in candidates if candidate.readable), None)) is not None
        ),
        None,
    )
    primary = selected or next(((root, mounted, candidates, None) for root, mounted, candidates in inspected if mounted), None)
    if primary is None:
        root = roots[0] if roots else Path("")
        mounted = False
        candidates = []
        readable = None
    else:
        root, mounted, candidates, readable = primary

    permission_error = None
    if readable is None:
        permission_error = next((candidate.error for candidate in candidates if candidate.error), None)
    trusted_mount_path = explicit_root or root in labeled_roots or kobo_volume_is_default_mount_path(root)
    selected_mounted = readable is not None or (mounted and trusted_mount_path)
    return {
        "mount_path": str(root),
        "mounted": selected_mounted,
        "database_found": readable is not None,
        "selected_path": readable.path if readable else None,
        "permission_error": permission_error,
        "candidates": [candidate.__dict__ for candidate in candidates],
        "searched_mount_paths": [str(root) for root in roots],
    }


def import_from_kobo(store: SnapshotStore, volume: Path | None = None) -> dict[str, Any]:
    status = device_status(volume)
    if not status["mounted"]:
        raise ImportError(f"Kobo is not mounted at {status['mount_path']}")
    if not status["selected_path"]:
        if status["permission_error"]:
            raise ImportError(
                "Kobo is mounted, but the app could not read the KOReader database. "
                "Use manual upload or grant this app permission to read the Kobo volume."
            )
        raise ImportError("Kobo is mounted, but no KOReader statistics.sqlite3 file was found.")

    root = Path(status["mount_path"])
    sidecar_payload = serialize_sidecar_snapshot(build_sidecar_snapshot(root))
    meta = store.import_file(
        Path(status["selected_path"]),
        source_kind="kobo",
        source_path=status["selected_path"],
        sidecar_payload=sidecar_payload,
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
        prepared_sidecars = Path(tmp_dir) / "sidecars.json"
        try:
            copy_sqlite_database(source, prepared)
        except sqlite3.DatabaseError as exc:
            raise ImportError(f"Selected file is not a readable SQLite database: {source}") from exc

        sidecar_payload = serialize_sidecar_snapshot(build_sidecar_snapshot(Path(status["mount_path"])))
        prepared_sidecars.write_bytes(sidecar_payload)
        prepared_sidecar_hash = sidecar_snapshot_hash(sidecar_payload)
        prepared_hash = combined_content_hash(hash_file(prepared), prepared_sidecar_hash)
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
                sidecar_source=prepared_sidecars,
                sidecar_hash=prepared_sidecar_hash,
            )

    return {
        "imported": True,
        "reason": "changed",
        "snapshot": meta.__dict__,
        "device": status,
    }
