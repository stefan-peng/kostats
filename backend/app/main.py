from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .device import auto_import_from_kobo, device_status, import_from_kobo
from .errors import ImportError, UnsupportedSchemaError
from .sqlite_stats import SnapshotMeta, build_dashboard
from .storage import SnapshotStore


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


@app.get("/api/device/status")
def get_device_status() -> dict:
    return device_status()


@app.post("/api/import/kobo")
def post_import_kobo() -> dict:
    try:
        result = import_from_kobo(store())
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
async def post_import_upload(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "statistics.sqlite3").suffix or ".sqlite3"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            tmp_path = Path(handle.name)
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        meta = store().import_file(
            tmp_path,
            source_kind="upload",
            source_path=file.filename,
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
def get_snapshots() -> dict:
    return {"snapshots": store().list_snapshots()}


@app.get("/api/dashboard")
def get_dashboard(snapshot_id: str = "latest") -> dict:
    snapshot = store().resolve(snapshot_id)
    if snapshot is None:
        return {
            "has_data": False,
            "snapshot": None,
            "summary": {
                "total_time_seconds": 0,
                "total_time_label": "0m",
                "reading_days": 0,
                "books": 0,
                "pages": 0,
                "current_streak": 0,
            },
            "charts": {
                "daily": [],
                "monthly": [],
                "top_books": [],
                "calendar": {
                    "start_date": None,
                    "end_date": None,
                    "max_minutes": 0,
                    "total_days": 0,
                    "days": [],
                },
            },
            "books": [],
            "recent_books": [],
        }
    try:
        return build_dashboard(Path(snapshot.path), snapshot)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Snapshot file is missing: {snapshot.id}") from exc
    except UnsupportedSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
