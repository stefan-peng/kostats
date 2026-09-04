from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from .library import inventory
from .lua_table import LuaTableError, parse_lua_table


VALID_STATUSES = {"reading", "complete", "abandoned"}


def text_value(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def int_value(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def float_value(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if 0 <= result <= 1 else None


def table_value(value: Any) -> dict[Any, Any]:
    return value if isinstance(value, dict) else {}


def annotation_count(value: Any) -> tuple[int, int]:
    if isinstance(value, list):
        entries = value
    elif isinstance(value, dict):
        entries = [item for key, item in value.items() if isinstance(key, int)]
    else:
        entries = []
    highlights = len(entries)
    notes = sum(
        1
        for entry in entries
        if isinstance(entry, dict) and text_value(entry.get("note")) is not None
    )
    return highlights, notes


def normalize_sidecar(path: Path) -> dict[str, Any] | None:
    try:
        parsed = parse_lua_table(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, LuaTableError):
        return None
    if not isinstance(parsed, dict):
        return None

    summary = table_value(parsed.get("summary"))
    stats = table_value(parsed.get("stats"))
    props = table_value(parsed.get("doc_props"))
    annotations, annotation_notes = annotation_count(parsed.get("annotations"))
    status = text_value(summary.get("status"))
    if status not in VALID_STATUSES:
        status = None

    highlight_count = max(int_value(stats.get("highlights")) or 0, annotations)
    note_count = max(int_value(stats.get("notes")) or 0, annotation_notes)
    return {
        "source_path": str(path),
        "doc_path": text_value(parsed.get("doc_path")),
        "partial_md5_checksum": text_value(parsed.get("partial_md5_checksum")),
        "title": text_value(props.get("title")) or text_value(stats.get("title")),
        "authors": text_value(props.get("authors")) or text_value(stats.get("authors")),
        "status": status,
        "percent_finished": float_value(parsed.get("percent_finished")),
        "status_modified": text_value(summary.get("modified")),
        "highlight_count": highlight_count,
        "note_count": note_count,
        "series": text_value(props.get("series")) or text_value(stats.get("series")),
        "series_index": float_value_unbounded(props.get("series_index")),
        "language": text_value(props.get("language")) or text_value(stats.get("language")),
    }


def float_value_unbounded(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sidecar_candidates(volume: Path) -> list[Path]:
    candidates: set[Path] = set()
    skipped_root_dirs = {
        ".adds",
        ".fseventsd",
        ".kobo",
        ".kobo-images",
        ".Spotlight-V100",
        ".Trashes",
        "System Volume Information",
    }
    for root, dirs, files in os.walk(volume):
        root_path = Path(root)
        if root_path == volume:
            dirs[:] = [name for name in dirs if name not in skipped_root_dirs]
        if root_path.name.endswith(".sdr"):
            candidates.update(
                root_path / name
                for name in files
                if name.startswith("metadata.") and name.endswith(".lua") and not name.startswith("._")
            )
            dirs[:] = []

    koreader_root = volume / ".adds/koreader"
    for name in ("docsettings", "hashdocsettings"):
        root = koreader_root / name
        if root.is_dir():
            candidates.update(
                path
                for path in root.rglob("metadata.*.lua")
                if not path.name.startswith("._")
            )
    legacy_history = koreader_root / "history"
    if legacy_history.is_dir():
        candidates.update(
            path
            for path in legacy_history.glob("*.lua")
            if not path.name.startswith("._")
        )
    return sorted(candidates)


def book_sidecar_paths(volume: Path, book: dict[str, Any]) -> set[Path]:
    """Identify KOReader metadata locations even when their contents cannot be read."""
    document = Path(book["source_path"])
    filename = f"metadata{document.suffix}.lua"
    paths = {document.with_suffix(".sdr") / filename}
    koreader = volume / ".adds/koreader"
    relative = document.relative_to(volume)
    for mount in ("/mnt/onboard", "/mnt/sd"):
        device_path = Path(mount) / relative
        paths.add(koreader / "docsettings" / device_path.with_suffix(".sdr").as_posix().lstrip("/") / filename)
        history_name = f"[{device_path.parent.as_posix().replace('/', '#')}#] {document.name}.lua"
        paths.add(koreader / "history" / history_name)
    checksum = book.get("partial_md5_checksum")
    if checksum:
        paths.add(koreader / "hashdocsettings" / checksum[:2] / f"{checksum}.sdr" / filename)
    return paths


def build_sidecar_snapshot(volume: Path) -> dict[str, Any]:
    records = []
    malformed = 0
    candidates = set(sidecar_candidates(volume))
    for path in sorted(candidates):
        record = normalize_sidecar(path)
        if record is None:
            malformed += 1
        else:
            records.append(record)
    # Keep inventory separate from sidecars: absence is only evidence when the
    # device was scanned successfully and metadata was readable.
    library = inventory(volume)
    by_path = {record.get("doc_path"): record for record in records if record.get("doc_path")}
    for book in library:
        matching = by_path.get(book["doc_path"])
        if matching:
            # Use the stored KOReader identity when document content changes (e.g. covers).
            book["partial_md5_checksum"] = matching.get("partial_md5_checksum")
        has_sidecar = bool(book_sidecar_paths(volume, book) & candidates)
        book["status"] = None if has_sidecar or not book["partial_md5_checksum"] else "unread"
    return {
        "library": library,
        "version": 2,
        "records": records,
        "malformed_count": malformed,
    }


def serialize_sidecar_snapshot(snapshot: dict[str, Any]) -> bytes:
    return (json.dumps(snapshot, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sidecar_snapshot_hash(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_sidecar_snapshot(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return []
    records = payload.get("records", []) if isinstance(payload, dict) else []
    records = [record for record in records if isinstance(record, dict)]
    library = payload.get("library", []) if isinstance(payload, dict) else []
    # Sidecars remain authoritative; inventory supplies entries for other files.
    checksums = {record.get("partial_md5_checksum") for record in records if record.get("partial_md5_checksum")}
    paths = {record.get("doc_path") for record in records if record.get("doc_path")}
    for book in library:
        if isinstance(book, dict) and book.get("partial_md5_checksum") not in checksums and book.get("doc_path") not in paths:
            records.append(book)
    return records
