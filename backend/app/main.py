from __future__ import annotations

import os
import tempfile
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .backups import RecoveryBackupStore
from .devices import DeviceRegistry, normalized_label
from .device import auto_import_from_kobo, device_status, import_from_kobo
from .errors import BackupError, ImportError, UnsupportedSchemaError
from .sqlite_stats import SnapshotMeta, aggregate_dashboards, build_dashboard, empty_dashboard
from .storage import SnapshotStore, hash_file


app = FastAPI(title="kostats", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def store() -> SnapshotStore:
    return SnapshotStore()


def backup_store() -> RecoveryBackupStore:
    return RecoveryBackupStore(store().root)


def device_registry() -> DeviceRegistry:
    return DeviceRegistry(store().root)


def snapshot_cache_fingerprint(snapshot: SnapshotMeta) -> tuple:
    path = Path(snapshot.path)
    stat = path.stat()
    fingerprint: list[object] = [str(path), stat.st_mtime_ns, stat.st_size, hash_file(path)]
    if snapshot.sidecar_path:
        sidecar_path = Path(snapshot.sidecar_path)
        sidecar_stat = sidecar_path.stat()
        fingerprint.extend(
            [
                str(sidecar_path),
                sidecar_stat.st_mtime_ns,
                sidecar_stat.st_size,
                hash_file(sidecar_path),
            ]
        )
    return tuple(fingerprint)


def current_local_date() -> str:
    return datetime.now().astimezone().date().isoformat()


@lru_cache(maxsize=64)
def cached_dashboard(snapshot: SnapshotMeta, fingerprint: tuple, today: str, include_all_sessions: bool = False) -> dict:
    return build_dashboard(
        Path(snapshot.path),
        snapshot,
        today=datetime.strptime(today, "%Y-%m-%d").date(),
        include_all_sessions=include_all_sessions,
    )


def dashboard_for_snapshot(snapshot: SnapshotMeta, *, include_all_sessions: bool = False) -> dict:
    return cached_dashboard(
        snapshot,
        snapshot_cache_fingerprint(snapshot),
        current_local_date(),
        include_all_sessions,
    )


def known_device_rows() -> list[dict]:
    return [*store().list_snapshots(), *backup_store().list_backups()]


class RestoreRequest(BaseModel):
    confirmed: bool = False
    restore_optional_extensions: bool = False


class DeviceUpdateRequest(BaseModel):
    label: str


class DeviceAssignmentRequest(BaseModel):
    device_id: str | None = None
    new_device_label: str | None = None


def resolve_assigned_device(
    assignment: DeviceAssignmentRequest | None,
    *,
    default: dict | None = None,
    source: str = "manual",
) -> dict | None:
    if assignment is None:
        return default
    registry = device_registry()
    if assignment.device_id:
        device = registry.resolve(assignment.device_id)
        if device is None:
            known = next((row for row in known_device_rows() if row.get("device_id") == assignment.device_id), None)
            if known is not None:
                device = registry.upsert(
                    device_id=assignment.device_id,
                    label=known.get("device_label") or assignment.device_id,
                    model=known.get("device_model"),
                    koreader_version=known.get("koreader_version"),
                    source=known.get("source") or source,
                    label_source="manual",
                )
        if device is None:
            raise HTTPException(status_code=404, detail=f"Device not found: {assignment.device_id}")
        return device
    if assignment.new_device_label and assignment.new_device_label.strip():
        label_key = normalized_label(assignment.new_device_label)
        known = next(
            (
                row
                for row in known_device_rows()
                if normalized_label(row.get("device_label")) == label_key and row.get("device_id")
            ),
            None,
        )
        if known is not None:
            return registry.upsert(
                device_id=known["device_id"],
                label=known.get("device_label") or assignment.new_device_label,
                model=known.get("device_model"),
                koreader_version=known.get("koreader_version"),
                source=known.get("source") or source,
                label_source="manual",
            )
        device = registry.create_manual(assignment.new_device_label, source=source)
        if device is None:
            raise HTTPException(status_code=400, detail="Device label is required.")
        return device
    return default


def raw_device_summaries(snapshot_rows: list[dict], backup_rows: list[dict]) -> dict[str, dict]:
    devices = {item["id"]: item for item in device_registry().list_devices()}
    for row in [*snapshot_rows, *backup_rows]:
        device_id = row.get("device_id")
        if not device_id or device_id in devices:
            continue
        devices[device_id] = {
            "id": device_id,
            "label": row.get("device_label") or device_id,
            "model": row.get("device_model"),
            "source": row.get("source") or "legacy",
            "first_seen": row.get("imported_at") or row.get("created_at"),
            "last_seen": row.get("imported_at") or row.get("created_at"),
        }
    return devices


def display_device_label(value: object) -> str:
    return " ".join(str(value or "").split())


def device_label_display_score(label: str) -> tuple[int, int]:
    return (sum(1 for char in label if char.isupper()), -len(label))


GENERIC_DEVICE_LABEL_KEYS = {
    normalized_label("Kobo device"),
    normalized_label("Primary Kobo"),
    normalized_label("Uploaded databases"),
}


def effective_device_group_key(device: dict, label: str) -> str:
    label_key = normalized_label(label)
    if label_key and label_key not in GENERIC_DEVICE_LABEL_KEYS and label_key != normalized_label(device["id"]):
        return f"label:{label_key}"
    return f"device:{device['id']}"


def effective_device_groups(snapshot_rows: list[dict], backup_rows: list[dict]) -> tuple[list[dict], dict[str, dict]]:
    devices = raw_device_summaries(snapshot_rows, backup_rows)
    grouped: dict[str, dict] = {}
    snapshots_by_device: dict[str, list[dict]] = {}
    backups_by_device: dict[str, list[dict]] = {}
    for row in snapshot_rows:
        if device_id := row.get("device_id"):
            snapshots_by_device.setdefault(device_id, []).append(row)
    for row in backup_rows:
        if device_id := row.get("device_id"):
            backups_by_device.setdefault(device_id, []).append(row)

    for device in sorted(devices.values(), key=lambda item: (item.get("label") or item["id"], item["id"])):
        label = display_device_label(device.get("label") or device["id"]) or device["id"]
        key = effective_device_group_key(device, label)
        group = grouped.setdefault(
            key,
            {
                **device,
                "id": device["id"],
                "label": label,
                "device_ids": [],
                "snapshot_count": 0,
                "backup_count": 0,
                "last_snapshot_at": None,
                "last_backup_at": None,
            },
        )
        if device_label_display_score(label) > device_label_display_score(group["label"]):
            group["label"] = label
        group["device_ids"].append(device["id"])
        group["model"] = group.get("model") or device.get("model")
        group["koreader_version"] = group.get("koreader_version") or device.get("koreader_version")

    group_by_raw_id: dict[str, dict] = {}
    for group in grouped.values():
        raw_ids = set(group["device_ids"])
        device_snapshots = [row for raw_id in raw_ids for row in snapshots_by_device.get(raw_id, [])]
        device_backups = [row for raw_id in raw_ids for row in backups_by_device.get(raw_id, [])]
        group["snapshot_count"] = len(device_snapshots)
        group["backup_count"] = len(device_backups)
        group["last_snapshot_at"] = max((row["imported_at"] for row in device_snapshots), default=None)
        group["last_backup_at"] = max((row["created_at"] for row in device_backups), default=None)
        for raw_id in raw_ids:
            group_by_raw_id[raw_id] = group

    summaries = sorted(grouped.values(), key=lambda item: item.get("label") or item["id"])
    return summaries, group_by_raw_id


def effective_device_ids(device_id: str, snapshot_rows: list[dict], backup_rows: list[dict]) -> set[str]:
    if not device_id or device_id == "all":
        return set()
    summaries, group_by_raw_id = effective_device_groups(snapshot_rows, backup_rows)
    if device_id in group_by_raw_id:
        return set(group_by_raw_id[device_id]["device_ids"])
    group = next((item for item in summaries if item["id"] == device_id), None)
    return set(group["device_ids"]) if group else {device_id}


def with_effective_device(row: dict, group_by_raw_id: dict[str, dict]) -> dict:
    group = group_by_raw_id.get(row.get("device_id"))
    if group is None:
        return row
    return {
        **row,
        "device_id": group["id"],
        "device_label": group["label"],
        "device_model": group.get("model"),
    }


def latest_effective_snapshots(snapshot_rows: list[dict], backup_rows: list[dict]) -> list[SnapshotMeta]:
    _, group_by_raw_id = effective_device_groups(snapshot_rows, backup_rows)
    latest: dict[str, dict] = {}
    for row in snapshot_rows:
        group = group_by_raw_id.get(row.get("device_id"))
        effective_id = group["id"] if group else row.get("device_id")
        if effective_id and effective_id not in latest:
            latest[effective_id] = row
    return [SnapshotMeta(**with_effective_device(row, group_by_raw_id)) for row in latest.values()]


@app.get("/api/device/status")
def get_device_status() -> dict:
    return device_status()


@app.get("/api/devices")
def get_devices() -> dict:
    snapshot_rows = store().list_snapshots()
    backup_rows = backup_store().list_backups()
    summaries, _ = effective_device_groups(snapshot_rows, backup_rows)
    return {"devices": summaries}


@app.patch("/api/devices/{device_id}")
def patch_device(device_id: str, request: DeviceUpdateRequest) -> dict:
    registry = device_registry()
    snapshot_rows = store().list_snapshots()
    backup_rows = backup_store().list_backups()
    target_ids = effective_device_ids(device_id, snapshot_rows, backup_rows) or {device_id}
    renamed: list[dict] = []
    for target_id in sorted(target_ids):
        device = registry.rename(target_id, request.label)
        if device is not None:
            renamed.append(device)
            continue
        known = next((row for row in [*snapshot_rows, *backup_rows] if row.get("device_id") == target_id), None)
        if known is not None:
            registry.upsert(
                device_id=target_id,
                label=known.get("device_label") or target_id,
                model=known.get("device_model"),
                koreader_version=known.get("koreader_version"),
                source=known.get("source") or "legacy",
                label_source="manual",
            )
            device = registry.rename(target_id, request.label)
            if device is not None:
                renamed.append(device)
    if not renamed:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")
    cached_dashboard.cache_clear()
    return {"device": renamed[0]}


@app.post("/api/import/kobo")
def post_import_kobo(request: DeviceAssignmentRequest | None = None) -> dict:
    try:
        result = import_from_kobo(store(), device=resolve_assigned_device(request, source="kobo"))
        snapshot = SnapshotMeta(**result["snapshot"])
        result["dashboard"] = build_dashboard(Path(snapshot.path), snapshot)
        return result
    except ImportError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UnsupportedSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/import/kobo/auto")
def post_auto_import_kobo() -> dict:
    try:
        result = auto_import_from_kobo(store())
        if result["imported"] and result["snapshot"]:
            snapshot = SnapshotMeta(**result["snapshot"])
            result["dashboard"] = build_dashboard(Path(snapshot.path), snapshot)
        return result
    except ImportError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UnsupportedSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/import/upload")
async def post_import_upload(
    file: UploadFile = File(...),
    device_id: str | None = Form(default=None),
    new_device_label: str | None = Form(default=None),
) -> dict:
    suffix = Path(file.filename or "statistics.sqlite3").suffix or ".sqlite3"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            tmp_path = Path(handle.name)
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        assignment = DeviceAssignmentRequest(device_id=device_id, new_device_label=new_device_label)
        if not assignment.device_id and not (assignment.new_device_label and assignment.new_device_label.strip()):
            raise HTTPException(status_code=400, detail="Choose an existing device or enter a device name before uploading.")
        meta = store().import_file(
            tmp_path,
            source_kind="upload",
            source_path=file.filename,
            device=resolve_assigned_device(
                assignment,
                source="upload",
            ),
        )
        return {
            "snapshot": meta.__dict__,
            "dashboard": build_dashboard(Path(meta.path), meta),
        }
    except ImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UnsupportedSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass


@app.get("/api/snapshots")
def get_snapshots(device_id: str = "all") -> dict:
    snapshot_rows = store().list_snapshots()
    backup_rows = backup_store().list_backups()
    _, group_by_raw_id = effective_device_groups(snapshot_rows, backup_rows)
    if device_id and device_id != "all":
        ids = effective_device_ids(device_id, snapshot_rows, backup_rows)
        snapshot_rows = [snapshot for snapshot in snapshot_rows if snapshot.get("device_id") in ids]
    return {"snapshots": [with_effective_device(snapshot, group_by_raw_id) for snapshot in snapshot_rows]}


@app.patch("/api/snapshots/{snapshot_id}/device")
def patch_snapshot_device(snapshot_id: str, request: DeviceAssignmentRequest) -> dict:
    device = resolve_assigned_device(request, source="manual")
    if device is None:
        raise HTTPException(status_code=400, detail="Device assignment is required.")
    snapshot = store().assign_device(snapshot_id, device)
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot not found: {snapshot_id}")
    cached_dashboard.cache_clear()
    return {"snapshot": snapshot.__dict__}


@app.get("/api/backups")
def get_backups(device_id: str = "all") -> dict:
    try:
        snapshot_rows = store().list_snapshots()
        backup_rows = backup_store().list_backups()
        _, group_by_raw_id = effective_device_groups(snapshot_rows, backup_rows)
        if device_id and device_id != "all":
            ids = effective_device_ids(device_id, snapshot_rows, backup_rows)
            backup_rows = [backup for backup in backup_rows if backup.get("device_id") in ids]
        return {"backups": [with_effective_device(backup, group_by_raw_id) for backup in backup_rows]}
    except BackupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/backups/kobo")
def post_backup_kobo() -> dict:
    try:
        return backup_store().create_from_kobo()
    except BackupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/backups/{backup_id}/restore-preview")
def get_restore_preview(backup_id: str) -> dict:
    try:
        return backup_store().restore_preview(backup_id)
    except BackupError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 409
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.post("/api/backups/{backup_id}/restore")
def post_restore_backup(backup_id: str, request: RestoreRequest) -> dict:
    try:
        return backup_store().restore(
            backup_id,
            confirmed=request.confirmed,
            restore_extensions=request.restore_optional_extensions,
        )
    except BackupError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 409
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.get("/api/dashboard")
def get_dashboard(snapshot_id: str = "latest", device_id: str = "all") -> dict:
    if snapshot_id in {"latest", "aggregate"}:
        if device_id and device_id != "all":
            snapshot_rows = store().list_snapshots()
            backup_rows = backup_store().list_backups()
            _, group_by_raw_id = effective_device_groups(snapshot_rows, backup_rows)
            ids = effective_device_ids(device_id, snapshot_rows, backup_rows)
            latest_by_effective_id: dict[str, dict] = {}
            for row in snapshot_rows:
                row_device_id = row.get("device_id")
                group = group_by_raw_id.get(row_device_id)
                effective_id = group["id"] if group else row_device_id
                if row_device_id in ids and effective_id and effective_id not in latest_by_effective_id:
                    latest_by_effective_id[effective_id] = row
            snapshots = [
                SnapshotMeta(**with_effective_device(row, group_by_raw_id))
                for row in latest_by_effective_id.values()
            ]
            if len(snapshots) > 1:
                try:
                    dashboards = [dashboard_for_snapshot(item, include_all_sessions=True) for item in snapshots]
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=404, detail="Snapshot file is missing") from exc
                except UnsupportedSchemaError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
                return aggregate_dashboards(dashboards, snapshots=snapshots)
            snapshot = snapshots[0] if snapshots else None
        else:
            snapshot_rows = store().list_snapshots()
            backup_rows = backup_store().list_backups()
            snapshots = latest_effective_snapshots(snapshot_rows, backup_rows)
            try:
                dashboards = [dashboard_for_snapshot(snapshot, include_all_sessions=True) for snapshot in snapshots]
            except FileNotFoundError as exc:
                raise HTTPException(status_code=404, detail="Snapshot file is missing") from exc
            except UnsupportedSchemaError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            if not dashboards:
                return empty_dashboard()
            return aggregate_dashboards(dashboards, snapshots=snapshots)
    else:
        snapshot = store().resolve(snapshot_id)
    if snapshot is None:
        return empty_dashboard()
    try:
        return dashboard_for_snapshot(snapshot)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Snapshot file is missing: {snapshot.id}") from exc
    except UnsupportedSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
