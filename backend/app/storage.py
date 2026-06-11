from __future__ import annotations

import json
import hashlib
import shutil
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import data_dir
from .errors import ImportError, UnsupportedSchemaError
from .sqlite_stats import SnapshotMeta, build_dashboard, read_user_version


class SnapshotStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or data_dir()
        self.snapshots_dir = self.root / "snapshots"
        self.manifest_path = self.root / "manifest.json"

    def ensure(self) -> None:
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

    def load_manifest(self) -> dict[str, Any]:
        self.ensure()
        if not self.manifest_path.exists():
            return {"snapshots": []}
        with self.manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        manifest.setdefault("snapshots", [])
        return manifest

    def save_manifest(self, manifest: dict[str, Any]) -> None:
        self.ensure()
        tmp_path = self.manifest_path.with_suffix(".json.tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
            handle.write("\n")
        tmp_path.replace(self.manifest_path)

    def list_snapshots(self) -> list[dict[str, Any]]:
        manifest = self.load_manifest()
        return sorted(
            manifest["snapshots"],
            key=lambda item: item["imported_at"],
            reverse=True,
        )

    def latest(self) -> SnapshotMeta | None:
        snapshots = self.list_snapshots()
        if not snapshots:
            return None
        return SnapshotMeta(**snapshots[0])

    def resolve(self, snapshot_id: str) -> SnapshotMeta | None:
        if snapshot_id == "latest":
            return self.latest()
        for item in self.load_manifest()["snapshots"]:
            if item["id"] == snapshot_id:
                return SnapshotMeta(**item)
        return None

    def snapshot_content_hash(self, snapshot: SnapshotMeta | None) -> str | None:
        if snapshot is None:
            return None
        if snapshot.content_hash:
            return snapshot.content_hash
        path = Path(snapshot.path)
        if not path.exists():
            return None
        return hash_file(path)

    def import_file(
        self,
        source: Path,
        *,
        source_kind: str,
        source_path: str | None = None,
        sidecar_payload: bytes | None = None,
    ) -> SnapshotMeta:
        self.ensure()
        if not source.exists():
            raise ImportError(f"Database file does not exist: {source}")
        if not source.is_file():
            raise ImportError(f"Database path is not a file: {source}")

        imported_at, snapshot_id, destination = self.next_snapshot_destination()
        sidecar_destination = self.sidecar_destination(snapshot_id) if sidecar_payload is not None else None
        try:
            copy_sqlite_database(source, destination)
            if sidecar_destination is not None:
                sidecar_destination.write_bytes(sidecar_payload)
        except sqlite3.DatabaseError as exc:
            destination.unlink(missing_ok=True)
            if sidecar_destination is not None:
                sidecar_destination.unlink(missing_ok=True)
            raise ImportError(f"Selected file is not a readable SQLite database: {source_path or source}") from exc
        except OSError as exc:
            destination.unlink(missing_ok=True)
            if sidecar_destination is not None:
                sidecar_destination.unlink(missing_ok=True)
            raise ImportError(f"Could not copy sidecar metadata: {source_path or source}") from exc

        sidecar_hash = hash_file(sidecar_destination) if sidecar_destination else None
        content_hash = hash_file(destination)
        if sidecar_hash:
            content_hash = combined_content_hash(content_hash, sidecar_hash)
        return self.record_snapshot(
            destination,
            imported_at=imported_at,
            snapshot_id=snapshot_id,
            source_kind=source_kind,
            source_path=source_path,
            content_hash=content_hash,
            sidecar_destination=sidecar_destination,
            sidecar_hash=sidecar_hash,
        )

    def import_snapshot_copy(
        self,
        source: Path,
        *,
        source_kind: str,
        source_path: str | None = None,
        content_hash: str | None = None,
        sidecar_source: Path | None = None,
        sidecar_hash: str | None = None,
    ) -> SnapshotMeta:
        self.ensure()
        if not source.exists():
            raise ImportError(f"Database file does not exist: {source}")
        if not source.is_file():
            raise ImportError(f"Database path is not a file: {source}")

        imported_at, snapshot_id, destination = self.next_snapshot_destination()
        sidecar_destination = self.sidecar_destination(snapshot_id) if sidecar_source is not None else None
        try:
            shutil.copy2(source, destination)
            if sidecar_source is not None and sidecar_destination is not None:
                shutil.copy2(sidecar_source, sidecar_destination)
        except OSError as exc:
            destination.unlink(missing_ok=True)
            if sidecar_destination is not None:
                sidecar_destination.unlink(missing_ok=True)
            raise ImportError(f"Could not copy database snapshot: {source_path or source}") from exc

        return self.record_snapshot(
            destination,
            imported_at=imported_at,
            snapshot_id=snapshot_id,
            source_kind=source_kind,
            source_path=source_path,
            content_hash=content_hash,
            sidecar_destination=sidecar_destination,
            sidecar_hash=sidecar_hash,
        )

    def next_snapshot_destination(self) -> tuple[str, str, Path]:
        imported_at = datetime.now(timezone.utc).isoformat()
        snapshot_id = imported_at.replace(":", "").replace("+00:00", "Z")
        return imported_at, snapshot_id, self.snapshots_dir / f"{snapshot_id}-statistics.sqlite3"

    def sidecar_destination(self, snapshot_id: str) -> Path:
        return self.snapshots_dir / f"{snapshot_id}-sidecars.json"

    def record_snapshot(
        self,
        destination: Path,
        *,
        imported_at: str,
        snapshot_id: str,
        source_kind: str,
        source_path: str | None,
        content_hash: str | None = None,
        sidecar_destination: Path | None = None,
        sidecar_hash: str | None = None,
    ) -> SnapshotMeta:
        try:
            user_version = read_user_version(destination)
            meta = SnapshotMeta(
                id=snapshot_id,
                imported_at=imported_at,
                source=source_kind,
                source_path=source_path,
                path=str(destination),
                file_size=destination.stat().st_size,
                user_version=user_version,
                schema_version=str(user_version),
                content_hash=content_hash or hash_file(destination),
                sidecar_path=str(sidecar_destination) if sidecar_destination else None,
                sidecar_hash=sidecar_hash or (hash_file(sidecar_destination) if sidecar_destination else None),
            )
            build_dashboard(destination, meta)
        except UnsupportedSchemaError:
            destination.unlink(missing_ok=True)
            if sidecar_destination is not None:
                sidecar_destination.unlink(missing_ok=True)
            raise

        manifest = self.load_manifest()
        manifest["snapshots"].append(meta.__dict__)
        self.save_manifest(manifest)
        return meta


def copy_sqlite_database(source: Path, destination: Path) -> None:
    source_uri = f"{source.resolve().as_uri()}?mode=ro"
    with closing(sqlite3.connect(source_uri, uri=True)) as source_conn:
        with closing(sqlite3.connect(destination)) as destination_conn:
            source_conn.backup(destination_conn)


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def combined_content_hash(database_hash: str, sidecar_hash: str) -> str:
    digest = hashlib.sha256()
    digest.update(database_hash.encode("ascii"))
    digest.update(b"\0")
    digest.update(sidecar_hash.encode("ascii"))
    return digest.hexdigest()
