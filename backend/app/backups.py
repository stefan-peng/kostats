from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from .device import DEVICE_LOCK, device_status
from .errors import BackupError
from .lua_table import LuaTableError, decode_string, parse_lua_table
from .sidecars import normalize_sidecar, sidecar_candidates
from .storage import copy_sqlite_database


BACKUP_FORMAT_VERSION = 1
BOOK_EXTENSIONS = {
    ".azw",
    ".azw3",
    ".cb7",
    ".cbr",
    ".cbt",
    ".cbz",
    ".chm",
    ".djv",
    ".djvu",
    ".doc",
    ".docx",
    ".epub",
    ".fb2",
    ".html",
    ".htm",
    ".kepub",
    ".mobi",
    ".odt",
    ".pdf",
    ".prc",
    ".rtf",
    ".txt",
    ".xhtml",
    ".zip",
}
ROOT_FILES = {"settings.reader.lua", "history.lua", "defaults.custom.lua"}
DATABASE_FILES = {"statistics.sqlite3", "vocabulary_builder.sqlite3"}
EXCLUDED_NAMES = {"bookinfo_cache.sqlite3"}
EXCLUDED_SUFFIXES = (".log", ".old", ".shm", ".wal", "-shm", "-wal")
EXCLUDED_ROOT_DIRS = {
    ".fseventsd",
    ".kobo",
    ".kobo-images",
    ".Spotlight-V100",
    ".Trashes",
    "System Volume Information",
}
CREDENTIAL_RE = re.compile(
    r"(?i)(password|passwd|token|secret|api[_-]?key|username|user[_-]?name|cookie)"
)
PATH_RE = re.compile(r'(["\'])(/mnt/(?:onboard|sd)/[^"\']+)\1')
KOBO_PRODUCT_MODELS = {
    "390": "Kobo_monza",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def backup_id(now: datetime | None = None) -> str:
    value = now or utc_now()
    return value.isoformat().replace(":", "").replace("+00:00", "Z")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def partial_md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for exponent in range(-1, 11):
            offset = 1024 * (4**exponent)
            handle.seek(int(offset))
            sample = handle.read(1024)
            if not sample:
                break
            digest.update(sample)
    return digest.hexdigest()


def normalized_text(value: str | None) -> str | None:
    if not value:
        return None
    text = unicodedata.normalize("NFKC", value)
    text = re.sub(r"\s+", " ", text).strip().casefold()
    return text or None


def device_doc_path(volume: Path, path: Path) -> str:
    relative = path.relative_to(volume).as_posix()
    return f"/mnt/onboard/{relative}"


def detect_koreader_version(koreader_root: Path) -> str | None:
    for relative in ("git-rev", "version", "VERSION"):
        path = koreader_root / relative
        if not path.is_file():
            continue
        try:
            value = path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            continue
        if value:
            return value.splitlines()[0][:120]
    return None


def lua_string_field(text: str, key: str) -> str | None:
    match = re.search(
        rf'(?:\["{re.escape(key)}"\]|{re.escape(key)})\s*=\s*("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')',
        text,
    )
    if not match:
        return None
    try:
        return decode_string(match.group(1))
    except LuaTableError:
        return None


def detect_device_model(koreader_root: Path) -> str | None:
    settings = koreader_root / "settings.reader.lua"
    if settings.is_file():
        try:
            text = settings.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            text = ""
        for key in ("device_model", "device", "product"):
            if value := lua_string_field(text, key):
                return value
    version_file = koreader_root.parents[1] / ".kobo/version"
    if version_file.is_file():
        try:
            product_id = version_file.read_text(encoding="utf-8").strip()[-3:]
        except (OSError, UnicodeError):
            return None
        return KOBO_PRODUCT_MODELS.get(product_id, f"Kobo product {product_id}")
    return None


def document_metadata_mode(koreader_root: Path) -> str:
    settings = koreader_root / "settings.reader.lua"
    if not settings.is_file():
        return "doc"
    try:
        text = settings.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return "doc"
    match = re.search(
        r'(?:\["document_metadata_folder"\]|document_metadata_folder)\s*=\s*["\'](doc|dir|hash)["\']',
        text,
    )
    return match.group(1) if match else "doc"


def should_exclude(path: Path) -> bool:
    name = path.name
    lower = name.lower()
    if name.startswith("._") or name.startswith("FSCK0000."):
        return True
    if lower in EXCLUDED_NAMES:
        return True
    if lower.endswith(EXCLUDED_SUFFIXES):
        return True
    return False


def iter_files(root: Path) -> Iterable[Path]:
    if root.is_file():
        if not should_exclude(root):
            yield root
        return
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and not should_exclude(path):
            yield path


def sqlite_content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    uri = f"{path.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        for line in connection.iterdump():
            digest.update(line.encode("utf-8"))
            digest.update(b"\n")
    return digest.hexdigest()


def sidecar_directories(volume: Path) -> list[Path]:
    directories = {path.parent for path in sidecar_candidates(volume)}
    return sorted(directories)


def sidecar_sources(volume: Path) -> list[Path]:
    koreader_history = volume / ".adds/koreader/history"
    sources: set[Path] = set()
    for path in sidecar_candidates(volume):
        if path.parent == koreader_history and not path.name.startswith("metadata."):
            sources.add(path)
        else:
            sources.add(path.parent)
    return sorted(sources)


def sidecar_record(volume: Path, source_path: Path) -> dict[str, Any]:
    metadata_paths = (
        [source_path]
        if source_path.is_file()
        else sorted(source_path.glob("metadata.*.lua"))
    )
    normalized = next(
        (record for path in metadata_paths if (record := normalize_sidecar(path)) is not None),
        {},
    )
    if metadata_paths:
        try:
            metadata_text = metadata_paths[0].read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            metadata_text = ""
        for key in ("doc_path", "partial_md5_checksum"):
            normalized.setdefault(key, lua_string_field(metadata_text, key))
        if not normalized.get("title"):
            normalized["title"] = lua_string_field(metadata_text, "title")
        if not normalized.get("authors"):
            normalized["authors"] = lua_string_field(metadata_text, "authors")
    doc_path = normalized.get("doc_path")
    checksum = normalized.get("partial_md5_checksum")
    if doc_path and not checksum:
        relative = re.sub(r"^/mnt/(?:onboard|sd)/?", "", doc_path)
        document = safe_destination(volume, relative)
        if document.is_file():
            try:
                checksum = partial_md5(document)
            except OSError:
                pass
    source = source_path.relative_to(volume).as_posix()
    if source.startswith(".adds/koreader/hashdocsettings/"):
        mode = "hash"
    elif source.startswith(".adds/koreader/docsettings/") or source.startswith(".adds/koreader/history/"):
        mode = "dir"
    else:
        mode = "doc"
    return {
        "archive_path": f"payload/sidecars/{source}",
        "source_path": source,
        "source_mode": mode,
        "doc_path": doc_path,
        "partial_md5_checksum": checksum,
        "title": normalized.get("title"),
        "authors": normalized.get("authors"),
        "files": [],
    }


class RecoveryBackupStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.backups_dir = root / "backups"
        self.index_path = self.backups_dir / "manifest.json"
        self._index_lock = threading.Lock()

    def ensure(self) -> None:
        self.backups_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            self.backups_dir.chmod(0o700)
        except OSError:
            pass

    def load_index(self) -> dict[str, Any]:
        self.ensure()
        if not self.index_path.exists():
            return {"version": 1, "backups": []}
        try:
            payload = json.loads(self.index_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise BackupError("The local recovery backup index is unreadable.") from exc
        payload.setdefault("version", 1)
        payload.setdefault("backups", [])
        return payload

    def save_index(self, index: dict[str, Any]) -> None:
        self.ensure()
        temporary = self.index_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(self.index_path)

    def list_backups(self) -> list[dict[str, Any]]:
        return sorted(
            self.load_index()["backups"],
            key=lambda item: item["created_at"],
            reverse=True,
        )

    def resolve(self, identifier: str) -> dict[str, Any] | None:
        return next((item for item in self.load_index()["backups"] if item["id"] == identifier), None)

    def create_from_kobo(
        self,
        volume: Path | None = None,
        *,
        source: str = "kobo",
        force: bool = False,
    ) -> dict[str, Any]:
        status = device_status(volume)
        if not status["mounted"]:
            raise BackupError(f"Kobo is not mounted at {status['mount_path']}")
        root = Path(status["mount_path"])
        if not root.is_dir():
            raise BackupError("The Kobo mount is not a readable directory.")
        with DEVICE_LOCK:
            return self._create(root, source=source, force=force)

    def _create(self, volume: Path, *, source: str, force: bool) -> dict[str, Any]:
        self.ensure()
        koreader_root = volume / ".adds/koreader"
        if not koreader_root.is_dir():
            raise BackupError("KOReader was not found under .adds/koreader on the mounted Kobo.")

        identifier = backup_id()
        archive_path = self.backups_dir / f"{identifier}.zip"
        payloads: list[tuple[Path, str, str]] = []
        temporary_databases: list[Path] = []
        sidecars: list[dict[str, Any]] = []
        credentials_included = False

        def add_path(source_path: Path, archive_name: str, category: str) -> None:
            nonlocal credentials_included
            for file_path in iter_files(source_path):
                suffix = file_path.relative_to(source_path).as_posix() if source_path.is_dir() else ""
                destination = archive_name if not suffix else f"{archive_name}/{suffix}"
                payloads.append((file_path, destination, category))
                if file_path.suffix == ".lua":
                    try:
                        credentials_included |= bool(CREDENTIAL_RE.search(file_path.read_text(encoding="utf-8")))
                    except (OSError, UnicodeError):
                        pass

        for name in ROOT_FILES:
            add_path(koreader_root / name, f"payload/koreader/{name}", "settings")
        add_path(koreader_root / "settings", "payload/koreader/settings", "settings")
        add_path(koreader_root / "data/cr3.ini", "payload/koreader/data/cr3.ini", "rendering")
        add_path(koreader_root / "data/dict", "payload/koreader/data/dict", "dictionaries")
        add_path(koreader_root / "data/tessdata", "payload/koreader/data/tessdata", "tessdata")
        add_path(koreader_root / "styletweaks", "payload/koreader/styletweaks", "styletweaks")

        for name in DATABASE_FILES:
            source_db = koreader_root / "settings" / name
            if not source_db.is_file():
                continue
            file_descriptor, prepared_name = tempfile.mkstemp(prefix="kostats-backup-", suffix=".sqlite3")
            os.close(file_descriptor)
            prepared = Path(prepared_name)
            try:
                copy_sqlite_database(source_db, prepared)
            except (OSError, sqlite3.DatabaseError) as exc:
                prepared.unlink(missing_ok=True)
                raise BackupError(f"Could not create a consistent copy of {name}.") from exc
            temporary_databases.append(prepared)
            payloads = [
                payload
                for payload in payloads
                if payload[1] != f"payload/koreader/settings/{name}"
            ]
            payloads.append((prepared, f"payload/koreader/settings/{name}", "databases"))

        for sidecar_source in sidecar_sources(volume):
            record = sidecar_record(volume, sidecar_source)
            for file_path in iter_files(sidecar_source):
                if sidecar_source.is_file():
                    archive_name = record["archive_path"]
                else:
                    relative = file_path.relative_to(sidecar_source).as_posix()
                    archive_name = f"{record['archive_path']}/{relative}"
                payloads.append((file_path, archive_name, "sidecars"))
                record["files"].append(archive_name)
            sidecars.append(record)

        add_path(koreader_root / "plugins", "payload/extensions/plugins", "extensions")
        add_path(koreader_root / "patches", "payload/extensions/patches", "extensions")

        counts = Counter(category for _, _, category in payloads)
        manifest: dict[str, Any] = {
            "format_version": BACKUP_FORMAT_VERSION,
            "id": identifier,
            "created_at": utc_now().isoformat(),
            "source": source,
            "source_mount": str(volume),
            "koreader_version": detect_koreader_version(koreader_root),
            "device_model": detect_device_model(koreader_root),
            "document_metadata_folder": document_metadata_mode(koreader_root),
            "credentials_included": credentials_included,
            "counts": dict(counts),
            "payloads": [],
            "sidecars": sidecars,
            "known_book_paths": [],
        }
        known_book_paths: set[str] = set()
        try:
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for source_path, archive_name, category in sorted(payloads, key=lambda item: item[1]):
                    payload = source_path.read_bytes()
                    archive.writestr(archive_name, payload)
                    if source_path.suffix == ".lua":
                        try:
                            known_book_paths.update(
                                match.group(2)
                                for match in PATH_RE.finditer(payload.decode("utf-8"))
                                if PurePosixPath(match.group(2)).suffix.lower() in BOOK_EXTENSIONS
                            )
                        except UnicodeDecodeError:
                            pass
                    dedup_sha256 = (
                        sqlite_content_hash(source_path)
                        if category == "databases"
                        else sha256_bytes(payload)
                    )
                    manifest["payloads"].append(
                        {
                            "path": archive_name,
                            "size": len(payload),
                            "sha256": sha256_bytes(payload),
                            "dedup_sha256": dedup_sha256,
                            "category": category,
                        }
                    )
                manifest["known_book_paths"] = sorted(known_book_paths)
                content_hash = sha256_bytes(
                    json.dumps(
                        [(item["path"], item["dedup_sha256"]) for item in manifest["payloads"]],
                        separators=(",", ":"),
                    ).encode("utf-8")
                )
                manifest["content_hash"] = content_hash
                archive.writestr("manifest.json", json.dumps(manifest, indent=2, sort_keys=True) + "\n")
            archive_path.chmod(0o600)
        except (OSError, zipfile.BadZipFile) as exc:
            archive_path.unlink(missing_ok=True)
            raise BackupError("Could not write the recovery backup archive.") from exc
        finally:
            for path in temporary_databases:
                path.unlink(missing_ok=True)

        with self._index_lock:
            index = self.load_index()
            duplicate = next(
                (item for item in index["backups"] if item.get("content_hash") == manifest["content_hash"]),
                None,
            )
            if duplicate and not force:
                archive_path.unlink(missing_ok=True)
                return {"created": False, "backup": duplicate}
            summary = self._summary(manifest, archive_path)
            index["backups"].append(summary)
            self.save_index(index)
        return {"created": True, "backup": summary}

    def _summary(self, manifest: dict[str, Any], archive_path: Path) -> dict[str, Any]:
        return {
            "id": manifest["id"],
            "created_at": manifest["created_at"],
            "source": manifest["source"],
            "source_mount": manifest["source_mount"],
            "archive_path": str(archive_path),
            "archive_size": archive_path.stat().st_size,
            "content_hash": manifest["content_hash"],
            "koreader_version": manifest["koreader_version"],
            "device_model": manifest["device_model"],
            "document_metadata_folder": manifest["document_metadata_folder"],
            "credentials_included": manifest["credentials_included"],
            "counts": manifest["counts"],
        }

    def load_archive(self, identifier: str) -> tuple[dict[str, Any], zipfile.ZipFile]:
        summary = self.resolve(identifier)
        if summary is None:
            raise BackupError(f"Recovery backup not found: {identifier}")
        archive_path = Path(summary["archive_path"])
        try:
            archive = zipfile.ZipFile(archive_path, "r")
            names = archive.namelist()
            for name in names:
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts:
                    archive.close()
                    raise BackupError("The recovery backup contains an unsafe path.")
            manifest = json.loads(archive.read("manifest.json"))
        except (OSError, KeyError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
            raise BackupError("The recovery backup archive is unreadable.") from exc
        if manifest.get("format_version") != BACKUP_FORMAT_VERSION:
            archive.close()
            raise BackupError("The recovery backup format is not supported.")
        return manifest, archive

    def validate_archive(self, manifest: dict[str, Any], archive: zipfile.ZipFile) -> None:
        for item in manifest.get("payloads", []):
            try:
                payload = archive.read(item["path"])
            except KeyError as exc:
                raise BackupError(f"Backup payload is missing: {item['path']}") from exc
            if len(payload) != item["size"] or sha256_bytes(payload) != item["sha256"]:
                raise BackupError(f"Backup checksum validation failed: {item['path']}")

    def restore_preview(self, identifier: str, volume: Path | None = None) -> dict[str, Any]:
        status = device_status(volume)
        if not status["mounted"]:
            raise BackupError(f"Kobo is not mounted at {status['mount_path']}")
        root = Path(status["mount_path"])
        manifest, archive = self.load_archive(identifier)
        try:
            self.validate_archive(manifest, archive)
        finally:
            archive.close()
        matches = match_sidecars(root, manifest.get("sidecars", []))
        current_version = detect_koreader_version(root / ".adds/koreader")
        backup_version = manifest.get("koreader_version")
        required_bytes = sum(item.get("size", 0) for item in manifest.get("payloads", []))
        return {
            "backup": self.resolve(identifier),
            "device": status,
            "current_koreader_version": current_version,
            "version_warning": bool(backup_version and current_version and backup_version != current_version),
            "required_bytes": required_bytes,
            "available_bytes": shutil.disk_usage(root).free,
            "counts": manifest.get("counts", {}),
            **matches,
        }

    def restore(
        self,
        identifier: str,
        *,
        confirmed: bool,
        restore_extensions: bool,
        volume: Path | None = None,
    ) -> dict[str, Any]:
        if not confirmed:
            raise BackupError("Restore confirmation is required.")
        status = device_status(volume)
        if not status["mounted"]:
            raise BackupError(f"Kobo is not mounted at {status['mount_path']}")
        root = Path(status["mount_path"])
        koreader_root = root / ".adds/koreader"
        if not koreader_root.is_dir():
            raise BackupError("KOReader was not found under .adds/koreader on the mounted Kobo.")

        with DEVICE_LOCK:
            manifest, archive = self.load_archive(identifier)
            try:
                self.validate_archive(manifest, archive)
                matches = match_sidecars(root, manifest.get("sidecars", []))
                required_bytes = sum(item.get("size", 0) for item in manifest.get("payloads", []))
                if shutil.disk_usage(root).free < required_bytes:
                    raise BackupError("The Kobo does not have enough free space for this restore.")
                verify_writable(root)
                safety = self._create(root, source="pre-restore-safety", force=True)["backup"]
                result = apply_restore(
                    root,
                    manifest,
                    archive,
                    matches,
                    restore_extensions=restore_extensions,
                )
                if result["failed"]:
                    raise BackupError(
                        f"Restore failed for {len(result['failed'])} item(s). "
                        f"Safety backup {safety['id']} is available."
                    )
            finally:
                archive.close()
        return {
            **result,
            "safety_backup_id": safety["id"],
            "restart_required": True,
        }


def scan_books(volume: Path) -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    for root, dirs, files in os.walk(volume):
        root_path = Path(root)
        if root_path == volume:
            dirs[:] = [
                name
                for name in dirs
                if name != ".adds" and name not in EXCLUDED_ROOT_DIRS and not name.endswith(".sdr")
            ]
        else:
            dirs[:] = [name for name in dirs if not name.endswith(".sdr")]
        for name in files:
            path = root_path / name
            if name.startswith(".") or should_exclude(path) or path.suffix.lower() not in BOOK_EXTENSIONS:
                continue
            try:
                checksum = partial_md5(path)
            except OSError:
                continue
            stem = path.stem
            title = re.sub(r"\s+\(\d+\)$", "", stem).strip()
            author = path.parent.parent.name if path.parent.parent != volume else None
            books.append(
                {
                    "path": str(path),
                    "doc_path": device_doc_path(volume, path),
                    "partial_md5_checksum": checksum,
                    "title": title,
                    "authors": author,
                }
            )
    return books


def match_sidecars(volume: Path, sidecars: list[dict[str, Any]]) -> dict[str, Any]:
    books = scan_books(volume)
    by_hash: dict[str, list[dict[str, Any]]] = {}
    for book in books:
        by_hash.setdefault(book["partial_md5_checksum"], []).append(book)
    exact: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    for sidecar in sidecars:
        checksum = sidecar.get("partial_md5_checksum")
        candidates = by_hash.get(checksum, []) if checksum else []
        base = {
            "source_path": sidecar.get("source_path"),
            "old_doc_path": sidecar.get("doc_path"),
            "title": sidecar.get("title"),
            "authors": sidecar.get("authors"),
            "partial_md5_checksum": checksum,
        }
        if len(candidates) == 1:
            exact.append({**base, "new_doc_path": candidates[0]["doc_path"], "new_path": candidates[0]["path"]})
        elif len(candidates) > 1:
            ambiguous.append({**base, "candidates": candidates})
        else:
            title = normalized_text(sidecar.get("title"))
            authors = normalized_text(sidecar.get("authors"))
            fallback = [
                book
                for book in books
                if title
                and normalized_text(book.get("title")) == title
                and (not authors or not book.get("authors") or normalized_text(book.get("authors")) == authors)
            ][:10]
            missing.append({**base, "fallback_candidates": fallback})
    return {
        "exact_matches": exact,
        "missing_matches": missing,
        "ambiguous_matches": ambiguous,
        "book_count": len(books),
    }


def verify_writable(volume: Path) -> None:
    try:
        with tempfile.NamedTemporaryFile(prefix=".kostats-write-test-", dir=volume, delete=True):
            pass
    except OSError as exc:
        raise BackupError("The mounted Kobo is not writable.") from exc


def safe_destination(root: Path, relative: str) -> Path:
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts:
        raise BackupError(f"Unsafe restore destination: {relative}")
    destination = (root / Path(*path.parts)).resolve()
    resolved_root = root.resolve()
    if destination != resolved_root and resolved_root not in destination.parents:
        raise BackupError(f"Unsafe restore destination: {relative}")
    return destination


def write_payload(destination: Path, payload: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.kostats.tmp")
    temporary.write_bytes(payload)
    temporary.replace(destination)


def restored_sidecar_destination(
    volume: Path,
    koreader_root: Path,
    mode: str,
    match: dict[str, Any],
) -> Path:
    book_path = Path(match["new_path"])
    doc_path = match["new_doc_path"]
    if mode == "hash":
        checksum = match["partial_md5_checksum"]
        return koreader_root / "hashdocsettings" / checksum[:2] / f"{checksum}.sdr"
    without_suffix = str(Path(doc_path).with_suffix("")).lstrip("/")
    if mode == "dir":
        return koreader_root / "docsettings" / f"{without_suffix}.sdr"
    return book_path.with_suffix("").with_name(book_path.with_suffix("").name + ".sdr")


def rewrite_lua_paths(payload: bytes, replacements: dict[str, str], unmatched: set[str]) -> bytes:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload
    try:
        parsed = parse_lua_table(text)
    except LuaTableError:
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text.encode("utf-8")
    rewritten = rewrite_lua_value(parsed, replacements, unmatched)
    return ("return " + dump_lua(rewritten) + "\n").encode("utf-8")


DROP = object()


def rewrite_lua_value(value: Any, replacements: dict[str, str], unmatched: set[str]) -> Any:
    if isinstance(value, str):
        if value in unmatched:
            return DROP
        output = value
        for old, new in replacements.items():
            output = output.replace(old, new)
        return output
    if isinstance(value, list):
        return [
            rewritten
            for item in value
            if (rewritten := rewrite_lua_value(item, replacements, unmatched)) is not DROP
        ]
    if isinstance(value, dict):
        output = {}
        for key, item in value.items():
            new_key = rewrite_lua_value(key, replacements, unmatched)
            new_item = rewrite_lua_value(item, replacements, unmatched)
            if new_key is DROP or new_item is DROP:
                continue
            output[new_key] = new_item
        return output
    return value


def dump_lua(value: Any, indent: int = 0) -> str:
    if value is None:
        return "nil"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "{ " + ", ".join(dump_lua(item, indent + 1) for item in value) + " }"
    if isinstance(value, dict):
        padding = "    " * (indent + 1)
        closing = "    " * indent
        entries = [
            f"{padding}[{dump_lua(key, indent + 1)}] = {dump_lua(item, indent + 1)},"
            for key, item in value.items()
        ]
        return "{\n" + "\n".join(entries) + f"\n{closing}}}"
    raise BackupError(f"Unsupported Lua value in recovery backup: {type(value).__name__}")


def apply_restore(
    volume: Path,
    manifest: dict[str, Any],
    archive: zipfile.ZipFile,
    matches: dict[str, Any],
    *,
    restore_extensions: bool,
) -> dict[str, Any]:
    koreader_root = volume / ".adds/koreader"
    exact_by_source = {item["source_path"]: item for item in matches["exact_matches"]}
    replacements = {
        item["old_doc_path"]: item["new_doc_path"]
        for item in matches["exact_matches"]
        if item.get("old_doc_path")
    }
    unmatched = {
        item["old_doc_path"]
        for item in matches["missing_matches"] + matches["ambiguous_matches"]
        if item.get("old_doc_path")
    }
    unmatched.update(
        path
        for path in manifest.get("known_book_paths", [])
        if path not in replacements
    )
    restored = Counter()
    failed: list[dict[str, str]] = []

    sidecar_paths = {
        payload_path
        for sidecar in manifest.get("sidecars", [])
        for payload_path in sidecar.get("files", [])
    }
    for item in manifest.get("payloads", []):
        archive_path = item["path"]
        category = item["category"]
        if archive_path in sidecar_paths:
            continue
        if category == "extensions":
            if not restore_extensions:
                continue
            relative = archive_path.removeprefix("payload/extensions/")
            destination = safe_destination(koreader_root, relative)
            path_parts = PurePosixPath(relative).parts
            if len(path_parts) >= 2 and path_parts[0] == "plugins":
                plugin_root = safe_destination(koreader_root, str(PurePosixPath(*path_parts[:2])))
                if plugin_root.exists():
                    continue
            if destination.exists():
                continue
        else:
            relative = archive_path.removeprefix("payload/koreader/")
            destination = safe_destination(koreader_root, relative)
        try:
            payload = archive.read(archive_path)
            if destination.suffix == ".lua":
                payload = rewrite_lua_paths(payload, replacements, unmatched)
            write_payload(destination, payload)
            restored[category] += 1
        except (OSError, KeyError, BackupError) as exc:
            failed.append({"path": archive_path, "error": str(exc)})

    mode = manifest.get("document_metadata_folder") or "doc"
    restored_sidecars = 0
    skipped_sidecars = len(matches["missing_matches"]) + len(matches["ambiguous_matches"])
    for sidecar in manifest.get("sidecars", []):
        match = exact_by_source.get(sidecar.get("source_path"))
        if match is None:
            continue
        destination_dir = restored_sidecar_destination(volume, koreader_root, mode, match)
        try:
            for archive_path in sidecar.get("files", []):
                name = PurePosixPath(archive_path).name
                is_legacy_history = str(sidecar.get("source_path", "")).startswith(
                    ".adds/koreader/history/"
                )
                if (name.startswith("metadata.") or is_legacy_history) and name.endswith(".lua"):
                    suffix = Path(match["new_path"]).suffix.lstrip(".") or "_"
                    name = f"metadata.{suffix}.lua"
                payload = archive.read(archive_path)
                if name.endswith(".lua"):
                    payload = rewrite_lua_paths(payload, replacements, unmatched)
                write_payload(destination_dir / name, payload)
            restored_sidecars += 1
        except (OSError, KeyError, BackupError) as exc:
            failed.append({"path": sidecar.get("source_path", ""), "error": str(exc)})

    return {
        "restored": {
            **dict(restored),
            "sidecars": restored_sidecars,
        },
        "skipped": {
            "sidecars": skipped_sidecars,
            "extensions": 0 if restore_extensions else manifest.get("counts", {}).get("extensions", 0),
        },
        "failed": failed,
    }
